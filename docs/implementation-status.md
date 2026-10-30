# Implementation status

Updated October 30, 2026. This is a runnable local development pilot implementing the first web-first slice of the [approved delivery sequence](planning/README.md), with persistent data and exercised cross-role workflows. It does not represent completion of the full 12-month business roadmap or production launch approval.

## Implemented

| Area               | Working behavior                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketplace        | Server-rendered catalog, category/search/price filters, sorting, item details, saved items, collection pages, public certificate verification                                     |
| Accounts           | Scrypt passwords, hashed sessions, local invitations, owner administration, viewer/publisher permissions, member revocation with session invalidation                             |
| Creator publishing | Private drafts, rights statements, independent review/change requests, edition caps, stock intake, assessed specimens, priced publication                                         |
| Artwork            | Owner-scoped PNG/JPEG/WebP upload, decoded/re-encoded WebP, bounded size and pixel count, metadata removal, private/public access rules                                           |
| Seller inventory   | Add a physical-item record, request vault intake, follow receipt/inspection, publish or withdraw a fixed-price listing                                                            |
| VIA and custody    | Recorded assessments, grades, certificate supersession/revocation, custody state changes, quarantine, public history with private evidence separation                             |
| Checkout           | Server quotes, unique-item reservation, idempotency, expiry, credit holds, recorded ownership transfer, vault or demo shipment selection                                          |
| Money and credits  | Separate USD/credit journals, balanced-posting constraints, demo payment, fee allocation, held settlements, demo releases, refunds and credit restoration                         |
| RePool             | Immutable versioned demo offers, expiry, changed-offer consent/decline, receipt and independent assessment gates, exact single grant, title transfer and recorded demo returns    |
| Operations         | Separate rights/warehouse/VIA/finance/support/audit permissions, scoped queues, production stock, intake, simulated shipping/payouts, support and audit                           |
| Reliability        | Transactional outbox with deduplicated notification processing, background reservation expiry, retry-safe payments/refunds, application validation and database constraints       |
| UI                 | Responsive navigation, marketplace, item/checkout, collection/orders/credits, creator/seller/staff views, keyboard-accessible native dialogs, recoverable errors and empty states |

## Deliberate implementation differences from the plans

- **Express replaces NestJS for the HTTP layer.** The environment's registry restrictions made NestJS unavailable, while Express was cached. Domain services and SQL transactions remain separate and reusable.
- **One web application provides role-specific workspaces.** Staff requests enforce backend authorization, but the operations UI is not yet a separately deployed, independently authenticated application.
- **PGlite provides the default single-process local PostgreSQL runtime.** A separate PostgreSQL adapter is also implemented. Redis, a managed queue, cloud hosting and managed database provisioning have not been introduced.
- **Image data is bounded and stored in PostgreSQL for this pilot.** A production object-store adapter, private document uploads, malware scanning, image moderation and lifecycle policies remain necessary. Rights evidence and intake evidence currently use text; artwork upload is not proof of physical authentication or legal rights.
- **Sessions are local accounts, not managed OIDC.** Invitations are addressed to the signed-in account email and expire after seven days. No email delivery, email verification, MFA, recovery, recipient onboarding, KYC or age verification is claimed. Personal workspaces cannot invite members; owner transfer and staff-permission administration UI remain unimplemented.
- **VIA certificates expose stored assessment validity.** Event chains and database immutability checks are implemented; external signing keys, trusted timestamps, independent checkpoints, immutable object retention and C2PA conformance are not.
- **The outbox worker runs alongside the API.** It processes in-app notifications and reservation expiry. Separate worker deployments, external notification providers, DLQs and broader event replay tooling remain future work.
- **Pilot plan labels represent access entitlements, not paid subscriptions.** Local invitations and member revocation are implemented. Subscription billing, metering, tiers and invoicing are not implemented.
- **OpenAPI is generated from route/input definitions.** Shared response schemas/types now cover organization lists, invitations, membership administration, RePool terms and offer history. Every HTTP error includes code, message, field errors, retryability and a matching correlation header. The frontend retains structured errors and displays field details/support references. Legacy response schemas and a fully generated client remain to be expanded.

## Simulated commercial boundaries

Local demo payment confirmation remains an authenticated **demo action**. With a test secret key configured, new orders use Stripe-hosted Checkout, and payment confirmation comes only from authenticated server retrieval of Stripe session state. PixUP never receives card details. Seller payouts and shipments remain simulations; simulated refund and payout actions are disabled for Stripe orders. Demo rates are 5% seller commission, $8 optional delivery, 100 credits per dollar, and 500 credits for the initial RePool offer, with staff-authored revised demo offers. Each version records its amount, expiry, author and policy; admission posts exactly the accepted amount. They are intentionally labeled test constants rather than approved business terms.

The API refuses unsupported application modes and refuses an unspecified production mode. A production Next.js build can still be served for local evaluation using `APP_MODE=demo`; this is not permission to operate real-money commerce. A demo-mode flag is an operational guard, not a substitute for production security review.

There is no real tax calculation, bank reconciliation, production PSP reconciliation, consumer shipping protection, regulated custody, insurance, chargeback recovery or validated authentication model. Stripe test-session reconciliation is implemented; it does not establish live-money readiness. Internal balanced journals do not establish external cash availability or physical custody. Platform-owned sales use simplified demonstration accounting; finance must approve the production chart of accounts and revenue treatment.

IFCI payments, royalties, FPCR reserve deductions and VACV valuation are not activated. The UI presents recorded circulation separately from earnings. The displayed price-reference panel reports completed demo observations and insufficient-data states, not a calibrated comparable-sales valuation.

## October 30 plan alignment

This increment addresses local B1/F1 identity and access, B2/F1 contracts, and B8/F3 changed-offer behavior. It does not complete the full updated roadmap.

- Settings supports invitation creation/acceptance/revocation and member removal. Viewer access is read-only; publisher/owner membership is checked again for mutations. Revocation removes all member sessions. Private artwork attached to an organization collection is readable only by current members, its owner, or appropriately scoped staff.
- Operations returns only permitted queues. Warehouse fulfillment excludes finance amounts; rights evidence is excluded from warehouse stock projections. Finance controls third-party refunds and simulated settlement release; support can inspect orders but cannot refund them. The original `/ops` aggregate route remains for compatibility; independent paginated queue endpoints remain future work.
- Account/membership/permission changes change query scope and remount private views. Queries consume cancellation signals; old scopes are canceled and removed. Workspace switches cancel cached requests and close collection editors. Session refresh runs every 15 seconds while active and on window focus; authorization is enforced immediately on every backend request.
- RePool maintains immutable offer versions and audited consent, with expected-version conflicts. Expired or unaccepted revised offers cannot transfer title or issue credits. Declined items remain unavailable for listing until Operations records a demo return; returned items require fresh custody/VIA review. This is buyback only: consigned pool membership, market valuation and real return shipping remain unimplemented.
- Migration 004 preserves the existing schema/data and backfills prior staff access and RePool offers. Legacy open offers gain a seven-day expiry from migration; completed grants and journals are untouched.

## Stripe test checkout increment

- `STRIPE_SECRET_KEY` enables hosted test Checkout through the server-only Stripe adapter. `PAYMENT_PROVIDER=demo` keeps existing local fixtures deterministic; live keys fail startup. No frontend secret or card field is added.
- Migration 005 records the provider per order, durable payment attempts, exact immutable-in-use create payloads and provider session IDs, and a deduplicated webhook inbox containing only event routing metadata. Existing orders default to demo.
- Repeated or interrupted creation uses the same Stripe idempotency key and payload. Confirmation validates session identity, test mode, amount, USD currency, client reference and order metadata before the transactional inventory/journal transition. Paid statuses and zero-total `no_payment_required` are distinct from merely visiting a success URL.
- Cancellation/expiration retrieve authoritative provider state before releasing stock or credit holds. API/browser polling works without webhook forwarding. Signed webhooks trigger retrieval through a durable inbox. Very old ambiguous creates and paid inventory exceptions stay reserved for manual reconciliation.
- Cash and credit-only Checkout Session create/retrieve/expire requests were exercised against the configured Stripe test account. Sessions were immediately expired; no payment was made. Completed-payment, webhook, interruption and race tests use a fake provider. The browser checkout test uses contract fixtures, not a completed payment on Stripe's hosted page.
- Refund/dispute provider effects, recipient onboarding and Stripe Connect payouts remain future work. The API blocks local demo reversal/release for Stripe orders. This increment does not complete B4/B5/B7 or the paid-pilot launch gates.

## Verification

October 30 checks: **36 domain/database/HTTP tests passed**, **6 Playwright journeys passed**, and **`npm run build` passed**, including both TypeScript checks. Browser tests used the locally installed Chromium headless shell revision 1243 through `PLAYWRIGHT_EXECUTABLE_PATH`; the default revision requested by Playwright was unavailable. Tests used isolated temporary databases and did not migrate the user's `.data/pixup` directory. The migration chain was also tested against a constructed pre-004 database and rerun to check idempotence. `npm run stripe:check` verified session create/retrieve/expire with the real Stripe test API for both cash and credit-only totals.

The repository includes automated domain/database and HTTP tests, plus Playwright browser workflows. Test coverage includes competing buyers, payment and refund replay, authorization, CSRF, expiry, restricted credit redemption, overspending, intake gates, publication gates, certificate revocation, immutable/balanced journals, outbox replay, and uploaded-image access rules.

The browser suite exercises purchase/refund, uploaded creator artwork through publishing, cross-account review/stock intake, revised RePool offer consent and credit grant, invitation/viewer access with stale-session revocation, mobile navigation, overflow checks and automated WCAG A/AA checks on the marketplace. Automated accessibility checks do not establish complete WCAG conformance; manual screen-reader and broader device review remain required.

Earlier pilot validation used a separate temporary PostgreSQL 18 instance for migrations, seeding, joined reads and concurrent reservations. This increment was verified with PGlite; migrations 004–005 have not been rerun against external PostgreSQL. Most invariant tests use embedded PostgreSQL; sustained multi-process load, provider outage behavior, managed backups, restore drills and live integrations have not been tested.

## Next production increments

1. Resolve the plan's commercial decisions: credit redemption scope, creator entitlement contracts, seller protection, title/payout milestones, refund windows, taxation and jurisdiction/age policy.
2. Add managed identity, verified invitation delivery, staff MFA, owner transfer and staff-permission administration, recovery and privacy workflows. Introduce database least-privilege roles and defense-in-depth tenant policies; current isolation is enforced in the application.
3. Extend the Stripe test Checkout foundation into an approved live payment flow: provider refunds/disputes, recipient onboarding and Connect payouts, external reconciliation, operational exception tooling and launch controls. Demo endpoints already reject Stripe orders; real-money operation remains disabled.
4. Integrate production image/document storage, scanning and moderation; implement physical intake capture, identity binding, labels, carrier tracking, loss/damage procedures and evidence retention.
5. Add paid SaaS subscriptions and usage metering, richer catalog/category schemas, multi-organization inventory and audited finance approvals.
6. Add calibrated price observations, attribution methodology and independently controlled certificate signing/checkpoints. Activate governance/reserves only after policy and finance approval.
7. Complete security assessment, privacy/age controls, monitoring, operational alerting, backup/restore exercises and realistic load tests before an external paid pilot.
8. Implement CVM and LiveUP channel adapters against the existing transaction core, then GOUP/WaxUP and scoped AI query/match/route tools according to the phased roadmap.

The original planning documents remain the target design; this document identifies the current executable implementation and its limits.
