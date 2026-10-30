import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDatabase, migrate, one, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services, createApp } from '../apps/api/src/app';
import { type Actor } from '../apps/api/src/auth';
import { staffPermissions } from '../packages/domain/contracts';
import { id, DomainError } from '../packages/domain/core';
import { FakePaymentControls } from './fixtures/payment-controls-provider';
const actor = (uid: string, staff = false): Actor => ({
  id: uid,
  email: `${uid}@pixup.demo`,
  name: uid,
  is_staff: staff,
  staff_permissions: staff ? [...staffPermissions] : [],
  csrf: 'fixture',
  organizations: [],
});
const buyer = actor('collector'),
  seller = actor('seller'),
  ops = actor('ops', true),
  reviewer = actor('creator', true);
const rejection = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
let db: Database, s: Services, provider: FakePaymentControls;
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  await db.query("UPDATE users SET is_staff=true WHERE id='creator'");
  await db.query("INSERT INTO staff_permissions(user_id,permission) VALUES ('creator','finance')");
  provider = new FakePaymentControls();
  s = new Services(db, {
    provider,
    origin: 'http://127.0.0.1:3000',
    webhookSecret: 'fixture',
    connectCountries: ['US'],
    connectTransfers: true,
  });
});
afterEach(async () => db.close());
async function paid(asset = 'court-01', credits = false) {
  const q = await s.commerce.quote(buyer, {
    listing_id: `listing-${asset}`,
    fulfillment: 'vault',
    use_credits: credits,
  });
  const o = await s.commerce.checkout(buyer, { quote_id: q.id, shipping_address: '' }, id());
  await s.payments.start(buyer, o.id);
  const a = (await one(db, 'SELECT * FROM payment_attempts WHERE order_id=$1', [o.id]))!;
  const remote = provider.paid(a.provider_session_id);
  await s.payments.status(buyer, o.id);
  return { o, remote };
}
const partial = {
  seller_cents: 100,
  fee_cents: 0,
  shipping_cents: 0,
  reason: 'Explicit synthetic customer price adjustment allocation',
};
async function approve(aid: string) {
  return s.finance.decide(
    reviewer,
    aid,
    1,
    'approve',
    'Independent review of exact test payment inputs',
  );
}
test('payment account binding rejects credential changes and legacy scope requires verified original session', async () => {
  const { o, remote } = await paid();
  assert.equal(
    (await one(db, 'SELECT account_id FROM payment_attempts WHERE order_id=$1', [o.id]))!
      .account_id,
    provider.account,
  );
  provider.account = 'acct_other';
  await assert.rejects(
    s.payments.requestRefund(ops, o.id, 'Changed provider cannot refund this order'),
    rejection('PROVIDER_ACCOUNT_MISMATCH'),
  );
  provider.account = 'acct_fixture_platform';
  await db.exec('ALTER TABLE payment_attempts DISABLE TRIGGER immutable_payment_scope');
  await db.query(
    'UPDATE payment_attempts SET account_id=NULL,provider_mode=NULL WHERE order_id=$1',
    [o.id],
  );
  await db.exec('ALTER TABLE payment_attempts ENABLE TRIGGER immutable_payment_scope');
  await assert.rejects(s.payments.status(buyer, o.id), rejection('PAYMENT_SCOPE_REVIEW'));
  await s.payments.bindScope(
    ops,
    o.id,
    remote.id,
    'Verified original session under its original account',
  );
  assert.equal((await s.paymentControls.reconcile(ops, o.id)).state, 'matched');
  await assert.rejects(
    db.query("UPDATE payment_attempts SET account_id='acct_other' WHERE order_id=$1", [o.id]),
  );
});
test('independent partial cash adjustment preserves title and credits; remaining full refund reverses each allocation once', async () => {
  const { o } = await paid('court-01', true),
    before = (await s.commerce.credits(buyer)).available;
  const a = await s.paymentControls.requestPartial(ops, o.id, partial);
  await assert.rejects(
    s.finance.decide(ops, a.id, 1, 'approve', 'Self approval must fail'),
    rejection('SELF_APPROVAL'),
  );
  await approve(a.id);
  assert.equal(
    (await one(db, "SELECT owner_id FROM assets WHERE id='court-01'"))!.owner_id,
    buyer.id,
  );
  assert.equal((await s.commerce.credits(buyer)).available, before);
  assert.equal(
    (await one(db, 'SELECT status FROM orders WHERE id=$1', [o.id]))!.status,
    'fulfilled',
  );
  assert.equal((await s.paymentControls.reconcile(ops, o.id)).state, 'matched');
  const order = (await one(db, 'SELECT * FROM orders WHERE id=$1', [o.id]))!;
  await s.payments.requestRefund(ops, o.id, 'Return remaining cash and all original credits');
  assert.equal(
    [...provider.refunds.values()].reduce((n, r) => n + r.amount, 0),
    order.total_cents,
  );
  assert.equal((await s.commerce.credits(buyer)).available, before + order.credit_units);
  assert.equal(
    (await one(
      db,
      "SELECT sum(l.amount)::int AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.unit='USD' AND l.account='stripe_test_clearing'",
    ))!.n,
    0,
  );
  assert.equal(
    (await one(db, 'SELECT owner_id FROM assets WHERE id=$1', [order.asset_id]))!.owner_id,
    order.seller_id,
  );
});
test('partial refund ambiguity replays the same provider key and stale approval cannot exceed remaining funds', async () => {
  const { o } = await paid();
  const a = await s.paymentControls.requestPartial(ops, o.id, partial);
  provider.loseRefund = true;
  await assert.rejects(approve(a.id));
  await assert.rejects(
    s.payments.requestRefund(ops, o.id, 'A pending partial refund must hold full reversal'),
    rejection('PAYMENT_HOLD'),
  );
  await Promise.all([
    s.paymentControls.refreshPartial(ops, a.id, undefined, 'Recover the original partial refund'),
    s.paymentControls.refreshPartial(
      ops,
      a.id,
      undefined,
      'Concurrent recovery of the same partial refund',
    ),
  ]);
  assert.equal(provider.refunds.size, 1);
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM journal_entries WHERE reference=$1', [
      `partial-refund:${a.id}`,
    ]))!.n,
    1,
  );
  await assert.rejects(
    s.paymentControls.requestPartial(ops, o.id, { ...partial, seller_cents: 9999999 }),
    rejection('REFUND_ALLOCATION'),
  );
});
test('failed full refund replacement needs terminal provider evidence and independent approval, retaining both attempts', async () => {
  const { o } = await paid();
  provider.refundOutcome = 'failed';
  await s.payments.requestRefund(ops, o.id, 'Initial refund reaches terminal provider failure');
  const a = await s.paymentControls.requestRetry(
    ops,
    o.id,
    'Reviewed original provider failure before retry',
  );
  provider.refundOutcome = 'succeeded';
  await approve(a.id);
  const rows = (
    await db.query('SELECT * FROM payment_refunds WHERE order_id=$1 ORDER BY attempt_number', [
      o.id,
    ])
  ).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[1].previous_refund_id, rows[0].id);
  assert.equal(rows[1].status, 'succeeded');
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM journal_entries WHERE reference=$1', [
      `refund:${o.id}`,
    ]))!.n,
    1,
  );
  assert.equal((await s.payments.queue(ops)).items.filter((r) => r.id === o.id).length, 1);
});
function signed(event: any) {
  const raw = Buffer.from(JSON.stringify(event)),
    t = Math.floor(Date.now() / 1000);
  return {
    raw,
    signature: `t=${t},v1=${createHmac('sha256', 'fixture')
      .update(t + '.')
      .update(raw)
      .digest('hex')}`,
  };
}
test('signed refund events deduplicate, reject account/content changes and retrieve canonical outcomes', async () => {
  const { o, remote } = await paid();
  provider.refundOutcome = 'pending';
  await s.payments.requestRefund(ops, o.id, 'Pending test refund for durable webhook handling');
  const refund = [...provider.refunds.values()][0];
  refund.status = 'succeeded';
  const e = {
      id: 'evt_refund_control',
      type: 'refund.updated',
      livemode: false,
      data: { object: { id: refund.id, payment_intent: remote.payment_intent } },
    },
    sig = signed(e);
  await s.paymentControls.webhook(sig.raw, sig.signature);
  await s.paymentControls.webhook(sig.raw, sig.signature);
  const changed = signed({ ...e, type: 'refund.failed' });
  await assert.rejects(
    s.paymentControls.webhook(changed.raw, changed.signature),
    rejection('WEBHOOK_CONFLICT'),
  );
  const other = signed({ ...e, id: 'evt_wrong_account', account: 'acct_other' });
  await assert.rejects(
    s.paymentControls.webhook(other.raw, other.signature),
    rejection('WEBHOOK_ACCOUNT'),
  );
  await s.paymentControls.worker();
  assert.equal(
    (await one(db, 'SELECT status FROM orders WHERE id=$1', [o.id]))!.status,
    'refunded',
  );
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM payment_control_events'))!.n, 1);
});
test('disputes freeze financial activity and price eligibility without changing title, credits or order status', async () => {
  const { o, remote } = await paid();
  const did = 'du_fixture';
  provider.disputes.set(did, {
    id: did,
    livemode: false,
    payment_intent: remote.payment_intent,
    amount: 100,
    currency: 'usd',
    status: 'needs_response',
    evidence_details: { due_by: Math.floor(Date.now() / 1000) + 86400 },
  });
  await s.paymentControls.dispute(
    ops,
    did,
    'Retrieve current provider dispute and response deadline',
  );
  await assert.rejects(
    s.payments.requestRefund(ops, o.id, 'Disputed payment cannot also be refunded'),
    rejection('PAYMENT_HOLD'),
  );
  await assert.rejects(s.catalog.list(buyer, 'court-01', 10000), rejection('REFUND_PENDING'));
  assert.equal(
    (await one(db, 'SELECT status FROM orders WHERE id=$1', [o.id]))!.status,
    'fulfilled',
  );
  assert.equal(
    (await one(db, "SELECT owner_id FROM assets WHERE id='court-01'"))!.owner_id,
    buyer.id,
  );
  provider.disputes.get(did).status = 'won';
  await s.paymentControls.dispute(ops, did, 'Retrieve authoritative won dispute outcome');
  assert.equal((await s.paymentControls.reconcile(ops, o.id)).state, 'matched');
  await s.payments.requestRefund(
    ops,
    o.id,
    'Independent normal refund after authoritative dispute win',
  );
});
test('unrecognized external refunds create immutable reconciliation evidence and hold new adjustments', async () => {
  const { o, remote } = await paid();
  provider.refunds.set('re_external', {
    id: 're_external',
    amount: 25,
    currency: 'usd',
    payment_intent: remote.payment_intent!,
    metadata: { order_id: o.id, refund_id: 'unknown' },
    status: 'succeeded',
  });
  assert.equal((await s.paymentControls.reconcile(ops, o.id)).state, 'mismatch');
  await assert.rejects(
    s.paymentControls.requestPartial(ops, o.id, partial),
    rejection('PAYMENT_HOLD'),
  );
  await assert.rejects(db.query("UPDATE payment_reconciliations SET state='matched'"));
  assert.equal(
    (await one(db, 'SELECT state FROM payment_exceptions WHERE order_id=$1', [o.id]))!.state,
    'open',
  );
  assert.equal(
    (await one(db, 'SELECT status FROM orders WHERE id=$1', [o.id]))!.status,
    'fulfilled',
  );
});
test('onboarding is owner scoped and test transfer approval replays an ambiguous provider result without bank-paid claims', async () => {
  const { o } = await paid('idol-01');
  provider.loseRecipient = true;
  await assert.rejects(s.connect.onboard(seller, 'US'));
  const link = await s.connect.onboard(seller, 'US');
  assert.match(link.url, /^https:\/\/connect.stripe.com\//);
  assert.equal(provider.recipients.size, 1);
  assert.equal((await s.connect.status(buyer)).recipient, null);
  provider.ready('seller');
  await s.connect.refresh(seller);
  const settlement = (await one(db, 'SELECT id FROM settlements WHERE order_id=$1', [o.id]))!;
  const approval = await s.connect.request(
    ops,
    settlement.id,
    'Release fulfilled test seller proceeds to connected balance',
  );
  provider.loseTransfer = true;
  await assert.rejects(approve(approval.id));
  assert.equal(provider.transfers.size, 1);
  await s.connect.recoverTransfer(
    ops,
    approval.id,
    undefined,
    'Recover the original transfer using its durable key',
  );
  assert.equal(provider.transfers.size, 1);
  assert.equal(
    (await one(db, 'SELECT status FROM settlements WHERE id=$1', [settlement.id]))!.status,
    'released',
  );
  assert.equal((await s.connect.status(seller)).bank_payouts_tracked, false);
  await assert.rejects(
    s.payments.requestRefund(ops, o.id, 'Transferred funds require a reversal workflow first'),
    rejection('PAYMENT_HOLD'),
  );
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM journal_entries WHERE reference=$1', [
      `connect-transfer:${approval.id}`,
    ]))!.n,
    1,
  );
});
test('connect gates and recipient readiness cannot be bypassed by a return URL or finance request', async () => {
  const { o } = await paid('idol-01');
  await s.connect.onboard(seller, 'US');
  const settlement = (await one(db, 'SELECT id FROM settlements WHERE order_id=$1', [o.id]))!;
  await assert.rejects(
    s.connect.request(
      ops,
      settlement.id,
      'An incomplete hosted onboarding must not permit transfer',
    ),
    rejection('RECIPIENT_NOT_READY'),
  );
  const disabled = new Services(db, { provider });
  await assert.rejects(disabled.connect.onboard(seller, 'US'), rejection('CONNECT_DISABLED'));
  assert.equal((await s.connect.status(seller)).recipient!.transfers_active, false);
});
test('payment controls HTTP separates buyer, finance, CSRF and provider account information', async () => {
  const { o } = await paid();
  const server = createApp(s).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  try {
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'collector@pixup.demo', password: 'PixupDemo2026!' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal(
      (await fetch(`${base}/ops/payment-controls`, { headers: { cookie } })).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/ops/payments/${o.id}/partial-refund`, {
          method: 'POST',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify(partial),
        })
      ).status,
      403,
    );
    const data = await (
      await fetch(`${base}/orders/${o.id}/payment-adjustments`, { headers: { cookie } })
    ).json();
    assert(!JSON.stringify(data).includes('acct_'));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test('old failed-refund events cannot replace a later successful retry', async () => {
  const { o, remote } = await paid();
  provider.refundOutcome = 'failed';
  await s.payments.requestRefund(ops, o.id, 'Initial failed refund for historical event replay');
  const first = [...provider.refunds.values()][0];
  const a = await s.paymentControls.requestRetry(
    ops,
    o.id,
    'Independent original failure review before replacement',
  );
  provider.refundOutcome = 'succeeded';
  await approve(a.id);
  const e = signed({
    id: 'evt_old_failed_refund',
    type: 'refund.failed',
    livemode: false,
    data: { object: { id: first.id, payment_intent: remote.payment_intent } },
  });
  await s.paymentControls.webhook(e.raw, e.signature);
  await s.paymentControls.worker();
  assert.equal(
    (await one(
      db,
      "SELECT processed_at FROM payment_control_events WHERE event_id='evt_old_failed_refund'",
    ))!.processed_at !== null,
    true,
  );
  assert.equal(
    (await one(db, 'SELECT status FROM orders WHERE id=$1', [o.id]))!.status,
    'refunded',
  );
});
test('a delayed older dispute retrieval cannot overwrite a newer provider outcome', async () => {
  const { o, remote } = await paid();
  const did = 'du_racing_fixture',
    d = {
      id: did,
      livemode: false,
      payment_intent: remote.payment_intent,
      amount: 100,
      currency: 'usd',
      status: 'needs_response',
      evidence_details: { due_by: null },
    };
  provider.disputes.set(did, d);
  let release!: (v: any) => void, started!: () => void;
  const began = new Promise<void>((r) => {
    started = r;
  });
  const original = provider.dispute.bind(provider);
  let first = true;
  provider.dispute = async (id) => {
    if (first) {
      first = false;
      started();
      return new Promise((r) => {
        release = r;
      });
    }
    return original(id);
  };
  const old = s.paymentControls.syncDispute(did);
  await began;
  d.status = 'won';
  await s.paymentControls.syncDispute(did);
  release({ ...d, status: 'needs_response' });
  await old;
  assert.equal(
    (await one(db, 'SELECT status FROM provider_disputes WHERE id=$1', [did]))!.status,
    'won',
  );
  assert.equal((await s.paymentControls.reconcile(ops, o.id)).state, 'matched');
});

test('external reversal observation preserves transfer history and holds independently of cash reconciliation', async () => {
  const { o } = await paid('idol-01');
  await s.connect.onboard(seller, 'US');
  provider.ready('seller');
  await s.connect.refresh(seller);
  const settlement = (await one(db, 'SELECT id FROM settlements WHERE order_id=$1', [o.id]))!;
  const approval = await s.connect.request(
    ops,
    settlement.id,
    'Approve fulfilled test proceeds for connected balance',
  );
  await approve(approval.id);
  const transfer = [...provider.transfers.values()][0];
  transfer.reversed = true;
  transfer.amount_reversed = transfer.amount;
  await assert.rejects(
    s.connect.recoverTransfer(
      ops,
      approval.id,
      undefined,
      'Observe external provider reversal without inventing accounting',
    ),
    rejection('TRANSFER_REVERSED'),
  );
  assert.equal(
    (await one(db, 'SELECT state FROM settlement_transfers WHERE id=$1', [approval.id]))!.state,
    'succeeded',
  );
  assert.equal((await s.paymentControls.reconcile(ops, o.id)).state, 'matched');
  assert.equal(
    (await one(
      db,
      "SELECT state FROM payment_exceptions WHERE order_id=$1 AND code='TRANSFER_REVERSED'",
      [o.id],
    ))!.state,
    'open',
  );
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM journal_entries WHERE reference=$1', [
      `connect-transfer:${approval.id}`,
    ]))!.n,
    1,
  );
});
