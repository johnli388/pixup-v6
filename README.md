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
npm ci
cp .env.example .env
npm run dev
```

The existing workspace `.npmrc` was preserved. It points to a corporate registry that was unavailable during implementation; public npm access was also blocked. Installation here used verified package content already in the local cache. On another machine, use your organization's permitted npm registry. The lockfile contains canonical public package URLs and package integrity hashes, not a dependency on the temporary cache server.

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

Stripe refunds, disputes and Connect payouts are not implemented. Local demo refunds and simulated payout releases are blocked for Stripe orders so they cannot imply a provider-side reversal or transfer. Taxes, fulfillment and business terms remain pilot simulations.

```sh
npm run stripe:check  # Create/retrieve/expire $1 and credit-only test sessions; no payment
```

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
npm run format     # Format application source
```

Playwright uses Chromium. Install a supported browser with `npx playwright install chromium` when permitted, or set `PLAYWRIGHT_EXECUTABLE_PATH` to an existing compatible browser executable. Browser tests start their own services on ports **3100/4100**, use a fresh temporary database, and do not alter your `.data/pixup` records. The browser suite uses a separate Next.js build directory.

## PostgreSQL instead of embedded storage

The default PGlite runtime embeds PostgreSQL and needs no Docker or database service. It is intended for one local API process. For a separate PostgreSQL database, set `DATABASE_URL` before starting the API:

```sh
docker compose up -d db
DATABASE_URL=postgresql://pixup:local-development-only@127.0.0.1:5432/pixup npm run dev
```

The included Compose file exposes the database on loopback only and uses a named development volume. The embedded and external adapters share SQL migrations. External PostgreSQL was separately exercised for migrations, seeding and simultaneous inventory reservations. Do not point this seeded demo at a database containing production records.

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

Read [implementation status](docs/implementation-status.md) before extending or deploying. The broader CVM, LiveUP, subscription and AI roadmap remains staged after this first web release.
