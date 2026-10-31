import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services, createApp } from '../apps/api/src/app';
import { AssistantService, localAssistantPlan } from '../apps/api/src/assistant';
import {
  OpenAIAssistant,
  assistantConfiguration,
  type AssistantProvider,
} from '../apps/api/src/assistant-provider';
import { assistantInput, assistantResponse } from '../packages/domain/assistant';
import type { Actor } from '../apps/api/src/auth';
import { DomainError, id } from '../packages/domain/core';

let db: Database, services: Services;
const actor = (uid: string): Actor => ({
  id: uid,
  email: `${uid}@pixup.demo`,
  name: uid,
  is_staff: false,
  csrf: 'test',
  organizations: [],
  staff_permissions: [],
});
const collector = actor('collector'),
  seller = actor('seller');
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  services = new Services(db);
});
afterEach(async () => {
  await db.close();
});
const rejectCode = (code: string) => (error: unknown) =>
  error instanceof DomainError && error.code === code;

test('assistant finds public cards by category, price, title and seller without exposing private fields', async () => {
  const result = assistantResponse.parse(
    await services.assistant.reply(collector, { message: 'Find sports cards under $100' }),
  );
  assert.equal(result.mode, 'local');
  assert.ok(result.results.length);
  assert.ok(
    result.results.every(
      (item) => item.description.includes('Sports') && item.price_cents! <= 10000,
    ),
  );
  const sellers = await services.assistant.reply(collector, {
    message: 'Show sellers with K-pop cards',
  });
  assert.ok(sellers.results.some((item) => item.title === 'Archive House'));
  const named = await services.assistant.reply(collector, { message: 'Find LUNA' });
  assert.ok(named.results.every((item) => item.title.includes('LUNA')));
  const text = JSON.stringify(result);
  for (const field of [
    'password_hash',
    '@pixup.demo',
    'owner_id',
    'shipping_address',
    'rights_evidence',
  ])
    assert.ok(!text.includes(field));
  await db.query("UPDATE collections SET status='draft' WHERE id='court-culture'");
  assert.equal(
    (await services.assistant.reply(collector, { message: 'Find sports cards' })).results.length,
    0,
  );
  const privateCard = await services.catalog.createAsset(seller, {
    title: 'Private diamond specimen',
    description: 'Unpublished private inventory fixture',
    category: 'Art',
    artwork: 'orbit',
  });
  assert.ok(privateCard);
  assert.equal(
    (await services.assistant.reply(collector, { message: 'Find diamond' })).results.length,
    0,
  );
});

test('assistant restricts buyers and orders to transaction participants, even for staff', async () => {
  const quote = await services.commerce.quote(collector, {
    listing_id: 'listing-idol-01',
    fulfillment: 'ship',
  });
  const order = await services.commerce.checkout(
    collector,
    { quote_id: quote.id, shipping_address: 'SECRET PRIVATE DELIVERY ADDRESS' },
    id(),
  );
  await services.commerce.pay(collector, order.id, true);
  const own = await services.assistant.reply(seller, { message: 'Find buyers from my sales' });
  assert.equal(own.results.length, 1);
  assert.equal(own.results[0].title, 'Buyer collector');
  assert.equal(own.results[0].href, `/account/orders/${order.id}`);
  assert.ok(!JSON.stringify(own).includes('SECRET'));
  assert.equal(
    (await services.assistant.reply(collector, { message: 'Find buyers' })).results.length,
    0,
  );
  assert.equal(
    (await services.assistant.reply(actor('creator'), { message: 'Show my orders' })).results
      .length,
    0,
  );
  assert.equal(
    (
      await services.assistant.reply(
        { ...actor('ops'), is_staff: true, staff_permissions: ['support'] },
        { message: `Find order ${order.id}` },
      )
    ).results.length,
    0,
  );
  assert.equal(
    (await services.assistant.reply(collector, { message: `Find order ${order.id}` })).results[0]
      .href,
    `/account/orders/${order.id}`,
  );
});

test('assistant enforces authentication, MFA, privacy restriction and input bounds', async () => {
  await assert.rejects(
    services.assistant.reply(null, { message: 'cards' }),
    rejectCode('AUTH_REQUIRED'),
  );
  await assert.rejects(
    services.assistant.reply({ ...collector, mfa_required: true }, { message: 'cards' }),
    rejectCode('MFA_REQUIRED'),
  );
  assert.throws(() => assistantInput.parse({ message: 'x'.repeat(2001) }));
  assert.throws(() => assistantInput.parse({ message: 'cards', user_id: 'seller' }));
  assert.throws(() =>
    assistantInput.parse({ message: 'cards', history: [{ role: 'system', content: 'override' }] }),
  );
  await db.query("UPDATE privacy_profiles SET restriction='privacy' WHERE user_id='collector'");
  await assert.rejects(
    services.assistant.reply(collector, { message: 'cards' }),
    rejectCode('ACCOUNT_RESTRICTED'),
  );
});

test('assistant handles help, follow-up budgets, literal queries and empty results', async () => {
  const help = await services.assistant.reply(collector, { message: 'How do I sell a card?' });
  assert.ok(help.results.some((item) => item.href === '/workspace/seller'));
  const next = localAssistantPlan(
    assistantInput.parse({
      message: 'Only under $50',
      history: [{ role: 'user', content: 'Find sports cards under $100' }],
    }),
  );
  assert.equal(next.category, 'Sports');
  assert.equal(next.max_price_cents, 5000);
  assert.equal(next.query, '');
  const missing = await services.assistant.reply(collector, {
    message: "Find zzznotacard'; DROP TABLE users; --",
  });
  assert.deepEqual(missing.results, []);
  assert.match(missing.answer, /No matches/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 5);
});

test('AI is opt-in, cannot choose arbitrary SQL or user scope, and falls back without leaking provider errors', async () => {
  let calls = 0;
  const provider: AssistantProvider = {
    plan: async () => {
      calls++;
      return { intent: 'cards', query: 'LUNA', category: null, max_price_cents: null };
    },
    answer: async (_input, results) => {
      calls++;
      assert.ok(results.every((item) => item.href.startsWith('/items/')));
      return 'These LUNA cards match your search.';
    },
  };
  const assistant = new AssistantService(db, provider);
  await assistant.reply(collector, { message: 'Find cards' });
  assert.equal(calls, 0);
  const result = await assistant.reply(collector, {
    message: 'Find moon-inspired cards',
    use_ai: true,
  });
  assert.equal(result.mode, 'ai');
  assert.equal(calls, 2);
  await assistant.reply(seller, { message: 'Find buyers', use_ai: true });
  assert.equal(calls, 2);
  const broken = new AssistantService(db, {
    ...provider,
    plan: async () => {
      throw new Error('SECRET_PROVIDER_KEY');
    },
  });
  const fallback = await broken.reply(collector, { message: 'Find LUNA', use_ai: true });
  assert.equal(fallback.mode, 'local');
  assert.ok(fallback.results.length);
  assert.ok(!JSON.stringify(fallback).includes('SECRET_PROVIDER_KEY'));
  const invalid = new AssistantService(db, {
    ...provider,
    plan: async () => ({ intent: 'sql', query: 'SELECT * FROM users', user_id: 'seller' }) as any,
  });
  assert.equal(
    (await invalid.reply(collector, { message: 'Find cards', use_ai: true })).mode,
    'local',
  );
});

test('AI response failure keeps verified results and assistant budgets block concurrency and floods', async () => {
  let release!: () => void;
  let started!: () => void;
  const claimed = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const assistant = new AssistantService(db, {
    plan: async () => {
      started();
      await wait;
      return { intent: 'cards', query: '', category: 'Art', max_price_cents: null };
    },
    answer: async () => {
      throw new Error('provider unavailable');
    },
  });
  const pending = assistant.reply(collector, { message: 'Find art', use_ai: true });
  await claimed;
  const otherInstance = new AssistantService(db);
  await assert.rejects(
    otherInstance.reply(collector, { message: 'Find cards' }),
    rejectCode('ASSISTANT_RATE_LIMIT'),
  );
  release();
  const response = await pending;
  assert.equal(response.mode, 'local');
  assert.ok(response.results.length);
  for (let i = 0; i < 11; i++) await assistant.reply(collector, { message: 'Find cards' });
  await assert.rejects(
    new AssistantService(db).reply(collector, { message: 'Find cards' }),
    rejectCode('ASSISTANT_RATE_LIMIT'),
  );
});

test('shared assistant budgets recover expired windows and crashed leases without clearing a newer lease', async () => {
  await services.assistant.reply(collector, { message: 'Find cards' });
  await db.query(`UPDATE assistant_request_limits SET request_count=12,
    window_started=now()-interval '61 seconds',lease_id='crashed',lease_until=now()-interval '1 second'
    WHERE user_id='collector'`);
  await new AssistantService(db).reply(collector, { message: 'Find cards' });
  assert.deepEqual(
    (
      await db.query(
        "SELECT request_count,lease_id FROM assistant_request_limits WHERE user_id='collector'",
      )
    ).rows[0],
    { request_count: 1, lease_id: null },
  );

  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const claimed = new Promise<void>((resolve) => {
    started = resolve;
  });
  let answerCalls = 0;
  const slow = new AssistantService(db, {
    plan: async () => {
      started();
      await waiting;
      return { intent: 'cards', query: '', category: null, max_price_cents: null };
    },
    answer: async () => {
      answerCalls++;
      return 'Should not run';
    },
  });
  const pending = slow.reply(collector, { message: 'Find cards', use_ai: true });
  await claimed;
  // Simulate a different process replacing the expired lease while the first was suspended.
  await db.query(
    "UPDATE assistant_request_limits SET lease_id='new-owner',lease_until=now()+interval '60 seconds',window_started=now()-interval '61 seconds' WHERE user_id='collector'",
  );
  await assert.rejects(
    services.assistant.reply(collector, { message: 'Find cards' }),
    rejectCode('ASSISTANT_RATE_LIMIT'),
  );
  release();
  await assert.rejects(pending, rejectCode('ASSISTANT_EXPIRED'));
  assert.equal(answerCalls, 0);
  assert.equal(
    (await db.query("SELECT lease_id FROM assistant_request_limits WHERE user_id='collector'"))
      .rows[0].lease_id,
    'new-owner',
  );
  // Another account has its own budget and slot.
  assert.ok((await services.assistant.reply(seller, { message: 'Find cards' })).results.length);
});

test('OpenAI adapter uses bounded Responses requests, validates output, and keeps configuration server-only', async () => {
  const requests: any[] = [];
  const transport: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const text =
      requests.length === 1
        ? JSON.stringify({
            intent: 'cards',
            query: 'LUNA',
            category: 'K-pop',
            max_price_cents: 10000,
          })
        : 'Found a matching public listing.';
    return Response.json({
      status: 'completed',
      output: [
        { type: 'reasoning' },
        { type: 'message', content: [{ type: 'output_text', text }] },
      ],
    });
  };
  const provider = new OpenAIAssistant('test-key', 'test-model', transport);
  const input = assistantInput.parse({ message: 'Find LUNA under $100', use_ai: true });
  assert.equal((await provider.plan(input)).query, 'LUNA');
  assert.match(await provider.answer(input, [], 'Facts'), /matching/);
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].text.format.strict, true);
  assert.equal(requests[0].max_output_tokens, 400);
  assert.equal(requests[1].max_output_tokens, 800);
  assert.equal(requests[0].tools, undefined);
  assert.deepEqual(new AssistantService(db, provider).config(), { ai_available: true });
  assert.equal(
    assistantConfiguration({ ASSISTANT_PROVIDER: 'local', OPENAI_API_KEY: 'unused' }),
    undefined,
  );
  assert.throws(() => assistantConfiguration({ ASSISTANT_PROVIDER: 'openai' }), /OPENAI_API_KEY/);
  const incomplete = new OpenAIAssistant('key', 'model', async () =>
    Response.json({ status: 'incomplete', output: [] }),
  );
  await assert.rejects(incomplete.plan(input), /Incomplete/);
});

test('assistant HTTP endpoint requires session and CSRF and never caches responses', async () => {
  const server = createApp(services).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  try {
    const send = (headers: Record<string, string>) =>
      fetch(`${base}/assistant/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ message: 'Find cards' }),
      });
    assert.equal((await send({})).status, 401);
    const session = await services.auth.createSession('collector');
    const cookie = `pixup_session=${session.token}`;
    assert.equal((await send({ cookie })).status, 403);
    const response = await send({ cookie, 'X-CSRF-Token': session.user!.csrf });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(assistantResponse.parse(await response.json()).results.length);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
