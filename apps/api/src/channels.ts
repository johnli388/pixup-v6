import { requireEligibility } from '../../../packages/domain/privacy';
import { createPublicKey, createPrivateKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { one, type Database, type SQL } from '../../../packages/database/index';
import { check, id, audit, provenance, assertNoRefund } from '../../../packages/domain/core';
import { hash } from '../../../packages/domain/security';
import {
  contextInput,
  allocationInput,
  packInput,
  deviceEvent,
  revealInput,
} from '../../../packages/domain/channels';
import { requireStaff, type Actor } from './auth';
import { gate, lockChannels, assertChannelFree, saleEligible } from './channel-core';
import { collectionPublishedSql } from '../../../packages/domain/catalog-visibility';

export async function channelMembership(tx: SQL, actor: Pick<Actor, 'id'>, org: string) {
  check(
    await one(
      tx,
      "SELECT role FROM memberships WHERE user_id=$1 AND org_id=$2 AND role IN ('owner','operator','publisher')",
      [actor.id, org],
    ),
    'FORBIDDEN',
    'An active publishing or operating membership is required.',
    403,
  );
}
// Pilot protocol only. Production devices require persistent pinned signing keys.
export class ChannelService {
  private signingKey;
  readonly publicKey: string;
  constructor(
    private db: Database,
    privateKey = process.env.CVM_COMMAND_PRIVATE_KEY,
  ) {
    this.signingKey = privateKey
      ? createPrivateKey(privateKey.replace(/\\n/g, '\n'))
      : generateKeyPairSync('ed25519').privateKey;
    check(
      this.signingKey.asymmetricKeyType === 'ed25519',
      'DEVICE_KEY',
      'Use an Ed25519 command signing key.',
      500,
    );
    this.publicKey = createPublicKey(this.signingKey)
      .export({ type: 'spki', format: 'pem' })
      .toString();
  }
  tx<T>(fn: (tx: SQL) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      return fn(tx);
    });
  }
  async manage(tx: SQL, actor: Actor, cid: string) {
    const c = await one(tx, 'SELECT * FROM channel_contexts WHERE id=$1', [cid]);
    check(c, 'NOT_FOUND', 'Channel not found.', 404);
    if (!(actor.is_staff && actor.staff_permissions.includes('warehouse')))
      await channelMembership(tx, actor, c.org_id);
    return c;
  }
  async gates(actor: Actor) {
    requireStaff(actor, 'warehouse');
    return (await this.db.query('SELECT * FROM channel_gates ORDER BY kind')).rows;
  }
  async setGate(actor: Actor, kind: string, enabled: boolean, evidence: string) {
    requireStaff(actor, 'warehouse');
    return this.tx(async (tx) => {
      check(
        ['cvm', 'liveup', 'goup', 'waxup', 'ai'].includes(kind),
        'INVALID_CHANNEL',
        'Unknown channel.',
        400,
      );
      check(evidence.trim().length >= 10, 'EVIDENCE_REQUIRED', 'Record pilot gate evidence.', 400);
      if (enabled) {
        const prerequisites =
          kind === 'ai'
            ? ['cvm', 'liveup', 'goup', 'waxup']
            : ['goup', 'waxup'].includes(kind)
              ? ['cvm', 'liveup']
              : [];
        for (const prerequisite of prerequisites) await gate(tx, prerequisite);
      }
      await tx.query(
        'UPDATE channel_gates SET enabled=$2,evidence=$3,updated_by=$4,updated_at=now() WHERE kind=$1',
        [kind, enabled, evidence, actor.id],
      );
      await audit(tx, actor.id, 'channel.gate', kind, { enabled, evidence });
      return { ok: true };
    });
  }
  async create(actor: Actor, input: unknown) {
    const d = contextInput.parse(input);
    return this.tx(async (tx) => {
      await requireEligibility(tx, actor.id);
      await channelMembership(tx, actor, d.org_id);
      await gate(tx, d.kind);
      if (d.deadline)
        check(
          new Date(d.deadline).getTime() > Date.now(),
          'DEADLINE',
          'Use a future deadline.',
          400,
        );
      if (d.kind === 'goup')
        check(d.deadline, 'DEADLINE', 'Group purchases require a deadline.', 400);
      if (d.kind === 'cvm') {
        let valid = false;
        try {
          valid = !!d.public_key && createPublicKey(d.public_key).asymmetricKeyType === 'ed25519';
        } catch {}
        check(valid, 'DEVICE_KEY', 'Provide a device Ed25519 public key.', 400);
      }
      const cid = id();
      await tx.query(
        'INSERT INTO channel_contexts(id,kind,org_id,name,terms,deadline,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [cid, d.kind, d.org_id, d.name, JSON.stringify(d.terms), d.deadline || null, actor.id],
      );
      if (d.kind === 'cvm')
        await tx.query('INSERT INTO channel_devices(context_id,public_key) VALUES ($1,$2)', [
          cid,
          d.public_key,
        ]);
      await audit(tx, actor.id, 'channel.created', cid, { kind: d.kind });
      return { id: cid };
    });
  }
  async browse() {
    return (
      await this.db
        .query(`SELECT c.id,c.kind,c.name,c.org_id,c.status,c.terms,c.terms_version,c.deadline,
      COALESCE(NOT d.revoked AND d.last_seen_at>now()-interval '90 seconds',false) AS online
      FROM channel_contexts c JOIN channel_gates g ON g.kind=c.kind LEFT JOIN channel_devices d ON d.context_id=c.id
      WHERE g.enabled ORDER BY c.created_at DESC LIMIT 100`)
    ).rows;
  }
  async detail(cid: string, actor?: Actor | null) {
    const c = await one(
      this.db,
      `SELECT c.id,c.kind,c.name,c.org_id,c.status,c.terms,c.terms_version,c.deadline,
      COALESCE(NOT d.revoked AND d.last_seen_at>now()-interval '90 seconds',false) AS online
      FROM channel_contexts c JOIN channel_gates g ON g.kind=c.kind LEFT JOIN channel_devices d ON d.context_id=c.id
      WHERE c.id=$1 AND g.enabled`,
      [cid],
    );
    check(c, 'NOT_FOUND', 'Active pilot channel not found.', 404);
    const items = (
      await this.db.query(
        `SELECT ca.id,ca.slot,ca.asset_id,ca.listing_id,ca.state,a.title,a.kind,a.category,a.certification,a.custody,l.price_cents,l.status AS listing_status,
      (p.user_id=$2) AS is_pledged_by_me,(p.user_id IS NOT NULL) AS pledged,${collectionPublishedSql} AS published
      FROM channel_allocations ca JOIN assets a ON a.id=ca.asset_id JOIN listings l ON l.id=ca.listing_id
      LEFT JOIN group_pledges p ON p.allocation_id=ca.id WHERE ca.context_id=$1 AND ca.state<>'closed' ORDER BY ca.slot,ca.id`,
        [cid, actor?.id || null],
      )
    ).rows;
    return {
      ...c,
      items: items.flatMap<Record<string, any>>(({ published, ...item }, i) => {
        if (!published) return [];
        // Preserve the original allocation count/index when hiding private stock,
        // so displayed GOUP shipping shares still match the transaction core.
        return [
          {
            ...item,
            shipping_cents:
              c.kind === 'goup'
                ? Math.floor(c.terms.shipping_total_cents / items.length) +
                  (i < c.terms.shipping_total_cents % items.length ? 1 : 0)
                : c.kind === 'waxup'
                  ? c.terms.shipping_total_cents
                  : 0,
          },
        ];
      }),
    };
  }
  async workspace(actor: Actor) {
    const staff = actor.is_staff && actor.staff_permissions.includes('warehouse');
    const contexts = (
      await this.db.query(
        `SELECT c.* FROM channel_contexts c WHERE $2 OR EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=c.org_id AND m.user_id=$1 AND m.role IN ('owner','operator','publisher')) ORDER BY created_at DESC`,
        [actor.id, staff],
      )
    ).rows;
    const ids = contexts.map((c) => c.id);
    const allocations = (
      await this.db.query(
        `SELECT a.*,l.status AS listing_status FROM channel_allocations a JOIN listings l ON l.id=a.listing_id WHERE a.context_id=ANY($1::text[]) AND a.state<>'closed'`,
        [ids],
      )
    ).rows;
    const orders = (
      await this.db.query(
        `SELECT co.*,o.channel,o.asset_id,o.status AS order_status,o.payment_provider,CASE WHEN $2 AND o.channel IN ('goup','waxup') THEN o.shipping_address ELSE NULL END AS shipping_address,dc.id AS command_id,dc.state AS command_state,dc.payload->>'expires_at' AS command_expires_at FROM channel_orders co JOIN orders o ON o.id=co.order_id LEFT JOIN device_commands dc ON dc.order_id=o.id WHERE co.context_id=ANY($1::text[]) ORDER BY o.created_at DESC LIMIT 200`,
        [ids, staff],
      )
    ).rows;
    const returns = staff
      ? (
          await this.db.query(
            "SELECT * FROM device_returns WHERE status<>'received' ORDER BY created_at",
          )
        ).rows
      : [];
    const wholesale_returns = staff
      ? (
          await this.db.query(
            "SELECT * FROM wholesale_returns WHERE status='requested' ORDER BY created_at",
          )
        ).rows
      : [];
    return {
      contexts,
      allocations,
      orders,
      returns,
      wholesale_returns,
      command_public_key: this.publicKey,
    };
  }
  async assign(actor: Actor, cid: string, input: unknown) {
    const d = allocationInput.parse(input);
    return this.tx(async (tx) => {
      const c = await this.manage(tx, actor, cid);
      await gate(tx, c.kind);
      check(
        c.status === 'open',
        'INVALID_STATE',
        'Assign inventory before locking or closing the channel.',
      );
      if (c.kind === 'cvm') requireStaff(actor, 'warehouse');
      const l = await one(
        tx,
        'SELECT l.*,a.owner_id,a.custody,a.certification,a.kind FROM listings l JOIN assets a ON a.id=l.asset_id WHERE l.id=$1 FOR UPDATE OF l,a',
        [d.listing_id],
      );
      check(
        l?.status === 'active' && (await saleEligible(tx, l, 'liveup')) && l.custody === 'vault',
        'INELIGIBLE',
        'Assign available vaulted stock.',
      );
      // Organization membership alone never confers title to another member's inventory.
      check(
        l.owner_id === actor.id ||
          (actor.is_staff &&
            actor.staff_permissions.includes('warehouse') &&
            l.owner_id === 'platform'),
        'FORBIDDEN',
        'Only the stock owner or platform warehouse may allocate this stock.',
        403,
      );
      await assertChannelFree(tx, l.asset_id);
      await assertNoRefund(tx, l.asset_id);
      check(
        !(await one(
          tx,
          "SELECT id FROM intakes WHERE asset_id=$1 AND status IN ('awaiting_receipt','received')",
          [l.asset_id],
        )),
        'INTAKE_PENDING',
        'Complete intake first.',
      );
      const count = (await one(
        tx,
        "SELECT count(*)::int AS n FROM channel_allocations WHERE context_id=$1 AND state<>'closed'",
        [cid],
      ))!.n;
      if (c.kind === 'goup')
        check(count < c.terms.target_units, 'GROUP_FULL', 'All group slots have inventory.');
      if (c.kind === 'waxup') {
        const p = await one(
          tx,
          "SELECT units FROM sealed_packs WHERE asset_id=$1 AND status='sealed'",
          [l.asset_id],
        );
        check(
          p?.units === c.terms.units_per_case,
          'CASE_REQUIRED',
          'Wholesale requires a sealed case with the declared unit count.',
        );
      }
      const aid = id();
      await tx.query(
        'INSERT INTO channel_allocations(id,context_id,asset_id,listing_id,slot) VALUES ($1,$2,$3,$4,$5)',
        [aid, cid, l.asset_id, l.id, d.slot],
      );
      if (c.kind === 'cvm')
        await tx.query("UPDATE assets SET custody='device' WHERE id=$1", [l.asset_id]);
      await provenance(
        tx,
        l.asset_id,
        actor.id,
        'channel_assigned',
        `Physical stock assigned to ${c.kind.toUpperCase()}.`,
      );
      await audit(tx, actor.id, 'channel.assigned', aid, { slot: d.slot });
      return { id: aid };
    });
  }
  async release(actor: Actor, allocation: string, evidence: string) {
    return this.tx(async (tx) => {
      const a = await one(tx, 'SELECT * FROM channel_allocations WHERE id=$1', [allocation]);
      check(a, 'NOT_FOUND', 'Allocation not found.', 404);
      const c = await this.manage(tx, actor, a.context_id);
      if (c.kind === 'cvm') requireStaff(actor, 'warehouse');
      check(
        c.kind !== 'goup' || c.status !== 'locked',
        'GROUP_LOCKED',
        'Cancel the group before releasing inventory.',
      );
      if (c.kind === 'goup' && c.status === 'open')
        check(
          !(await one(
            tx,
            "SELECT p.allocation_id FROM group_pledges p JOIN channel_allocations a ON a.id=p.allocation_id WHERE a.context_id=$1 AND a.state<>'closed'",
            [c.id],
          )),
          'GROUP_PLEDGED',
          'Participants must withdraw their pledges or the group must cancel before changing stock.',
        );
      if (a.state === 'closed') return { ok: true };
      check(
        !(await one(
          tx,
          "SELECT id FROM orders WHERE allocation_id=$1 AND status IN ('pending_payment','paid','fulfilled')",
          [a.id],
        )),
        'ORDER_PENDING',
        'Resolve payment and physical fulfillment before releasing this slot.',
      );
      await assertNoRefund(tx, a.asset_id);
      if (c.kind === 'cvm')
        await tx.query(
          "UPDATE assets SET custody=CASE WHEN certification IN ('revoked','rejected') THEN 'quarantine' ELSE 'vault' END WHERE id=$1",
          [a.asset_id],
        );
      await tx.query("UPDATE channel_allocations SET state='closed' WHERE id=$1", [a.id]);
      const restored = await one(tx, 'SELECT * FROM assets WHERE id=$1', [a.asset_id]);
      if (await saleEligible(tx, restored, 'liveup'))
        await tx.query(
          "UPDATE listings SET status='active' WHERE id=$1 AND status='withdrawn' AND seller_id=$2",
          [a.listing_id, restored!.owner_id],
        );
      await provenance(
        tx,
        a.asset_id,
        actor.id,
        'channel_released',
        'Channel stock returned to vault availability.',
      );
      await audit(tx, actor.id, 'channel.released', a.id, { evidence });
      return { ok: true };
    });
  }
  async pack(actor: Actor, input: unknown) {
    requireStaff(actor, 'warehouse');
    const d = packInput.parse(input);
    return this.tx(async (tx) => {
      const aid = id(),
        lid = id();
      await tx.query(
        "INSERT INTO assets(id,owner_id,title,category,serial,artwork,description,custody,platform_owned,kind) VALUES ($1,'platform',$2,$3,$4,'court',$5,'vault',true,'sealed_pack')",
        [
          aid,
          d.title,
          d.category,
          `PACK-${aid}`,
          `Sealed physical stock. ${d.units} units; contents and authenticity not yet assessed.`,
        ],
      );
      await tx.query(
        'INSERT INTO sealed_packs(asset_id,supplier_reference,seal_reference,units,registered_by) VALUES ($1,$2,$3,$4,$5)',
        [aid, d.supplier_reference, d.seal_reference, d.units, actor.id],
      );
      await tx.query(
        "INSERT INTO listings(id,asset_id,seller_id,price_cents) VALUES ($1,$2,'platform',$3)",
        [lid, aid, d.price_cents],
      );
      await provenance(
        tx,
        aid,
        actor.id,
        'sealed_stock',
        'Physical sealed stock registered; contents unverified.',
      );
      await audit(tx, actor.id, 'channel.pack_registered', aid, {
        supplier_reference: d.supplier_reference,
        seal_reference: d.seal_reference,
      });
      return { asset_id: aid, listing_id: lid };
    });
  }
  async status(actor: Actor, cid: string, status: 'paused' | 'open' | 'canceled') {
    return this.tx(async (tx) => {
      const c = await this.manage(tx, actor, cid);
      check(
        !['completed', 'canceled'].includes(c.status),
        'INVALID_STATE',
        'This channel is closed.',
      );
      check(
        c.kind !== 'goup' || status === 'canceled',
        'GROUP_STATE',
        'Groups lock through participant consent or cancel.',
      );
      if (status === 'open') await gate(tx, c.kind);
      await tx.query('UPDATE channel_contexts SET status=$2 WHERE id=$1', [cid, status]);
      if (status === 'canceled') {
        // Issued vends require physical reconciliation, never a blind refund.
        await tx.query(
          `UPDATE channel_orders co SET state='refund_required',updated_at=now() WHERE co.context_id=$1 AND co.state='awaiting_fulfillment'
          AND NOT EXISTS(SELECT 1 FROM device_commands d WHERE d.order_id=co.order_id AND d.state IN ('issued','unknown','succeeded'))`,
          [cid],
        );
        await tx.query(
          "UPDATE device_commands SET state='failed' WHERE device_id=$1 AND state='queued'",
          [cid],
        );
      }
      await audit(tx, actor.id, 'channel.status', cid, { status });
      return { ok: true };
    });
  }
  async pledge(actor: Actor, allocation: string, version: number) {
    return this.tx(async (tx) => {
      await requireEligibility(tx, actor.id);
      const a = await one(
        tx,
        'SELECT a.*,c.kind,c.status,c.deadline,c.terms_version FROM channel_allocations a JOIN channel_contexts c ON c.id=a.context_id WHERE a.id=$1',
        [allocation],
      );
      check(
        a &&
          a.kind === 'goup' &&
          a.status === 'open' &&
          a.state === 'assigned' &&
          new Date(a.deadline).getTime() > Date.now(),
        'GROUP_CLOSED',
        'Group is not accepting pledges.',
      );
      await gate(tx, 'goup');
      check(version === a.terms_version, 'TERMS_CHANGED', 'Review the current group terms.');
      const c = await one(tx, 'SELECT terms FROM channel_contexts WHERE id=$1', [a.context_id]);
      const n = (await one(
        tx,
        "SELECT count(*)::int AS n FROM channel_allocations WHERE context_id=$1 AND state='assigned'",
        [a.context_id],
      ))!.n;
      check(
        n === c!.terms.target_units,
        'GROUP_STOCK_INCOMPLETE',
        'All declared slots must be stocked before accepting fixed shipping shares.',
      );
      const l = await one(tx, 'SELECT seller_id FROM listings WHERE id=$1', [a.listing_id]);
      check(l?.seller_id !== actor.id, 'OWN_LISTING', 'Cannot pledge your own stock.');
      const p = await one(tx, 'SELECT user_id FROM group_pledges WHERE allocation_id=$1', [
        allocation,
      ]);
      check(!p || p.user_id === actor.id, 'SLOT_TAKEN', 'Another participant owns this share.');
      await tx.query(
        'INSERT INTO group_pledges(allocation_id,user_id,accepted_terms_version) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [allocation, actor.id, version],
      );
      await audit(tx, actor.id, 'group.pledged', allocation, { version });
      return { ok: true };
    });
  }
  async unpledge(actor: Actor, allocation: string) {
    return this.tx(async (tx) => {
      const p = await one(
        tx,
        'SELECT p.user_id,c.status FROM group_pledges p JOIN channel_allocations a ON a.id=p.allocation_id JOIN channel_contexts c ON c.id=a.context_id WHERE p.allocation_id=$1',
        [allocation],
      );
      check(p?.user_id === actor.id, 'NOT_FOUND', 'Your pledge was not found.', 404);
      check(
        p.status === 'open',
        'GROUP_LOCKED',
        'Locked groups require cancellation or order recovery.',
      );
      await tx.query('DELETE FROM group_pledges WHERE allocation_id=$1', [allocation]);
      await audit(tx, actor.id, 'group.unpledged', allocation);
      return { ok: true };
    });
  }
  async lockGroup(actor: Actor, cid: string) {
    return this.tx(async (tx) => {
      const c = await this.manage(tx, actor, cid);
      await gate(tx, 'goup');
      check(
        c.kind === 'goup' && c.status === 'open' && new Date(c.deadline).getTime() > Date.now(),
        'GROUP_CLOSED',
        'Group cannot lock.',
      );
      const n = (await one(
        tx,
        `SELECT count(*)::int AS n FROM channel_allocations a JOIN group_pledges p ON p.allocation_id=a.id JOIN listings l ON l.id=a.listing_id WHERE a.context_id=$1 AND a.state='assigned' AND p.accepted_terms_version=$2 AND l.status='active'`,
        [cid, c.terms_version],
      ))!.n;
      check(
        n === c.terms.target_units,
        'GROUP_INCOMPLETE',
        'Every declared slot needs stock and participant consent.',
      );
      await tx.query("UPDATE channel_contexts SET status='locked' WHERE id=$1", [cid]);
      await audit(tx, actor.id, 'group.locked', cid);
      return { ok: true };
    });
  }
  async business(actor: Actor, user: string, org: string, approved: boolean) {
    requireStaff(actor, 'finance');
    return this.tx(async (tx) => {
      if (approved) {
        await channelMembership(tx, { id: user }, org);
        await tx.query(
          'INSERT INTO channel_businesses(user_id,org_id,approved_by) VALUES ($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET org_id=$2,approved_by=$3',
          [user, org, actor.id],
        );
      } else await tx.query('DELETE FROM channel_businesses WHERE user_id=$1', [user]);
      await audit(tx, actor.id, 'wholesale.business', user, { org, approved });
      return { ok: true };
    });
  }
  async reveal(actor: Actor, orderId: string, input: unknown) {
    const d = revealInput.parse(input);
    return this.tx(async (tx) => {
      const o = await one(
        tx,
        'SELECT o.*,co.context_id,co.state,co.reveal_hash FROM orders o JOIN channel_orders co ON co.order_id=o.id WHERE o.id=$1',
        [orderId],
      );
      check(o?.channel === 'liveup', 'NOT_FOUND', 'LiveUP order not found.', 404);
      await this.manage(tx, actor, o.context_id);
      if (o.state === 'fulfilled') {
        check(
          o.reveal_hash === hash(JSON.stringify(d)),
          'REVEAL_CONFLICT',
          'A recorded reveal cannot be replaced.',
        );
        return {
          ok: true,
          contents: (
            await tx.query('SELECT asset_id FROM pack_contents WHERE pack_id=$1', [o.asset_id])
          ).rows,
        };
      }
      check(
        o.status === 'paid' && o.state === 'awaiting_fulfillment',
        'INVALID_STATE',
        'A paid, unresolved pack is required.',
      );
      await assertNoRefund(tx, o.asset_id);
      const p = await one(tx, 'SELECT * FROM sealed_packs WHERE asset_id=$1', [o.asset_id]);
      check(
        p ? p.status === 'sealed' && d.contents.length === p.units : !d.contents.length,
        'CONTENTS_COUNT',
        'Record exactly the physical pack contents, or no child items for a single specimen.',
      );
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1', [o.asset_id]);
      check(
        a && a.owner_id === o.buyer_id && a.custody === 'vault',
        'CUSTODY_CHANGED',
        'Reconcile vault custody first.',
      );
      const children = [];
      for (const content of d.contents) {
        const aid = id();
        await tx.query(
          "INSERT INTO assets(id,owner_id,title,category,serial,artwork,description,custody) VALUES ($1,$2,$3,$4,$5,$6,$7,'vault')",
          [
            aid,
            o.buyer_id,
            content.title,
            a.category,
            `OPEN-${aid}`,
            a.artwork,
            content.description,
          ],
        );
        await tx.query('INSERT INTO pack_contents(pack_id,asset_id) VALUES ($1,$2)', [
          o.asset_id,
          aid,
        ]);
        await provenance(
          tx,
          aid,
          actor.id,
          'pack_opened',
          `Recorded from physical pack ${a.serial}; VIA assessment is still required.`,
        );
        children.push({ asset_id: aid });
      }
      if (p)
        await tx.query("UPDATE sealed_packs SET status='opened' WHERE asset_id=$1", [o.asset_id]);
      await tx.query(
        'UPDATE channel_orders SET recording_reference=$2,recording_offset_ms=$3,reveal_hash=$4 WHERE order_id=$1',
        [orderId, d.recording_reference, d.recording_offset_ms, hash(JSON.stringify(d))],
      );
      await this.finish(tx, o, actor.id, d.evidence, 'vault');
      await audit(tx, actor.id, 'liveup.revealed', orderId, { ...d, contents: children });
      return { ok: true, contents: children };
    });
  }
  async finish(tx: SQL, o: any, actor: string, evidence: string, custody: string) {
    await tx.query(
      "UPDATE channel_orders SET state='fulfilled',evidence=$2,updated_at=now() WHERE order_id=$1",
      [o.id, evidence],
    );
    await tx.query("UPDATE orders SET status='fulfilled',tracking=$2 WHERE id=$1", [
      o.id,
      custody === 'shipping' ? evidence : '',
    ]);
    await tx.query('UPDATE assets SET custody=$2 WHERE id=$1', [o.asset_id, custody]);
    await tx.query("UPDATE channel_allocations SET state='closed' WHERE id=$1", [o.allocation_id]);
    await provenance(
      tx,
      o.asset_id,
      actor,
      'channel_fulfilled',
      `${o.channel.toUpperCase()} physical fulfillment recorded.`,
    );
  }
  async fulfill(actor: Actor, oid: string, evidence: string) {
    requireStaff(actor, 'warehouse');
    return this.tx(async (tx) => {
      const o = await one(
        tx,
        'SELECT o.*,co.state,co.context_id FROM orders o JOIN channel_orders co ON co.order_id=o.id WHERE o.id=$1',
        [oid],
      );
      check(
        o && ['goup', 'waxup'].includes(o.channel),
        'NOT_FOUND',
        'Channel shipment not found.',
        404,
      );
      if (o.state === 'fulfilled') return { ok: true };
      check(
        o.status === 'paid' && o.state === 'awaiting_fulfillment',
        'INVALID_STATE',
        'Paid allocation is required.',
      );
      await assertNoRefund(tx, o.asset_id);
      const c = await one(tx, 'SELECT * FROM channel_contexts WHERE id=$1', [o.context_id]);
      if (o.channel === 'goup') {
        const n = (await one(
          tx,
          `SELECT count(*)::int AS n FROM channel_allocations a WHERE a.context_id=$1 AND EXISTS(SELECT 1 FROM orders o JOIN channel_orders co ON co.order_id=o.id WHERE o.allocation_id=a.id AND o.status IN ('paid','fulfilled') AND co.state IN ('awaiting_fulfillment','fulfilled'))`,
          [c!.id],
        ))!.n;
        check(
          ['locked', 'completed'].includes(c!.status) && n === c!.terms.target_units,
          'GROUP_UNPAID',
          'All participant orders must be paid before any shipment.',
        );
      } else
        check(
          c!.status !== 'canceled',
          'CHANNEL_CLOSED',
          'Canceled wholesale orders require refund review.',
        );
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1', [o.asset_id]);
      check(
        a && a.custody === 'vault' && a.owner_id === o.buyer_id,
        'CUSTODY_CHANGED',
        'Resolve physical custody first.',
      );
      await this.finish(tx, o, actor.id, evidence, 'shipping');
      if (o.channel === 'goup')
        await tx.query("UPDATE channel_contexts SET status='completed' WHERE id=$1", [c!.id]);
      await audit(tx, actor.id, 'channel.shipped', oid, { evidence });
      return { ok: true };
    });
  }
  async wholesaleReturn(actor: Actor, oid: string, note: string) {
    return this.tx(async (tx) => {
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1', [oid]);
      check(
        o?.buyer_id === actor.id && o.channel === 'waxup',
        'NOT_FOUND',
        'Wholesale order not found.',
        404,
      );
      check(
        o.status === 'fulfilled' &&
          o.channel_terms.return_mode !== 'none' &&
          Date.now() < new Date(o.paid_at).getTime() + o.channel_terms.return_days * 86400000,
        'RETURN_INELIGIBLE',
        'This order is outside its conditional return policy.',
      );
      await tx.query(
        'INSERT INTO wholesale_returns(order_id,user_id,mode,note) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [oid, actor.id, o.channel_terms.return_mode, note],
      );
      return { ok: true, status: 'requested' };
    });
  }
  async decideWholesaleReturn(actor: Actor, oid: string, approved: boolean, note: string) {
    requireStaff(actor, 'warehouse');
    return this.tx(async (tx) => {
      const r = await one(tx, 'SELECT * FROM wholesale_returns WHERE order_id=$1', [oid]);
      check(
        r?.status === 'requested',
        'INVALID_STATE',
        'Return request no longer awaits a decision.',
      );
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1', [oid]);
      if (approved) {
        const a = await one(tx, 'SELECT * FROM assets WHERE id=$1', [o!.asset_id]);
        check(a && a.owner_id === r.user_id, 'OWNER_CHANGED', 'Ownership changed.');
        await assertChannelFree(tx, a.id);
        await assertNoRefund(tx, a.id);
        await tx.query(
          "INSERT INTO intakes(id,asset_id,user_id,kind,evidence) VALUES ($1,$2,$3,'vault',$4)",
          [id(), a.id, r.user_id, `WaxUP ${r.mode} review only; no grant or payout. ${note}`],
        );
      }
      await tx.query('UPDATE wholesale_returns SET status=$2,decision_note=$3 WHERE order_id=$1', [
        oid,
        approved ? 'approved' : 'rejected',
        note,
      ]);
      await audit(tx, actor.id, 'wholesale.return_decision', oid, { approved, note });
      return { ok: true };
    });
  }
  async revokeDevice(actor: Actor, cid: string) {
    requireStaff(actor, 'warehouse');
    return this.tx(async (tx) => {
      const c = await this.manage(tx, actor, cid);
      check(c.kind === 'cvm', 'NOT_FOUND', 'Device not found.', 404);
      await tx.query('UPDATE channel_devices SET revoked=true WHERE context_id=$1', [cid]);
      await tx.query("UPDATE channel_contexts SET status='paused' WHERE id=$1", [cid]);
      await audit(tx, actor.id, 'device.revoked', cid);
      return { ok: true };
    });
  }
  async event(device: string, raw: Buffer, timestamp: string, signature: string) {
    const time = Number(timestamp);
    check(
      Buffer.isBuffer(raw) &&
        raw.length <= 65536 &&
        Number.isSafeInteger(time) &&
        Math.abs(Date.now() - time) < 300000,
      'DEVICE_AUTH',
      'Device timestamp is missing or stale.',
      401,
    );
    return this.tx(async (tx) => {
      const d = await one(tx, 'SELECT * FROM channel_devices WHERE context_id=$1', [device]);
      let valid = false;
      try {
        valid =
          !!d &&
          !d.revoked &&
          verify(
            null,
            Buffer.from(`${device}\n${timestamp}\n${raw.toString('utf8')}`),
            d.public_key,
            Buffer.from(signature, 'base64'),
          );
      } catch {}
      check(valid, 'DEVICE_AUTH', 'Device signature is invalid or revoked.', 401);
      let json;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch {
        check(false, 'INVALID_JSON', 'Malformed device event.', 400);
      }
      const e = deviceEvent.parse(json),
        digest = hash(raw.toString('utf8'));
      const previous = await one(
        tx,
        'SELECT * FROM device_events WHERE device_id=$1 AND event_id=$2',
        [device, e.event_id],
      );
      if (previous) {
        check(
          previous.request_hash === digest,
          'EVENT_CONFLICT',
          'Event identifier already has different content.',
        );
        if (e.type === 'heartbeat') {
          const commands = [];
          for (const command of previous.result.commands || []) {
            const current = await one(
              tx,
              'SELECT state,payload FROM device_commands WHERE id=$1 AND device_id=$2',
              [command.id, device],
            );
            if (current?.state === 'issued' && Date.parse(current.payload.expires_at) > Date.now())
              commands.push(command);
          }
          return { ...previous.result, commands };
        }
        return previous.result;
      }
      let result: any = { ok: true };
      if (e.type === 'heartbeat') {
        await tx.query('UPDATE channel_devices SET last_seen_at=now() WHERE context_id=$1', [
          device,
        ]);
        const c = await one(
          tx,
          'SELECT c.status,g.enabled FROM channel_contexts c JOIN channel_gates g ON g.kind=c.kind WHERE c.id=$1',
          [device],
        );
        const commands =
          c?.status === 'open' && c.enabled
            ? (
                await tx.query(
                  "SELECT * FROM device_commands WHERE device_id=$1 AND state='queued' ORDER BY created_at LIMIT 20",
                  [device],
                )
              ).rows
            : [];
        const issued = [];
        for (const command of commands) {
          if (Date.parse(command.payload.expires_at) <= Date.now()) {
            await tx.query("UPDATE device_commands SET state='failed' WHERE id=$1", [command.id]);
            await tx.query("UPDATE channel_orders SET state='refund_required' WHERE order_id=$1", [
              command.order_id,
            ]);
            continue;
          }
          // Mark before delivery; a lost response leaves an unknown outcome, never a fresh command.
          await tx.query("UPDATE device_commands SET state='issued',issued_at=now() WHERE id=$1", [
            command.id,
          ]);
          issued.push({
            id: command.id,
            payload: JSON.stringify(command.payload, Object.keys(command.payload).sort()),
            signature: command.signature,
          });
        }
        result = { ok: true, commands: issued };
      } else if (e.type === 'vend') {
        const cmd = await one(tx, 'SELECT * FROM device_commands WHERE id=$1 AND device_id=$2', [
          e.command_id,
          device,
        ]);
        check(cmd, 'NOT_FOUND', 'Command not found.', 404);
        if (['succeeded', 'failed'].includes(cmd.state))
          check(
            cmd.state ===
              (e.outcome === 'delivered'
                ? 'succeeded'
                : e.outcome === 'not_dispensed'
                  ? 'failed'
                  : 'unknown'),
            'OUTCOME_CONFLICT',
            'A final device outcome cannot be overwritten.',
          );
        else {
          check(
            ['issued', 'unknown'].includes(cmd.state),
            'COMMAND_NOT_ISSUED',
            'This command was never issued.',
          );
          await this.vendOutcome(tx, cmd, e.outcome, e.evidence, 'platform');
        }
      } else {
        const r = await one(tx, 'SELECT * FROM device_returns WHERE id=$1 AND device_id=$2', [
          e.return_id,
          device,
        ]);
        check(r, 'NOT_FOUND', 'Return receipt not found.', 404);
        if (r.status === 'expected') {
          const a = await one(tx, 'SELECT * FROM assets WHERE id=$1', [r.asset_id]);
          check(
            a && a.owner_id === r.user_id && ['seller', 'delivered'].includes(a.custody),
            'RETURN_CHANGED',
            'Reconcile the return owner and custody.',
          );
          await assertChannelFree(tx, a.id);
          await assertNoRefund(tx, a.id);
          check(
            !(await one(
              tx,
              "SELECT id FROM listings WHERE asset_id=$1 AND status IN ('active','reserved')",
              [a.id],
            )),
            'ASSET_BUSY',
            'Return stock must not be listed.',
          );
          await tx.query("UPDATE device_returns SET status='deposited' WHERE id=$1", [r.id]);
          await tx.query("UPDATE assets SET custody='device' WHERE id=$1", [r.asset_id]);
          await provenance(
            tx,
            r.asset_id,
            'platform',
            'device_return',
            'Device reported receipt; warehouse and VIA review are pending. No credits granted.',
          );
          await audit(tx, 'platform', 'device.deposit', r.id, { evidence: e.evidence });
        }
        result = { ok: true, receipt_id: r.id, credits_granted: 0 };
      }
      await tx.query(
        'INSERT INTO device_events(device_id,event_id,request_hash,result) VALUES ($1,$2,$3,$4)',
        [device, e.event_id, digest, JSON.stringify(result)],
      );
      return result;
    });
  }
  async vendOutcome(tx: SQL, cmd: any, outcome: string, evidence: string, actor: string) {
    const o = await one(tx, 'SELECT * FROM orders WHERE id=$1', [cmd.order_id]);
    check(
      o?.status === 'paid',
      'INVALID_STATE',
      'This order is not awaiting physical fulfillment.',
    );
    await assertNoRefund(tx, o.asset_id);
    const state =
      outcome === 'delivered' ? 'succeeded' : outcome === 'not_dispensed' ? 'failed' : 'unknown';
    await tx.query('UPDATE device_commands SET state=$2 WHERE id=$1', [cmd.id, state]);
    if (outcome === 'delivered') await this.finish(tx, o, actor, evidence, 'delivered');
    else
      await tx.query(
        'UPDATE channel_orders SET state=$2,evidence=$3,updated_at=now() WHERE order_id=$1',
        [o.id, outcome === 'not_dispensed' ? 'refund_required' : 'unknown', evidence],
      );
    await audit(tx, actor, 'device.outcome', cmd.id, { outcome, evidence });
  }
  async reconcileVend(actor: Actor, command: string, outcome: string, evidence: string) {
    requireStaff(actor, 'warehouse');
    return this.tx(async (tx) => {
      const cmd = await one(tx, 'SELECT * FROM device_commands WHERE id=$1', [command]);
      check(
        cmd && ['issued', 'unknown'].includes(cmd.state),
        'INVALID_STATE',
        'Only an unresolved issued command can be reconciled.',
      );
      check(
        ['delivered', 'not_dispensed'].includes(outcome),
        'INVALID_OUTCOME',
        'Record a witnessed final outcome.',
        400,
      );
      check(
        Date.parse(cmd.payload.expires_at) + 300000 <= Date.now(),
        'RECONCILIATION_WAIT',
        'Wait until the signed command and its five-minute clock tolerance expire, then physically isolate the device and record the witnessed outcome.',
      );
      await this.vendOutcome(tx, cmd, outcome, evidence, actor.id);
      return { ok: true };
    });
  }
  async returnClaim(actor: Actor, device: string, asset: string) {
    return this.tx(async (tx) => {
      await gate(tx, 'cvm');
      const d = await one(tx, 'SELECT * FROM channel_devices WHERE context_id=$1', [device]);
      check(
        d &&
          !d.revoked &&
          d.last_seen_at &&
          new Date(d.last_seen_at).getTime() > Date.now() - 90000,
        'DEVICE_OFFLINE',
        'Use an online return device.',
      );
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1', [asset]);
      check(
        a && a.owner_id === actor.id,
        'FORBIDDEN',
        'Only the owner can register a return.',
        403,
      );
      check(
        ['seller', 'delivered'].includes(a.custody),
        'INVALID_CUSTODY',
        'Only external stock can enter a device return.',
      );
      await assertChannelFree(tx, asset);
      await assertNoRefund(tx, asset);
      check(
        !(await one(
          tx,
          "SELECT id FROM listings WHERE asset_id=$1 AND status IN ('active','reserved')",
          [asset],
        )),
        'ASSET_BUSY',
        'Withdraw the listing first.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM intakes WHERE asset_id=$1 AND status IN ('awaiting_receipt','received')",
          [asset],
        )),
        'INTAKE_PENDING',
        'An intake already exists.',
      );
      const old = await one(
        tx,
        "SELECT * FROM device_returns WHERE asset_id=$1 AND status<>'received'",
        [asset],
      );
      if (old) {
        check(
          old.device_id === device,
          'RETURN_PENDING',
          'Return already assigned to another device.',
        );
        return { id: old.id, credits_granted: 0 };
      }
      const rid = id();
      await tx.query(
        'INSERT INTO device_returns(id,device_id,asset_id,user_id) VALUES ($1,$2,$3,$4)',
        [rid, device, asset, actor.id],
      );
      return { id: rid, credits_granted: 0 };
    });
  }
  async receiveReturn(actor: Actor, rid: string, evidence: string) {
    requireStaff(actor, 'warehouse');
    return this.tx(async (tx) => {
      const r = await one(tx, 'SELECT * FROM device_returns WHERE id=$1', [rid]);
      check(r, 'NOT_FOUND', 'Return not found.', 404);
      if (r.status === 'received') return { intake_id: r.intake_id };
      check(r.status === 'deposited', 'RECEIPT_REQUIRED', 'Device receipt is required.');
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1', [r.asset_id]);
      check(
        a && a.owner_id === r.user_id && a.custody === 'device',
        'RETURN_CHANGED',
        'Reconcile custody first.',
      );
      const iid = id();
      await tx.query(
        "INSERT INTO intakes(id,asset_id,user_id,kind,status,evidence) VALUES ($1,$2,$3,'vault','received',$4)",
        [iid, r.asset_id, r.user_id, evidence],
      );
      await tx.query("UPDATE assets SET custody='intake',certification='unverified' WHERE id=$1", [
        r.asset_id,
      ]);
      await tx.query(
        "UPDATE certificates SET status='superseded' WHERE asset_id=$1 AND status='active'",
        [r.asset_id],
      );
      await tx.query("UPDATE device_returns SET status='received',intake_id=$2 WHERE id=$1", [
        rid,
        iid,
      ]);
      await provenance(
        tx,
        r.asset_id,
        actor.id,
        'return_received',
        'Warehouse received device return. Independent VIA review required.',
      );
      await audit(tx, actor.id, 'device.return_received', rid, { evidence });
      return { intake_id: iid, credits_granted: 0 };
    });
  }
  async worker() {
    return this.tx(async (tx) => {
      // Groups fail together if the deadline passes without full payment, or a participant refunds.
      const groups = (
        await tx.query(
          "SELECT * FROM channel_contexts WHERE kind='goup' AND status IN ('open','locked')",
        )
      ).rows;
      for (const c of groups) {
        const n = (await one(
          tx,
          `SELECT count(*)::int AS n FROM channel_allocations a WHERE a.context_id=$1 AND EXISTS(SELECT 1 FROM orders o JOIN channel_orders co ON co.order_id=o.id WHERE o.allocation_id=a.id AND o.status='paid' AND co.state='awaiting_fulfillment')`,
          [c.id],
        ))!.n;
        const refunded = await one(
          tx,
          "SELECT co.order_id FROM channel_orders co WHERE co.context_id=$1 AND co.state IN ('refunded','refund_required')",
          [c.id],
        );
        if (
          refunded ||
          (new Date(c.deadline).getTime() <= Date.now() && n < c.terms.target_units)
        ) {
          await tx.query("UPDATE channel_contexts SET status='canceled' WHERE id=$1", [c.id]);
          await tx.query(
            "UPDATE channel_orders SET state='refund_required',updated_at=now() WHERE context_id=$1 AND state='awaiting_fulfillment'",
            [c.id],
          );
        }
      }
      const paid = (
        await tx.query(`SELECT o.*,ca.context_id,ca.slot,c.status AS context_status,d.revoked FROM orders o JOIN channel_orders co ON co.order_id=o.id
        JOIN channel_allocations ca ON ca.id=o.allocation_id JOIN channel_contexts c ON c.id=ca.context_id JOIN channel_devices d ON d.context_id=c.id
        WHERE o.status='paid' AND co.state='awaiting_fulfillment' AND NOT EXISTS(SELECT 1 FROM device_commands dc WHERE dc.order_id=o.id)`)
      ).rows;
      for (const o of paid) {
        if (o.context_status === 'canceled' || o.revoked) {
          await tx.query("UPDATE channel_orders SET state='refund_required' WHERE order_id=$1", [
            o.id,
          ]);
          continue;
        }
        if (o.context_status !== 'open') continue;
        const command = id(),
          payload = {
            command_id: command,
            device_id: o.context_id,
            order_id: o.id,
            slot: o.slot,
            asset_id: o.asset_id,
            action: 'dispense',
            expires_at: new Date(Date.now() + 300000).toISOString(),
          };
        // Canonicalize using PostgreSQL jsonb text ordering before signing transport bytes.
        const canonical = (await one(tx, 'SELECT $1::jsonb AS payload', [JSON.stringify(payload)]))!
          .payload;
        const signature = sign(
          null,
          Buffer.from(JSON.stringify(canonical, Object.keys(canonical).sort())),
          this.signingKey,
        ).toString('base64');
        await tx.query(
          'INSERT INTO device_commands(id,order_id,device_id,payload,signature) VALUES ($1,$2,$3,$4,$5)',
          [command, o.id, o.context_id, JSON.stringify(canonical), signature],
        );
      }
      const stale = (
        await tx.query(
          "SELECT * FROM device_commands WHERE (state='issued' AND issued_at<now()-interval '90 seconds') OR (state='queued' AND created_at<now()-interval '5 minutes')",
        )
      ).rows;
      for (const cmd of stale) {
        const unknown = cmd.state === 'issued';
        await tx.query('UPDATE device_commands SET state=$2 WHERE id=$1', [
          cmd.id,
          unknown ? 'unknown' : 'failed',
        ]);
        await tx.query('UPDATE channel_orders SET state=$2,updated_at=now() WHERE order_id=$1', [
          cmd.order_id,
          unknown ? 'unknown' : 'refund_required',
        ]);
      }
      return { ok: true };
    });
  }
}
