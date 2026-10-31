import { verifyCommunityPostgres } from '../tests/fixtures/community-postgres';
import { verifyAssistantPostgres } from '../tests/fixtures/assistant-postgres';
import assert from 'node:assert/strict';
import { withDatabaseActor, assertRuntimeRole } from '../packages/database/context';
import { readFile } from 'node:fs/promises';
import { openDatabase, migrate, one, type SQL, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services } from '../apps/api/src/app';
import type { Actor } from '../apps/api/src/auth';
import type { CheckoutProvider, StripeSession, StripeRefund } from '../apps/api/src/stripe';
import { FakeBilling } from '../tests/fixtures/billing-provider';
import { FakePaymentControls } from '../tests/fixtures/payment-controls-provider';
import { id } from '../packages/domain/core';

// Requires an explicitly supplied, EMPTY disposable PostgreSQL database.
// Does not load .env, reset schemas, drop data or touch the default local database.
const url = process.env.PIXUP_VERIFY_DATABASE_URL;
assert(url, 'Set PIXUP_VERIFY_DATABASE_URL to an empty disposable PostgreSQL database.');
const underlying = await openDatabase(url);
function checked(sql: SQL): SQL {
  return {
    exec: (text) => sql.exec(text),
    query: (text, params) => {
      assert(!params?.includes(undefined), `Undefined SQL parameter in verification: ${text}`);
      return sql.query(text, params);
    },
  };
}
const db: Database = {
  ...checked(underlying),
  transaction: (fn) => underlying.transaction((tx) => fn(checked(tx))),
  close: () => underlying.close(),
};
try {
  assert.equal(
    (await one(
      db,
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
    ))!.n,
    0,
    'Verification database must be empty.',
  );
  await db.exec(
    'CREATE TABLE migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const file of [
    '001-initial.sql',
    '002-journal-invariants.sql',
    '003-media.sql',
    '004-plan-alignment.sql',
    '005-stripe-checkout.sql',
  ]) {
    await db.transaction(async (tx) => {
      await tx.exec(
        await readFile(new URL(`../packages/database/${file}`, import.meta.url), 'utf8'),
      );
      await tx.query('INSERT INTO migrations(version) VALUES ($1)', [file.slice(0, 3)]);
    });
  }
  await seed(db);
  // Persist a true pre-006 order without calling newer services against an old schema.
  await db.query(
    "INSERT INTO quotes(id,buyer_id,listing_id,price_cents,fee_cents,credit_units,fulfillment,shipping_cents,expires_at) VALUES ('legacy-quote','collector','listing-orbit-01',6500,325,0,'vault',0,now()+interval '10 minutes')",
  );
  await db.query(
    "INSERT INTO orders(id,quote_id,buyer_id,seller_id,asset_id,listing_id,status,total_cents,fee_cents,seller_cents,fulfillment,reservation_expires_at,payment_provider) VALUES ('legacy-order','legacy-quote','collector','platform','orbit-01','listing-orbit-01','canceled',6500,325,6175,'vault',now(),'stripe_test')",
  );
  await db.query(
    "INSERT INTO payment_attempts(id,order_id,status) VALUES ('legacy-attempt','legacy-order','requires_review')",
  );
  await migrate(db);
  await migrate(db);
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM migrations'))!.n, 16);
  assert.deepEqual(
    await one(
      db,
      "SELECT commercial_policy_version,commercial_snapshot FROM orders WHERE id='legacy-order'",
    ),
    { commercial_policy_version: null, commercial_snapshot: null },
  );
  assert.equal(
    (await one(db, "SELECT commercial_snapshot FROM quotes WHERE id='legacy-quote'"))!
      .commercial_snapshot,
    null,
  );
  assert.equal(
    (await one(db, "SELECT reason FROM payment_reviews WHERE order_id='legacy-order'"))!.reason,
    'ambiguous_create',
  );
  assert.equal(
    (await one(db, "SELECT channel FROM orders WHERE id='legacy-order'"))!.channel,
    'web',
  );
  let session: StripeSession;
  let refund: StripeRefund | undefined;
  let refundKey: string | undefined;
  const provider: CheckoutProvider = {
    async create(payload) {
      session ??= {
        id: 'cs_test_postgres',
        livemode: false,
        status: 'open',
        payment_status: 'unpaid',
        amount_total: Number(payload['line_items[0][price_data][unit_amount]']),
        currency: 'usd',
        client_reference_id: payload.client_reference_id,
        metadata: { order_id: payload.client_reference_id },
        url: 'https://checkout.stripe.com/c/pay/test',
        payment_intent: null,
      };
      return structuredClone(session);
    },
    async retrieve() {
      return structuredClone(session);
    },
    async expire() {
      session.status = 'expired';
      return structuredClone(session);
    },
    async refund(payload, key) {
      if (refundKey) assert.equal(key, refundKey, 'Concurrent refund must reuse its durable key');
      refundKey = key;
      refund ??= {
        id: 're_postgres',
        amount: Number(payload.amount),
        currency: 'usd',
        payment_intent: payload.payment_intent,
        metadata: {
          order_id: payload['metadata[order_id]'],
          refund_id: payload['metadata[refund_id]'],
        },
        status: 'pending',
      };
      return structuredClone(refund);
    },
    async retrieveRefund() {
      return structuredClone(refund!);
    },
  };
  const s = new Services(db, { provider });
  const buyer: Actor = {
    id: 'collector',
    email: 'collector@pixup.demo',
    name: 'Collector',
    is_staff: false,
    staff_permissions: [],
    organizations: [],
    csrf: 'fixture',
  };
  const finance: Actor = { ...buyer, id: 'ops', is_staff: true, staff_permissions: ['finance'] };
  const { privacyPolicy } = await import('../packages/domain/privacy');
  const policy = privacyPolicy();
  for (const uid of ['collector', 'seller', 'platform', 'ops'])
    await s.privacy.consent(
      { ...buyer, id: uid },
      {
        adult: true,
        terms_version: policy.terms_version,
        privacy_version: policy.privacy_version,
        marketing_opt_in: false,
      },
    );
  const quote = await s.commerce.quote(buyer, {
    listing_id: 'listing-court-01',
    fulfillment: 'vault',
    use_credits: true,
  });
  const [a, b] = await Promise.all([
    s.commerce.checkout(buyer, { quote_id: quote.id, shipping_address: '' }, 'pg-replay'),
    s.commerce.checkout(buyer, { quote_id: quote.id, shipping_address: '' }, 'pg-replay'),
  ]);
  assert.equal(a.id, b.id);
  await s.payments.start(buyer, a.id);
  session!.status = 'complete';
  session!.payment_status = 'paid';
  session!.payment_intent = 'pi_postgres';
  session!.url = null;
  await Promise.all([s.payments.status(buyer, a.id), s.payments.status(buyer, a.id)]);
  await Promise.all([
    s.payments.requestRefund(finance, a.id, 'Concurrent approved vault return'),
    s.payments.requestRefund(finance, a.id, 'Concurrent approved vault return'),
  ]);
  await assert.rejects(s.catalog.list(buyer, 'court-01', 15000), { code: 'REFUND_PENDING' });
  refund!.status = 'succeeded';
  await Promise.all([s.payments.status(buyer, a.id), s.payments.status(buyer, a.id)]);
  assert.equal((await s.commerce.order(buyer, a.id)).status, 'refunded');
  assert.equal((await s.commerce.credits(buyer)).available, 1200);
  assert.equal((await one(db, 'SELECT count(*)::int AS n FROM payment_refunds'))!.n, 1);
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM journal_entries WHERE reference=$1', [
      `refund:${a.id}`,
    ]))!.n,
    1,
  );
  assert.equal(
    (await one(
      db,
      'SELECT count(*)::int AS n FROM (SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING sum(amount)<>0) x',
    ))!.n,
    0,
  );
  // Concurrent channel reservations and command completion against real PostgreSQL.
  const { generateKeyPairSync, sign, randomUUID } = await import('node:crypto');
  const demo = new Services(db),
    warehouse: Actor = { ...finance, staff_permissions: ['finance', 'warehouse'] };
  await demo.channels.setGate(
    warehouse,
    'cvm',
    true,
    'Disposable PostgreSQL channel contract evidence',
  );
  const keys = generateKeyPairSync('ed25519');
  const channel = await demo.channels.create(warehouse, {
    kind: 'cvm',
    org_id: 'ops-org',
    name: 'PostgreSQL device',
    terms: { description: 'Isolated concurrency pilot contract' },
    public_key: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  const allocation = await demo.channels.assign(warehouse, channel.id, {
    listing_id: 'listing-court-01',
    slot: '1',
  });
  async function deviceEvent(body: unknown) {
    const raw = Buffer.from(JSON.stringify(body)),
      timestamp = String(Date.now());
    return demo.channels.event(
      channel.id,
      raw,
      timestamp,
      sign(
        null,
        Buffer.from(`${channel.id}\n${timestamp}\n${raw.toString()}`),
        keys.privateKey,
      ).toString('base64'),
    );
  }
  await deviceEvent({ event_id: randomUUID(), type: 'heartbeat' });
  const competitors = [buyer, { ...buyer, id: 'seller' }];
  const quotes = await Promise.all(
    competitors.map((actor) =>
      demo.commerce.quote(actor, {
        listing_id: 'listing-court-01',
        allocation_id: allocation.id,
        fulfillment: 'vault',
      }),
    ),
  );
  const reservations = await Promise.allSettled(
    competitors.map((actor, i) =>
      demo.commerce.checkout(actor, { quote_id: quotes[i].id, shipping_address: '' }, randomUUID()),
    ),
  );
  assert.equal(reservations.filter((r) => r.status === 'fulfilled').length, 1);
  const winner = reservations.findIndex((r) => r.status === 'fulfilled');
  const reserved = reservations[winner] as PromiseFulfilledResult<{ id: string }>;
  await demo.commerce.pay(competitors[winner], reserved.value.id, true);
  await Promise.all([demo.channels.worker(), demo.channels.worker()]);
  const polls = await Promise.all([
    deviceEvent({ event_id: randomUUID(), type: 'heartbeat' }),
    deviceEvent({ event_id: randomUUID(), type: 'heartbeat' }),
  ]);
  const commands = polls.flatMap((p) => p.commands);
  assert.equal(commands.length, 1);
  const { verify } = await import('node:crypto');
  assert(
    verify(
      null,
      Buffer.from(commands[0].payload),
      demo.channels.publicKey,
      Buffer.from(commands[0].signature, 'base64'),
    ),
  );
  await Promise.all(
    [1, 2].map(() =>
      deviceEvent({
        event_id: randomUUID(),
        type: 'vend',
        command_id: commands[0].id,
        outcome: 'delivered',
        evidence: 'Concurrent signed simulator outcome evidence',
      }),
    ),
  );
  assert.equal(
    (await one(
      db,
      "SELECT count(*)::int AS n FROM provenance_events WHERE asset_id='court-01' AND type='channel_fulfilled'",
    ))!.n,
    1,
  );
  assert.equal(
    (await demo.commerce.order(competitors[winner], reserved.value.id)).status,
    'fulfilled',
  );
  for (const kind of ['liveup', 'goup', 'waxup', 'ai'])
    await demo.channels.setGate(
      warehouse,
      kind,
      true,
      'Disposable PostgreSQL pilot phase evidence',
    );
  const credential = await demo.tools.create(warehouse, {
    org_id: 'ops-org',
    name: 'Concurrent quota',
    scopes: ['query'],
    daily_limit: 1,
  });
  const calls = await Promise.allSettled(
    [1, 2].map(() =>
      demo.tools.execute(`Bearer ${credential.secret}`, 'query', { request_id: randomUUID() }),
    ),
  );
  assert.equal(calls.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await one(db, 'SELECT count(*)::int AS n FROM tool_calls WHERE key_id=$1', [credential.id]))!
      .n,
    1,
  );
  console.log(
    'PostgreSQL transaction recovery checks passed; validating price and checkpoint JSON next.',
  );
  const grade = (await one(db, "SELECT grade FROM assets WHERE id='orbit-01'"))!.grade;
  const cohort = await demo.pricing.cohort(finance, {
    label: 'PostgreSQL comparable fixture',
    definition:
      'Equivalent Orbit variant and exact condition; synthetic PostgreSQL observation test.',
    grade,
    asset_ids: ['orbit-01'],
  });
  for (let i = 0; i < 5; i++) {
    const o = await demo.pricing.observe(finance, {
      cohort_id: cohort.id,
      source: 'postgres-fixture',
      source_reference: String(i),
      permission_evidence: 'Synthetic source permission for regression only',
      evidence: 'Synthetic completed equivalent sale evidence',
      amount_cents: 10000 + i * 100,
      occurred_at: new Date(Date.now() - 1000).toISOString(),
      final_sale: true,
      related_party: false,
    });
    await demo.pricing.review(
      { ...finance, id: 'seller' },
      o.id,
      'include',
      'Independent synthetic finance review',
    );
  }
  await demo.pricing.snapshot(finance, cohort.id, 'external');
  const external = (await demo.pricing.reference('orbit-01')).lanes.find(
    (l) => l.lane === 'external',
  ) as any;
  assert.equal(external.state, 'available');
  assert.equal(external.median_cents, 10200);
  const auditor: Actor = { ...finance, staff_permissions: ['audit'] };
  const checkpoint = await demo.trust.request(auditor, 'checkpoint', '');
  const { canonical } = await import('../packages/domain/trust');
  assert.equal(
    canonical(
      (await one(db, 'SELECT payload FROM signing_requests WHERE id=$1', [checkpoint.request_id]))!
        .payload,
    ),
    canonical(checkpoint.payload),
  );
  console.log('PostgreSQL transaction, price and checkpoint checks passed; validating SaaS next.');
  const billingProvider = new FakeBilling(),
    saas = new Services(db, {}, { provider: billingProvider });
  await db.query("UPDATE users SET is_staff=true WHERE id='seller'");
  await db.query("INSERT INTO staff_permissions(user_id,permission) VALUES ('seller','finance')");
  const plan = await saas.billing.createPlan(finance, {
    name: 'PostgreSQL monthly fixture',
    audience: 'demand',
    amount_cents: 3000,
    trial_days: 0,
    grace_days: 3,
    limits: {
      seats: 5,
      asset_registrations: 51,
      collection_drafts: 10,
      listing_creations: 50,
      tool_calls: 500,
    },
  });
  const approval = await saas.finance.request(
    finance,
    'plan_activate',
    plan.id,
    'Review disposable PostgreSQL subscription fixture',
  );
  await saas.finance.decide(
    { ...finance, id: 'seller' },
    approval.id,
    1,
    'approve',
    'Independent PostgreSQL fixture approval',
  );
  const attempts = await Promise.all([
    saas.billing.start(buyer, 'collector-org', plan.id),
    saas.billing.start(buyer, 'collector-org', plan.id),
  ]);
  assert.equal(attempts[0].id, attempts[1].id);
  billingProvider.complete(attempts[0].id);
  await saas.billing.resume(buyer, attempts[0].id);
  assert.equal(
    (await saas.billing.account(buyer, 'collector-org')).entitlement.paid_entitlement,
    true,
  );
  const item = await saas.catalog.createAsset(buyer, {
    org_id: 'collector-org',
    title: 'PostgreSQL structured record',
    description: 'Synthetic category and usage serialization fixture',
    category: 'Sports',
    artwork: 'court',
    attributes: { category: 'Sports', athlete: 'Synthetic athlete', season: '2026' },
  });
  assert.equal(
    (await saas.inventory.list(buyer, 'collector-org')).items.find((a) => a.id === item.id)!
      .catalog_attributes.athlete,
    'Synthetic athlete',
  );
  assert.equal(
    (await one(
      db,
      "SELECT sum(quantity)::int AS n FROM usage_events WHERE org_id='collector-org' AND metric='asset_registrations'",
    ))!.n,
    1,
  );
  const remote = [...billingProvider.subscriptions.values()][0];
  remote.status = 'past_due';
  remote.latest_invoice!.status = 'open';
  remote.latest_invoice!.amount_paid = 0;
  await saas.billing.resume(buyer, attempts[0].id);
  assert.equal((await saas.billing.account(buyer, 'collector-org')).entitlement.state, 'grace');
  const { digest } = await import('../apps/api/src/evidence-providers');
  const ops: Actor = { ...finance, staff_permissions: ['warehouse', 'support', 'audit'] };
  const physical = new Services(
    db,
    {},
    {},
    { scanner: { scan: async () => ({ clean: true, engine: 'PostgreSQL fixture scanner' }) } },
  );
  const bytes = Buffer.from('%PDF-1.7\nSynthetic PostgreSQL evidence\n%%EOF');
  const upload = await physical.evidence.reserve(buyer, {
    client_key: id(),
    purpose: 'incident',
    asset_id: item.id,
    mime: 'application/pdf',
    size: bytes.length,
    hash: digest(bytes),
  });
  await physical.evidence.upload(buyer, upload.id, bytes);
  await physical.evidence.process(upload.id);
  await physical.evidence.review(
    ops,
    upload.id,
    true,
    'Synthetic PostgreSQL evidence scope review',
  );
  assert.deepEqual((await physical.evidence.read(buyer, upload.id)).bytes, bytes);
  const incident = await physical.logistics.incident(buyer, {
    asset_id: item.id,
    kind: 'identity_mismatch',
    evidence_id: upload.id,
    note: 'Synthetic physical identity discrepancy for recovery check',
  });
  await physical.logistics.resolve(
    ops,
    incident.id,
    1,
    'Synthetic independent resolution retains quarantine',
  );
  assert.equal(
    (await one(db, 'SELECT custody FROM assets WHERE id=$1', [item.id]))!.custody,
    'quarantine',
  );
  const paymentProvider = new FakePaymentControls(),
    controls = new Services(db, {
      provider: paymentProvider,
      connectCountries: ['US'],
      connectTransfers: true,
    });
  const cashQuote = await controls.commerce.quote(buyer, {
      listing_id: 'listing-idol-01',
      fulfillment: 'vault',
    }),
    cashOrder = await controls.commerce.checkout(
      buyer,
      { quote_id: cashQuote.id, shipping_address: '' },
      id(),
    );
  await controls.payments.start(buyer, cashOrder.id);
  const attempt = (await one(
    db,
    'SELECT provider_session_id FROM payment_attempts WHERE order_id=$1',
    [cashOrder.id],
  ))!;
  paymentProvider.paid(attempt.provider_session_id);
  await controls.payments.status(buyer, cashOrder.id);
  const adjustment = await controls.paymentControls.requestPartial(finance, cashOrder.id, {
    seller_cents: 100,
    fee_cents: 0,
    shipping_cents: 0,
    reason: 'PostgreSQL explicit partial refund allocation fixture',
  });
  await controls.finance.decide(
    { ...finance, id: 'seller' },
    adjustment.id,
    1,
    'approve',
    'Independent PostgreSQL partial refund review',
  );
  assert.equal((await controls.paymentControls.reconcile(finance, cashOrder.id)).state, 'matched');
  await controls.connect.onboard({ ...buyer, id: 'seller' }, 'US');
  paymentProvider.ready('seller');
  await controls.connect.refresh({ ...buyer, id: 'seller' });
  const held = (await one(db, 'SELECT id FROM settlements WHERE order_id=$1', [cashOrder.id]))!,
    transfer = await controls.connect.request(
      finance,
      held.id,
      'PostgreSQL fulfilled settlement test transfer review',
    );
  await controls.finance.decide(
    { ...finance, id: 'seller' },
    transfer.id,
    1,
    'approve',
    'Independent PostgreSQL connected transfer review',
  );
  assert.equal(
    (await one(db, 'SELECT state FROM settlement_transfers WHERE id=$1', [transfer.id]))!.state,
    'succeeded',
  );
  assert.equal(
    (await one(
      db,
      'SELECT count(*)::int AS n FROM (SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING sum(amount)<>0) bad',
    ))!.n,
    0,
  );

  await db.exec(
    await readFile(new URL('../infra/database/runtime-roles.sql', import.meta.url), 'utf8'),
  );
  // UUID-generated credentials contain no SQL metacharacters. Keep passwords out
  // of logs; disposable roles must also work on password-authenticated CI hosts.
  const apiPassword = id(),
    workerPassword = id();
  await db.exec(
    `CREATE ROLE pixup_identity_api LOGIN PASSWORD '${apiPassword}' IN ROLE pixup_runtime;
     CREATE ROLE pixup_identity_worker LOGIN PASSWORD '${workerPassword}' IN ROLE pixup_worker`,
  );
  const apiUrl = new URL(url);
  apiUrl.username = 'pixup_identity_api';
  apiUrl.password = apiPassword;
  const workerUrl = new URL(url);
  workerUrl.username = 'pixup_identity_worker';
  workerUrl.password = workerPassword;
  const apiDb = await openDatabase(apiUrl.href),
    roleWorker = await openDatabase(workerUrl.href);
  try {
    await assertRuntimeRole(apiDb, false);
    const otherApi = await openDatabase(apiUrl.href);
    try {
      await verifyAssistantPostgres(db, apiDb, otherApi);
    } finally {
      await otherApi.close();
    }
    await verifyCommunityPostgres(db, apiDb, roleWorker);
    await assertRuntimeRole(roleWorker, true);
    await assert.rejects(assertRuntimeRole(roleWorker, false));
    await assert.rejects(assertRuntimeRole(db, false));
    await db.query(
      "INSERT INTO collections(id,org_id,title,description,category,edition_size,status) VALUES ('rls-private','creator-org','Private tenant fixture','Only creator members may see this draft','Art',1,'draft')",
    );
    assert.equal(
      (await apiDb.query("SELECT id FROM collections WHERE id='rls-private'")).rows.length,
      0,
    );
    await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        withDatabaseActor(n % 2 ? 'creator' : 'collector', async () => {
          const rows = (await apiDb.query("SELECT id FROM collections WHERE id='rls-private'"))
            .rows;
          assert.equal(rows.length, n % 2 ? 1 : 0);
        }),
      ),
    );
    await withDatabaseActor('collector', async () => {
      assert.equal(
        (
          await apiDb.query(
            "UPDATE collections SET title='Forbidden' WHERE id='rls-private' RETURNING id",
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        apiDb.query(
          "INSERT INTO collections(id,org_id,title,description,category,edition_size) VALUES ('rls-foreign','creator-org','Forbidden','Cross-tenant insertion attempt','Art',1)",
        ),
      );
    });
    await assert.rejects(
      withDatabaseActor('creator', () =>
        apiDb.transaction(async (tx) => {
          assert.equal(
            (await tx.query("SELECT id FROM collections WHERE id='rls-private'")).rows.length,
            1,
          );
          throw new Error('Deliberate context rollback');
        }),
      ),
    );
    assert.equal(
      (await apiDb.query("SELECT id FROM collections WHERE id='rls-private'")).rows.length,
      0,
    );
    assert.equal(
      (await roleWorker.query("SELECT id FROM collections WHERE id='rls-private'")).rows.length,
      1,
    );
    await assert.rejects(apiDb.exec('CREATE TABLE forbidden_runtime_ddl(id integer)'));
    await assert.rejects(apiDb.exec('TRUNCATE journal_lines'));
    await assert.rejects(apiDb.exec('SET ROLE pixup_worker'));
    await assert.rejects(apiDb.query("UPDATE migrations SET version='bad' WHERE version='013'"));
    const apiServices = new Services(apiDb),
      login = await apiServices.auth.login('creator@pixup.demo', 'PixupDemo2026!');
    // A hidden LEFT JOIN parent must never turn unpublished legacy stock public.
    await db.query(
      "INSERT INTO assets(id,collection_id,owner_id,title,category,serial,artwork,description,grade,certification,custody) VALUES ('rls-stock','rls-private','creator','Private stock fixture','Art','PX-RLS-STOCK','orbit','Unpublished fixture with legacy listing','10','verified','vault')",
    );
    await db.query(
      "INSERT INTO listings(id,asset_id,seller_id,price_cents) VALUES ('rls-stock-listing','rls-stock','creator',1000)",
    );
    await withDatabaseActor('', async () => {
      assert(!(await apiServices.catalog.browse()).items.some((a) => a.id === 'rls-stock'));
      await assert.rejects(apiServices.catalog.item('rls-stock'));
    });
    await withDatabaseActor('collector', async () => {
      const credential = await apiServices.tools.create(buyer, {
        name: 'RLS stock regression',
        org_id: 'collector-org',
        scopes: ['query'],
        daily_limit: 5,
      });
      const result = await apiServices.tools.execute(`Bearer ${credential.secret}`, 'query', {
        request_id: id(),
        asset_id: 'rls-stock',
      });
      assert.deepEqual(result.items, []);
      await assert.rejects(
        apiServices.commerce.quote(buyer, {
          listing_id: 'rls-stock-listing',
          fulfillment: 'vault',
        }),
      );
    });
    await withDatabaseActor('creator', async () => {
      assert.equal((await apiServices.catalog.item('rls-stock', login.user!)).is_owner, true);
    });
    const commercialInput = {
      topic: 'credit_redemption',
      action: 'disable_credits',
      base_version: 1,
      statement: 'Disposable PostgreSQL pilot credit suspension review.',
      evidence: 'Synthetic independent finance evidence reference.',
    };
    const commercialA = await apiServices.commercial.propose(finance, commercialInput);
    const commercialB = await apiServices.commercial.propose(finance, commercialInput);
    const commercialReviews = await Promise.allSettled(
      [commercialA, commercialB].map((p) =>
        apiServices.commercial.review({ ...finance, id: 'seller' }, p.id, {
          decision: 'approve',
          note: 'Independent PostgreSQL local pilot review.',
        }),
      ),
    );
    assert.equal(commercialReviews.filter((r) => r.status === 'fulfilled').length, 1);
    const commercial = await apiServices.commercial.dashboard(finance);
    assert.equal(commercial.policy.version, 2);
    assert.equal(commercial.policy.credit_scope, 'disabled');
    assert.equal(commercial.policy.production_launch_approved, false);
    await assert.rejects(
      apiDb.query("UPDATE commercial_policy_versions SET snapshot='{}' WHERE version=1"),
    );
    await assert.rejects(
      apiDb.query(
        "UPDATE commercial_decisions SET statement='Unauthorized changed proposal' WHERE id=$1",
        [commercialA.id],
      ),
    );
    await assert.rejects(
      apiDb.query('DELETE FROM commercial_decisions WHERE id=$1', [commercialA.id]),
    );
    assert(login.user!.organizations.some((o) => o.id === 'creator-org'));
    const invitation = await withDatabaseActor('creator', () =>
      apiServices.organizations.invite(
        login.user!,
        'creator-org',
        'rls-addressed@example.test',
        'viewer',
      ),
    );
    assert.equal(
      (
        await withDatabaseActor('collector', () =>
          apiDb.query('SELECT id FROM organization_invitations WHERE id=$1', [invitation!.id]),
        )
      ).rows.length,
      0,
    );
  } finally {
    await apiDb.close();
    await roleWorker.close();
  }
  console.log(
    'PostgreSQL migrations 001–016, transaction/payment recovery, separate runtime/worker roles, denied DDL/TRUNCATE, tenant read/write isolation and pooled context reset passed.',
  );
} finally {
  await db.close();
}
