import { randomBytes } from 'node:crypto';
import { one, type Database, type SQL } from '../../../packages/database/index';
import { check, id, audit } from '../../../packages/domain/core';
import { hash, passwordHash, passwordMatches } from '../../../packages/domain/security';
import { base32, matchTotp } from '../../../packages/domain/identity-secrets';
import { lockChannels } from './channel-core';
import { AuthService, type Actor } from './auth';
import type { IdentityOptions, Mail } from './identity-providers';
export class IdentityService {
  constructor(
    public db: Database,
    public auth: AuthService,
    public options: IdentityOptions = {},
  ) {}
  box() {
    check(
      this.options.box,
      'IDENTITY_DISABLED',
      'Configure identity encryption before using this feature.',
      503,
    );
    return this.options.box;
  }
  async limit(key: string, max = 5) {
    const r = await one(
      this.db,
      `INSERT INTO auth_attempts(key) VALUES ($1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.window_started<now()-interval '15 minutes' THEN 1 ELSE auth_attempts.attempts+1 END,window_started=CASE WHEN auth_attempts.window_started<now()-interval '15 minutes' THEN now() ELSE auth_attempts.window_started END RETURNING attempts`,
      [hash('identity:' + key)],
    );
    check(
      r!.attempts <= max,
      'IDENTITY_RATE_LIMIT',
      'Too many attempts. Try again in 15 minutes.',
      429,
    );
  }
  async status(actor: Actor) {
    const factor = await one(this.db, 'SELECT enabled_at FROM authenticators WHERE user_id=$1', [
      actor.id,
    ]);
    return {
      email_verified: !!actor.email_verified_at,
      mfa_enabled: !!factor?.enabled_at,
      mfa_required: !!actor.mfa_required,
      mfa_available: !!this.options.box,
      mail_enabled: !!this.options.mail,
      managed_enabled: !!this.options.oidc,
      staff_mfa_required: !!this.options.staffMfaRequired,
      local_login_enabled: (await one(
        this.db,
        'SELECT local_login_enabled FROM users WHERE id=$1',
        [actor.id],
      ))!.local_login_enabled,
    };
  }
  async enqueue(
    tx: SQL,
    kind: 'verify' | 'reset' | 'invite',
    email: string,
    uid: string | null,
    resource: string | null,
  ) {
    check(this.options.mail, 'MAIL_DISABLED', 'Configure identity email delivery first.', 503);
    const token = randomBytes(32).toString('hex'),
      mid = id();
    await tx.query(
      "INSERT INTO identity_challenges(token_hash,kind,email,user_id,resource_id,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '30 minutes')",
      [hash(token), kind, email, uid, resource],
    );
    const mail: Mail = {
      to: email,
      subject:
        kind === 'reset'
          ? 'Reset your PixUP password'
          : kind === 'invite'
            ? 'Verify your PixUP workspace invitation'
            : 'Verify your PixUP email',
      text: `Open ${this.options.origin || 'http://127.0.0.1:3000'}/identity/action#token=${token} to ${kind === 'reset' ? 'reset your password' : 'verify this email link'}. This link expires in 30 minutes. If you did not request it, ignore this message.`,
    };
    await tx.query('INSERT INTO identity_mail(id,token_hash,payload) VALUES ($1,$2,$3)', [
      mid,
      hash(token),
      this.box().seal(JSON.stringify(mail)),
    ]);
  }
  async verifyEmail(actor: Actor) {
    await this.limit('verify:' + actor.id);
    await this.db.transaction((tx) => this.enqueue(tx, 'verify', actor.email, actor.id, null));
    return { ok: true };
  }
  async resetRequest(email: string) {
    await this.limit('reset:' + email.toLowerCase());
    check(this.options.mail, 'MAIL_DISABLED', 'Email recovery is not configured.', 503);
    const u = await one(
      this.db,
      'SELECT id,email FROM users WHERE email=$1 AND closed_at IS NULL AND local_login_enabled',
      [email.toLowerCase()],
    );
    if (u) await this.db.transaction((tx) => this.enqueue(tx, 'reset', u.email, u.id, null));
    return { ok: true, message: 'If an eligible account exists, a recovery link will be sent.' };
  }
  async consume(actor: Actor | null, token: string, password?: string) {
    const encoded = password ? await passwordHash(password) : undefined;
    await this.limit('consume:' + (actor?.id || hash(token)), 10);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const c = await one(
        tx,
        'SELECT *,expires_at>now() AS valid FROM identity_challenges WHERE token_hash=$1 FOR UPDATE',
        [hash(token)],
      );
      check(
        c && c.valid && !c.used_at && c.kind !== 'oidc',
        'LINK_UNAVAILABLE',
        'This link is invalid, expired or already used.',
        400,
      );
      const u = await one(
        tx,
        'SELECT * FROM users WHERE email=$1 AND closed_at IS NULL FOR UPDATE',
        [c.email],
      );
      check(
        u && (!c.user_id || c.user_id === u.id),
        'LINK_UNAVAILABLE',
        'This link is unavailable.',
        400,
      );
      if (c.kind === 'reset') {
        check(
          encoded && u.local_login_enabled,
          'RECOVERY_UNAVAILABLE',
          'Use your managed identity provider for recovery, or supply a new password.',
          400,
        );
        await tx.query(
          'UPDATE users SET password_hash=$2,email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1',
          [u.id, encoded],
        );
        await tx.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
        await tx.query(
          "UPDATE identity_challenges SET used_at=now() WHERE user_id=$1 AND kind='reset' AND used_at IS NULL",
          [u.id],
        );
      } else {
        check(
          actor?.id === u.id,
          'RECIPIENT_REQUIRED',
          'Sign in as the addressed account before verifying this link.',
          403,
        );
        if (c.kind === 'invite')
          check(
            await one(
              tx,
              "SELECT id FROM organization_invitations WHERE id=$1 AND email=$2 AND status='pending' AND expires_at>now()",
              [c.resource_id, c.email],
            ),
            'INVITATION_UNAVAILABLE',
            'The invitation is no longer available.',
          );
        await tx.query(
          'UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1',
          [u.id],
        );
      }
      await tx.query(
        'UPDATE identity_challenges SET used_at=now(),secret=NULL WHERE token_hash=$1',
        [c.token_hash],
      );
      await audit(tx, u.id, 'identity.email_link_consumed', c.resource_id || u.id, {
        kind: c.kind,
      });
      return { ok: true, kind: c.kind, invitation_id: c.kind === 'invite' ? c.resource_id : null };
    });
  }
  async reauthenticate(actor: Actor, token: string, password: string) {
    await this.limit('reauth:' + actor.id, 10);
    const u = await one(this.db, 'SELECT * FROM users WHERE id=$1 AND closed_at IS NULL', [
      actor.id,
    ]);
    check(
      u?.local_login_enabled && (await passwordMatches(password, u.password_hash)),
      'INVALID_CREDENTIALS',
      'Password reauthentication failed. Managed users must sign in again.',
      401,
    );
    await this.db.query(
      'UPDATE sessions SET reauthenticated_at=now() WHERE token_hash=$1 AND user_id=$2',
      [hash(token), actor.id],
    );
    return { ok: true };
  }
  recent(actor: Actor, requireMfa = false) {
    check(
      actor.reauthenticated_at && Date.parse(actor.reauthenticated_at) > Date.now() - 10 * 60000,
      'REAUTH_REQUIRED',
      'Sign in again or confirm your password before this change.',
      403,
    );
    check(!actor.mfa_required, 'MFA_REQUIRED', 'Complete authentication first.', 403);
    if (requireMfa)
      check(
        actor.mfa_verified_at && Date.parse(actor.mfa_verified_at) > Date.now() - 10 * 60000,
        'MFA_REQUIRED',
        'Confirm a fresh authenticator code before administering access.',
        403,
      );
  }
  async enroll(actor: Actor, password: string, replace = false) {
    if (replace) this.recent(actor, true);
    this.box();
    await this.limit('enroll:' + actor.id, 5);
    const u = await one(this.db, 'SELECT * FROM users WHERE id=$1 AND closed_at IS NULL', [
      actor.id,
    ]);
    check(
      u &&
        ((u.local_login_enabled && (await passwordMatches(password, u.password_hash))) ||
          (!u.local_login_enabled &&
            actor.auth_method === 'oidc' &&
            actor.reauthenticated_at &&
            Date.parse(actor.reauthenticated_at) > Date.now() - 5 * 60000)),
      'REAUTH_REQUIRED',
      'Confirm your password or sign in again with your managed provider.',
      403,
    );
    const secret = base32(randomBytes(20));
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const existing = await one(tx, 'SELECT enabled_at FROM authenticators WHERE user_id=$1', [
        actor.id,
      ]);
      if (replace) {
        check(existing?.enabled_at, 'MFA_NOT_ENROLLED', 'Enroll an authenticator first.');
        await tx.query(
          'UPDATE authenticators SET pending_secret=$2,pending_at=now() WHERE user_id=$1',
          [actor.id, this.box().seal(secret)],
        );
      } else {
        check(!existing?.enabled_at, 'MFA_EXISTS', 'An authenticator is already enrolled.');
        await tx.query(
          'INSERT INTO authenticators(user_id,secret) VALUES ($1,$2) ON CONFLICT(user_id) DO UPDATE SET secret=$2,created_at=now(),last_step=-1',
          [actor.id, this.box().seal(secret)],
        );
      }
      await audit(tx, actor.id, 'identity.mfa_enrollment_started', actor.id);
    });
    return {
      secret,
      uri: `otpauth://totp/PixUP:${encodeURIComponent(actor.email)}?secret=${secret}&issuer=PixUP&algorithm=SHA1&digits=6&period=30`,
    };
  }
  async verifyMfa(actor: Actor, token: string, code: string, confirmEnrollment = false) {
    await this.limit('mfa:' + actor.id, 10);
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(12).toString('hex'));
    const enrollment = await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const factor = await one(tx, 'SELECT * FROM authenticators WHERE user_id=$1 FOR UPDATE', [
        actor.id,
      ]);
      check(factor, 'MFA_NOT_ENROLLED', 'Enroll an authenticator first.');
      const replacing = !!factor.enabled_at && confirmEnrollment;
      if (replacing) {
        this.recent(actor, true);
        check(
          factor.pending_secret && Date.parse(factor.pending_at) > Date.now() - 10 * 60000,
          'MFA_ENROLLMENT_EXPIRED',
          'Restart authenticator replacement.',
        );
      }
      const selectedSecret = replacing ? factor.pending_secret : factor.secret;
      const step = matchTotp(
        this.box().open(selectedSecret),
        code,
        replacing ? -1 : Number(factor.last_step),
      );
      if (step === null) {
        check(
          factor.enabled_at && !replacing,
          'MFA_INVALID',
          'Enter a current authenticator code.',
          401,
        );
        const recovered = await one(
          tx,
          'UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash',
          [actor.id, hash(code)],
        );
        check(recovered, 'MFA_INVALID', 'Code invalid or already used.', 401);
      } else
        await tx.query('UPDATE authenticators SET last_step=$2 WHERE user_id=$1', [actor.id, step]);
      if (!factor.enabled_at || replacing) {
        check(
          Date.parse(replacing ? factor.pending_at : factor.created_at) > Date.now() - 10 * 60000,
          'MFA_ENROLLMENT_EXPIRED',
          'Restart authenticator enrollment.',
        );
        await tx.query(
          'UPDATE authenticators SET enabled_at=now(),secret=$2,pending_secret=NULL,pending_at=NULL WHERE user_id=$1',
          [actor.id, selectedSecret],
        );
        await tx.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [actor.id]);
        for (const value of recoveryCodes)
          await tx.query('INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES ($1,$2)', [
            actor.id,
            hash(value),
          ]);
        await tx.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [
          actor.id,
          hash(token),
        ]);
      }
      check(
        await one(
          tx,
          'UPDATE sessions SET mfa_verified_at=now() WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() RETURNING token_hash',
          [hash(token), actor.id],
        ),
        'AUTH_REQUIRED',
        'Sign in again.',
        401,
      );
      await audit(
        tx,
        actor.id,
        replacing
          ? 'identity.mfa_replaced'
          : !factor.enabled_at
            ? 'identity.mfa_enrolled'
            : 'identity.mfa_verified',
        actor.id,
        { recovery: step === null },
      );
      return !factor.enabled_at || replacing;
    });
    return { ok: true, recovery_codes: enrollment ? recoveryCodes : undefined };
  }
  async sessions(actor: Actor, token: string) {
    return (
      await this.db.query(
        'SELECT token_hash,created_at,expires_at,auth_method,mfa_verified_at FROM sessions WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC',
        [actor.id],
      )
    ).rows.map((s) => ({
      id: hash('session-display:' + s.token_hash),
      current: s.token_hash === hash(token),
      created_at: s.created_at,
      expires_at: s.expires_at,
      auth_method: s.auth_method,
      mfa_verified: !!s.mfa_verified_at,
    }));
  }
  async revokeSessions(actor: Actor, token: string) {
    await this.db.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [
      actor.id,
      hash(token),
    ]);
    await audit(this.db, actor.id, 'identity.other_sessions_revoked', actor.id);
    return { ok: true };
  }
  async worker() {
    await this.db.query(
      "UPDATE authenticators SET pending_secret=NULL,pending_at=NULL WHERE pending_at<now()-interval '10 minutes'",
    );
    await this.db.query(
      "DELETE FROM authenticators WHERE enabled_at IS NULL AND created_at<now()-interval '10 minutes'",
    );
    await this.db.query(
      "UPDATE identity_mail m SET state='expired',payload='' FROM identity_challenges c WHERE c.token_hash=m.token_hash AND (c.expires_at<=now() OR c.used_at IS NOT NULL) AND m.state='pending'",
    );
    await this.db.query(
      'UPDATE identity_challenges SET secret=NULL WHERE expires_at<=now() AND secret IS NOT NULL',
    );
    if (!this.options.mail) return;
    const rows = (
      await this.db.query(
        "SELECT m.* FROM identity_mail m JOIN identity_challenges c ON c.token_hash=m.token_hash WHERE m.state='pending' AND c.expires_at>now() AND c.used_at IS NULL AND (m.checked_at IS NULL OR m.checked_at<now()-interval '1 minute') ORDER BY m.created_at LIMIT 5",
      )
    ).rows;
    for (const r of rows) {
      await this.db.query('UPDATE identity_mail SET checked_at=now() WHERE id=$1', [r.id]);
      try {
        const providerId = await this.options.mail.send(
          JSON.parse(this.box().open(r.payload)),
          `pixup-identity-${r.id}`,
        );
        await this.db.query(
          "UPDATE identity_mail SET state='accepted',provider_id=$2,error_code=NULL,payload='' WHERE id=$1",
          [r.id, providerId],
        );
      } catch {
        await this.db.query("UPDATE identity_mail SET error_code='MAIL_UNAVAILABLE' WHERE id=$1", [
          r.id,
        ]);
      }
    }
  }
}
