# Identity and access — item 2

Migration `013-identity-access.sql` adds configurable managed sign-in, email-link verification/recovery, authenticators and recovery codes, consented workspace ownership transfer, independent staff-access review and initial PostgreSQL tenant policies. Existing users are **not** marked email-verified or MFA-enrolled. Existing staff permissions remain intact; no account receives `identity_admin` automatically. Local demo login remains available. This is an implementation increment, not approval to expose the seeded pilot publicly.

## Enable identity features

Keep the root `.env` private. Generate and securely retain a persistent 32-byte encryption key:

```sh
openssl rand -hex 32
```

Set `IDENTITY_ENCRYPTION_KEY` to that hex value. It encrypts authenticator secrets, pending replacement secrets, OIDC state material and queued email bodies with AES-256-GCM. Losing it locks out enrolled factors and invalidates pending flows; restore the original key rather than deleting factors. Managed key storage, rotation and independent encrypted-key restoration remain deployment work. Session tokens, email-link tokens and recovery codes are stored as hashes. Neither the HTTP API nor logs expose stored authentication secrets.

Settings → **Account security** supports enrollment, current-code verification, one-use recovery codes, password reauthentication and ending other sessions. Authenticator setup keys and recovery codes are displayed only during enrollment/confirmation; save recovery codes offline. A current authenticator or unused recovery code plus fresh password/managed authentication can initiate replacement. The old factor remains active until the new code is confirmed. Confirmation replaces recovery codes and revokes other sessions. There is no unauthenticated or staff “clear MFA” endpoint. Losing both the factor and all recovery codes requires an independently approved recovery process that is not implemented here.

`STAFF_MFA_REQUIRED=true` requires all staff to complete enrollment/verification before protected API use. Default `false` preserves the existing local demo; an account with an enrolled factor requires MFA regardless of that flag. Pending MFA sessions can access only the current identity, enrollment/verification and sign-out routes. Verification lasts at most 12 hours; sensitive access administration additionally requires password/managed authentication and MFA within 10 minutes. Totals, ownership and business privileges are never derived from an identity-provider role claim.

## Managed sign-in

Configure a confidential OpenID Connect client with an HTTPS issuer and these server-only settings:

```dotenv
OIDC_ISSUER=https://your-issuer.example
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
APP_ORIGIN=http://127.0.0.1:3000
```

The confidential client uses `client_secret_post`; configure that authentication method at the provider. Register exactly `${APP_ORIGIN}/api/identity/oidc/callback` as the callback. Deployed origins require HTTPS and `COOKIE_SECURE=true`. The adapter uses authorization code flow with PKCE S256, random state/nonce, a separate HTTP-only browser-binding cookie, a ten-minute single-use exchange and fresh provider authentication. The maintained `openid-client` library verifies issuer/audience/nonce and signed ID tokens against provider keys. Email must be provider-verified. Access/refresh/ID tokens are not persisted or returned to the browser. External sign-out/session revocation and provider deprovisioning synchronization remain outstanding.

Local account identity is bound to **issuer plus subject**, never email alone. A matching existing local email produces a recoverable refusal, not automatic linking. Existing local accounts continue using their original credentials; migration/linking needs a separate authenticated approval workflow. New managed users receive personal accounts with local password login disabled. They still need the normal age/terms declaration and local organization/staff permissions. Provider email changes do not silently change the stored account email or move memberships.

Registry access timed out during this increment. `openid-client` 6.8.8, `jose` 6.2.12 and `oauth4webapi` 3.8.8 are pinned to the maintainers’ official GitHub release tarballs, with integrity entries in `package-lock.json`. Lifecycle scripts were disabled during installation. The [dependency advisory check](evidence/item2-dependency-assessment-2026-10-30.json) was **unavailable**, not passed. See the [client’s security configuration](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md).

## Email verification, invitations and password recovery

The implemented delivery adapter uses Resend; external delivery defaults to disabled:

```dotenv
IDENTITY_MAIL_PROVIDER=resend
IDENTITY_MAIL_FROM=PixUP <verified-sender@your-domain.example>
RESEND_API_KEY=your-server-only-key
VERIFIED_INVITATIONS_REQUIRED=true
```

Configure and verify the sending domain with the provider before enabling this capability. No external email was sent or provider account provisioned by implementation/testing. A separate worker retries bounded batches independently of payment/scanner outages. Its encrypted outbox retains one stable idempotency key per message. Queued links expire after 30 minutes, well within the provider’s documented [24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys). Accepted payloads and expired/consumed pending payloads are cleared. Provider acceptance is not inbox delivery, email verification or invitation acceptance. Delivery/bounce webhooks, suppression handling and deliverability acceptance remain outstanding.

Account security can send a verification link. Login offers password recovery only when email delivery is enabled. Known and unknown recovery addresses receive the same response shape. Tokens appear in the link fragment, are removed from the address bar after session initialization and are consumed only by an explicit POST. GET requests and mail scanners do not consume them. Resetting a password revokes all sessions and other pending password-reset links but preserves MFA. Managed users recover credentials at their provider; a reset link cannot enable local login.

When delivery or `VERIFIED_INVITATIONS_REQUIRED` is enabled, invitation acceptance requires both a verified email and consumption of the exact addressed invitation link. The invitation must still be pending and within its original seven-day window, and existing role/seat gates still apply. Owners can resend a new 30-minute email link without extending the invitation. Existing invitations created before delivery was configured need a resend. Disabling the mail provider does not bypass verification if the explicit required flag remains true. With both controls off, the historical addressed local-demo invitation path remains available and does not prove mailbox ownership.

Email/recovery/MFA attempts are throttled persistently per account/token purpose, in addition to bounded HTTP authentication traffic. Monitoring exposes delayed identity-delivery failures. Privacy exports include verification/enrollment and managed-issuer metadata without keys, tokens or passwords. Eligible closure revokes sessions, destroys authenticator/recovery secrets and clears pending mail; retained business/audit records remain governed by the existing review process. An identity administrator must first leave that role through independent review before account closure.

## Ownership and staff administration

An authenticated, recently reauthenticated **sole owner** of a creator or merchant workspace can nominate a verified existing member. The current owner must also have verified email. The recipient must explicitly accept within 24 hours; either participant can cancel. Acceptance checks current membership and original ownership again, makes the recipient owner, makes the former owner publisher and revokes both users’ sessions. It preserves physical title, payee identity, subscriptions and historical attribution. Personal/platform workspaces and ambiguous multiple-owner configurations are excluded. Settings shows pending transfers and the ownership request form.

Identity administration is a separate `identity_admin` permission. Initialize exactly two existing email-verified, MFA-enrolled accounts once through the offline operator command:

```sh
npm run identity:bootstrap -- EXISTING_USER_ID_ONE EXISTING_USER_ID_TWO
```

The command uses `DATABASE_MIGRATION_URL` when configured, otherwise the existing local database selection. It does not create accounts, assert verification, reset MFA or send invitations. It refuses initialization if any administrator already exists and revokes both users’ prior sessions. Do not run it against production data without the deployment’s approved operator procedure. The command was not run against your application database.

Operations → **Access** requires fresh MFA and reauthentication. An administrator requests the complete desired permission set for another verified, enrolled account; a different current administrator who is not the target decides it. Empty permissions revoke staff access. Requests expire after 24 hours, bind immutable prior/new permissions and fail if requester authority or target readiness changed. Execution invalidates the target’s sessions. Removing an identity administrator must retain at least two active enrolled administrators. Request identities, terms and terminal decisions are immutable and audited. Provider claims, ordinary staff roles and finance approval do not grant this authority.

## PostgreSQL runtime separation and tenant policies

Local PGlite/owner mode remains the default for development. Database policy enforcement is exercised using separate **nonowner PostgreSQL roles**, not inferred from owner-mode tests. To configure that mode:

1. Apply migrations through the migration-owner connection: `DATABASE_MIGRATION_URL=… npm run db:migrate`.
2. Review and apply [runtime role provisioning](../infra/database/runtime-roles.sql) as the trusted database administrator. It creates non-login `pixup_runtime` and `pixup_worker` groups, grants DML without schema/role administration, denies migration writes, and withholds TRUNCATE and financial-history modification.
3. Provision separate LOGIN roles/credentials externally. Grant only `pixup_runtime` to the API login and only `pixup_worker` to the worker login. Neither login may inherit the migration owner, superuser, BYPASSRLS or the other operational role. Do not place migration credentials in the deployed API environment.
4. Configure `DATABASE_URL` for the API, `DATABASE_WORKER_URL` for workers, `DATABASE_HARDENED=true` and `SEED_DEMO=false`. Startup verifies role properties, ownership, selected privileges, enabled policies and migration 013. It runs no migrations or seed in this mode. Reapply reviewed grants after future migrations.

The initial RLS scope is **private collection rows, organization invitations and ownership-transfer proposals**. Public published collection rows remain readable. Runtime actor context comes from the authenticated session and is set transaction-locally on the same connection for each query/transaction; it resets on success, rollback and pool reuse. Named worker-role policies permit their cross-tenant background work. Role inheritance, denied foreign writes, absent-context reads and concurrent pooled contexts are exercised against PostgreSQL 18.

These policies supplement API permission checks; they do not yet cover every financial, asset, membership, evidence or authentication table, and they do not replace column-level privacy rules. Application-supplied PostgreSQL context assumes trusted parameterized server code; it is not a defense against arbitrary SQL execution with runtime credentials. Migration/owner connections can bypass RLS and are restricted to controlled offline operations. Broader table policies, narrower service roles, separately deployed workers/operations and deployed IAM/network controls remain launch work. See [PostgreSQL row-security behavior](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## Acceptance scope

Tests use temporary databases, signed OIDC/JWKS transport fixtures and a capturing email provider; browser MFA enrollment and recovery use real local account APIs. They do not establish acceptance of a particular hosted IdP, email domain, deliverability or production deployment. Complete real provider sign-in/denial/key-rotation/session-revocation checks, verified inbox delivery and expiry/recovery acceptance, protected key backup/restore, administrator recovery drills and an available dependency/security assessment before an external pilot.
