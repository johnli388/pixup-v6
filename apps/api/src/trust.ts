import { readFile } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import { z } from 'zod';
import { one, type Database, type SQL } from '../../../packages/database/index';
import { audit, check, id } from '../../../packages/domain/core';
import {
  canonical,
  digest,
  merkle,
  signatureValid,
  type TrustKey,
  type Head,
} from '../../../packages/domain/trust';
import { verifyIntegrity } from '../../../packages/operations/integrity';
import { requireStaff, type Actor } from './auth';
import { lockChannels } from './channel-core';
const trustSchema = z
  .object({
    keys: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            purpose: z.enum(['certificate', 'checkpoint']),
            public_key: z.string().max(2000),
            not_before: z.iso.datetime(),
            not_after: z.iso.datetime(),
            revoked: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export class TrustService {
  constructor(
    private db: Database,
    private storePath = process.env.CERT_TRUST_STORE,
  ) {}
  private async keys(): Promise<TrustKey[]> {
    if (!this.storePath) return [];
    try {
      const data = trustSchema.parse(JSON.parse(await readFile(this.storePath, 'utf8')));
      check(
        new Set(data.keys.map((k) => k.id)).size === data.keys.length,
        'INVALID_TRUST_STORE',
        'Duplicate key IDs.',
      );
      for (const k of data.keys)
        check(
          !k.public_key.includes('PRIVATE') &&
            createPublicKey(k.public_key).asymmetricKeyType === 'ed25519' &&
            Date.parse(k.not_before) < Date.parse(k.not_after),
          'INVALID_TRUST_STORE',
          'Invalid public verification key.',
        );
      return data.keys;
    } catch {
      check(
        false,
        'TRUST_UNAVAILABLE',
        'The independently provisioned public trust store is unavailable.',
        503,
      );
    }
  }
  private async certificatePayload(tx: SQL, cid: string) {
    const c = await one(
      tx,
      `SELECT c.id,c.asset_id,c.assessment_id,c.status,c.created_at,a.serial,a.certification,s.result,s.grade,s.evidence,s.created_at AS assessed_at,s.reviewer_id
    FROM certificates c JOIN assets a ON a.id=c.asset_id JOIN assessments s ON s.id=c.assessment_id WHERE c.id=$1`,
      [cid],
    );
    check(c, 'NOT_FOUND', 'Certificate not found.', 404);
    return {
      row: c,
      body: {
        certificate_id: c.id,
        asset_id: c.asset_id,
        serial: c.serial,
        assessment_id: c.assessment_id,
        result: c.result,
        grade: c.grade,
        assessed_at: new Date(c.assessed_at).toISOString(),
        certificate_created_at: new Date(c.created_at).toISOString(),
        evidence_hash: digest(c.evidence),
        simulation: true,
      },
    };
  }
  async request(actor: Actor, kind: 'certificate' | 'checkpoint', resource: string) {
    requireStaff(actor, 'audit');
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const rid = id();
      let body: Record<string, unknown>;
      let entries: Head[] = [];
      if (kind === 'certificate') {
        const c = await this.certificatePayload(tx, resource);
        check(
          c.row.reviewer_id !== actor.id,
          'SELF_SIGNING',
          'The assessment reviewer cannot request its signature.',
          403,
        );
        check(
          c.row.status === 'active' && c.row.certification === 'verified',
          'CERTIFICATE_INACTIVE',
          'Only a current verified assessment can be signed.',
        );
        body = c.body;
      } else {
        await verifyIntegrity(tx);
        entries = (
          await tx.query<Head>(
            'SELECT DISTINCT ON(asset_id) asset_id,sequence,hash FROM provenance_events ORDER BY asset_id,sequence DESC',
          )
        ).rows;
        check(
          entries.length <= 10000,
          'CHECKPOINT_CAPACITY',
          'Use the production checkpoint pipeline for more than 10,000 heads.',
        );
        const last = await one(
          tx,
          `SELECT r.payload FROM trust_signatures s JOIN signing_requests r ON r.id=s.request_id WHERE r.kind='checkpoint' ORDER BY (r.payload->>'sequence')::int DESC LIMIT 1`,
        );
        body = {
          sequence: (last?.payload.sequence || 0) + 1,
          previous_digest: last ? digest(canonical(last.payload)) : 'genesis',
          root: merkle(entries).root,
          count: entries.length,
          simulation: true,
        };
        resource = String(body.sequence);
      }
      const payload = {
        version: 'pixup-trust-v1',
        kind,
        request_id: rid,
        issued_at: new Date().toISOString(),
        ...body,
      };
      await tx.query(
        'INSERT INTO signing_requests(id,kind,resource_id,payload,entries,created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [rid, kind, resource, JSON.stringify(payload), JSON.stringify(entries), actor.id],
      );
      await audit(tx, actor.id, 'trust.signing_requested', rid, { kind });
      return { request_id: rid, payload, entries, payload_hash: digest(canonical(payload)) };
    });
  }
  async accept(actor: Actor, rid: string, keyId: string, signature: string) {
    requireStaff(actor, 'audit');
    const keys = await this.keys();
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const r = await one(tx, 'SELECT * FROM signing_requests WHERE id=$1', [rid]);
      check(r, 'NOT_FOUND', 'Signing request not found.', 404);
      const prior = await one(tx, 'SELECT * FROM trust_signatures WHERE request_id=$1', [rid]);
      if (prior) {
        check(
          prior.key_id === keyId && prior.signature === signature,
          'SIGNATURE_CONFLICT',
          'This request already has a different signature.',
        );
        return { id: prior.id };
      }
      check(
        Date.parse(r.expires_at) > Date.now(),
        'REQUEST_EXPIRED',
        'Create a fresh signing request.',
      );
      const key = keys.find((k) => k.id === keyId);
      check(
        key && Date.now() <= Date.parse(key.not_after) && signatureValid(r.payload, signature, key),
        'SIGNATURE_INVALID',
        'Signature or independently configured key is invalid.',
      );
      if (r.kind === 'certificate') {
        const c = await this.certificatePayload(tx, r.resource_id);
        check(
          c.row.reviewer_id !== actor.id,
          'SELF_SIGNING',
          'The assessment reviewer cannot import its signature.',
          403,
        );
        check(
          c.row.status === 'active' && c.row.certification === 'verified',
          'CERTIFICATE_INACTIVE',
          'The assessment is no longer current.',
        );
        for (const [k, v] of Object.entries(c.body))
          check(
            r.payload[k] === v,
            'CERTIFICATE_CHANGED',
            'Certificate content changed after the request.',
          );
      } else {
        const last = await one(
          tx,
          `SELECT r.payload FROM trust_signatures s JOIN signing_requests r ON r.id=s.request_id WHERE r.kind='checkpoint' ORDER BY (r.payload->>'sequence')::int DESC LIMIT 1`,
        );
        check(
          r.payload.sequence === (last?.payload.sequence || 0) + 1 &&
            r.payload.previous_digest === (last ? digest(canonical(last.payload)) : 'genesis'),
          'CHECKPOINT_CONFLICT',
          'Another checkpoint advanced the chain; request a new checkpoint.',
        );
        check(
          merkle(r.entries).root === r.payload.root,
          'CHECKPOINT_INVALID',
          'Checkpoint content mismatch.',
        );
      }
      const sid = id();
      await tx.query(
        'INSERT INTO trust_signatures(id,request_id,key_id,signature,imported_by) VALUES ($1,$2,$3,$4,$5)',
        [sid, rid, keyId, signature, actor.id],
      );
      await audit(tx, actor.id, 'trust.signature_imported', sid, { key_id: keyId, kind: r.kind });
      return { id: sid };
    });
  }
  async verification(cid: string) {
    const c = await this.certificatePayload(this.db, cid);
    let keys: TrustKey[];
    try {
      keys = await this.keys();
    } catch {
      return { state: 'trust_unavailable', signed: false, checkpoint: null };
    }
    const signatures = (
      await this.db.query(
        `SELECT r.payload,s.key_id,s.signature FROM trust_signatures s JOIN signing_requests r ON r.id=s.request_id WHERE r.kind='certificate' AND r.resource_id=$1 ORDER BY s.created_at DESC,s.id DESC`,
        [cid],
      )
    ).rows;
    const verified = signatures.find(
      (s) =>
        signatureValid(
          s.payload,
          s.signature,
          keys.find((k) => k.id === s.key_id),
        ) && Object.entries(c.body).every(([k, v]) => s.payload[k] === v),
    );
    const latest = await one(
      this.db,
      `SELECT r.payload,r.entries,s.key_id,s.signature FROM trust_signatures s JOIN signing_requests r ON r.id=s.request_id WHERE r.kind='checkpoint' ORDER BY (r.payload->>'sequence')::int DESC LIMIT 1`,
    );
    let checkpoint: Record<string, unknown> | null = null;
    if (
      latest &&
      signatureValid(
        latest.payload,
        latest.signature,
        keys.find((k) => k.id === latest.key_id),
      )
    ) {
      const entries = latest.entries as Head[],
        index = entries.findIndex((e) => e.asset_id === c.row.asset_id);
      if (index >= 0 && merkle(entries).root === latest.payload.root) {
        const head = await one(
          this.db,
          'SELECT sequence,hash FROM provenance_events WHERE asset_id=$1 ORDER BY sequence DESC LIMIT 1',
          [c.row.asset_id],
        );
        checkpoint = {
          payload: latest.payload,
          key_id: latest.key_id,
          signature: latest.signature,
          head: entries[index],
          proof: merkle(entries, index).proof,
          current_head:
            head?.sequence === entries[index].sequence && head?.hash === entries[index].hash,
        };
      }
    }
    return {
      state: verified
        ? 'signature_verified'
        : signatures.length
          ? 'untrusted_signature'
          : keys.length
            ? 'unsigned'
            : 'trust_not_configured',
      signed: !!verified,
      ...(verified
        ? { payload: verified.payload, key_id: verified.key_id, signature: verified.signature }
        : {}),
      checkpoint,
    };
  }
  async dashboard(actor: Actor) {
    requireStaff(actor, 'audit');
    const keys = await this.keys();
    return {
      keys: keys.map(({ public_key, ...k }) => ({ ...k, fingerprint: digest(public_key) })),
      requests: (
        await this.db.query(
          'SELECT id,kind,resource_id,payload,expires_at FROM signing_requests ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
      signatures: (
        await this.db.query(
          'SELECT id,request_id,key_id,created_at FROM trust_signatures ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
      boundary:
        'Private signing keys are never accepted by the API. Public trust roots are provisioned independently.',
    };
  }
}
