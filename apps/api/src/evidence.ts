import { z } from 'zod';
import sharp from 'sharp';
import { one, type Database, type SQL } from '../../../packages/database/index';
import { check, id, audit, DomainError } from '../../../packages/domain/core';
import { requireEligibility } from '../../../packages/domain/privacy';
import { type Actor, requireStaff } from './auth';
import { lockChannels } from './channel-core';
import { digest, type EvidenceOptions } from './evidence-providers';

export const fileInput = z
  .object({
    client_key: z.string().min(8).max(120),
    purpose: z.enum(['artwork', 'intake', 'rights', 'shipment', 'incident']),
    asset_id: z.string().max(100).optional(),
    collection_id: z.string().max(100).optional(),
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
    size: z.number().int().min(1).max(10485760),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type FileInput = z.infer<typeof fileInput>;
const reviewPermission = (purpose: string) =>
  purpose === 'rights' || purpose === 'artwork'
    ? 'rights'
    : purpose === 'incident'
      ? 'support'
      : 'warehouse';
const projection =
  'id,owner_id,purpose,asset_id,collection_id,mime,size,hash,state,scan_engine,scanned_at,error_code,review_note,reviewed_by,retain_until,legal_hold,created_at';
async function scope(tx: SQL, actor: Actor, f: any, write = false) {
  const staff = actor.is_staff && actor.staff_permissions.includes(reviewPermission(f.purpose));
  if (staff) return;
  if (f.purpose === 'artwork') {
    check(!f.owner_id || f.owner_id === actor.id, 'NOT_FOUND', 'Upload not found.', 404);
    return;
  }
  if (f.collection_id) {
    check(
      f.purpose === 'rights' &&
        (await one(
          tx,
          `SELECT c.id FROM collections c JOIN memberships m ON m.org_id=c.org_id WHERE c.id=$1 AND m.user_id=$2 ${write ? "AND m.role IN ('owner','publisher')" : ''}`,
          [f.collection_id, actor.id],
        )),
      'NOT_FOUND',
      'Evidence scope not found.',
      404,
    );
    return;
  }
  check(!f.owner_id || f.owner_id === actor.id, 'NOT_FOUND', 'Evidence scope not found.', 404);
  check(
    f.asset_id &&
      (await one(tx, 'SELECT id FROM assets WHERE id=$1 AND owner_id=$2', [f.asset_id, actor.id])),
    'NOT_FOUND',
    'Evidence scope not found.',
    404,
  );
}
export async function approvedEvidence(tx: SQL, file: string, asset: string, purposes: string[]) {
  const f = await one(tx, 'SELECT * FROM stored_files WHERE id=$1 FOR SHARE', [file]);
  check(
    f && f.asset_id === asset && purposes.includes(f.purpose) && f.state === 'approved',
    'EVIDENCE_REQUIRED',
    'Use approved, malware-scanned evidence for this exact item.',
  );
  return f;
}
export class EvidenceService {
  constructor(
    private db: Database,
    public options: EvidenceOptions = {},
  ) {}
  async reserve(actor: Actor, input: FileInput) {
    const d = fileInput.parse(input);
    check(
      !(d.asset_id && d.collection_id) &&
        (d.purpose === 'artwork'
          ? !d.asset_id && !d.collection_id && d.mime !== 'application/pdf'
          : !!(d.asset_id || d.collection_id)),
      'EVIDENCE_SCOPE',
      'Choose one evidence scope, or an image for artwork.',
      400,
    );
    check(
      d.purpose !== 'rights' || !!d.collection_id,
      'EVIDENCE_SCOPE',
      'Rights documents belong to a collection.',
      400,
    );
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await requireEligibility(tx, actor.id);
      await scope(tx, actor, d, true);
      const old = await one(tx, 'SELECT * FROM stored_files WHERE owner_id=$1 AND client_key=$2', [
        actor.id,
        d.client_key,
      ]);
      if (old) {
        check(
          ['purpose', 'mime', 'size', 'hash', 'asset_id', 'collection_id'].every(
            (k) => (old[k] || null) === ((d as any)[k] || null),
          ),
          'UPLOAD_CONFLICT',
          'Reuse the upload key only for the same document.',
          409,
        );
        return { id: old.id, state: old.state };
      }
      const count = await one(
        tx,
        "SELECT count(*)::int AS n FROM stored_files WHERE owner_id=$1 AND created_at>now()-interval '1 day'",
        [actor.id],
      );
      check(count!.n < 50, 'UPLOAD_LIMIT', 'Daily upload limit reached.', 429);
      const fid = id();
      await tx.query(
        'INSERT INTO stored_files(id,owner_id,client_key,purpose,asset_id,collection_id,mime,size,hash,store,object_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          fid,
          actor.id,
          d.client_key,
          d.purpose,
          d.asset_id || null,
          d.collection_id || null,
          d.mime,
          d.size,
          d.hash,
          this.options.store ? 's3' : 'database',
          `pixup/${fid}/original`,
        ],
      );
      await audit(tx, actor.id, 'evidence.reserved', fid, { purpose: d.purpose });
      return { id: fid, state: 'awaiting_upload' };
    });
  }
  async upload(actor: Actor, fid: string, bytes: Buffer) {
    check(Buffer.isBuffer(bytes), 'UPLOAD_BYTES', 'Send supported raw file bytes.', 400);
    const f = await one(this.db, 'SELECT * FROM stored_files WHERE id=$1 AND owner_id=$2', [
      fid,
      actor.id,
    ]);
    check(f, 'NOT_FOUND', 'Upload not found.', 404);
    await scope(this.db, actor, f, true);
    check(
      bytes.length === f.size && digest(bytes) === f.hash,
      'UPLOAD_HASH',
      'File bytes do not match the reserved size and digest.',
      400,
    );
    check(
      f.state !== 'purged' && f.state !== 'purging',
      'UPLOAD_EXPIRED',
      'This upload was purged.',
      410,
    );
    if (f.state !== 'awaiting_upload') return { id: fid, state: f.state };
    check(
      Date.parse(f.created_at) > Date.now() - 86400000,
      'UPLOAD_EXPIRED',
      'Upload reservation expired; reserve a new upload.',
      410,
    );
    if (f.mime === 'application/pdf')
      check(
        bytes.subarray(0, 5).toString() === '%PDF-',
        'FILE_FORMAT',
        'Choose a PDF document.',
        400,
      );
    else {
      try {
        const m = await sharp(bytes, { limitInputPixels: 24_000_000, animated: false }).metadata();
        check(
          `image/${m.format}` === f.mime && (m.pages || 1) === 1,
          'FILE_FORMAT',
          'Choose a single-frame PNG, JPEG or WebP.',
          400,
        );
      } catch {
        throw new DomainError(400, 'FILE_FORMAT', 'Invalid image or image exceeds 24 megapixels.');
      }
    }
    if (f.store === 's3') {
      check(
        this.options.store,
        'STORAGE_UNAVAILABLE',
        'Restore the original storage configuration.',
        503,
      );
      await this.options.store.put(f.object_key, bytes);
    }
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await scope(tx, actor, f, true);
      await requireEligibility(tx, actor.id);
      await tx.query(
        "UPDATE stored_files SET state='pending_scan',data=$2 WHERE id=$1 AND state='awaiting_upload'",
        [fid, f.store === 'database' ? bytes : null],
      );
      await audit(tx, actor.id, 'evidence.uploaded', fid);
    });
    return { id: fid, state: 'pending_scan' };
  }
  private async bytes(f: any, preview = false) {
    if (f.store === 'database') return Buffer.from(preview ? f.preview_data : f.data);
    check(
      this.options.store,
      'STORAGE_UNAVAILABLE',
      'Restore the original storage configuration.',
      503,
    );
    return this.options.store.get(preview ? f.preview_key : f.object_key);
  }
  async process(fid: string) {
    const f = await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      return one(
        tx,
        "UPDATE stored_files SET scan_version=scan_version+1,checked_at=now() WHERE id=$1 AND state IN ('pending_scan','scan_failed') RETURNING *",
        [fid],
      );
    });
    if (!f) return;
    try {
      check(
        this.options.scanner,
        'SCANNER_UNAVAILABLE',
        'Configure malware scanning before reviewing files.',
        503,
      );
      const bytes = await this.bytes(f);
      check(
        bytes.length === f.size && digest(bytes) === f.hash,
        'FILE_INTEGRITY',
        'Stored evidence failed its integrity check.',
        503,
      );
      const result = await this.options.scanner.scan(bytes);
      let preview: Buffer | undefined, width: number | undefined, height: number | undefined;
      if (result.clean && f.purpose === 'artwork') {
        const out = await sharp(bytes, { limitInputPixels: 24_000_000, animated: false })
          .rotate()
          .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 88 })
          .toBuffer({ resolveWithObject: true });
        preview = out.data;
        width = out.info.width;
        height = out.info.height;
        if (f.store === 's3') await this.options.store!.put(`pixup/${fid}/preview`, preview);
      }
      const applied = await this.db.transaction(async (tx) => {
        await lockChannels(tx);
        const saved = await one(
          tx,
          "UPDATE stored_files SET state=$3,scan_engine=$4,scanned_at=now(),error_code=NULL,preview_key=$5,preview_data=$6 WHERE id=$1 AND scan_version=$2 AND state IN ('pending_scan','scan_failed') RETURNING id",
          [
            fid,
            f.scan_version,
            result.clean ? 'pending_review' : 'blocked',
            result.engine,
            preview ? `pixup/${fid}/preview` : null,
            f.store === 'database' && preview ? preview : null,
          ],
        );
        if (!saved) return false;
        if (preview)
          await tx.query(
            "INSERT INTO media(id,owner_id,mime,data,width,height,hash,file_id) VALUES ($1,$2,'image/webp',NULL,$3,$4,$5,$1) ON CONFLICT(id) DO NOTHING",
            [fid, f.owner_id, width, height, digest(preview)],
          );
        await audit(
          tx,
          f.owner_id,
          result.clean ? 'evidence.scan_clean' : 'evidence.scan_blocked',
          fid,
          { engine: result.engine },
        );
        return true;
      });
      if (!applied && preview && f.store === 's3') {
        const current = await one(this.db, 'SELECT state FROM stored_files WHERE id=$1', [fid]);
        if (['purging', 'purged'].includes(current?.state)) {
          try {
            await this.options.store!.delete(`pixup/${fid}/preview`);
          } catch {
            await this.db.query(
              "UPDATE stored_files SET state='purging',error_code='PURGE_RETRY' WHERE id=$1 AND state IN ('purging','purged')",
              [fid],
            );
          }
        }
      }
    } catch (e) {
      await this.db.query(
        "UPDATE stored_files SET state='scan_failed',error_code=$3 WHERE id=$1 AND scan_version=$2 AND state IN ('pending_scan','scan_failed')",
        [fid, f.scan_version, e instanceof DomainError ? e.code : 'SCAN_FAILED'],
      );
    }
  }
  async worker() {
    const files = (
      await this.db.query(
        "SELECT id FROM stored_files WHERE state IN ('pending_scan','scan_failed') AND (checked_at IS NULL OR checked_at<now()-interval '1 minute') ORDER BY created_at LIMIT 5",
      )
    ).rows;
    for (const f of files) await this.process(f.id);
  }
  async review(actor: Actor, fid: string, approve: boolean, note: string) {
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const f = await one(tx, 'SELECT * FROM stored_files WHERE id=$1 FOR UPDATE', [fid]);
      check(f, 'NOT_FOUND', 'Evidence not found.', 404);
      requireStaff(actor, reviewPermission(f.purpose));
      check(
        f.owner_id !== actor.id,
        'SELF_REVIEW',
        'Another reviewer must moderate this upload.',
        403,
      );
      check(
        f.state === 'pending_review' || (!approve && f.state === 'approved'),
        'SCAN_REQUIRED',
        'Only clean files awaiting review can be approved.',
      );
      await tx.query(
        'UPDATE stored_files SET state=$2,reviewed_by=$3,review_note=$4,reviewed_at=now() WHERE id=$1',
        [fid, approve ? 'approved' : 'rejected', actor.id, note],
      );
      await audit(tx, actor.id, approve ? 'evidence.approved' : 'evidence.rejected', fid, { note });
      return { ok: true };
    });
  }
  async list(actor: Actor) {
    const roles = actor.is_staff ? actor.staff_permissions : [];
    return {
      files: (
        await this.db.query(
          `SELECT ${projection} FROM stored_files WHERE owner_id=$1 OR (purpose IN ('artwork','rights') AND $2) OR (purpose IN ('intake','shipment') AND $3) OR (purpose='incident' AND $4) OR $5 ORDER BY created_at DESC LIMIT 100`,
          [
            actor.id,
            roles.includes('rights'),
            roles.includes('warehouse'),
            roles.includes('support'),
            roles.includes('audit'),
          ],
        )
      ).rows,
    };
  }
  async read(actor: Actor, fid: string) {
    const f = await one(this.db, 'SELECT * FROM stored_files WHERE id=$1', [fid]);
    check(f, 'NOT_FOUND', 'Evidence not found.', 404);
    await scope(this.db, actor, f);
    check(
      ['pending_review', 'approved'].includes(f.state),
      'FILE_QUARANTINED',
      'This file is quarantined or unavailable.',
      423,
    );
    const bytes = await this.bytes(f);
    check(digest(bytes) === f.hash, 'FILE_INTEGRITY', 'Evidence integrity check failed.', 503);
    await scope(this.db, actor, f);
    check(
      ['pending_review', 'approved'].includes(
        (await one(this.db, 'SELECT state FROM stored_files WHERE id=$1', [fid]))?.state,
      ),
      'FILE_QUARANTINED',
      'This file is no longer available.',
      423,
    );
    await audit(this.db, actor.id, 'evidence.downloaded', fid);
    return { bytes, mime: f.mime };
  }
  async artwork(fid: string) {
    const f = await one(this.db, 'SELECT * FROM stored_files WHERE id=$1', [fid]);
    check(f?.state === 'approved', 'NOT_FOUND', 'Approved artwork not found.', 404);
    const bytes = await this.bytes(f, true),
      m = await one(this.db, 'SELECT hash FROM media WHERE file_id=$1', [fid]);
    check(m && digest(bytes) === m.hash, 'FILE_INTEGRITY', 'Artwork integrity check failed.', 503);
    check(
      (await one(this.db, 'SELECT state FROM stored_files WHERE id=$1', [fid]))?.state ===
        'approved',
      'NOT_FOUND',
      'Approved artwork not found.',
      404,
    );
    return bytes;
  }
  async hold(actor: Actor, fid: string, hold: boolean, note: string) {
    requireStaff(actor, 'audit');
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const f = await one(tx, 'SELECT state FROM stored_files WHERE id=$1 FOR UPDATE', [fid]);
      check(
        f && !['purging', 'purged'].includes(f.state),
        'FILE_UNAVAILABLE',
        'This file is no longer available for retention changes.',
      );
      await tx.query('UPDATE stored_files SET legal_hold=$2 WHERE id=$1', [fid, hold]);
      await audit(tx, actor.id, 'evidence.retention_hold', fid, { hold, note });
      return { ok: true };
    });
  }
  async purge(actor: Actor, fid: string, note: string) {
    requireStaff(actor, 'audit');
    const f = await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const f = await one(tx, 'SELECT * FROM stored_files WHERE id=$1 FOR UPDATE', [fid]);
      check(f, 'NOT_FOUND', 'Evidence not found.', 404);
      if (f.state === 'purged') return f;
      check(
        !f.legal_hold && Date.parse(f.retain_until) < Date.now(),
        'RETENTION_HOLD',
        'Retention has not expired or a legal hold applies.',
      );
      const attached = await one(
        tx,
        `SELECT id FROM physical_captures WHERE front_file=$1 OR back_file=$1 UNION ALL SELECT id FROM shipments WHERE evidence_id=$1 UNION ALL SELECT id FROM shipment_events WHERE evidence_id=$1 UNION ALL SELECT id FROM physical_incidents WHERE evidence_id=$1 UNION ALL SELECT id FROM collections WHERE artwork='media:'||$1 UNION ALL SELECT id FROM assets WHERE artwork='media:'||$1 LIMIT 1`,
        [fid],
      );
      check(
        !attached,
        'RETENTION_HOLD',
        'Evidence referenced by business records requires a separate retention review.',
      );
      check(
        !f.collection_id &&
          (!f.asset_id ||
            !(await one(
              tx,
              "SELECT id FROM intakes WHERE asset_id=$1 AND status IN ('awaiting_receipt','received') UNION ALL SELECT id FROM orders WHERE asset_id=$1 AND status IN ('pending_payment','paid') UNION ALL SELECT id FROM physical_incidents WHERE asset_id=$1 AND state='open' LIMIT 1",
              [f.asset_id],
            ))),
        'RETENTION_HOLD',
        'Rights evidence or an active custody/payment case requires further retention review.',
      );
      await tx.query(
        "UPDATE stored_files SET state='purging',scan_version=scan_version+1 WHERE id=$1",
        [fid],
      );
      await audit(tx, actor.id, 'evidence.purge_requested', fid, { note });
      return f;
    });
    if (f.state === 'purged') return { ok: true };
    if (f.store === 's3') {
      check(
        this.options.store,
        'STORAGE_UNAVAILABLE',
        'Restore the original storage configuration.',
        503,
      );
      await this.options.store.delete(f.object_key);
      if (f.purpose === 'artwork') await this.options.store.delete(`pixup/${fid}/preview`);
    }
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await tx.query(
        "UPDATE stored_files SET state='purged',data=NULL,preview_data=NULL WHERE id=$1 AND state='purging'",
        [fid],
      );
      await audit(tx, actor.id, 'evidence.purged', fid, { note });
    });
    return { ok: true };
  }
}
