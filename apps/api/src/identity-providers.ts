import { OpenIdProvider } from './managed-identity';
import { z } from 'zod';
import { check } from '../../../packages/domain/core';
import { SecretBox } from '../../../packages/domain/identity-secrets';
export type Mail = { to: string; subject: string; text: string };
export interface IdentityMailProvider {
  send(mail: Mail, key: string): Promise<string>;
}
export interface ManagedIdentityProvider {
  issuer: string;
  authorize(input: {
    state: string;
    nonce: string;
    verifier: string;
    redirect: string;
  }): Promise<string>;
  exchange(input: {
    url: string;
    state: string;
    nonce: string;
    verifier: string;
    redirect: string;
  }): Promise<{ subject: string; email: string; name: string; email_verified: boolean }>;
}
export type IdentityOptions = {
  box?: SecretBox;
  mail?: IdentityMailProvider;
  oidc?: ManagedIdentityProvider;
  origin?: string;
  requireVerifiedInvitations?: boolean;
  staffMfaRequired?: boolean;
};
export class ResendIdentityMail implements IdentityMailProvider {
  constructor(
    private key: string,
    private from: string,
  ) {}
  async send(mail: Mail, key: string) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        from: this.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    check(r.ok, 'MAIL_UNAVAILABLE', 'Email delivery is awaiting provider confirmation.', 503);
    return z.object({ id: z.string().min(1) }).parse(await r.json()).id;
  }
}
export function identityConfiguration(env: NodeJS.ProcessEnv = process.env): IdentityOptions {
  const box = env.IDENTITY_ENCRYPTION_KEY ? new SecretBox(env.IDENTITY_ENCRYPTION_KEY) : undefined;
  const origin = env.APP_ORIGIN || 'http://127.0.0.1:3000';
  const url = new URL(origin);
  check(
    url.origin === origin &&
      !url.username &&
      !url.password &&
      ['http:', 'https:'].includes(url.protocol),
    'IDENTITY_CONFIGURATION',
    'APP_ORIGIN must be an HTTP(S) origin.',
    500,
  );
  check(
    !env.IDENTITY_MAIL_PROVIDER || ['disabled', 'resend'].includes(env.IDENTITY_MAIL_PROVIDER),
    'IDENTITY_CONFIGURATION',
    'Choose disabled or resend identity email delivery.',
    500,
  );
  const mail =
    env.IDENTITY_MAIL_PROVIDER === 'resend'
      ? new ResendIdentityMail(env.RESEND_API_KEY || '', env.IDENTITY_MAIL_FROM || '')
      : undefined;
  check(
    !mail || (box && env.RESEND_API_KEY && env.IDENTITY_MAIL_FROM),
    'IDENTITY_CONFIGURATION',
    'Email delivery requires an encryption key, API key and verified sender.',
    500,
  );
  check(
    env.STAFF_MFA_REQUIRED !== 'true' || box,
    'IDENTITY_CONFIGURATION',
    'Staff MFA requires a persistent encryption key.',
    500,
  );
  const oidc = env.OIDC_ISSUER
    ? new OpenIdProvider(env.OIDC_ISSUER, env.OIDC_CLIENT_ID || '', env.OIDC_CLIENT_SECRET || '')
    : undefined;
  check(
    !oidc || box,
    'IDENTITY_CONFIGURATION',
    'Managed identity requires persistent encryption.',
    500,
  );
  return {
    box,
    mail,
    oidc,
    origin,
    staffMfaRequired: env.STAFF_MFA_REQUIRED === 'true',
    requireVerifiedInvitations: env.VERIFIED_INVITATIONS_REQUIRED === 'true',
  };
}
