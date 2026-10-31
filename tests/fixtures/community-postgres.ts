import assert from 'node:assert/strict';
import { one, type Database } from '../../packages/database/index';
import { withDatabaseActor } from '../../packages/database/context';
import { Services } from '../../apps/api/src/app';
import { CommunityService, communityWorker } from '../../apps/api/src/community';
import { communityGuidelinesVersion } from '../../packages/domain/community';
import { id } from '../../packages/domain/core';
import type { Actor } from '../../apps/api/src/auth';

export async function verifyCommunityPostgres(admin: Database, api: Database, worker: Database) {
  const services = new Services(admin),
    c = new CommunityService(api, { enabled: true, writes: true });
  const actors: Actor[] = [];
  for (const role of ['author', 'reader', 'moderator', 'reviewer']) {
    const a = (
      await services.auth.register(
        `Community ${role}`,
        `community-${id()}@example.test`,
        'Disposable-community-2026!',
      )
    ).user!;
    if (role === 'moderator' || role === 'reviewer') {
      await admin.query('UPDATE users SET is_staff=true WHERE id=$1', [a.id]);
      await admin.query(
        "INSERT INTO staff_permissions(user_id,permission) VALUES($1,'community_moderation')",
        [a.id],
      );
      await admin.query(
        "INSERT INTO authenticators(user_id,secret,enabled_at) VALUES($1,'disposable-verification',now())",
        [a.id],
      );
      a.is_staff = true;
      a.staff_permissions = ['community_moderation'];
      a.mfa_verified_at = new Date().toISOString();
    }
    await services.privacy.consent(a, {
      adult: true,
      terms_version: 'pilot-terms-v1',
      privacy_version: 'pilot-privacy-v1',
      marketing_opt_in: false,
    });
    await c.profile(a, {
      display_name: `Community ${role}`,
      bio: 'PostgreSQL verification fixture',
      reply_notifications: true,
    });
    await c.accept(a, { version: communityGuidelinesVersion, accepted: true });
    actors.push(a);
  }
  const [author, reader, moderator, reviewer] = actors;
  const data = {
    type: 'story',
    title: 'PostgreSQL community story',
    body: 'Only a private draft until an independent moderator approves it.',
    topics: ['beginners'],
    asset_ids: [],
  };
  const key = id(),
    retries = await Promise.all(Array.from({ length: 4 }, () => c.create(author, data, key)));
  assert.equal(new Set(retries.map((r) => r.id)).size, 1);
  const pid = retries[0].id;
  await withDatabaseActor(reader.id, async () => {
    assert.equal(
      (await api.query('SELECT id FROM community_entries WHERE id=$1', [pid])).rows.length,
      0,
    );
    assert.equal(
      (
        await api.query(
          "UPDATE community_entries SET body='Foreign edit' WHERE id=$1 RETURNING id",
          [pid],
        )
      ).rows.length,
      0,
    );
  });
  assert.equal(
    (await api.query('SELECT id FROM community_entries WHERE id=$1', [pid])).rows.length,
    0,
  );
  await c.publish(author, pid, { version: 1 });
  await c.decide(moderator, pid, {
    version: 2,
    action: 'approve',
    reason: 'Independent PostgreSQL moderation fixture.',
  });
  // A visible post may be locked through the narrow helper, never edited by another author.
  await withDatabaseActor(reader.id, async () => {
    assert.equal(
      (
        await api.query(
          "UPDATE community_entries SET body='Forbidden visible edit' WHERE id=$1 RETURNING id",
          [pid],
        )
      ).rows.length,
      0,
    );
  });
  const ck = id(),
    comments = await Promise.all(
      Array.from({ length: 4 }, () =>
        c.comment(
          reader,
          pid,
          { body: 'Concurrent reply with a single stable idempotency key.' },
          ck,
        ),
      ),
    );
  assert.equal(new Set(comments.map((r) => r.id)).size, 1);
  await c.decide(moderator, comments[0].id, {
    version: 1,
    action: 'approve',
    reason: 'Independent review of the concurrent reply.',
  });
  await communityWorker(worker);
  await communityWorker(worker);
  assert.equal((await c.notifications(author)).items.filter((n) => n.kind === 'reply').length, 1);
  let blocked: Promise<unknown> | undefined;
  await admin.transaction(async (tx) => {
    await tx.query('SELECT id FROM community_entries WHERE id=$1 FOR UPDATE', [pid]);
    blocked = c.comment(reader, pid, { body: 'Must not appear after the thread lock.' }, id()).then(
      () => ({ ok: true }),
      (e) => ({ code: e.code }),
    );
    await tx.query('UPDATE community_entries SET locked=true,version=version+1 WHERE id=$1', [pid]);
  });
  assert.deepEqual(await blocked, { code: 'COMMUNITY_LOCKED' });
  const report = await c.report(reader, {
    entry_id: pid,
    category: 'other',
    explanation: 'Private report under the nonowner runtime role.',
  });
  await withDatabaseActor(author.id, async () =>
    assert.equal(
      (await api.query('SELECT id FROM community_reports WHERE id=$1', [report!.id])).rows.length,
      0,
    ),
  );
  await c.decide(moderator, pid, {
    version: 4,
    action: 'hide',
    reason: 'Temporary hide to exercise appeal isolation.',
  });
  const action = (await c.recovery(author)).actions.find((a) => a.action === 'hide')!;
  const appeal = await c.appeal(author, {
    action_id: action.id,
    statement: 'Please independently reconsider the hidden story.',
  });
  await c.decideAppeal(reviewer, appeal!.id, {
    version: 1,
    decision: 'overturn',
    reason: 'Independent PostgreSQL appeal sends content for review.',
  });
  assert.equal((await c.detail(author, pid)).moderation, 'pending');
  const own = await withDatabaseActor(author.id, () => new Services(api).privacy.export(author));
  assert(own.community.entries.some((e) => e.id === pid));
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      withDatabaseActor(i % 2 ? author.id : reader.id, async () => {
        assert.equal(
          (await api.query('SELECT id FROM community_entries WHERE id=$1', [pid])).rows.length,
          i % 2 ? 1 : 0,
        );
      }),
    ),
  );
  assert.equal(
    (await api.query('SELECT id FROM community_entries WHERE id=$1', [pid])).rows.length,
    0,
  );
  assert.equal(
    (await one(admin, 'SELECT count(*)::int AS n FROM community_entries WHERE post_id=$1', [pid]))!
      .n,
    1,
  );
}
