import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { one, type Database, type SQL } from '../../../packages/database/index';
import { check, id, audit, DomainError } from '../../../packages/domain/core';
import type { Actor } from './auth';

export async function checkArtwork(tx: SQL, actor: Actor, artwork: string) {
  if (!artwork.startsWith('media:')) return;
  check(
    await one(tx, 'SELECT id FROM media WHERE id=$1 AND owner_id=$2', [artwork.slice(6), actor.id]),
    'MEDIA_FORBIDDEN',
    'Upload artwork using your own account before attaching it.',
    403,
  );
}
export class MediaService {
  constructor(private db: Database) {}
  async upload(actor: Actor, bytes: Buffer) {
    check(
      Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 6 * 1024 * 1024,
      'IMAGE_SIZE',
      'Choose an image no larger than 6 MB.',
      400,
    );
    let image: Buffer, width: number, height: number;
    try {
      const decoder = sharp(bytes, { limitInputPixels: 24_000_000, animated: false });
      const metadata = await decoder.metadata();
      check(
        ['png', 'jpeg', 'webp'].includes(metadata.format || '') && (metadata.pages || 1) === 1,
        'IMAGE_FORMAT',
        'Use a single-frame PNG, JPEG, or WebP image.',
        400,
      );
      const output = await decoder
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer({ resolveWithObject: true });
      image = output.data;
      width = output.info.width;
      height = output.info.height;
    } catch {
      throw new DomainError(
        400,
        'INVALID_IMAGE',
        'This image could not be decoded. Use a PNG, JPEG, or WebP under 6 MB and 24 megapixels.',
      );
    }
    const mediaId = id();
    await this.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO media(id,owner_id,mime,data,width,height,hash) VALUES ($1,$2,'image/webp',$3,$4,$5,$6)",
        [mediaId, actor.id, image, width, height, createHash('sha256').update(image).digest('hex')],
      );
      await audit(tx, actor.id, 'media.uploaded', mediaId);
    });
    return { id: mediaId, artwork: `media:${mediaId}`, width, height };
  }
  async read(mediaId: string, actor: Actor | null) {
    const row = await one(
      this.db,
      `SELECT m.*,
      EXISTS(SELECT 1 FROM collections c WHERE c.artwork='media:'||m.id AND c.status='published') OR
      EXISTS(SELECT 1 FROM assets a JOIN listings l ON l.asset_id=a.id WHERE a.artwork='media:'||m.id AND l.status IN ('active','reserved','sold')) AS public
      FROM media m WHERE m.id=$1`,
      [mediaId],
    );
    const allowed =
      row &&
      (row.public ||
        row.owner_id === actor?.id ||
        (actor?.is_staff &&
          actor.staff_permissions.some((p) => ['rights', 'warehouse', 'via'].includes(p))) ||
        (actor &&
          (await one(
            this.db,
            `SELECT c.id FROM collections c JOIN memberships m ON m.org_id=c.org_id
          WHERE c.artwork=$1 AND m.user_id=$2`,
            [`media:${mediaId}`, actor.id],
          ))) ||
        (await one(this.db, `SELECT a.id FROM assets a WHERE a.artwork=$1 AND a.owner_id=$2`, [
          `media:${mediaId}`,
          actor?.id || '',
        ])));
    check(allowed, 'NOT_FOUND', 'Image not found.', 404);
    return row!;
  }
}
