import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { openDatabase, migrate, one, type Database } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { Services, createApp } from '../apps/api/src/app';
import { type Actor } from '../apps/api/src/auth';
import { OpenIdProvider } from '../apps/api/src/managed-identity';
import { SecretBox, base32, totp } from '../packages/domain/identity-secrets';
import { hash } from '../packages/domain/security';
import { DomainError } from '../packages/domain/core';
import type { Mail, ManagedIdentityProvider } from '../apps/api/src/identity-providers';
const rejection = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
let db: Database, s: Services, mail: Map<string, Mail>, loseMail: boolean;
const password = 'PixupDemo2026!';
beforeEach(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db);
  mail = new Map();
  loseMail = false;
  s = new Services(
    db,
    {},
    {},
    {},
    {
      box: new SecretBox('ab'.repeat(32)),
      origin: 'http://127.0.0.1:3000',
      mail: {
        async send(m, key) {
          mail.set(key, m);
          if (loseMail) {
            loseMail = false;
            throw new Error('response lost');
          }
          return key;
        },
      },
    },
  );
});
afterEach(async () => db.close());
async function login(uid: string) {
  const session = await s.auth.login(`${uid}@pixup.demo`, password);
  return { token: session.token, actor: session.user! };
}
async function emailToken(actor: Actor) {
  await s.identity.verifyEmail(actor);
  await s.identity.worker();
  const m = [...mail.values()].at(-1)!;
  return /#token=([a-f0-9]+)/.exec(m.text)![1];
}
async function verified(uid: string) {
  const a = await login(uid);
  await s.identity.consume(a.actor, await emailToken(a.actor));
  return { token: a.token, actor: (await s.auth.session(a.token))! };
}
async function factor(uid: string) {
  const a = await verified(uid);
  const f = await s.identity.enroll(a.actor, password);
  const result = await s.identity.verifyMfa(a.actor, a.token, totp(f.secret));
  return {
    ...a,
    actor: (await s.auth.session(a.token))!,
    secret: f.secret,
    codes: result.recovery_codes!,
  };
}
test('TOTP matches RFC 6238 six-digit truncation and authenticated encryption rejects tampering', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  assert.equal(totp(secret, 1), '287082');
  const box = new SecretBox('ab'.repeat(32)),
    sealed = box.seal('sensitive');
  assert.equal(box.open(sealed), 'sensitive');
  const bytes = Buffer.from(sealed, 'base64');
  bytes[13] ^= 1;
  assert.throws(() => box.open(bytes.toString('base64')));
});
test('verification and password recovery are one-use, addressed, expire and invalidate all sessions without disabling MFA', async () => {
  const a = await factor('collector'),
    other = await login('seller');
  const token = await emailToken(a.actor);
  await assert.rejects(s.identity.consume(other.actor, token), rejection('RECIPIENT_REQUIRED'));
  await s.identity.consume(a.actor, token);
  await assert.rejects(s.identity.consume(a.actor, token), rejection('LINK_UNAVAILABLE'));
  await s.identity.resetRequest('collector@pixup.demo');
  await s.identity.worker();
  const reset = /#token=([a-f0-9]+)/.exec([...mail.values()].at(-1)!.text)![1];
  const concurrent = await Promise.allSettled([
    s.identity.consume(null, reset, 'New-private-password-2026!'),
    s.identity.consume(null, reset, 'Other-private-password-2026!'),
  ]);
  assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await s.auth.session(a.token), null);
  assert(
    (await one(db, "SELECT enabled_at FROM authenticators WHERE user_id='collector'"))!.enabled_at,
  );
  const winningPassword =
    concurrent[0].status === 'fulfilled'
      ? 'New-private-password-2026!'
      : 'Other-private-password-2026!';
  const next = await s.auth.login('collector@pixup.demo', winningPassword);
  assert.equal(next.user!.mfa_required, true);
  await s.identity.verifyMfa(next.user!, next.token, a.codes[0]);
  await assert.rejects(
    s.identity.verifyMfa(next.user!, next.token, a.codes[0]),
    rejection('MFA_INVALID'),
  );
  const expired = await emailToken(other.actor);
  await db.query(
    "UPDATE identity_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [hash(expired)],
  );
  await assert.rejects(s.identity.consume(other.actor, expired), rejection('LINK_UNAVAILABLE'));
});
test('mail queue encrypts bearer links, retries the same key and never treats acceptance as verification', async () => {
  const a = await login('collector');
  await s.identity.verifyEmail(a.actor);
  const row = (await one(db, 'SELECT * FROM identity_mail'))!;
  assert(!row.payload.includes('token='));
  loseMail = true;
  await s.identity.worker();
  assert.equal(mail.size, 1);
  assert.equal(
    (await one(db, 'SELECT email_verified_at FROM users WHERE id=$1', [a.actor.id]))!
      .email_verified_at,
    null,
  );
  await db.query("UPDATE identity_mail SET checked_at=now()-interval '2 minutes'");
  await s.identity.worker();
  assert.equal(mail.size, 1);
  assert.equal((await one(db, 'SELECT state,payload FROM identity_mail'))!.state, 'accepted');
  assert.equal((await one(db, 'SELECT payload FROM identity_mail'))!.payload, '');
  const unknown = await s.identity.resetRequest('unknown@example.test'),
    known = await s.identity.resetRequest('seller@pixup.demo');
  assert.deepEqual(unknown, known);
});
test('verified invitation requires the exact addressed link; revocation and acceptance retain existing gates', async () => {
  const owner = await login('creator'),
    recipient = await login('collector');
  const invitation = await s.organizations.invite(
    owner.actor,
    'creator-org',
    recipient.actor.email,
    'viewer',
  );
  await assert.rejects(
    s.organizations.accept(recipient.actor, invitation!.id),
    rejection('INVITATION_VERIFICATION_REQUIRED'),
  );
  await s.identity.worker();
  const token = /#token=([a-f0-9]+)/.exec([...mail.values()].at(-1)!.text)![1];
  await s.identity.consume(recipient.actor, token);
  await s.organizations.accept(recipient.actor, invitation!.id);
  assert.equal(
    (await one(
      db,
      "SELECT role FROM memberships WHERE org_id='creator-org' AND user_id='collector'",
    ))!.role,
    'viewer',
  );
  const second = await s.organizations.invite(
    owner.actor,
    'creator-org',
    'seller@pixup.demo',
    'viewer',
  );
  await s.identity.worker();
  const revoked = /#token=([a-f0-9]+)/.exec([...mail.values()].at(-1)!.text)![1];
  await s.organizations.revokeInvitation(owner.actor, 'creator-org', second!.id);
  await assert.rejects(
    s.identity.consume((await login('seller')).actor, revoked),
    rejection('INVITATION_UNAVAILABLE'),
  );
});
test('MFA enrollment never replaces an active factor, codes cannot replay and staff policy blocks unauthenticated HTTP work', async () => {
  const a = await factor('ops');
  await assert.rejects(s.identity.enroll(a.actor, password), rejection('MFA_EXISTS'));
  await assert.rejects(
    s.identity.verifyMfa(a.actor, a.token, totp(a.secret)),
    rejection('MFA_INVALID'),
  );
  const login2 = await login('ops');
  assert.equal(login2.actor.mfa_required, true);
  const app = createApp(s).listen(0, '127.0.0.1');
  await once(app, 'listening');
  try {
    const addr = app.address() as any,
      base = `http://127.0.0.1:${addr.port}/v1`,
      headers = { cookie: `pixup_session=${login2.token}` };
    assert.equal((await fetch(base + '/ops', { headers })).status, 403);
    assert.equal((await fetch(base + '/identity/status', { headers })).status, 200);
    assert.equal(
      (
        await fetch(base + '/identity/mfa/verify', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: a.codes[0] }),
        })
      ).status,
      403,
    );
    await s.identity.verifyMfa(login2.actor, login2.token, a.codes[0]);
    assert.equal((await fetch(base + '/ops', { headers })).status, 200);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
  }
});
test('owner transfer requires both verified members, recipient consent and current authority, and revokes both sessions', async () => {
  const owner = await verified('creator'),
    recipient = await verified('collector');
  await db.query(
    "INSERT INTO memberships(user_id,org_id,role) VALUES ('collector','creator-org','viewer')",
  );
  const transfer = await s.access.transfer(owner.actor, 'creator-org', 'collector');
  await assert.rejects(
    s.access.decideTransfer(owner.actor, transfer.id, true),
    rejection('TRANSFER_UNAVAILABLE'),
  );
  await s.access.decideTransfer(recipient.actor, transfer.id, true);
  assert.equal(await s.auth.session(owner.token), null);
  assert.equal(await s.auth.session(recipient.token), null);
  const rows = (
    await db.query(
      "SELECT user_id,role FROM memberships WHERE org_id='creator-org' ORDER BY user_id",
    )
  ).rows;
  assert.deepEqual(rows, [
    { user_id: 'collector', role: 'owner' },
    { user_id: 'creator', role: 'publisher' },
  ]);
  await assert.rejects(
    s.access.decideTransfer(recipient.actor, transfer.id, true),
    rejection('NOT_FOUND'),
  );
});
test('staff permission changes require separate MFA administrators, exact prior permissions and revoke target sessions', async () => {
  const requester = await factor('ops'),
    reviewer = await factor('creator'),
    target = await factor('seller');
  await db.query("UPDATE users SET is_staff=true WHERE id IN ('ops','creator')");
  await db.query(
    "INSERT INTO staff_permissions(user_id,permission) VALUES ('ops','identity_admin'),('creator','identity_admin')",
  );
  requester.actor = (await s.auth.session(requester.token))!;
  reviewer.actor = (await s.auth.session(reviewer.token))!;
  const review = await s.access.request(
    requester.actor,
    'seller',
    ['finance'],
    'Grant finance to a reviewed verified operator',
  );
  await assert.rejects(
    s.access.decide(requester.actor, review.id, true, 'Self approval must remain forbidden'),
    rejection('SELF_REVIEW'),
  );
  await assert.rejects(
    db.query('UPDATE staff_access_reviews SET permissions=\'["identity_admin"]\' WHERE id=$1', [
      review.id,
    ]),
  );
  await s.access.decide(reviewer.actor, review.id, true, 'Independently reviewed finance scope');
  assert.equal(await s.auth.session(target.token), null);
  assert.deepEqual(
    (await db.query("SELECT permission FROM staff_permissions WHERE user_id='seller'")).rows,
    [{ permission: 'finance' }],
  );
  await assert.rejects(
    s.access.decide(reviewer.actor, review.id, true, 'No duplicate privilege transition'),
    rejection('REVIEW_UNAVAILABLE'),
  );
  const stale = await s.access.request(
    requester.actor,
    'seller',
    [],
    'Revoke the reviewed scope after duty change',
  );
  await db.query("INSERT INTO staff_permissions(user_id,permission) VALUES ('seller','audit')");
  await assert.rejects(
    s.access.decide(reviewer.actor, stale.id, true, 'Permissions changed after request'),
    rejection('REVIEW_STALE'),
  );
});
test('managed sign-in binds browser state once and never links existing accounts by email', async () => {
  const provider: ManagedIdentityProvider = {
    issuer: 'https://identity.example.test',
    async authorize(i) {
      return `https://identity.example.test/authorize?state=${i.state}`;
    },
    async exchange() {
      return {
        subject: 'subject-one',
        email: 'new-managed@example.test',
        name: 'Managed User',
        email_verified: true,
      };
    },
  };
  s.identity.options.oidc = provider;
  const start = await s.managedSignIn.start(),
    state = new URL(start.url).searchParams.get('state')!;
  await assert.rejects(
    s.managedSignIn.callback(state, 'wrong', 'https://irrelevant'),
    rejection('OIDC_STATE'),
  );
  const result = await s.managedSignIn.callback(state, start.browser, 'https://irrelevant');
  assert.equal(result.user!.email_verified_at !== null, true);
  assert.equal(result.user!.is_staff, false);
  assert.equal(
    (await one(db, 'SELECT local_login_enabled FROM users WHERE id=$1', [result.user!.id]))!
      .local_login_enabled,
    false,
  );
  await assert.rejects(
    s.managedSignIn.callback(state, start.browser, 'https://irrelevant'),
    rejection('OIDC_STATE'),
  );
  provider.exchange = async () => ({
    subject: 'different-subject',
    email: 'collector@pixup.demo',
    name: 'Cannot link',
    email_verified: true,
  });
  const collision = await s.managedSignIn.start();
  await assert.rejects(
    s.managedSignIn.callback(
      new URL(collision.url).searchParams.get('state')!,
      collision.browser,
      'https://irrelevant',
    ),
    rejection('IDENTITY_LINK_REQUIRED'),
  );
});
test('actual OIDC adapter verifies signed ID tokens, issuer, audience, nonce and PKCE through a transport fixture', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true }),
    jwk = await exportJWK(publicKey);
  let nonce = 'expected-nonce',
    aud = 'pixup-client',
    badSignature = false;
  const otherKeys = await generateKeyPair('RS256');
  const issuer = 'https://idp.example.test';
  let sawVerifier = false;
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('.well-known'))
      return Response.json({
        issuer,
        authorization_endpoint: issuer + '/authorize',
        token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/jwks',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
      });
    if (url.endsWith('/jwks'))
      return Response.json({ keys: [{ ...jwk, kid: 'fixture-key', alg: 'RS256', use: 'sig' }] });
    if (url.endsWith('/token')) {
      sawVerifier = String(init?.body).includes('code_verifier=');
      const jwt = await new SignJWT({
        sub: 'managed-sub',
        email: 'signed@example.test',
        email_verified: true,
        nonce,
        auth_time: Math.floor(Date.now() / 1000),
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
        .setIssuer(issuer)
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(badSignature ? otherKeys.privateKey : privateKey);
      return Response.json({
        access_token: 'opaque-fixture',
        token_type: 'Bearer',
        id_token: jwt,
        expires_in: 300,
      });
    }
    throw new Error('Unexpected provider URL');
  };
  const p = new OpenIdProvider(issuer, 'pixup-client', 'fixture-secret', transport as any),
    input = {
      state: 'expected-state',
      nonce: 'expected-nonce',
      verifier: 'a'.repeat(43),
      redirect: 'https://pixup.example.test/api/identity/oidc/callback',
    };
  const url = await p.authorize(input);
  assert.equal(new URL(url).searchParams.get('code_challenge_method'), 'S256');
  assert(!url.includes(input.verifier));
  const result = await p.exchange({
    ...input,
    url: input.redirect + '?code=fixture&state=expected-state',
  });
  assert.equal(result.email, 'signed@example.test');
  assert(sawVerifier);
  nonce = 'wrong-nonce';
  await assert.rejects(
    p.exchange({ ...input, url: input.redirect + '?code=fixture&state=expected-state' }),
  );
  nonce = input.nonce;
  aud = 'other-client';
  await assert.rejects(
    p.exchange({ ...input, url: input.redirect + '?code=fixture&state=expected-state' }),
  );
  aud = 'pixup-client';
  badSignature = true;
  await assert.rejects(
    p.exchange({ ...input, url: input.redirect + '?code=fixture&state=expected-state' }),
  );
});

test('required staff enrollment cannot bypass MFA and invalid codes are persistently throttled', async () => {
  s.auth.staffMfaRequired = true;
  const a = await login('ops');
  assert.equal(a.actor.mfa_required, true);
  const f = await s.identity.enroll(a.actor, password);
  await s.identity.verifyMfa(a.actor, a.token, totp(f.secret));
  assert.equal((await s.auth.session(a.token))!.mfa_required, false);
  for (let i = 0; i < 9; i++)
    await assert.rejects(
      s.identity.verifyMfa(a.actor, a.token, 'invalid-code'),
      rejection('MFA_INVALID'),
    );
  await assert.rejects(
    s.identity.verifyMfa(a.actor, a.token, 'invalid-code'),
    rejection('IDENTITY_RATE_LIMIT'),
  );
});
test('privacy export excludes authenticators and closure destroys authentication secrets and pending mail', async () => {
  const created = await s.auth.register(
      'Privacy identity',
      'identity-privacy@example.test',
      password,
    ),
    actor = created.user!;
  const f = await s.identity.enroll(actor, password);
  await s.identity.verifyMfa(actor, created.token, totp(f.secret));
  await s.identity.verifyEmail(actor);
  const exported = JSON.stringify(await s.privacy.export(actor));
  assert(!exported.includes(f.secret));
  assert(!exported.includes('token_hash'));
  assert(!exported.includes('password_hash'));
  const request = await s.privacy.request(
    actor,
    'delete',
    'Close this unused account and remove identity secrets',
  );
  await s.privacy.decide(
    (await login('ops')).actor,
    request.id,
    'complete',
    'No retained commerce or shared workspace records exist',
  );
  assert.equal(await s.auth.session(created.token), null);
  assert.equal(
    (await db.query('SELECT user_id FROM authenticators WHERE user_id=$1', [actor.id])).rows.length,
    0,
  );
  assert.equal((await db.query("SELECT id FROM identity_mail WHERE payload<>''")).rows.length, 0);
});

test('authenticator replacement preserves the old factor until confirmation and rotates recovery codes', async () => {
  const a = await factor('collector'),
    other = await login('collector');
  await assert.rejects(s.identity.enroll(other.actor, password, true), rejection('MFA_REQUIRED'));
  const old = (await one(db, 'SELECT secret FROM authenticators WHERE user_id=$1', [a.actor.id]))!
    .secret;
  const replacement = await s.identity.enroll(a.actor, password, true);
  assert.equal(
    (await one(db, 'SELECT secret FROM authenticators WHERE user_id=$1', [a.actor.id]))!.secret,
    old,
  );
  const result = await s.identity.verifyMfa(a.actor, a.token, totp(replacement.secret), true);
  assert.equal(result.recovery_codes!.length, 10);
  assert.equal(await s.auth.session(other.token), null);
  await assert.rejects(
    s.identity.verifyMfa(a.actor, a.token, a.codes[1]),
    rejection('MFA_INVALID'),
  );
  await s.identity.verifyMfa(a.actor, a.token, result.recovery_codes![0]);
});
