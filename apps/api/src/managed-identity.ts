import * as oidc from 'openid-client';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { one } from '../../../packages/database/index';
import { hash, passwordHash } from '../../../packages/domain/security';
import { check, id, audit } from '../../../packages/domain/core';
import { lockChannels } from './channel-core';
import type { ManagedIdentityProvider } from './identity-providers';
import { IdentityService } from './identity';
export class OpenIdProvider implements ManagedIdentityProvider {
  private config?: Promise<oidc.Configuration>;
  constructor(
    public issuer: string,
    private clientId: string,
    private clientSecret: string,
    private transport?: oidc.CustomFetch,
  ) {
    const url = new URL(issuer);
    check(
      url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
      'OIDC_CONFIGURATION',
      'OIDC issuer must be a fixed HTTPS URL.',
      500,
    );
    check(
      clientId && clientSecret,
      'OIDC_CONFIGURATION',
      'OIDC client credentials are required.',
      500,
    );
  }
  private configuration() {
    return (this.config ??= oidc
      .discovery(new URL(this.issuer), this.clientId, this.clientSecret, undefined, {
        timeout: 10,
        execute: [oidc.enableNonRepudiationChecks],
        ...(this.transport ? { [oidc.customFetch]: this.transport } : {}),
      })
      .catch((e) => {
        this.config = undefined;
        throw e;
      }));
  }
  async authorize(i: { state: string; nonce: string; verifier: string; redirect: string }) {
    return oidc.buildAuthorizationUrl(await this.configuration(), {
      redirect_uri: i.redirect,
      response_type: 'code',
      scope: 'openid email profile',
      state: i.state,
      nonce: i.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(i.verifier),
      code_challenge_method: 'S256',
      prompt: 'login',
      max_age: '0',
    }).href;
  }
  async exchange(i: {
    url: string;
    state: string;
    nonce: string;
    verifier: string;
    redirect: string;
  }) {
    const tokens = await oidc.authorizationCodeGrant(
      await this.configuration(),
      new URL(i.url),
      {
        expectedState: i.state,
        expectedNonce: i.nonce,
        pkceCodeVerifier: i.verifier,
        idTokenExpected: true,
      },
      { redirect_uri: i.redirect },
    );
    const c = z
      .object({
        sub: z.string().min(1).max(255),
        email: z.email().max(254),
        email_verified: z.literal(true),
        name: z.string().max(100).optional(),
        auth_time: z.number(),
      })
      .parse(tokens.claims());
    check(
      c.auth_time > Date.now() / 1000 - 600 && c.auth_time <= Date.now() / 1000 + 60,
      'OIDC_AUTH_STALE',
      'Managed sign-in must use a fresh provider authentication.',
      401,
    );
    return {
      subject: c.sub,
      email: c.email.toLowerCase(),
      name: c.name || c.email.split('@')[0],
      email_verified: true,
    };
  }
}
export class ManagedSignIn {
  constructor(private identity: IdentityService) {}
  private redirect() {
    return `${this.identity.options.origin || 'http://127.0.0.1:3000'}/api/identity/oidc/callback`;
  }
  async start() {
    const provider = this.identity.options.oidc;
    check(provider, 'OIDC_DISABLED', 'Managed sign-in is not configured.', 503);
    const state = randomBytes(32).toString('hex'),
      browser = randomBytes(32).toString('hex'),
      nonce = randomBytes(32).toString('hex'),
      verifier = randomBytes(32).toString('base64url');
    const url = await provider.authorize({ state, nonce, verifier, redirect: this.redirect() });
    check(
      new URL(url).protocol === 'https:',
      'OIDC_CONFIGURATION',
      'Hosted identity must use HTTPS.',
      503,
    );
    await this.identity.db.query(
      "INSERT INTO identity_challenges(token_hash,kind,browser_hash,secret,resource_id,expires_at) VALUES ($1,'oidc',$2,$3,$4,now()+interval '10 minutes')",
      [
        hash(state),
        hash(browser),
        this.identity.box().seal(JSON.stringify({ nonce, verifier })),
        provider.issuer,
      ],
    );
    return { url, browser };
  }
  async callback(state: string, browser: string, url: string) {
    const provider = this.identity.options.oidc;
    check(provider, 'OIDC_DISABLED', 'Managed sign-in is not configured.', 503);
    const c = await this.identity.db.transaction(async (tx) => {
      const r = await one(
        tx,
        "UPDATE identity_challenges SET used_at=now() WHERE token_hash=$1 AND kind='oidc' AND browser_hash=$2 AND resource_id=$3 AND used_at IS NULL AND expires_at>now() RETURNING secret",
        [hash(state), hash(browser), provider.issuer],
      );
      check(r, 'OIDC_STATE', 'Sign-in expired or does not match this browser. Start again.', 401);
      await tx.query('UPDATE identity_challenges SET secret=NULL WHERE token_hash=$1', [
        hash(state),
      ]);
      return r;
    });
    const saved = JSON.parse(this.identity.box().open(c.secret));
    const claims = await provider.exchange({ ...saved, state, url, redirect: this.redirect() });
    check(claims.email_verified, 'OIDC_EMAIL', 'The provider must verify the email address.', 403);
    const encoded = await passwordHash(randomBytes(32).toString('hex'));
    const uid = await this.identity.db.transaction(async (tx) => {
      await lockChannels(tx);
      const existing = await one(
        tx,
        'SELECT u.id,u.closed_at FROM managed_identities i JOIN users u ON u.id=i.user_id WHERE i.issuer=$1 AND i.subject=$2',
        [provider.issuer, claims.subject],
      );
      if (existing) {
        check(!existing.closed_at, 'ACCOUNT_CLOSED', 'Account is closed.', 403);
        return existing.id;
      }
      // Matching email alone never links a managed subject to an existing local account.
      check(
        !(await one(tx, 'SELECT id FROM users WHERE email=$1', [claims.email])),
        'IDENTITY_LINK_REQUIRED',
        'This email already belongs to an account. Use its existing sign-in; automatic account linking is disabled.',
        409,
      );
      const uid = id();
      await tx.query(
        'INSERT INTO users(id,email,name,password_hash,email_verified_at,local_login_enabled) VALUES ($1,$2,$3,$4,now(),false)',
        [uid, claims.email, claims.name, encoded],
      );
      await tx.query('INSERT INTO managed_identities(issuer,subject,user_id) VALUES ($1,$2,$3)', [
        provider.issuer,
        claims.subject,
        uid,
      ]);
      await tx.query("INSERT INTO organizations(id,name,kind) VALUES ($1,$2,'personal')", [
        `${uid}-org`,
        `${claims.name}'s collection`,
      ]);
      await tx.query("INSERT INTO memberships(user_id,org_id,role) VALUES ($1,$2,'owner')", [
        uid,
        `${uid}-org`,
      ]);
      await audit(tx, uid, 'identity.managed_registered', uid, { issuer: provider.issuer });
      return uid;
    });
    return this.identity.auth.createSession(uid, 'oidc');
  }
}
