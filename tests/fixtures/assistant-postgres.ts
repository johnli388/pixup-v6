import assert from 'node:assert/strict';
import type { Database } from '../../packages/database/index';
import { withDatabaseActor } from '../../packages/database/context';
import { Services } from '../../apps/api/src/app';
import { AssistantService } from '../../apps/api/src/assistant';
import { DomainError, id } from '../../packages/domain/core';

export async function verifyAssistantPostgres(admin: Database, api: Database, otherApi: Database) {
  const user = (
    await new Services(admin).auth.register(
      'Assistant tester',
      `assistant-${id()}@example.test`,
      'Disposable-assistant-2026!',
    )
  ).user!;
  const assistant = new AssistantService(api);
  const other = new AssistantService(otherApi);
  const reply = (service: AssistantService) =>
    withDatabaseActor(user.id, () =>
      service.reply(user, { message: 'Find sports cards under $100' }),
    );
  // Separate database pools simulate separate API processes sharing the same budget.
  for (let n = 0; n < 12; n++) {
    const result = await reply(n % 2 ? assistant : other);
    assert.ok(result.results.length);
    assert.ok(result.results.every((r) => r.kind === 'card' && r.price_cents! <= 10000));
  }
  await assert.rejects(
    reply(new AssistantService(otherApi)),
    (e: unknown) => e instanceof DomainError && e.code === 'ASSISTANT_RATE_LIMIT',
  );
  assert.equal((await api.query('SELECT * FROM assistant_request_limits')).rows.length, 0);
  await withDatabaseActor('seller', async () => {
    assert.equal(
      (await api.query('SELECT * FROM assistant_request_limits WHERE user_id=$1', [user.id])).rows
        .length,
      0,
    );
    assert.equal(
      (
        await api.query(
          'UPDATE assistant_request_limits SET request_count=1 WHERE user_id=$1 RETURNING user_id',
          [user.id],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      api.query(
        'INSERT INTO assistant_request_limits(user_id,request_count) VALUES ($1,1) ON CONFLICT(user_id) DO UPDATE SET request_count=1',
        [user.id],
      ),
    );
  });

  await admin.query(
    "UPDATE assistant_request_limits SET window_started=now()-interval '61 seconds' WHERE user_id=$1",
    [user.id],
  );
  let release!: () => void, started!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const claimed = new Promise<void>((resolve) => {
    started = resolve;
  });
  const slow = new AssistantService(api, {
    plan: async () => {
      started();
      await wait;
      return { intent: 'cards', query: '', category: 'Sports', max_price_cents: 10000 };
    },
    answer: async () => 'Verified public sports listings.',
  });
  const pending = withDatabaseActor(user.id, () =>
    slow.reply(user, { message: 'Find sports cards', use_ai: true }),
  );
  await claimed;
  try {
    await assert.rejects(
      reply(other),
      (e: unknown) => e instanceof DomainError && e.code === 'ASSISTANT_RATE_LIMIT',
    );
  } finally {
    release();
    await pending;
  }
  assert.equal((await reply(other)).mode, 'local');
}
