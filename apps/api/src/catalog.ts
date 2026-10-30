import type { Database, SQL } from '../../../packages/database/index';
import { one } from '../../../packages/database/index';
import { check, id, provenance, audit } from '../../../packages/domain/core';
import type { Actor } from './auth';
import { checkArtwork } from './media';

export const assetView = `SELECT a.*,c.title AS collection_title,c.edition_size,c.issuance_mode,
  l.id AS listing_id,l.price_cents,l.status AS listing_status,
  u.name AS seller_name,cert.id AS certificate_id
  FROM assets a LEFT JOIN collections c ON c.id=a.collection_id
  LEFT JOIN LATERAL (SELECT * FROM listings WHERE asset_id=a.id ORDER BY CASE WHEN status IN ('active','reserved') THEN 0 ELSE 1 END,created_at DESC LIMIT 1) l ON true
  LEFT JOIN users u ON u.id=l.seller_id
  LEFT JOIN LATERAL (SELECT id FROM certificates WHERE asset_id=a.id AND status='active' ORDER BY created_at DESC LIMIT 1) cert ON true`;

export class CatalogService {
  constructor(private db: Database) {}
  async browse() {
    const items = (
      await this.db.query(
        `${assetView} WHERE l.status IN ('active','reserved') AND (c.status='published' OR c.id IS NULL) ORDER BY a.created_at,a.edition_number`,
      )
    ).rows;
    const collections = (
      await this.db
        .query(`SELECT c.id,c.title,c.description,c.category,c.artwork,c.edition_size,c.issuance_mode,o.name AS creator_name,
      (SELECT count(*)::int FROM assets a JOIN listings l ON l.asset_id=a.id AND l.status='active' WHERE a.collection_id=c.id) AS available
      FROM collections c JOIN organizations o ON o.id=c.org_id WHERE c.status='published' ORDER BY c.created_at`)
    ).rows;
    return { items: items.map(({ owner_id, ...item }) => item), collections, mode: 'demo' };
  }
  async item(assetId: string, actor?: Actor | null) {
    const item = await one(this.db, `${assetView} WHERE a.id=$1`, [assetId]);
    check(item, 'NOT_FOUND', 'Collectible not found.', 404);
    const c = item.collection_id
      ? await one(this.db, 'SELECT status FROM collections WHERE id=$1', [item.collection_id])
      : null;
    check(
      item.owner_id === actor?.id ||
        (actor?.is_staff &&
          actor.staff_permissions.some((p) => ['rights', 'warehouse', 'via'].includes(p))) ||
        c?.status === 'published' ||
        item.listing_status,
      'NOT_FOUND',
      'Collectible not found.',
      404,
    );
    const history = (
      await this.db.query(
        'SELECT id,type,description,created_at,hash,previous_hash,sequence FROM provenance_events WHERE asset_id=$1 ORDER BY sequence DESC',
        [assetId],
      )
    ).rows;
    const sales = (
      await this.db.query(
        `SELECT o.total_cents-o.shipping_cents+o.credit_units AS amount_cents,o.paid_at FROM orders o
      JOIN assets a ON a.id=o.asset_id WHERE a.collection_id=$1 AND a.grade=$2 AND o.status IN ('paid','fulfilled') AND o.credit_units=0 ORDER BY o.paid_at DESC LIMIT 20`,
        [item.collection_id, item.grade],
      )
    ).rows;
    const { owner_id, ...publicItem } = item;
    return {
      ...publicItem,
      is_owner: owner_id === actor?.id,
      history,
      pricing: {
        sample_count: sales.length,
        sufficient: sales.length >= 5,
        observations: sales,
        label: 'Demo completed sales only; different specimens may not be comparable.',
      },
    };
  }
  async collection(cid: string) {
    const collection = await one(
      this.db,
      `SELECT c.id,c.title,c.description,c.category,c.edition_size,c.artwork,c.issuance_mode,o.name AS creator_name FROM collections c JOIN organizations o ON o.id=c.org_id WHERE c.id=$1 AND c.status='published'`,
      [cid],
    );
    check(collection, 'NOT_FOUND', 'Collection not found.', 404);
    return {
      ...collection,
      items: (
        await this.db.query(
          `${assetView} WHERE a.collection_id=$1 AND l.status IN ('active','reserved')`,
          [cid],
        )
      ).rows.map(({ owner_id, ...item }) => item),
    };
  }
  async verify(cid: string) {
    const cert = await one(
      this.db,
      `SELECT c.id,c.status,c.created_at,a.id AS asset_id,a.title,a.serial,a.artwork,a.certification,a.custody,s.grade,s.result,s.created_at AS assessed_at
      FROM certificates c JOIN assets a ON a.id=c.asset_id JOIN assessments s ON s.id=c.assessment_id WHERE c.id=$1`,
      [cid],
    );
    check(cert, 'NOT_FOUND', 'Certificate not found.', 404);
    return {
      ...cert,
      scope: 'Demonstration record. No real physical authentication or external signature service.',
      valid: cert.status === 'active' && cert.certification === 'verified',
    };
  }
  async portfolio(actor: Actor) {
    return {
      items: (
        await this.db.query(`${assetView} WHERE a.owner_id=$1 ORDER BY a.created_at DESC`, [
          actor.id,
        ])
      ).rows,
      saved: (
        await this.db.query(
          `${assetView} JOIN saved_items s ON s.asset_id=a.id WHERE s.user_id=$1`,
          [actor.id],
        )
      ).rows,
      intakes: (
        await this.db.query(
          'SELECT i.*,a.title,a.artwork FROM intakes i JOIN assets a ON a.id=i.asset_id WHERE i.user_id=$1 ORDER BY i.created_at DESC',
          [actor.id],
        )
      ).rows,
    };
  }
  async save(actor: Actor, assetId: string, saved: boolean) {
    await this.item(assetId, actor);
    if (saved)
      await this.db.query(
        'INSERT INTO saved_items(user_id,asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [actor.id, assetId],
      );
    else
      await this.db.query('DELETE FROM saved_items WHERE user_id=$1 AND asset_id=$2', [
        actor.id,
        assetId,
      ]);
    return { saved };
  }
  async member(tx: SQL, actor: Actor, org: string, publish = false, readOnly = false) {
    const m = await one(
      tx,
      'SELECT m.role,o.kind FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=$1 AND m.org_id=$2 FOR SHARE OF m',
      [actor.id, org],
    );
    check(
      m &&
        (readOnly || ['owner', 'publisher'].includes(m.role)) &&
        (!publish || m.kind === 'creator' || m.kind === 'platform'),
      'FORBIDDEN',
      'This workspace does not grant publishing access.',
      403,
    );
  }
  async creator(actor: Actor, org: string) {
    await this.member(this.db, actor, org, true, true);
    const collections = (
      await this.db.query(
        `SELECT c.*,(SELECT count(*)::int FROM assets a WHERE a.collection_id=c.id) AS stock_count FROM collections c WHERE c.org_id=$1 ORDER BY created_at DESC`,
        [org],
      )
    ).rows;
    const sales = (
      await this.db.query(
        `SELECT o.id,o.total_cents,o.status,o.created_at,a.title,c.issuance_mode FROM orders o JOIN assets a ON a.id=o.asset_id JOIN collections c ON c.id=a.collection_id WHERE c.org_id=$1 ORDER BY o.created_at DESC`,
        [org],
      )
    ).rows;
    return {
      collections,
      sales,
      attribution_note:
        'Circulation is recorded separately from earnings. IFCI-based payments are not enabled.',
    };
  }
  async createCollection(actor: Actor, data: any) {
    return this.db.transaction(async (tx) => {
      await this.member(tx, actor, data.org_id, true);
      await checkArtwork(tx, actor, data.artwork);
      const cid = id();
      await tx.query(
        'INSERT INTO collections(id,org_id,title,description,category,edition_size,rights_evidence,artwork) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          cid,
          data.org_id,
          data.title,
          data.description,
          data.category,
          data.edition_size,
          data.rights_evidence,
          data.artwork,
        ],
      );
      await audit(tx, actor.id, 'collection.created', cid);
      return { id: cid };
    });
  }
  async collectionAction(actor: Actor, cid: string, action: string, data: any) {
    return this.db.transaction(async (tx) => {
      const c = await one(tx, 'SELECT * FROM collections WHERE id=$1 FOR UPDATE', [cid]);
      check(c, 'NOT_FOUND', 'Collection not found.', 404);
      await this.member(tx, actor, c.org_id, true);
      if (action === 'save') {
        check(
          ['draft', 'changes_requested'].includes(c.status),
          'INVALID_STATE',
          'Only drafts can be edited.',
        );
        await tx.query(
          "UPDATE collections SET title=$2,description=$3,rights_evidence=$4,status='draft' WHERE id=$1",
          [cid, data.title, data.description, data.rights_evidence],
        );
      } else if (action === 'submit') {
        check(
          ['draft', 'changes_requested'].includes(c.status) && c.rights_evidence.length >= 20,
          'RIGHTS_REQUIRED',
          'Add detailed rights evidence before submitting.',
        );
        await tx.query("UPDATE collections SET status='submitted' WHERE id=$1", [cid]);
      } else if (action === 'publish') {
        check(
          c.status === 'stock_ready',
          'STOCK_NOT_READY',
          'Operations must approve rights and receive stock before publishing.',
        );
        const stock = (
          await tx.query('SELECT * FROM assets WHERE collection_id=$1 FOR UPDATE', [cid])
        ).rows;
        check(
          stock.length > 0 && stock.length <= c.edition_size,
          'STOCK_NOT_READY',
          'No approved stock is ready.',
        );
        for (const a of stock) {
          check(
            a.certification === 'verified' && a.custody === 'vault',
            'STOCK_NOT_READY',
            'All stock must be certified and vaulted.',
          );
          await tx.query(
            'INSERT INTO listings(id,asset_id,seller_id,price_cents) VALUES ($1,$2,$3,$4)',
            [id(), a.id, a.owner_id, data.price_cents],
          );
        }
        await tx.query("UPDATE collections SET status='published' WHERE id=$1", [cid]);
      }
      await audit(tx, actor.id, `collection.${action}`, cid);
      return { id: cid };
    });
  }
  async createAsset(actor: Actor, data: any) {
    return this.db.transaction(async (tx) => {
      await checkArtwork(tx, actor, data.artwork);
      const aid = id();
      await tx.query(
        'INSERT INTO assets(id,owner_id,title,category,serial,artwork,description) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          aid,
          actor.id,
          data.title,
          data.category,
          `PX-${id().slice(0, 12).toUpperCase()}`,
          data.artwork,
          data.description,
        ],
      );
      await provenance(
        tx,
        aid,
        actor.id,
        'registered',
        'Owner submitted an unverified collectible.',
      );
      return { id: aid };
    });
  }
  async list(actor: Actor, assetId: string, price: number) {
    return this.db.transaction(async (tx) => {
      const asset = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [assetId]);
      check(asset && asset.owner_id === actor.id, 'FORBIDDEN', 'You do not own this item.', 403);
      check(
        asset.custody === 'vault' && asset.certification === 'verified',
        'INELIGIBLE',
        'VIA certification and vault custody are required.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM orders WHERE asset_id=$1 AND status='paid' AND fulfillment='ship'",
          [assetId],
        )),
        'SHIPMENT_PENDING',
        'Resolve the outgoing shipment before listing this item.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM intakes WHERE asset_id=$1 AND status IN ('awaiting_receipt','received')",
          [assetId],
        )),
        'INTAKE_PENDING',
        'An intake is already in progress.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM listings WHERE asset_id=$1 AND status IN ('active','reserved')",
          [assetId],
        )),
        'ALREADY_LISTED',
        'This item already has an active listing.',
      );
      const lid = id();
      await tx.query(
        'INSERT INTO listings(id,asset_id,seller_id,price_cents) VALUES ($1,$2,$3,$4)',
        [lid, assetId, actor.id, price],
      );
      await provenance(tx, assetId, actor.id, 'listed', 'Listed for fixed-price sale.');
      return { id: lid };
    });
  }
  async withdrawListing(actor: Actor, listingId: string) {
    return this.db.transaction(async (tx) => {
      const listing = await one(tx, 'SELECT * FROM listings WHERE id=$1 FOR UPDATE', [listingId]);
      check(listing?.seller_id === actor.id, 'FORBIDDEN', 'This listing is not yours.', 403);
      check(
        listing.status === 'active',
        'INVALID_STATE',
        'Reserved or sold listings cannot be withdrawn.',
      );
      await tx.query("UPDATE listings SET status='withdrawn' WHERE id=$1", [listingId]);
      await audit(tx, actor.id, 'listing.withdrawn', listingId);
      return { ok: true };
    });
  }
}
