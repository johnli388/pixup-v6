import { one, type SQL } from '../../../packages/database/index';
import { check } from '../../../packages/domain/core';
import type { Actor } from './auth';
import { collectionPublishedSql } from '../../../packages/domain/catalog-visibility';
import { assetPaymentHoldSql } from '../../../packages/domain/inventory-holds';

// Short pilot transactions serialize shared channel/core transitions. Network
// calls must remain outside this lock. Replace with measured partitioned locking
// before scaling device fleets. All writers must share the same database.
export async function lockChannels(tx: SQL) {
  await tx.query('SELECT pg_advisory_xact_lock(770077)');
}
export async function gate(tx: SQL, kind: string) {
  check(
    (await one(tx, 'SELECT enabled FROM channel_gates WHERE kind=$1', [kind]))?.enabled,
    'CHANNEL_DISABLED',
    'This channel has not passed its pilot activation gate.',
  );
}
export async function saleEligible(tx: SQL, asset: any, channel = 'web') {
  if (!asset || asset.custody !== (channel === 'cvm' ? 'device' : 'vault')) return false;
  if (
    !(await one(tx, `SELECT a.id FROM assets a WHERE a.id=$1 AND ${collectionPublishedSql}`, [
      asset.asset_id || asset.id,
    ]))
  )
    return false;
  if (await one(tx, `SELECT 1 WHERE ${assetPaymentHoldSql('$1')}`, [asset.asset_id || asset.id]))
    return false;
  if (asset.kind === 'sealed_pack')
    return (
      channel !== 'web' &&
      !['revoked', 'rejected'].includes(asset.certification) &&
      !!(await one(tx, "SELECT asset_id FROM sealed_packs WHERE asset_id=$1 AND status='sealed'", [
        asset.asset_id || asset.id,
      ]))
    );
  return asset.certification === 'verified';
}
export async function channelQuote(
  tx: SQL,
  actor: Actor,
  assetId: string,
  listingId: string,
  data: any,
): Promise<any> {
  const allocation = await one(
    tx,
    `SELECT a.*,c.kind,c.status AS context_status,c.terms,c.terms_version,c.deadline,
    d.revoked,d.last_seen_at FROM channel_allocations a JOIN channel_contexts c ON c.id=a.context_id
    LEFT JOIN channel_devices d ON d.context_id=c.id WHERE a.asset_id=$1 AND a.state<>'closed'`,
    [assetId],
  );
  if (!allocation) {
    check(!data.allocation_id, 'ALLOCATION_INVALID', 'Channel inventory is no longer assigned.');
    return null;
  }
  check(
    data.allocation_id === allocation.id && allocation.listing_id === listingId,
    'CHANNEL_ALLOCATION_REQUIRED',
    'Purchase through the assigned channel.',
  );
  await gate(tx, allocation.kind);
  check(
    allocation.state === 'assigned',
    'INVENTORY_CONFLICT',
    'This channel item is already allocated to a paid order.',
  );
  check(
    allocation.context_status === (allocation.kind === 'goup' ? 'locked' : 'open'),
    'CHANNEL_NOT_OPEN',
    'This channel is not accepting payments.',
  );
  if (allocation.deadline)
    check(
      new Date(allocation.deadline).getTime() > Date.now(),
      'CHANNEL_DEADLINE',
      'The channel deadline has passed.',
    );
  if (allocation.kind === 'cvm')
    check(
      !allocation.revoked &&
        allocation.last_seen_at &&
        new Date(allocation.last_seen_at).getTime() > Date.now() - 90000,
      'DEVICE_OFFLINE',
      'The device is offline. New paid vends are disabled.',
    );
  if (allocation.kind === 'goup') {
    const pledge = await one(tx, 'SELECT * FROM group_pledges WHERE allocation_id=$1', [
      allocation.id,
    ]);
    check(
      pledge?.user_id === actor.id && pledge.accepted_terms_version === allocation.terms_version,
      'GROUP_ALLOCATION',
      'This group share belongs to another participant or has different terms.',
    );
  }
  if (allocation.kind === 'waxup') {
    check(!data.use_credits, 'CASH_ONLY', 'Wholesale purchases use cash, not ecosystem credits.');
    check(
      await one(
        tx,
        `SELECT b.user_id FROM channel_businesses b JOIN memberships m ON m.org_id=b.org_id AND m.user_id=b.user_id
      WHERE b.user_id=$1 AND m.role IN ('owner','operator','publisher')`,
        [actor.id],
      ),
      'BUSINESS_REQUIRED',
      'An approved business account is required.',
      403,
    );
  }
  check(
    data.fulfillment === 'vault',
    'CHANNEL_FULFILLMENT',
    'Channel fulfillment is coordinated by the channel, not standard web shipping.',
  );
  let shipping = 0;
  if (allocation.kind === 'goup') {
    const slots = (
      await tx.query(
        "SELECT id FROM channel_allocations WHERE context_id=$1 AND state<>'closed' ORDER BY slot,id",
        [allocation.context_id],
      )
    ).rows;
    const index = slots.findIndex((s) => s.id === allocation.id),
      total = allocation.terms.shipping_total_cents;
    shipping = Math.floor(total / slots.length) + (index < total % slots.length ? 1 : 0);
  } else if (allocation.kind === 'waxup') shipping = allocation.terms.shipping_total_cents;
  return {
    ...allocation,
    shipping,
    snapshot: {
      ...allocation.terms,
      version: allocation.terms_version,
      context_id: allocation.context_id,
      kind: allocation.kind,
      shipping_cents: shipping,
    },
  };
}
export async function channelPaid(tx: SQL, o: any) {
  if (!o.allocation_id) return;
  const c = await one(
    tx,
    `SELECT c.* FROM channel_allocations a JOIN channel_contexts c ON c.id=a.context_id WHERE a.id=$1`,
    [o.allocation_id],
  );
  const failed =
    c?.status === 'canceled' || (c?.deadline && new Date(c.deadline).getTime() <= Date.now());
  await tx.query("UPDATE channel_allocations SET state='committed' WHERE id=$1", [o.allocation_id]);
  await tx.query('UPDATE channel_orders SET state=$2,updated_at=now() WHERE order_id=$1', [
    o.id,
    failed ? 'refund_required' : 'awaiting_fulfillment',
  ]);
}
export async function channelRefundGate(tx: SQL, o: any) {
  const channel = await one(tx, 'SELECT state FROM channel_orders WHERE order_id=$1', [o.id]);
  if (!channel) return false;
  check(
    ['awaiting_fulfillment', 'refund_required'].includes(channel.state),
    'CHANNEL_RECOVERY_REQUIRED',
    'Resolve the physical channel outcome before refunding.',
  );
  if (o.channel === 'cvm')
    check(
      channel.state === 'refund_required',
      'VEND_UNRESOLVED',
      'A device outcome must be reconciled before refund.',
    );
  if (o.channel === 'goup')
    check(
      !(await one(
        tx,
        `SELECT other.order_id FROM channel_orders own JOIN channel_orders other ON other.context_id=own.context_id WHERE own.order_id=$1 AND other.state='fulfilled'`,
        [o.id],
      )),
      'GROUP_DISPATCHED',
      'This group has started dispatch. Open a support case for return review.',
    );
  if (o.channel === 'liveup')
    check(
      !(await one(tx, "SELECT asset_id FROM sealed_packs WHERE asset_id=$1 AND status='opened'", [
        o.asset_id,
      ])),
      'PACK_OPENED',
      'An opened pack needs a separate return investigation.',
    );
  return o.channel === 'cvm' && channel.state === 'refund_required';
}
export async function channelRefunded(tx: SQL, o: any) {
  if (!o.allocation_id) return;
  await tx.query("UPDATE channel_orders SET state='refunded',updated_at=now() WHERE order_id=$1", [
    o.id,
  ]);
  // An undispensed item still occupies its device slot until a witnessed removal.
  if (o.channel !== 'cvm')
    await tx.query("UPDATE channel_allocations SET state='closed' WHERE id=$1", [o.allocation_id]);
}
export async function assertChannelFree(tx: SQL, assetId: string) {
  check(
    !(await one(tx, "SELECT id FROM channel_allocations WHERE asset_id=$1 AND state<>'closed'", [
      assetId,
    ])),
    'CHANNEL_STOCK_HELD',
    'This item is assigned to a channel. Complete or release its physical allocation first.',
  );
}
