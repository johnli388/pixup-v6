# PixUP

A working local implementation of the first PixUP marketplace release: discover collectibles, publish invited creator collections, sell vaulted inventory, purchase and refund items, verify VIA records, and recirculate through RePool.

**This release is a development pilot with local demo or Stripe test payments, plus simulated payouts, shipping and physical assessments. It is not approved for real-money operations.** Transactions, permissions, inventory changes, journals and uploaded artwork persist in a real PostgreSQL-compatible database.

## Run locally

Requires Node.js 24+ and npm. Dependencies are already installed in this workspace.

```sh
npm run dev
```

Open **http://127.0.0.1:3000**. The API runs on port 4000. The first API startup applies migrations and seeds original demo collections and accounts. Data persists under `.data/pixup`; restarting does not reset it. Only one API process may open an embedded database directory at a time.

Preview captures: [desktop](docs/screenshots/marketplace-desktop.png) · [mobile](docs/screenshots/marketplace-mobile.png).

For a fresh checkout:

```sh
npm run deps:ci
cp .env.example .env
npm run dev
```

Broadcom Artifactory remains the default registry in `.npmrc`. Use `npm run deps:ci` for lockfile installs or `npm run deps:install` for regular installs: the helper probes the configured registry, then uses `https://registry.npmjs.org/` if the first registry is unavailable. Each probe has a five-second fetch timeout and no retries. The choice applies only to that command; `.npmrc` and global npm settings are unchanged. If both probes fail, installation does not start.

Run `npm run registry:check` to check availability without installing. Additional install options/packages work through `npm run deps:install -- <package-or-options>`. Ordinary `npm install` and `npm ci` continue to use the configured registry directly; npm has one default registry, so the helper provides failover. For a manual override, use `npm ci --registry=https://registry.npmjs.org/`. Probes use [npm ping](https://docs.npmjs.com/cli/v11/commands/npm-ping/), retaining npm's proxy, CA and scoped-registry settings. Explicit lockfile URLs and scoped registries still apply; this is default-registry failover, not per-package mirroring.

## Demo accounts

All demo accounts use **`PixupDemo2026!`**. Select an account on the sign-in screen to fill its credentials, then sign in. New registrations create personal collector/seller accounts; creator access is invitation-only. The seeded creator account can invite registered accounts as publishers or viewers from Settings.

| Email                  | Workspace                                                                    |
| ---------------------- | ---------------------------------------------------------------------------- |
| `collector@pixup.demo` | Buy, collect, save favorites, credits, sell and recirculate                  |
| `creator@pixup.demo`   | Creator collections, rights submission, publication, seller proceeds         |
| `seller@pixup.demo`    | Existing inventory, vaulted listings, settlements                            |
| `ops@pixup.demo`       | Independent review, stock intake, VIA, fulfillment, financial audit, support |

Use **Settings → Sign out / switch demo account** to change roles. These are shared local fixtures, not real customer identities. Use fictional shipping addresses and evidence while evaluating the workflows.

## Try the complete workflows

**Languages:** use **Language** in the sidebar (inside the navigation menu on mobile) to select English, Español, Français, 简体中文, 日本語 or 한국어. The choice persists across visits and also controls Ask PixUP responses and date/number formatting. Prices remain USD; member and catalog content retain their original language. See [internationalization coverage and maintenance](docs/internationalization.md).

**PixUP Guide:** open **AI assistant** in the navigation or use **Ask PixUP** from any page. Search cards by title/category/budget, find public seller listings, look up buyer references from your own sales, search your orders, and ask about PixUP workflows. Local search/help works immediately. Optional AI answers require `ASSISTANT_PROVIDER=openai`, a server-only `OPENAI_API_KEY`, and a restart; users opt in in the chat. See [assistant configuration, privacy and verification](docs/assistant.md).

The [current-pilot gap review](docs/planning/05-current-pilot-gap-review.md) records shared assistant budgets (migration 016), dedicated route recovery, unknown-route HTTP 404s and preview isolation checks. Hardened PostgreSQL deployments must apply migration 016 and refresh runtime grants before startup.

**Local demo purchase and refund (`PAYMENT_PROVIDER=demo`):** sign in as Collector → Marketplace → choose a PixUP-owned item → Make it yours → choose vault custody → optionally use credits → Review total → Confirm demo purchase. The order survives a refresh. A vault refund restores original ownership and eligible credits while reversing the journal.

**Publish a collection:** sign in as Creator → Creator Studio → New collection → select a sample design or upload a PNG/JPEG/WebP → enter rights evidence → Create draft → Submit for review. Switch to Operations → Publishing → approve the rights submission → receive assessed stock. Switch back to Creator → set a price and publish. Individual specimens become purchasable.

**Sell an existing collectible:** sign in as Seller → add a collectible → request vault intake. Operations records physical receipt and inspection. Once accepted, the seller can list it. A purchase creates a held settlement; Operations can simulate release after fulfillment and resolution of support holds.

**Workspace access:** sign in as Creator → Settings → Manage organization → invite an account by email as Viewer or Publisher. Sign in as that account → Settings → Accept invitation. Owners can revoke invitations or member access. Revoking membership ends every existing session for that member. Invitations are local records; no email is sent or verified.

**RePool:** sign in as Collector → Seller Studio → recirculate an unlisted, certified item → accept the provisional **500-credit demo offer**. Operations must record receipt and accept inspection before credits become available and ownership transfers to PixUP. After receipt, Operations can revise the offer; the owner reviews old/new amounts under Seller Studio → Intakes → Review offer. Every revised offer expires after seven days and requires explicit consent. Declining retains ownership and enables a recorded demo return without a credit grant. Credits are nontransferable, nonwithdrawable, and usable only on PixUP-owned inventory. Demo redemption uses **100 credits = $1**; these are test constants, not approved commercial policy.

Staff permissions are stored separately for rights review, warehouse, VIA, finance, support and audit. The seeded Operations account retains all six for demonstration. Restricted staff receive only authorized queues; refunds for other users require finance permission. Production stock assessment requires both warehouse and VIA permissions and an independent reviewer.

The additive `004-plan-alignment.sql` migration runs automatically at API startup. It preserves existing IDs and transactions, adds invitation/staff permission records, and backfills version-one RePool offers. Existing staff flags receive the six explicit permissions for compatibility; new staff permissions must be provisioned separately.

## Stripe test checkout

An existing `STRIPE_SECRET_KEY` test key in the root `.env` automatically enables Stripe-hosted Checkout for new orders. Keep `APP_MODE=demo`; restart `npm run dev` after changing environment variables. The secret stays in the API process and is never sent to the browser. A publishable key is not needed for this hosted flow.

1. Sign in as Collector, open an available item, choose custody and optional credits, and review the total.
2. Choose **Continue to Stripe Checkout**. Stripe collects test payment details on its own page; this pilot allows card payments, subject to the account's enabled payment methods.
3. Return to the order page. It remains pending until the API retrieves a matching, completed Stripe session with payment confirmed. A success URL alone never grants ownership. Close/reopen the browser and use Orders to resume the same session.

Use [Stripe's test payment details](https://docs.stripe.com/testing) rather than a real card. Configure eligible methods in [Stripe payment settings](https://dashboard.stripe.com/test/settings/payment_methods). This integration pins API version `2026-10-28.endive` and uses `allowed_payment_method_types`, with USD totals and adaptive pricing disabled. See [Checkout Session API](https://docs.stripe.com/api/checkout/sessions/create).

`PAYMENT_PROVIDER=auto` is the default: test key present → Stripe test Checkout; no key → local simulation. Set `PAYMENT_PROVIDER=demo` explicitly to retain the original simulated purchase/refund workflows. `PAYMENT_PROVIDER=stripe_test` requires a test key. Live keys are rejected. Each order retains its provider, so existing demo orders remain demo orders.

The API polls active sessions in the background and the order page refreshes payment status. Optional verified webhooks provide another recovery path:

```sh
stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed --forward-to http://127.0.0.1:4000/v1/webhooks/stripe
```

Add the CLI's signing secret to `.env` as `STRIPE_WEBHOOK_SECRET`, then restart the API. Signature verification uses the original request bytes; events are deduplicated in a durable inbox, and the worker retrieves Stripe's current session before changing an order. Do not use the API secret key as the webhook secret.

Stripe sessions reserve stock for 35 minutes. The local expiry worker never releases an initiated Stripe reservation on a browser timeout: the provider must confirm expiration. Cancellation also resolves Stripe status first, including a payment that won the cancellation race. Uncertain requests retain the reservation; very old ambiguous creates require support reconciliation instead of a new charge attempt. Credit-only totals use a zero-total Checkout session and still require completion; partial credit redemption leaves at least the USD card minimum when cash remains.

**Stripe test refunds and recovery:** sign in as Operations → Payments → Review payment. Finance staff can assign an open review, reconcile the original Checkout Session, cancel only if Stripe confirms it is unpaid, or issue a full test refund with a reason and explicit confirmation. A lost session must be matched by its original ID; the server validates amount, currency and order identity before acting. Existing pending reviews are backfilled by migration `006-payment-recovery.sql` at startup.

Refunds retain a durable request and provider idempotency key. Listing, RePool intake and shipment are blocked while the refund is pending. Only a matching successful Stripe refund reverses the journal, restores original credits and returns title. Credit-only orders restore credits without a cash refund. Paid inventory exceptions can be refunded without transferring title, and quarantine is preserved. The order page shows refund progress; stale ambiguous refunds require the original refund ID from the Stripe test dashboard. Failed/canceled refunds are recorded without silently creating a replacement.

Item 3 adds independently approved partial cash adjustments and failed-refund replacements, canonical refund/dispute events, account-bound recovery, immutable gross-cash/refund reconciliation, hosted Express test onboarding and opt-in transfers to connected test balances. Operations → Payments exposes recovery; Settings exposes onboarding when countries are configured. Connect is disabled by default, and transfers are not bank payouts. See [payment controls and acceptance runbook](docs/payment-controls.md) for configuration, limits and the manual hosted-completion harness. Local demo refunds and simulated payout releases remain blocked for Stripe orders. Live payments, bank payouts, tax and approved commercial terms remain outstanding.

Item pages now show an **Item passport** with separate registry/source, VIA authenticity, condition, certificate and custody fields. A registry entry or QR lookup is not a physical authentication or an ownership claim.

```sh
npm run stripe:check  # Create/retrieve/expire $1 and credit-only test sessions; no payment
npm run stripe:refund-check  # Create and refund a $1 Stripe test payment; no real funds
npm run stripe:controls-check # Validate test partial/remaining refunds and canonical retrieval
```

## Commercial policy

Item 1 adds **Operations → Commercial**, with seven decision areas, immutable proposals and policy versions, independent finance reviews, and controls to pause/restore pilot checkout or PixUP-owned credit redemption. Quotes and orders retain their original commercial snapshots. Existing demo terms and the 18+ baseline are preserved; production commercial decisions remain unresolved. See the [commercial policy runbook](docs/commercial-policy.md).

## Community Hub

Community Hub adds member discussions, stories, knowledge sharing, topics, comments, private saves and moderated reports/appeals. Open `/community`; the text pilot defaults off. Run `COMMUNITY_ENABLED=true COMMUNITY_WRITES_ENABLED=true npm run dev` after provisioning scoped MFA moderators. Migration 015 is additive; demo staff receive no automatic moderation grant. See [setup, workflows, privacy and rollout limits](docs/community-hub.md).

## Channel pilots and scoped discovery tools

Open **Workspace → Channel workspace** to enable pilot gates, register sealed stock, allocate existing listings and manage CVM/LiveUP fulfillment. CVM and LiveUP activate first; GOUP/WaxUP follow, then scoped Query/Match/Route. All gates start disabled and require staff evidence. Buyers use `/channels` and the existing quote/order/payment flow.

CVM includes signed commands/events, offline checks, ambiguous-vend recovery and a persistent device simulator. LiveUP records witnessed physical openings and unverified child-item lineage. GOUP keeps separate participant payments and shipping shares. WaxUP requires business approval and cash-only sealed-case orders. **Workspace → Developer tools** creates scoped, expiring credentials and runs read-only inventory queries, matches and route previews with quotas and replay-safe usage.

See [channel adapter setup and protocol reference](docs/channel-adapters.md) for activation, simulator commands, recovery and provider limitations. Startup applies migration 007 while preserving existing orders as web orders. No live device, stream, carrier or external LLM service is connected by this increment.

## Commands

```sh
npm run dev          # API and web, with reload
npm run typecheck    # Backend and frontend TypeScript
npm test            # Domain, database and HTTP integration tests
npm run test:e2e     # Isolated browser workflows and accessibility test
npm run build       # Typecheck and optimized Next.js build
APP_MODE=demo npm start  # Serve the built frontend with the demo API
npm run db:migrate  # Apply database migrations independently
npm run stripe:check # Check Stripe test session creation/retrieval/expiry
npm run stripe:refund-check # Exercise test PaymentIntent and provider refund (uses .env)
npm run postgres:recovery-check # Requires PIXUP_VERIFY_DATABASE_URL: empty disposable PostgreSQL DB
npm run cvm:sim -- init /tmp/pixup-device-demo # Create local simulator device keys
npm run security:audit # Production dependency advisory assessment; unavailable results fail
npm run pricing:calibrate # Reproduce synthetic comparable-price calibration scenarios
npm run trust:sign -- request.json signature.json # Offline custodian only; explicit key file/ID required
npm run ops:verify # Load and encrypted restore drill; requires two empty disposable PostgreSQL URLs
npm run db:backup -- /secure-backups/snapshot.pxb # Explicit backup URL and encryption key required
npm run db:restore -- /secure-backups/snapshot.pxb # Explicit empty restore database required
npm run format     # Format application source
```

Playwright uses Chromium. Install a supported browser with `npx playwright install chromium` when permitted, or set `PLAYWRIGHT_EXECUTABLE_PATH` to an existing compatible browser executable. Browser tests start their own services on ports **3100/4100**, use a fresh temporary database, and do not alter your `.data/pixup` records. The browser suite uses a separate Next.js build directory.

## PostgreSQL instead of embedded storage

The default PGlite runtime embeds PostgreSQL and needs no Docker or database service. It is intended for one local API process. For a separate PostgreSQL database, set `DATABASE_URL` before starting the API:

```sh
docker compose up -d db
DATABASE_URL=postgresql://pixup:local-development-only@127.0.0.1:5432/pixup npm run dev
```

The included Compose file exposes the database on loopback only and uses a named development volume. The embedded and external adapters share SQL migrations. PostgreSQL 18 was exercised through migrations 001–013, exception backfill, checkout replay, concurrent payment/refund completion, channel stock contention, signed vend replay, tool quotas, price snapshots, checkpoint payloads, subscription replay/invoices, metering, structured inventory, finance approvals, private evidence, physical incident recovery, scoped partial refunds/reconciliation and Connect test transfers. The external adapter now preserves encoded JSON payloads without double-encoding them. Existing external databases with JSON scalar strings from the older adapter need a separate data review; this change does not rewrite their immutable history. Do not point this seeded demo at a database containing production records.

## Structure

```text
apps/api/src/           HTTP routes, identity, catalog, commerce, operations, media
apps/web/app/           Next.js layouts, routing and styles
apps/web/components/    Marketplace, creator, seller, collector and operations UI
packages/database/     PostgreSQL/PGlite adapters, versioned SQL migrations, seed
packages/domain/       Invariants, password hashing, journal, provenance and audit
tests/                 Database/domain/HTTP tests and Playwright journeys
docs/planning/         Original reviewed business and engineering plans
docs/implementation-status.md  Implemented scope, deviations and production gaps
```

The frontend uses Next.js, React, TypeScript, TanStack Query and Lucide. The backend uses **Express** with separate domain services and Zod validation. Express replaces the planned NestJS HTTP layer because NestJS packages were unavailable in the offline cache. No business module depends on Express, so a later NestJS controller layer can reuse those services.

## API and data integrity

The same-origin `/api/*` web routes proxy to backend `/v1/*`. The generated OpenAPI document, including organization and RePool response schemas and a consistent error envelope, is available at **http://127.0.0.1:4000/v1/openapi.json** (or `/api/openapi.json` through the frontend).

Sessions use random tokens stored as hashes and HTTP-only, SameSite cookies. Authenticated mutations require the session CSRF token from `/me`; checkout additionally requires an `Idempotency-Key`. Passwords use salted scrypt. Public records exclude owner IDs, addresses and private assessment evidence.

Inventory allocation and journals commit transactionally. Database constraints prevent multiple live listings or pending orders for the same specimen. Deferred triggers require balanced USD/credit journals; journal, assessment, audit and provenance history reject updates/deletes. Credits use grant lots and reservations. A transactional outbox delivers deduplicated in-app notifications.

Artwork uploads accept PNG/JPEG/WebP up to 6 MB and 24 megapixels, decode and re-encode through Sharp, strip metadata, and store a bounded WebP in the database. Originals are not retained. Draft artwork is private; publishing makes the attached artwork accessible. Production needs object storage, scanning, moderation, quotas and retention controls.

Read [implementation status](docs/implementation-status.md) before extending or deploying. CVM, LiveUP, GOUP/WaxUP and read-only AI tool adapters are available as gated local pilots; production provider integration and live subscription billing remain staged.

Account settings now requires an **18+ pilot declaration** before new commercial activity and provides privacy export/restriction requests. Existing accounts are not silently marked as consenting adults; newly generated demo fixtures have labeled synthetic declarations. Operations includes support-scoped Privacy and audit-scoped Monitoring views. See the [security assessment](docs/security-assessment.md) and [operational runbook](docs/operational-readiness.md) for alerts, encrypted PostgreSQL backups, restore/load exercises and remaining paid-pilot launch gates.

Operations also includes **Pricing** for curated cohorts, reviewed external observations and separate simulation snapshots, plus **Signatures** for offline certificate/checkpoint requests and verified artifact imports. Creator attribution remains observational; governance, reserves and IFCI payments remain disabled. Read [price methodology and independent signing setup](docs/price-attribution-trust.md) before configuring public trust roots. Migration 009 adds these records without fabricating prices, approvals or signatures.

Item 5 adds **Settings → Subscription and usage**, **Seller Studio → Organization inventory**, and **Operations → Billing / Approvals**. Finance drafts explicit monthly plans and another finance reviewer approves activation; workspace owners can then consent to hosted Stripe test subscription Checkout. Set `BILLING_PROVIDER=stripe_test` to enable it, using the existing server-only test key and a separate `STRIPE_BILLING_WEBHOOK_SECRET`. The seed has only one staff identity; independent review requires a separately provisioned finance account. No plans or prices are automatically approved.

Migration 010 adds subscription lifecycle/invoice records, included-usage caps, category-specific catalog attributes, organization inventory delegation and audited independent approvals for plans, inventory assignment and simulated settlement release. Delegation preserves the recorded title owner and seller payee. See [billing, inventory and finance setup](docs/saas-inventory-finance.md) for limits, recovery and remaining live-billing acceptance work. Verification passed **89 backend tests, 16 browser journeys, the production build and PostgreSQL migration/recovery checks**; subscription provider/browser tests use fixtures.

Item 4 adds **Settings / Operations → Private evidence**, **Operations → Physical handling**, and simulated tracking on shipped orders. Migration 011 adds scoped image/PDF uploads, an optional private S3 adapter, fail-closed ClamAV scanning, independent moderation, intake serial/seal/bin/photo captures, local labels, shipment events, loss/damage holds and retention controls. `PHYSICAL_CAPTURE_REQUIRED=true` requires captures before receipt/assessment and disables the legacy shipment shortcut. `EVIDENCE_STORAGE=s3` enables managed artwork processing; without a configured scanner, evidence stays quarantined. Existing `.env` values and application data are untouched by verification.

Read [evidence storage and logistics setup](docs/evidence-and-logistics.md) for configuration, recovery and rollout gates. Carrier labels/events are explicitly simulated; no postage or cloud resource is purchased. Actual S3/scanner acceptance, approved handling/retention policies and independent object backups remain required. Database backups alone do not restore S3 evidence.

Item 4 verification passed **99 backend tests, 18 browser journeys, the production build, and PostgreSQL migration 011/recovery checks**. Provider checks use deterministic S3/ClamAV fixtures; actual hosted provider acceptance remains outstanding.

Item 3 uses additive migration 012. Test account scope is verified before new payment activity; existing initiated orders require explicit binding to their original verified session. No accounts, onboarding countries or transfer gates are silently enabled. See the [payment controls runbook](docs/payment-controls.md).

Item 3 verification: **112 backend tests**, **20 browser journeys across the full run and corrected targeted rerun**, the production build and PostgreSQL migrations **001–012** passed. The Stripe test API also passed a $1 fixture payment with $0.40/$0.60 refunds and canonical reconciliation. Actual human hosted completion, Connect provider acceptance and bank payouts remain outstanding.

## Identity and access controls

Item 2 adds **Account security** for email verification, authenticator enrollment/recovery/replacement and session revocation; **Settings** for consented workspace owner transfers; and **Operations → Access** for independent staff-permission review. Migration 013 preserves existing users without inventing email verification, MFA or identity-administrator grants.

Managed OIDC and Resend email adapters are configurable and disabled by default. `IDENTITY_ENCRYPTION_KEY` is required for factors/provider flows; `STAFF_MFA_REQUIRED=true` enforces enrollment for staff, and `VERIFIED_INVITATIONS_REQUIRED=true` keeps invitation verification required even if email delivery is temporarily disabled. No external email or IdP account was provisioned. See the [identity and access runbook](docs/identity-and-access.md) for callback settings, recovery, administrator bootstrap and acceptance limits.

Optional `DATABASE_HARDENED=true` uses separately provisioned nonowner API/worker credentials and pre-applied migrations with `SEED_DEMO=false`. Initial PostgreSQL policies protect private collections, invitations and ownership proposals; full table coverage remains future work. See [role provisioning](infra/database/runtime-roles.sql) before enabling. The production dependency advisory check was [unavailable](docs/evidence/item2-dependency-assessment-2026-10-30.json), not passed.

Item 2 validation passed **124 backend cases and 22 browser journeys across regression and corrected targeted runs**, the production build and PostgreSQL migration **013**/role-isolation checks. `.env` and application data were unchanged.
