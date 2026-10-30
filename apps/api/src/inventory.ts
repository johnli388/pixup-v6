import { one, type Database } from '../../../packages/database/index';
import { check, id, audit, assertNoRefund } from '../../../packages/domain/core';
import { workspaceMember } from '../../../packages/domain/saas';
import { catalogAttributes } from '../../../packages/domain/catalog-attributes';
import { requireEligibility } from '../../../packages/domain/privacy';
import { type Actor } from './auth';
import { lockChannels, assertChannelFree } from './channel-core';
import { assetView } from './catalog';
export class InventoryService {
  constructor(private db: Database) {}
  async list(actor: Actor, org: string) {
    const m = await workspaceMember(this.db, actor.id, org);
    return {
      org_id: org,
      can_edit: ['owner', 'publisher', 'operator'].includes(m.role),
      items: (
        await this.db.query(
          `${assetView} WHERE a.inventory_org_id=$1 ORDER BY a.created_at DESC LIMIT 500`,
          [org],
        )
      ).rows.map(
        ({ owner_id, ...a }): Record<string, any> => ({ ...a, is_owner: owner_id === actor.id }),
      ),
      assignments: (
        await this.db.query(
          "SELECT id,resource_id,state,version,reason,decision_note FROM finance_approvals WHERE kind='inventory_assign' AND requested_by=$1 AND payload->>'to_org_id'=$2 ORDER BY created_at DESC LIMIT 100",
          [actor.id, org],
        )
      ).rows,
    };
  }
  async attributes(actor: Actor, aid: string, input: unknown) {
    const d = catalogAttributes.parse(input);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await requireEligibility(tx, actor.id);
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [aid]);
      check(a, 'NOT_FOUND', 'Item not found.', 404);
      if (a.owner_id !== actor.id) {
        check(a.inventory_org_id, 'FORBIDDEN', 'No inventory delegation exists.', 403);
        await workspaceMember(tx, actor.id, a.inventory_org_id, true);
      }
      check(
        d.category === a.category,
        'CATEGORY_MISMATCH',
        'Structured attributes must match the registered category.',
      );
      await assertNoRefund(tx, aid);
      await assertChannelFree(tx, aid);
      check(
        !(await one(
          tx,
          "SELECT id FROM intakes WHERE asset_id=$1 AND status IN ('awaiting_receipt','received')",
          [aid],
        )),
        'INVENTORY_BUSY',
        'Resolve intake before revising catalog attributes.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM orders WHERE asset_id=$1 AND (status='pending_payment' OR (status='paid' AND fulfillment='ship'))",
          [aid],
        )),
        'INVENTORY_BUSY',
        'Resolve the pending order or shipment before revising catalog attributes.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM listings WHERE asset_id=$1 AND status IN ('active','reserved')",
          [aid],
        )),
        'INVENTORY_BUSY',
        'Withdraw the listing before changing its description.',
      );
      check(
        !(await one(tx, 'SELECT asset_id FROM asset_price_cohorts WHERE asset_id=$1', [aid])),
        'COHORT_FROZEN',
        'Comparable metadata is frozen for a curated price cohort; request a data review.',
      );
      await tx.query('UPDATE assets SET catalog_attributes=$2 WHERE id=$1', [
        aid,
        JSON.stringify(d),
      ]);
      await tx.query(
        'INSERT INTO catalog_revisions(id,asset_id,attributes,actor_id) VALUES ($1,$2,$3,$4)',
        [id(), aid, JSON.stringify(d), actor.id],
      );
      await audit(tx, actor.id, 'catalog.attributes_updated', aid);
      return { ok: true };
    });
  }
}
