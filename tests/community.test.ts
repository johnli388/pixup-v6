import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openDatabase, migrate, one, type Database } from '../packages/database/index';
import { withDatabaseActor } from '../packages/database/context';
import { seed } from '../packages/database/seed';
import { CommunityService, communityWorker } from '../apps/api/src/community';
import { Services, createApp } from '../apps/api/src/app';
import type { Actor } from '../apps/api/src/auth';
import { DomainError, id } from '../packages/domain/core';
import { communityGuidelinesVersion } from '../packages/domain/community';
const actor = (uid: string, staff = false): Actor => ({
  id: uid,
  email: `${uid}@pixup.demo`,
  name: uid,
  csrf: 'fixture',
  is_staff: staff,
  staff_permissions: staff ? ['community_moderation', 'support'] : [],
  organizations: [],
  mfa_verified_at: new Date().toISOString(),
});
const buyer = actor('collector'),
  seller = actor('seller'),
  ops = actor('ops', true),
  second = actor('creator', true);
const rejects = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
let db: Database, c: CommunityService, s: Services;
const input = {
  type: 'story',
  title: 'My first collection story',
  body: 'A personal collecting experience, with safe plain text.',
  topics: ['beginners'],
  asset_ids: [],
};
const review = { action: 'approve', reason: 'Reviewed against the community pilot guidelines.' };
async function profile(a: Actor) {
  await c.profile(a, {
    display_name: `Member ${a.id}`,
    bio: 'Collecting stories',
    reply_notifications: true,
  });
  await c.accept(a, { version: communityGuidelinesVersion, accepted: true });
}
async function draft(a = buyer, extra: Record<string, unknown> = {}) {
  return c.create(a, { ...input, ...extra }, id());
}
async function visible(a = buyer, extra: Record<string, unknown> = {}) {
  const p = await draft(a, extra);
  await c.publish(a, p.id, { version: 1 });
  await c.decide(a.id === ops.id ? second : ops, p.id, { ...review, version: 2 });
  return p;
}
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  s = new Services(db);
  c = new CommunityService(db, { enabled: true, writes: true });
  s.community = c;
  assert.equal(
    (await db.query("SELECT * FROM staff_permissions WHERE permission='community_moderation'")).rows
      .length,
    0,
  );
  for (const a of [ops, second]) {
    await db.query('UPDATE users SET is_staff=true WHERE id=$1', [a.id]);
    await db.query(
      "INSERT INTO staff_permissions(user_id,permission) VALUES($1,'community_moderation')",
      [a.id],
    );
    await db.query(
      "INSERT INTO authenticators(user_id,secret,enabled_at) VALUES($1,'synthetic-test-only',now())",
      [a.id],
    );
  }
  for (const a of [buyer, seller, ops, second]) await profile(a);
});
afterEach(async () => db.close());
test('drafts, review, author projections, all roles and versioned edits preserve privacy', async () => {
  const p = await draft();
  assert.equal((await c.feed(seller, {})).items.length, 0);
  await assert.rejects(c.detail(seller, p.id), rejects('NOT_FOUND'));
  const own = await c.detail(buyer, p.id);
  assert.equal(own.author!.display_name, 'Member collector');
  assert.equal('author_id' in own, false);
  assert.equal('email' in own, false);
  await c.publish(buyer, p.id, { version: 1 });
  assert.equal((await c.feed(seller, {})).items.length, 0);
  await c.decide(ops, p.id, { ...review, version: 2 });
  assert.equal((await c.feed(seller, {})).items.length, 1);
  await assert.rejects(c.edit(seller, p.id, { ...input, version: 3 }), rejects('NOT_FOUND'));
  await assert.rejects(c.edit(buyer, p.id, { ...input, version: 1 }), rejects('COMMUNITY_STALE'));
  await c.edit(buyer, p.id, { ...input, body: 'Edited story returns to review.', version: 3 });
  assert.equal((await c.feed(seller, {})).items.length, 0);
  const exportData = await s.privacy.export(buyer);
  assert.equal(exportData.community.revisions[0].body, input.body);
  assert(!JSON.stringify(await s.privacy.export(seller)).includes(input.body));
});
test('request replay, card visibility, input limits and filter-bound pagination', async () => {
  const key = id();
  const first = await c.create(buyer, input, key);
  assert.deepEqual(await c.create(buyer, input, key), first);
  await assert.rejects(
    c.create(buyer, { ...input, title: 'Changed retry' }, key),
    rejects('IDEMPOTENCY_CONFLICT'),
  );
  await assert.rejects(
    draft(buyer, { asset_ids: ['nonexistent-private-card'] }),
    rejects('COMMUNITY_CARD'),
  );
  await assert.rejects(
    draft(buyer, { topics: ['beginners', 'beginners'] }),
    rejects('COMMUNITY_DUPLICATE_REFERENCE'),
  );
  const linked = await visible(buyer, { asset_ids: ['court-01'] });
  await db.query("UPDATE collections SET status='draft' WHERE id='court-culture'");
  assert.deepEqual((await c.detail(seller, linked.id)).links, [
    { id: null, title: 'Linked item unavailable' },
  ]);
  await visible(seller, { title: 'Another collection story' });
  const page = await c.feed(buyer, { limit: 1 });
  assert(page.next_cursor);
  const next = await c.feed(buyer, { limit: 1, cursor: page.next_cursor });
  assert.notEqual(next.items[0].id, page.items[0].id);
  await assert.rejects(
    c.feed(buyer, { limit: 1, q: 'changed', cursor: page.next_cursor }),
    rejects('COMMUNITY_CURSOR'),
  );
});
test('MFA, current authority, self review and independent appeal enforcement', async () => {
  const p = await visible();
  await assert.rejects(c.queue({ ...ops, mfa_verified_at: null }), rejects('MFA_REQUIRED'));
  const self = await draft(ops);
  await c.publish(ops, self.id, { version: 1 });
  await assert.rejects(
    c.decide(ops, self.id, { ...review, version: 2 }),
    rejects('COMMUNITY_SELF_REVIEW'),
  );
  await c.decide(ops, p.id, {
    action: 'hide',
    version: 3,
    reason: 'Review requested after a community safety concern.',
  });
  const action = (await c.recovery(buyer)).actions.find((a) => a.action === 'hide')!;
  const appeal = await c.appeal(buyer, {
    action_id: action.id,
    statement: 'Please reconsider this collecting story with context.',
  });
  await assert.rejects(
    c.decideAppeal(ops, appeal!.id, {
      version: 1,
      decision: 'overturn',
      reason: 'I cannot review my own action.',
    }),
    rejects('COMMUNITY_SELF_REVIEW'),
  );
  await c.decideAppeal(second, appeal!.id, {
    version: 1,
    decision: 'overturn',
    reason: 'Independent review returns content to moderation.',
  });
  assert.equal((await c.detail(buyer, p.id)).moderation, 'pending');
  assert.equal((await c.feed(seller, {})).items.length, 0);
  await db.query(
    "DELETE FROM staff_permissions WHERE user_id='ops' AND permission='community_moderation'",
  );
  await assert.rejects(c.queue(ops), rejects('FORBIDDEN'));
});
test('comments enforce parent depth, thread locks, review and deletion tombstones', async () => {
  const p = await visible();
  const key = id();
  const comment = await c.comment(seller, p.id, { body: 'My experience with this card.' }, key);
  assert.deepEqual(
    await c.comment(seller, p.id, { body: 'My experience with this card.' }, key),
    comment,
  );
  assert.equal((await c.comments(buyer, p.id)).items.length, 0);
  await c.decide(ops, comment.id, { ...review, version: 1 });
  const reply = await c.comment(
    buyer,
    p.id,
    { body: 'Thank you for sharing this experience.', parent_id: comment.id },
    id(),
  );
  await c.decide(ops, reply.id, { ...review, version: 1 });
  await assert.rejects(
    c.comment(buyer, p.id, { body: 'Too deeply nested', parent_id: reply.id }, id()),
    rejects('NOT_FOUND'),
  );
  await c.remove(seller, comment.id, { version: 2 });
  const comments = await c.comments(buyer, p.id);
  assert.equal(comments.items.length, 2);
  assert.equal(comments.items[0].body, '');
  assert.equal(comments.items[0].author, null);
  await c.decide(ops, p.id, {
    action: 'lock',
    version: 3,
    reason: 'Thread paused for a moderator review.',
  });
  await assert.rejects(
    c.comment(seller, p.id, { body: 'Late comment' }, id()),
    rejects('COMMUNITY_LOCKED'),
  );
  await c.remove(buyer, p.id, { version: 4 });
  await assert.rejects(c.comments(seller, p.id), rejects('NOT_FOUND'));
});
test('private interests, mute behavior and notification retries never copy hidden text', async () => {
  const p = await visible();
  await c.relation(seller, { kind: 'follow', target: 'beginners', enabled: true });
  await c.relation(seller, { kind: 'save', target: p.id, enabled: true });
  await c.relation(seller, { kind: 'like', target: p.id, enabled: true });
  await c.relation(seller, { kind: 'like', target: p.id, enabled: true });
  assert.equal((await c.detail(seller, p.id)).likes, 1);
  assert.equal((await c.feed(seller, { feed: 'following' })).items.length, 1);
  assert.equal((await c.feed(buyer, { feed: 'saved' })).items.length, 0);
  const comment = await c.comment(
    seller,
    p.id,
    { body: 'Private notification preview should never contain me.' },
    id(),
  );
  await c.decide(ops, comment.id, { ...review, version: 1 });
  await communityWorker(db);
  await communityWorker(db);
  assert.equal((await c.notifications(buyer)).items.filter((n) => n.kind === 'reply').length, 1);
  const payloads = JSON.stringify((await db.query('SELECT * FROM community_notifications')).rows);
  assert(!payloads.includes('Private notification'));
  await c.decide(ops, comment.id, {
    action: 'hide',
    version: 2,
    reason: 'Temporary visibility review for this reply.',
  });
  assert.equal((await c.notifications(buyer)).items.filter((n) => n.kind === 'reply').length, 0);
  await c.relation(seller, { kind: 'mute_topic', target: 'beginners', enabled: true });
  assert.equal((await c.feed(seller, {})).items.length, 0);
});
test('sanctions and write pauses preserve reports, appeals, deletion and commerce', async () => {
  const p = await visible();
  await c.decide(ops, p.id, {
    action: 'restrict',
    version: 3,
    reason: 'Temporary community posting restriction.',
    days: 1,
  });
  await assert.rejects(draft(), rejects('COMMUNITY_RESTRICTED'));
  const paused = new CommunityService(db, { enabled: true, writes: false });
  const report = await paused.report(buyer, {
    entry_id: p.id,
    category: 'other',
    explanation: 'A self report remains available while posting is restricted.',
  });
  assert(report!.id);
  await paused.remove(buyer, p.id, { version: 4 });
  assert.equal((await c.detail(buyer, p.id)).state, 'deleted');
  assert(
    (
      await s.commerce.quote(buyer, {
        listing_id: 'listing-court-01',
        fulfillment: 'vault',
        use_credits: false,
      })
    ).id,
  );
  const disabled = new CommunityService(db, { enabled: false, writes: false });
  await assert.rejects(disabled.feed(seller, {}), rejects('COMMUNITY_DISABLED'));
  assert.equal((await disabled.feed(buyer, { feed: 'mine' })).items.length, 1);
});
test('age and guideline checks are separate from commercial terms and persistent quotas', async () => {
  await db.query("DELETE FROM community_acceptances WHERE user_id='collector'");
  await assert.rejects(draft(), rejects('COMMUNITY_GUIDELINES_REQUIRED'));
  await c.accept(buyer, { version: communityGuidelinesVersion, accepted: true });
  await db.query("UPDATE privacy_profiles SET age_attested_at=NULL WHERE user_id='collector'");
  await assert.rejects(draft(), rejects('COMMUNITY_AGE_REQUIRED'));
  await db.query(
    "UPDATE privacy_profiles SET age_attested_at=now(),terms_version='old-commercial-terms' WHERE user_id='collector'",
  );
  await draft();
  await db.query(
    "UPDATE community_quotas SET count=60 WHERE user_id='collector' AND bucket='write'",
  );
  await assert.rejects(
    new CommunityService(db, { enabled: true, writes: true }).create(buyer, input, id()),
    rejects('COMMUNITY_RATE_LIMIT'),
  );
});
test('nonowner row policies hide drafts, private relations, reporters and old revisions', async () => {
  const p = await draft();
  await c.edit(buyer, p.id, { ...input, body: 'New private draft version.', version: 1 });
  const pub = await visible();
  await c.report(seller, {
    entry_id: pub.id,
    category: 'other',
    explanation: 'A private reporter explanation.',
  });
  await c.relation(seller, { kind: 'save', target: pub.id, enabled: true });
  await db.exec(
    await readFile(new URL('../infra/database/runtime-roles.sql', import.meta.url), 'utf8'),
  );
  await db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE pixup_runtime');
    await tx.query("SELECT set_config('pixup.actor_id','collector',true)");
    assert.equal((await tx.query('SELECT * FROM community_reports')).rows.length, 0);
    assert.equal((await tx.query('SELECT * FROM community_relations')).rows.length, 0);
    await tx.query("SELECT set_config('pixup.actor_id','seller',true)");
    assert.equal(
      (await tx.query('SELECT * FROM community_entries WHERE id=$1', [p.id])).rows.length,
      0,
    );
    assert.equal((await tx.query('SELECT * FROM community_revisions')).rows.length, 0);
    await tx.query("SELECT set_config('pixup.actor_id','',true)");
    assert.equal((await tx.query('SELECT * FROM community_entries')).rows.length, 0);
  });
});
test('HTTP requires authentication and CSRF, keeps responses private and validates unknown fields', async () => {
  const server = createApp(s).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  try {
    const guest = await fetch(`${base}/community/posts`);
    assert.equal(guest.status, 401);
    const login = await s.auth.createSession('collector');
    const headers = { 'Content-Type': 'application/json', Cookie: `pixup_session=${login.token}` };
    const bad = await fetch(`${base}/community/posts`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    assert.equal(bad.status, 403);
    const valid = await fetch(`${base}/community/posts`, {
      method: 'POST',
      headers: { ...headers, 'X-CSRF-Token': login.user!.csrf, 'Idempotency-Key': id() },
      body: JSON.stringify({ ...input, author_id: 'seller' }),
    });
    assert.equal(valid.status, 400);
    const response = await fetch(`${base}/community/posts`, { headers });
    assert.equal(response.status, 200);
    assert(response.headers.get('cache-control')?.includes('no-store'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('closure erases community identity and authored text, retaining no other members private data', async () => {
  const login = await s.auth.register(
      'Private account',
      `${id()}@example.test`,
      'Community-test-2026!',
    ),
    a = login.user!;
  await s.privacy.consent(a, {
    adult: true,
    terms_version: 'pilot-terms-v1',
    privacy_version: 'pilot-privacy-v1',
    marketing_opt_in: false,
  });
  await profile(a);
  const p = await draft(a);
  await c.edit(a, p.id, { ...input, body: 'Private changed draft.', version: 1 });
  const req = await s.privacy.request(
    a,
    'delete',
    'Please close my unused account and community profile.',
  );
  await s.privacy.decide(ops, req.id, 'complete', 'No commerce or unresolved community records.');
  assert.equal((await one(db, 'SELECT body FROM community_entries WHERE id=$1', [p.id]))!.body, '');
  assert.equal(
    (await db.query('SELECT * FROM community_revisions WHERE author_id=$1', [a.id])).rows.length,
    0,
  );
  assert.equal(
    (await one(db, 'SELECT display_name FROM community_profiles WHERE user_id=$1', [a.id]))!
      .display_name,
    'Deleted member',
  );
});

test('pending moderation work is not buried behind old removed content', async () => {
  await db.query(`INSERT INTO community_entries(id,author_id,type,title,body,state,moderation,created_at,updated_at)
    SELECT 'removed-fixture-' || n,'collector','story','Removed fixture','Old removed text','published','removed',now()-interval '1 day',now()-interval '1 day'
    FROM generate_series(1,105) AS n`);
  const p = await draft();
  await c.publish(buyer, p.id, { version: 1 });
  const queue = await c.queue(ops);
  assert.equal(queue.entries.length, 100);
  assert.equal(queue.entries[0].id, p.id);
});
