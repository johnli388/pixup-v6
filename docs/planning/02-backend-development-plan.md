# PixUP backend development plan

Updated October 30, 2026 after reviewing all 40 pages of [PixUP-BP-J.pdf](../../PixUP-BP-J.pdf) and all 18 pages of [PixUP-Pitch-J.pdf](../../PixUP-Pitch-J.pdf), and comparing them with the runnable local pilot. References use PDF page numbers; BP appendices occupy pages 25–40. This revision defines the remaining engineering work, not a claim that the PDFs’ business model or production integrations have been validated.

The confirmed sequence remains **web marketplace and invited creators first, then CVM and LiveUP pilots**. The PDFs prioritize CVM/LiveUP and agency supply first; invited creator publishing is an intentional earlier pilot requested by the user. Broad self-service issuance, channel rollout and paid SaaS expansion remain gated. Read with the [frontend plan](03-ui-frontend-development-plan.md), [architecture](01-system-architecture.md), [decision register D1–D16](README.md#decisions-and-inconsistencies-to-resolve), and [implementation status](../implementation-status.md). The implementation baseline and incremental backlog below supersede the original greenfield schedule for this workstream; the architecture remains the target design.

## 0. Business requirements and implementation baseline

### Source-to-delivery traceability

The requirement IDs below are shared with the frontend plan. “Required” describes target behavior; “pilot” describes existing local behavior. Deck economics and governance ratios are proposed business inputs, not production defaults.

| ID  | PDF requirement and evidence                                                                                          | Required backend behavior                                                                                                                       | Delivery owner / epic              |
| --- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| R01 | One protocol from issuance through recirculation; BP pp. 2, 6–9; Pitch pp. 2, 9                                       | Stable physical-item identity, shared orders/ledger, append-only events and policy versions across channels                                     | Backend lead; B2/B4/B11            |
| R02 | Agency, licensed, platform and own issuance; origin registration and creator participation; BP pp. 10, 17; Pitch p. 5 | Issuance mode, rights scope, edition/batch/proof records, beneficiaries and approved publication                                                | Creator operations + backend; B3   |
| R03 | VIA certification and grading, fixed service fees, frozen assessments; BP pp. 4, 33, 39; Pitch p. 6                   | Separate authenticity/condition results, reviewer independence, evidence, reassessment, certificate signing/revocation; no VIA trade commission | VIA operations + backend; B6       |
| R04 | PinUP platform-owned, vaulted and seller-held inventory; BP p. 12                                                     | Separate title, physical custody and sell authority; policy-specific fees and fulfillment; seller-held payment deferred                         | Commerce + warehouse; B5/B7        |
| R05 | RePool multi-source custody and governed recirculation; BP pp. 5, 37, 39; Pitch p. 10                                 | Pool membership distinct from ownership; accepted offers, credit grants, admission/exit and approved 6Re actions                                | Operations + backend; B8/B12       |
| R06 | Closed ecosystem credits, with cash wholesale and source payments also specified; BP pp. 11, 29, 38, 40               | Separate cash and credit units, origin/restriction tracking, tender-specific refunds, no transfer/cash-out; scope decision D2                   | Finance + backend; B4/B8           |
| R07 | PulseRate from independent completed trades; BP pp. 4, 39                                                             | Licensed observations, normalized cohorts, exclusions, sample sufficiency, freshness and reproducible reference snapshots                       | Data/backend; B9                   |
| R08 | IFCI observational attribution and proposed source payment; BP pp. 10, 23, 38–39; Pitch p. 5                          | Separate observations, score versions, beneficiary contracts and payables; no agency-based automatic allocation                                 | Product + finance; B9/B12          |
| R09 | Demand, distribution and supply sides subscribe to SaaS; BP pp. 7, 34; Pitch pp. 7, 12                                | Buyer memberships, partner service entitlements and creator plans; billing/metering separated from permissions and transaction fees             | Product + backend; B1/B12          |
| R10 | CVM/LiveUP plus MeetUP, card shows, GOUP and WaxUP; BP pp. 13–15, 25–30; Pitch p. 9                                   | Channel inventory allocation, physical evidence, partner commissions, wholesale cash orders and common reconciliation                           | Integration/backend; B11/B12       |
| R11 | VACV, FPCR and 6Re; BP pp. 37, 39                                                                                     | Eligible-custody valuation, unpriced coverage, versioned governance and separately controlled reserves; shadow reporting before activation      | Finance + governance; B9/B12       |
| R12 | Query/Match/Route, human decision, C2PA compatibility; BP p. 8; Pitch p. 11                                           | Scoped typed APIs, metered usage, auditable recommendations and explicit action authorization; media-provenance interoperability validation     | Backend/data; B12                  |
| R13 | Own-issued pool share capped; equal pruning rules; BP pp. 4, 40                                                       | Track issuer affiliation independently of owner, concentration policy, reviewer conflicts and identical governance criteria                     | Governance + VIA; B3/B8/B9         |
| R14 | Device, cards, protocol, operations and site ownership; partner-led wholesale; BP pp. 15, 25, 29                      | Effective resource agreements, risk/fee allocation, reversal rules, partner statements and deduplicated channel attribution                     | Finance + integrations; B4/B11/B12 |
| R15 | Pack/node forecasts and distinct revenue/custody measures; BP pp. 12, 15, 17–19, 34, 37; Pitch pp. 4, 13, 15          | Versioned metric definitions, cost basis, observed/scenario separation, channel deduplication and reproducible reporting                        | Finance + data; B0/B4/B9/B11       |
| R16 | Applicability and legal/entity boundaries; BP pp. 35–36, 39                                                           | Category/market activation gates, separate legal/account/risk boundaries for non-collectibles, licensing decision before expansion              | Product + counsel + lead; B0/B12   |

### What exists and what remains

| Area               | Existing local pilot                                                                                                                      | Production gap to close                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity           | Local sessions, addressed seven-day invitations, membership administration/revocation, viewer/publisher/owner checks and six staff scopes | Verified email delivery/onboarding, recovery, MFA, owner transfer, staff-permission administration and DB least privilege                                                  |
| Catalog/publishing | Individually registered assets, four category labels, collection drafts/review/edition caps/publication                                   | Structured sports/K-pop metadata, variants/packs/batches, rights expiry/territory, approval versions, production proof/QC and organization-owned stock                     |
| Media              | Owner-scoped image upload, decode/re-encode, private draft/public artwork rules, database storage                                         | Private evidence documents, scanning/moderation, resumable object-store uploads, quotas, retention and controlled exports                                                  |
| Commerce           | Quotes/reservations, Stripe-hosted test Checkout, durable attempts, verified inbox/status reconciliation, demo refunds/holds              | Actual hosted completed-payment validation, provider refunds/disputes, recipient onboarding/payouts, tax/shipping, approved live configuration and external reconciliation |
| Trust/custody      | Recorded assessments/certificates/history, intake, permission separation and independent stock review                                     | Physical capture standards, bins/scans/seals, loss/damage/return handling, conflict review and external signing/checkpoints                                                |
| Credits/RePool     | Immutable versioned offers, expiry/reoffer consent, receipt/VIA gates, exact single grant/title transfer, demo return after decline       | Market-informed offers, consigned pool membership, own-issued concentration limits, 6Re and approved liability treatment                                                   |
| Infrastructure     | Modular Express, migrations 001–005, PGlite/PostgreSQL adapters, in-process outbox/payment workers, durable payment-event inbox           | Managed deployment, separate workers, DB roles, telemetry, dead-letter/replay tools, provider account/mode namespaces and backup/restore                                   |
| SaaS/data/channels | Pilot plan field, circulation records and insufficient-price-data UI support                                                              | Paid subscriptions, usage metering, calibrated PulseRate/IFCI/VACV, CVM/LiveUP and partner integrations                                                                    |

The pilot’s **5% seller fee, $8 delivery, 500-credit RePool offer and 100 credits per dollar** are test constants. They are not rates approved by either PDF. The BP’s proposed **5% FPCR exit allocation** is a different concept from the demo seller commission. Do not combine or activate them accidentally. The UI’s Art/Gaming fixtures do not establish readiness for those physical product categories; launch validation remains sports cards and K-pop photocards.

## 1. First-release outcome

An invited creator can submit rights evidence, publish an approved physical collection and sell available stock. A buyer can purchase, receive or vault an item, inspect its history, and request certification or recirculation. A seller can send an item into custody, pass VIA review, list it, and receive eligible sale proceeds through an approved payment provider. Operations can reconcile every movement of goods, ownership, money and credits.

MVP supports fixed-price USD orders, a single seller per checkout, platform-owned inventory, and vaulted seller inventory. Sellers may prepare seller-held drafts and catalog their collection, but direct seller-shipped checkout is a later release gate. Auctions, bidding, mixed-seller carts, cross-border settlement, paid credit loading, automatic IFCI payouts and software random draws are deferred. Invited creator publishing is moderated rather than instant.

## 2. Code and delivery structure

Extend the current repository instead of starting another application:

```text
apps/api/src/             # Express transport + auth/catalog/commerce/operations/media services
apps/web/                # Next.js consumer, creator, seller and staff surfaces
packages/database/       # PostgreSQL/PGlite adapters, migrations, fixtures
packages/domain/         # Shared invariants, journal, audit and provenance helpers
tests/                   # Domain/HTTP tests and browser journeys
```

Retain TypeScript, modular Express and PostgreSQL as the working baseline. NestJS remains an architecture option, not a prerequisite or reason to rewrite working domains. PGlite is for local single-process development; use managed PostgreSQL for the paid pilot. Move HTTP-independent business services into explicit domain modules as they grow; split the current operations service into VIA, custody, support and finance responsibilities.

Extend shared Zod response schemas already covering organizations, invitations, RePool and payment status/configuration; keep the implemented error envelope. Add `packages/api-contracts` if needed for complete schemas and generated clients, `apps/worker` for provider inbox/outbox/reconciliation/media jobs, and `infra` for repeatable staging/production infrastructure. Separate the operations deployment and authentication boundary before paid launch, while sharing components and contracts. No microservice extraction is required for the initial release.

Use additive versioned migrations: add nullable columns/tables, backfill with explicit provenance, validate constraints, then require new fields. Preserve existing asset/order IDs and journals. Mark imported fixture records as demo; do not fabricate rights, custody evidence or provider IDs during migration. Deploy a clean production database without seeded demo accounts, and exclude simulation data from live price/attribution datasets.

Every feature includes authorization, policy snapshots, accepted/error states, operational visibility, migrations and relevant tests. Deploy to staging continuously. Capability switches apply by organization, market, category and channel; a flag cannot bypass a permission or eligibility check.

## 3. Remaining implementation backlog and delivery gates

B0–B12 retain the original plan’s identifiers for cross-reference. The windows below are **planning estimates from the next implementation kickoff**, not elapsed work or promised launch dates. They assume two backend contributors plus platform/QA support, the frontend capacity in its plan, and available product/finance/VIA reviewers. Re-estimate after B0 and two delivery cycles. Use a 20–24-week remaining planning envelope until integration and physical-operations readiness is known; existing pilot code does not remove those dependencies.

| Epic                                  | Incremental window / owner                     | Build on pilot; remaining output                                                                                                                                                      | Acceptance gate                                                                                                                         |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| B0 Policy and provider baseline       | Weeks 1–2; product/finance/lead                | Record confirmed D1 scope; resolve D2–D4 and D11–D16 activation rules, fee taxonomy, allowed markets, custody/title, seller protection; prove PSP sandbox payment/refund/payout route | Written rule versions and provider suitability; no unapproved demo constants carried forward                                            |
| B1 Identity, tenancy and platform     | Weeks 1–4; lead/platform                       | Extend implemented invitations/revocation and staff scopes with verified delivery, recovery/MFA, owner transfer, staff administration, CI/CD, managed DB/secrets/telemetry            | Cross-org escalation denied; staff audit, session revocation and backup baseline verified                                               |
| B2 Registry, contracts and media      | Weeks 2–5; backend                             | Category schema, variants/batches/packs, owner/custodian/authority model, full OpenAPI responses, private evidence/object storage                                                     | Public projections omit private evidence; pack/card identities distinct; backfill preserves existing IDs                                |
| B3 Creator issuance                   | Weeks 4–8; backend/creator operations          | Rights contracts/scopes/expiry, issuance modes, approved versions, production proofs/QC and stock import                                                                              | Expired/unapproved issuance blocked; edition cap and proof version enforced; agency records never create automatic IFCI source payables |
| B4 Cash/credit foundation             | Weeks 3–8; backend/finance                     | Extend existing Stripe attempts/inbox with account/mode scoping, operational exceptions, provider refunds/disputes and versioned fee/tender accounts                                  | Hosted test payment and refund validated; event replay, old ambiguous attempts and independent cash/credit reconciliation pass          |
| B5 Purchase and fulfillment           | Weeks 7–11; backend                            | Real checkout recovery, tax/shipping adapter, return requests, partial refunds, disputes, status separation                                                                           | Stock collision, late success, browser loss and refund-after-resale recovery pass                                                       |
| B6 VIA and physical custody           | Weeks 5–10; backend/VIA/warehouse              | Capture checklist, authentication/grade separation, labels/bins, custody handoffs, reassessment, signed certificates                                                                  | Reviewer independence; physical identity and evidence trace; no QR-only ownership claim                                                 |
| B7 Vaulted resale/settlement          | Weeks 10–13; backend/finance                   | Consignment authority, recipient verification, hold/release rules, transfer/payout status and recovery                                                                                | Accepted fee terms match seller net; payout/refund/dispute races reconcile                                                              |
| B8 Controlled RePool                  | Weeks 11–15; backend/operations                | Extend implemented versioned offers/reoffers with consigned membership, source affiliation, concentration policy and admission/exit records                                           | Receipt + current VIA + authority; new consent; one grant; own-issued cap; no third-party cash funded by credits                        |
| B9 Price/attribution/reporting        | Weeks 13–17; backend/data                      | Eligible trade observations, basic PulseRate snapshots, source attribution, shadow VACV and governance reports                                                                        | Exclusions/reversals reproducible; no-data shown; no automatic IFCI or FPCR payment                                                     |
| B10 Paid-pilot hardening              | Weeks 16–24; whole team                        | External reconciliation consoles, security review, load/restore drills, support/warehouse exercises                                                                                   | All section 12 gates pass; dates extend if provider or physical operations remain unready                                               |
| B11 CVM and LiveUP pilots             | After B10; indicative months 7–9               | Device/stream adapters, pack allocation, vend/evidence journal, partner statements, MeetUP field tasks                                                                                | Paid order, physical outcome and funds reconcile through ambiguous failures                                                             |
| B12 SaaS/governance/partner expansion | After pilot evidence; indicative months 10–12+ | Three-sided paid plans, metered APIs, GOUP/WaxUP, approved 6Re, calibrated IFCI/VACV and gated reserve policy                                                                         | Subscription lifecycle verified; per-channel admission tests; governance decisions reproducible                                         |

Dependencies: B0 gates live commercial rules; B1+B2 → B3; B1+B4+B2 → B5; B2 → B6; B4+B5+B6 → B7; B4+B6 → B8; eligible B5/B7 observations → B9; B1–B9 → B10. B11 shares B4–B8 rather than maintaining a separate inventory or ledger. B12 billing can be developed earlier, but activation follows validated entitlements and approved offers. Overlapping windows require explicit contributor ownership.

The BP/Pitch targets of 100 CVMs in year one, 2,000 in year three and the $15 licensed-pack model are business scenarios (BP pp. 15, 18–19; Pitch pp. 4, 13, 15). Use a small instrumented channel pilot to establish actual service capacity and unit economics before scaling; those targets do not establish a production load baseline.

## 4. API contracts

The table below is the **target contract**, not a list of all currently implemented endpoints. Current routes are defined in [`apps/api/src/app.ts`](../../apps/api/src/app.ts). Preserve them while introducing typed contracts and documented migration paths:

| Current pilot route / behavior                                                | Planned evolution                                                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/v1/collections/{id}/actions` with `save/submit/publish`                     | Keep compatibility; introduce explicit versioned submission/publication commands                                                                    |
| `/v1/uploads` accepts image bytes; `/v1/media/{id}` serves stored derivatives | Retain existing artwork references while adding upload sessions, object storage and separate private evidence scopes                                |
| `/v1/intakes` and `/v1/ops/intakes/{id}` combine vault/RePool                 | Introduce custody transfers, offer acceptance and pool-admission commands with separate state                                                       |
| `/v1/credits`, `/v1/settlements`, `/v1/creator/{org}`                         | Add pagination, explicit units, org scope, recipient status and attribution/payable projections                                                     |
| `/v1/orders/{id}/demo-payment` and locally simulated refunds/releases         | Preserve demo-only behavior; these actions already reject Stripe orders. Add provider refund/dispute and payout commands with audited authorization |
| `/v1/ops` returns permission-filtered aggregate queues                        | Preserve current warehouse/rights/finance isolation while splitting into paginated independent endpoints                                            |

Current payment endpoints are `GET /v1/payments/config`, `POST /v1/orders/{id}/stripe-checkout`, `GET /v1/orders/{id}/payment-status` and `POST /v1/orders/{id}/cancel-payment`. Organization invitation/member routes and versioned intake offer actions also exist; extend them instead of introducing duplicate workflows. A future `/v1` target endpoint in the table below is not evidence of a missing current workflow.

Use `/v1`, OpenAPI, cursor pagination, stable opaque IDs, UTC timestamps, explicit units/currency, and typed errors. Prices/fees/eligibility are server-authoritative. Mutating requests that can duplicate financial or inventory effects require `Idempotency-Key`; identical keys with different payloads return conflict. Record client-provided expected versions for conflict detection.

| Area                | Example endpoints                                                                                               | Authorization / invariant                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Account/workspaces  | `GET /v1/me`, `GET /v1/me/organizations`, `POST /v1/organizations/{id}/invitations`                             | Membership and invitation permissions                                           |
| Catalog             | `GET /v1/catalog`, `GET /v1/collections/{id}`, `GET /v1/assets/{id}`                                            | Public projection only; no private owner identity                               |
| Publishing          | `POST /v1/collections`, `POST /v1/collections/{id}/submit`, `POST /v1/collections/{id}/publish`                 | Draft owner, reviewer separation, approved version and rights scope             |
| Media               | `POST /v1/uploads`, `POST /v1/uploads/{id}/complete`                                                            | Signed short-lived upload, file constraints, scan before publication            |
| Listings            | `POST /v1/listings`, `PATCH /v1/listings/{id}`, `POST /v1/listings/{id}/withdraw`                               | Ownership/sell authority, certification/custody policy, item not sold/reserved  |
| Purchase            | `POST /v1/quotes`, `POST /v1/checkouts`, `GET /v1/orders/{id}`                                                  | Server totals, valid quote, inventory reservation, authorized order participant |
| Fulfillment         | `POST /v1/orders/{id}/shipments`, `POST /v1/orders/{id}/return-requests`                                        | Allowed state and appropriate buyer/operator role                               |
| VIA                 | `POST /v1/authentication-requests`, `POST /v1/assessments/{id}/decisions`                                       | Request ownership; authorized reviewer; final decision locked                   |
| Certificates        | `GET /v1/certificates/{id}/verify`                                                                              | Public safe projection, validity status, no sensitive evidence URLs             |
| Custody             | `POST /v1/custody-intakes`, `POST /v1/custody-intakes/{id}/receive`, `POST /v1/assets/{id}/withdrawal-requests` | Receiver/operator role; explicit ownership or delegated authority               |
| RePool              | `POST /v1/repool/quotes`, `POST /v1/repool/intakes`, `GET /v1/repool/intakes/{id}`                              | Quote expiry, final inspection, rule version and accepted terms                 |
| Financial views     | `GET /v1/me/credits`, `GET /v1/seller/settlements`, `GET /v1/creator/attribution`                               | Separate balance units and permissions                                          |
| Operational finance | `GET /v1/ops/reconciliation`, `POST /v1/ops/adjustment-requests/{id}/approve`                                   | Finance-only, dual control where material; no journal-line editing              |
| Provider events     | `POST /v1/webhooks/{provider}`                                                                                  | Signature verification and durable deduplication                                |
| Later channel APIs  | `POST /v1/devices/{id}/events`, `POST /v1/live-sessions/{id}/allocations`                                       | Device identity or host authorization; shared inventory constraints             |

Error bodies include `code`, safe `message`, `field_errors`, `retryable`, and `correlation_id`. Examples: `INVENTORY_CONFLICT`, `QUOTE_EXPIRED`, `PAYMENT_PENDING`, `CERTIFICATE_INELIGIBLE`, `RIGHTS_SCOPE_INVALID`, `CUSTODY_NOT_CONFIRMED`, `PAYOUT_RESTRICTED`. UI copy maps these codes to next actions.

Policy snapshots include fee schedule, sale terms, privacy/consent version, custody/title conditions and any beneficiary agreement. A later rule change applies prospectively; it must not silently change a paid order.

## 5. Lifecycle state machines

These are target lifecycles. The pilot has fewer states and combines payment/fulfillment in `orders.status`; migrate to separate payment, shipment, custody and settlement aggregates without rewriting historical events. In particular, today’s simulated `settlements.released` must not be reinterpreted as a confirmed bank payout.

| Aggregate         | Main states                                                                            | Exceptional paths                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Collection        | `draft → submitted → approved → production → stock_ready → published → archived`       | `changes_requested`, `rights_hold`, `rejected`; amendments create a new version                                     |
| Assessment        | `requested → received → inspecting → approved/rejected/inconclusive`                   | Reassessment creates a new record; issued certificate can be superseded/revoked                                     |
| Listing           | `draft → active → reserved → sold`                                                     | Withdrawn, quarantined, or reservation released; no edits to accepted order price                                   |
| Payment           | `created → requires_action/processing → succeeded`                                     | Failed, canceled, refund pending/refunded, disputed; capture status is distinct where authorization/capture is used |
| Order             | `pending_payment → paid → fulfillment_pending → fulfilled → completed`                 | Canceled, return requested, return received, partially/refunded, disputed; payment and shipment states are separate |
| Custody transfer  | `requested → authorized → dispatched → received → accepted`                            | Missing, damaged, identity mismatch, rejected, quarantine                                                           |
| Settlement        | `calculated → held → releasable → transfer_submitted → transferred → payout_confirmed` | Provider failure, compliance hold, reversal, recovery required                                                      |
| RePool intake     | `quoted → accepted_by_user → awaiting_receipt → inspecting → approved → admitted`      | Requote requiring consent, rejected/returned, quarantine; credits only on final accepted transaction                |
| RePool membership | `eligible → allocated → exited`                                                        | Suspended, withdrawn, reworked, retired; preserve reason and authority                                              |

Transitions are explicit commands with preconditions and authorized actors. Asynchronous messages request transitions; they do not force invalid state progression. Provider success arriving after a local timeout triggers a reconciliation path.

## 6. Purchase transaction and race handling

```mermaid
sequenceDiagram
  participant U as Buyer
  participant A as API
  participant D as Database
  participant P as PSP
  participant W as Worker
  U->>A: Checkout with quote and idempotency key
  A->>D: Lock inventory; validate; create reservation/order/attempt
  D-->>A: Commit pending payment
  A->>P: Create payment with durable attempt key
  P-->>U: Hosted payment / authentication
  P->>A: Signed payment event
  A->>D: Persist unique webhook inbox event
  A-->>P: Acknowledge receipt
  W->>D: Validate state; post journal; confirm paid allocation; outbox
  D-->>W: Commit
  U->>A: Retrieve authoritative order status
  A-->>U: Paid, pending, or action required
```

Reserve unique items with row locking or an atomic conditional update plus uniqueness constraints. Quantity stock uses a transactional available-minus-reserved check. Never trust search availability or a browser timer.

Reservation expiry must coordinate with in-flight payments. Before returning stock, resolve or cancel the pending payment where possible. If a success arrives after stock has been legitimately reassigned, record funds received and start a refund/exception; never sell the item twice. Retain a durable attempt so a crash between provider creation and response can be recovered using the provider idempotency key/reference.

The implemented test adapter uses hosted card Checkout and an exact persisted USD payload. Current Stripe reservations are 35 minutes; provider retrieval decides whether cancellation/expiry may release inventory and credit holds. A zero-cash session requires authoritative completion with `no_payment_required`. Success URLs never establish payment. These are implementation choices to revalidate before live operation, not terms specified by the PDFs.

Add an operational `requires_review` case for the pilot's very old ambiguous creates and paid inventory exceptions: assign owner/deadline, freeze affected resources, retrieve provider evidence, choose authorized completion/refund/correction and record one resolution. A timeout cannot independently release stock or create a second charge. Local idempotency records must survive provider key expiry; the pilot stops recreating an ambiguous attempt after 23 hours. Stripe API v1 may prune keys after at least 24 hours. [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests)

Initially restrict payment methods to those whose confirmation/cancellation behavior fits scarce inventory. Add slow asynchronous methods only after defining longer reservations and late-success handling.

## 7. Ledger, fees, credits, and accounting controls

Use an append-only journal with immutable business references and balanced postings. A finance-approved chart of accounts and revenue-recognition policy must precede live money movement. The examples below illustrate architecture, not the final accounting policy.

For a simplified $100 custodial resale with a $10 platform fee and no tax/shipping/royalty:

| Event                                | Debit                                 | Credit                                       |
| ------------------------------------ | ------------------------------------- | -------------------------------------------- |
| PSP confirms collection              | PSP clearing $100                     | Order funds liability $100                   |
| Sale becomes eligible for settlement | Order funds liability $100            | Seller payable $90; platform fee revenue $10 |
| Seller transfer settles              | Seller payable $90                    | PSP clearing $90                             |
| PSP processing fee assessed          | Processing fee expense, actual amount | PSP clearing, same amount                    |

Tax, shipping, creator/channel obligations, platform-owned inventory cost, disputes and reserves add distinct entries. A refund reverses the correct original allocations and records unrecovered external transfers; it does not erase history. Provider and bank timing differences remain explicit reconciliation items. Revenue treatment for platform-owned sales differs from agency/consignment commissions and requires finance approval.

Each posting has a unique business-effect key, such as `(order_id, settlement_version, effect_type)`. Serialize postings that consume balances or reserved funds. Apply corrections through reversible operations with supporting evidence.

Credits use a separate balanced unit ledger with issue, hold, consume, release, reverse, and approved expiry events. The economic obligation associated with credits also needs a finance-approved fiat accounting treatment; a unit ledger alone is not sufficient. Preserve grant origin and scope to prevent promotional or returned credits from becoming seller cash. Do not assume a USD conversion rate or expiration term absent an approved policy. A refund returns each tender to its appropriate original rail and records any legally required exception.

The fee engine takes seller/issuer agreement, channel, asset issuance mode, certification service, tax basis and policy version. It produces a reviewable allocation, fee disclosures and payable eligibility. Rates in the deck are model assumptions; do not hard-code the $15 pack economics as the universal schedule.

## 8. Financial and operational reconciliation

Extend current test-session reconciliation into independent reconciliations for PSP charges/refunds/disputes, connected-account transfers and payouts, internal journal balances, bank movements, credit obligations, and physical inventory. Match by stable provider/business IDs and amounts, not fuzzy timestamps alone. Persist reconciliation runs, unresolved exceptions, owner, age and resolution evidence.

Daily finance workflow: fetch provider/bank statements → compare with journal → classify timing differences versus missing/incorrect entries → route cases → approve corrective entries → close the run. Operations separately compares warehouse/device counts with stock and custody records. A balanced internal journal does not prove the external cash or physical item exists.

Alert on webhook backlog, stale unsettled orders, negative available balances, unmatched payouts, duplicate asset identifiers, revoked certificates on active listings and overdue custody transfers. Staff must be able to freeze an affected listing, seller payout or credit account without taking down unrelated commerce.

## 9. Trust and data implementation

VIA v1 is a documented human review workflow supported by image quality checks, duplicate-image flags and batch lookups. Record reviewer identity, evidence source, assessment criteria and disagreement handling. AI suggestions never silently become a certification decision.

For future recognition models, build a permissioned, labeled dataset split by item/batch to avoid leakage. Evaluate false acceptance, false rejection, uncertainty, category and capture-device performance. A model version can be promoted only after a domain-specific threshold and escalation policy are approved. Use shadow mode before automation; an uploaded photo alone cannot establish all physical authenticity attributes.

PulseRate v1 stores raw observations with source permissions and quality flags. Publish a reproducible methodology using suitable comparable cohorts, robust summary statistics, recency and sample sufficiency. Exclude nonfinal, self-dealing and refunded trades; retroactive exclusions produce new snapshots. The UI consumes value/range, confidence, sample count, as-of time and methodology version rather than a bare number.

IFCI v1 records attribution and draft signals. It does not pay a formula that the business has not defined. Before automated direct payments, require approved beneficiary contracts, qualifying trade definition, total allocable amount, score version, rounding, exclusions, caps and refund recovery. Store agreement-derived payables separately from observational scores.

Verified external completed sales belong in a separately sourced observation lane; they do not create PixUP orders, GMV, title events or payables. Record source permission, evidence, deduplication and quality/finality checks before PulseRate inclusion (BP pp. 12, 39; D15).

Shadow VACV/FPCR reporting must expose unpriced assets, stale comparables and rule versions. Simulate changing turnover, prices, chargebacks and reserve funding; do not infer financial safety from target ratios alone.

### 9.1 Registry and issuance details (R01–R04)

Add structured `ip_entities`, `rights_agreements`, `collection_versions`, `variants`, `production_batches`, `sealed_packs`, `pack_contents`, `custody_transfers` and `sell_authorities` as needed. These are proposed additions; equivalent existing records should be extended rather than duplicated.

- Sports fields: athlete, team, league, season/year, set, manufacturer, card number, parallel, autograph/relic attributes and language. K-pop fields: artist/group/member, album/era, event/store variant, issuer, release, language and edition. A variant is not a physical specimen.
- Record agency supplier/invoice evidence separately from rights to create a new licensed edition. A license includes territory, channel, term, production quantity and beneficiary references. A creator-facing form cannot assign its own approved issuance authority.
- Preserve title owner, custodian and sale/governance authority independently. Transition from the pilot’s user-only `owner_id` to a validated user-or-organization owner model; record the responsible actor separately. `platform_owned` is not an issuance mode: an agency card can later become PixUP-owned through buyback.
- Give each sealed pack and production batch stable identity before channel allocation. Register known contents privately; where third-party sealed contents are unknown, register specimens at witnessed opening and link them to the pack. Record the opening, its order and evidence without inventing earlier authentication. BP p. 3 explicitly starts with unverified packs. Source registration, authenticity outcome and condition grade require distinct fields and public labels. The pilot still publishes assessed specimens; add raw sealed-pack sale eligibility as a separately approved increment. A sealed-pack primary sale and certified secondary resale have different eligibility rules; a card needs current VIA eligibility before RePool admission.

### 9.2 VIA independence and evidence (R03)

VIA certification establishes authenticity eligibility; grading records condition. Store both results and uncertainty, criteria version, reviewer, capture method, batch/optical checks and evidence hashes. The current intake grade selector and seeded stock assessments are workflow demonstrations, not validation of physical authenticity. Source: BP pp. 4, 33, 39; Pitch p. 6.

Separate issuer, warehouse, reviewer and finance permissions. Prevent reviewers from approving their own inventory/issuance; require an independent review path for platform-owned or own-issued stock. VIA fees are fixed service-order fees under an approved schedule, independent of sale price, resale commission or the review outcome. Apply identical assessment and governance criteria to own-issued and third-party stock. Add issuer/affiliate conflict declarations and an independent assignment/escalation path; the existing permission split alone does not prove institutional independence.

Introduce evidence access logs, immutable assessment versions, certificate key IDs/signatures, independent checkpoints and key rotation/revocation procedures. QR possession identifies a public record; it does not prove physical ownership or authentic custody. C2PA media-manifest interoperability is a separate validation task, not evidence that the physical item or its rights are genuine.

### 9.3 RePool, VACV, FPCR and 6Re (R05/R11)

RePool must become a governed custody pool, extending today’s buyback-only flow. Support supply origin `buyback`, `consignment`, `agency_surplus` and `issuance_surplus`. Admission requires current VIA, confirmed receipt, an authorized custody/governance agreement and policy eligibility. Consignment leaves title with the consignor; accepted buyback transfers it according to the agreed terms. Custody alone does not grant permission to destroy or rework property. Source: BP pp. 5, 12, 37, 39.

Represent membership and actions independently: `pool_memberships`, `repool_offers`, `offer_acceptances`, `governance_cases`, `governance_decisions`, `valuation_snapshots` and `reserve_movements`. Record actor, input signals, policy version, consent/authority, evidence and effects. Admission/exit and credit issue happen atomically where they belong to one business effect. An item can be vaulted without being admitted to RePool or counted in VACV.

Own-issuance concentration is an admission control, not just a chart (BP pp. 4, 40; R13/D12). Store immutable issuance affiliation independently of present ownership. Product/governance must specify count/value/cohort denominator, threshold, sampling time and breach handling. Evaluate concurrent admissions transactionally so two individually valid requests cannot jointly exceed a limit. Use the same pruning parameters for own-issued and third-party stock; preserve policy/evidence on every decision. Own-issued pool admission stays disabled until this rule is approved; shadow reporting may proceed.

6Re uses the BP’s names **ReGra, ReGlo, ReFin, ReMix, ReAsc and ReFac**. The PDF defines only a collective upgrade/conversion/retirement framework, with circulation interval, PulseRate percentile and VIA status as signals. Product/operations must define each action’s physical procedure, consent, title effect, costs and eligibility; engineering must not invent expansions or destructive automatic rules. Start with recommendation → reviewed case → authorized work order → evidence of completion → reassessment/replacement lineage or retirement. Retired identities remain in history and cannot be relisted as unchanged originals.

Shadow VACV sums eligible, currently custodied pool specimens using a compatible, sufficiently fresh PulseRate snapshot. Preserve currency, cohort, as-of time, confidence and excluded/unpriced counts; no usable quote means “unpriced,” not zero. Exclude seller-held goods, shipped/withdrawn stock, revoked eligibility and duplicate identities. VACV is a custody valuation measure, not revenue, market capitalization, available cash or a guaranteed exit price.

The BP proposes a bottom-20%-median/all-assets-median ratio of 0.25–0.35, density of 1.3–1.8×, and annual long-tail exits of 5–12%. These are shadow comparison bands; density’s denominator/time window and cohort rules need definition before calculation. FPCR’s proposed 5% sale-exit allocation and 60% FPCR/VACV coverage require approved funding source, custody/control of funds, reversal treatment, valuation timing and authority before activation. Track reserve funds separately from seller liabilities, credits and revenue; a threshold must not automatically sweep excess into revenue without an approved policy.

## 10. SaaS billing and extensions

The three SaaS customer sides in BP p. 7 and Pitch p. 12 are demand (players), distribution (shops, hosts and vault partners), and supply (creators/IP). Sellers overlap these roles; three generic marketplace roles alone do not implement the subscription business. Model entitlements from the first release even if invited partners use free plans. Candidate dimensions are organization seats, active listings, collection drafts, bulk imports, analytics depth, API quota and approved channel access. Permission checks remain separate from entitlements.

When billing launches, support trial, active, past-due, grace, canceled and expired states; plan changes, invoice webhooks, prorations if selected, and usage-meter deduplication. A downgrade must preserve access to orders, records, support and earned funds. It can block new premium actions without deleting existing inventory.

Later partner integrations receive API credentials with organization scope, quotas, signed outbound webhooks, delivery logs and revocation. AI Query/Match/Route uses these same scoped APIs. Retrieved artwork descriptions or seller text never authorize privileged instructions. Any transactional agent command requires an explicit, bounded user authorization and the normal quote/payment/stock checks.

### 10.1 Billing, fee taxonomy and deferred products

Add billing accounts for both individuals and organizations, `plan_versions`, `subscriptions`, `entitlement_grants`, deduplicated `usage_events`, invoices and provider mappings. Membership benefits, partner service access and creator publishing limits must be explicit and independently testable. Do not sell priority authentication results or guaranteed RePool admission. Fees can be event-based before conversion to monthly plans; subscription revenue must be reported separately from repeat certification or consumables purchases (BP p. 34; Pitch pp. 7, 12).

A fee definition records service type, payer, payee, taxable basis, rate/fixed amount, currency, trigger, agreement and rule version. Distinguish issuance, VIA, execution, settlement, recirculation, API usage, custody and consumables. Pitch p. 7’s six fee stages and BP p. 34’s six revenue groupings are different views, not six automatic deductions on every sale. No event may accidentally charge both representations of the same service.

Genesis/prepaid collectible concepts (BP p. 10), software random draws, auctions and VIP uniform-price issuance (BP p. 6) remain separate gated products. They need specific payment/liability, disclosure, eligibility and fulfillment designs before implementation. No placeholder credit balance or random-card button should silently introduce them.

### 10.2 Channel contracts and rollout (R10)

| Channel                 | Backend increment after the web core                                                                                                                      | Pilot acceptance                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CVM                     | Device identity, location/stock freshness, slot/pack manifest, signed commands, command IDs, payment-vend saga, sensor outcomes, return-intake claim      | Duplicate command never causes a second vend; unknown outcome remains an exception rather than an automatic re-vend; deposit alone never grants credits  |
| LiveUP                  | Session/host identity, physical pack allocation, paid queue, witnessed opening, evidence/time offsets, resulting specimen registration and custody choice | Stream interruption/retry cannot reallocate the same pack; order and reveal evidence remain retrievable after broadcast                                  |
| MeetUP / retail partner | Scoped device/route tasks, replenishment and bin counts, incident evidence, location contracts and commission statements                                  | Technician sees only assigned tasks; count differences and commissions reconcile; camera evidence excludes unnecessary people data                       |
| Card show / GlowUP      | Event/channel tags, staff sales/intakes, consumables SKU/quantity stock, operating costs and feedback capture                                             | Consumables sales have fulfillment/accounting but do not count as VIA assets or VACV; offline notes cannot confirm paid ownership                        |
| GOUP                    | Organizer roles, group/participant allocations, funding deadlines, shipping shares, cancellation and fulfillment-provider handoff                         | Organizer cannot withdraw participant funds; short group/changed allocation has an approved refund path; cash and credit terms decided before activation |
| WaxUP                   | B2B customers, case-level quantities, cash wholesale invoices, partner stock, conditional consignment/buyback offers                                      | Wholesale cash receipts remain distinct from credit redemption; return eligibility and limits prevent reuse/arbitrage                                    |

All channels publish events through the same inventory/order/ledger boundaries, with `channel_id`, external reference, correlation/causation ID, schema and policy versions. Device and provider inboxes deduplicate external events; outbox delivery has retries, backoff, dead-letter handling and operator replay. Do not promise exactly-once network delivery; enforce one business effect in transactional handlers. Record actual deployment dates, uptime, stockouts, sales, costs and partner shares so the BP’s node economics can be compared with observations.

For R14, add versioned `partner_agreements` and `resource_interests` (or equivalent) for device, cards, protocol, operations and site. Each records the responsible party, resource, risk, fee/share basis, earning trigger, effective period and reversal terms. Resolve conflicts and snapshot the agreement before charging; never infer a fee from a partner's UI role. One primary sale channel plus assistance/servicing tags prevents a CVM sale also being counted as MeetUP GMV. Refunds reverse the corresponding partner allocation once; failed/unknown physical fulfillment holds any fulfillment-dependent commission.

BP p. 27 places card shows/GlowUP before CVM rollout and p. 28 describes early GOUP experimentation. Support research and approved event-tagged manual trials alongside B0–B3; full group-funding and channel products still follow B11/B12 gates. WaxUP routing may credit an originating shop under agreed customer-data permissions. Wholesale advertising/price terms require policy approval and must not set a secondary-market price floor.

### 10.3 IFCI and AI activation gates (R08/R12)

The BP’s IFCI inputs are price-discovery quality, holder diversity, holding-time structure, network spread and social activity (p. 38). Define permitted data sources, anti-self-dealing exclusions, score versions and explainable corrections. Its 50/50 major-IP/original-author discussion does not specify an executable payout formula; source contracts, allocation budget and refund recovery remain D4 decisions. Agency assets may contribute records but not automatic source distributions. If activated, source payments use per-transaction beneficiary payables; do not build a pooled investment product from the wording.

Start Query/Match/Route with read-only inventory, trust, reference-price and channel-availability tools. Return source IDs, permission-safe fields, freshness and recommendation reasons. A later route command must reference a user-approved action/quote and pass the same stock, payment and policy checks as the web client. Meter successful billable calls under an agreed definition; do not bill arbitrary retries twice. Evaluate unauthorized data access, seller-text prompt injection and recommendations for ineligible stock before public API access.

### 10.4 Metrics, cost and category contracts (R15/R16)

Keep a versioned metric registry with event basis, inclusion/exclusion, unit, time window, numerator/denominator, correction treatment and finance owner. Distinguish gross/net GMV, gross receipts, owned-stock revenue/cost/margin, agency/consignment fees, VIA services, subscription MRR/ARR, operating cash, seller/creator liabilities, credit obligations, VACV and funded FPCR. Define shipping/tax/refund treatment explicitly. Never add full transaction value to its fee income and label the sum recognized revenue. A zero or undefined denominator produces an unavailable metric, not a guessed ratio.

Track acquisition consideration, including credit-funded buybacks, production/rework, handling and loss by lot/specimen. BP p. 12's low-cost returned supply is a scenario, not a zero-cost accounting rule; p. 17's service-only language conflicts with owned-inventory margin. Finance resolves D14 before live statements. Partner deposits, debt principal and investor funding are financing/liability inputs, not sales. Node payback and DSCR remain scenario/finance reports until cash costs, debt-service terms and observation periods are approved.

The [planning index](README.md#forecast-and-metric-controls) records the deck forecasts separately. New physical categories require approved authentication, standardized condition, handling/packaging, price evidence and exit rules. Non-collectible expansion in BP p. 36 is gated by distinct legal/account/risk arrangements and the unresolved protocol licensing boundary (D16); a new category label or organization row cannot activate it.

## 11. Verification plan

The October 30 [implementation handoff](../implementation-status.md#verification) records **36 domain/database/HTTP tests, six browser journeys, typechecks and a production build passing**. Real Stripe test API checks created/retrieved/expired cash and credit-only sessions; no payment was made. Completed-payment/webhook/race tests use a fake provider, and the browser Stripe journey uses contract fixtures. Earlier external PostgreSQL checks covered the pre-004 baseline; migrations 004–005 still need multi-connection PostgreSQL validation. These checks do not establish live payments, physical operations or full accessibility readiness. This documentation revision does not rerun the application suite.

Retain those regression suites while adding the tests below to the responsible epic. Run finance/concurrency cases against separate PostgreSQL connections, not only the single-process embedded database.

| Test family       | Required scenarios                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain invariants | Debits equal credits per unit; no unauthorized title transfer; no RePool admission without custody/VIA; edition quantity caps                                                                                     |
| Concurrency       | 100 requests competing for one card; concurrent credit redemption; reservation expiry vs payment success; simultaneous payout/reversal                                                                            |
| Integration       | PSP sandbox payment/authentication/refund/transfer; out-of-order and duplicate webhooks; carrier failure; media scan rejection                                                                                    |
| Tenant/security   | Cross-tenant object IDs, role escalation, expired membership, staff scope, row-policy bypass, signed URL expiry, webhook forgery                                                                                  |
| Lifecycle         | Creator approval to sale; vaulted resale; rejected intake; custody gap/reassessment; damage return; seller restriction; royalty exclusion for agency item                                                         |
| Failure recovery  | Crash after payment creation; worker crash after journal commit; duplicate outbox delivery; queue outage; missing PSP events; partial provider refund                                                             |
| Load              | Pilot target workload plus scarce-item burst; slow provider simulation; monitor database locks, queue age and request percentiles                                                                                 |
| Recovery          | Restore backup to a clean environment, replay/reconcile external transactions, verify certificate/evidence links and balances                                                                                     |
| Device/live phase | Repeated dispense command, lost acknowledgement, sensor ambiguity, offline unit, inventory mismatch, interrupted stream allocation                                                                                |
| SaaS and fees     | Duplicate/out-of-order invoice events, membership/org entitlements, metering replay, downgrade without loss of records, VIA fee independence, no duplicate fee-stage charging                                     |
| Governance/data   | Consignment vs buyback title, concurrent own-issued concentration admission, unpriced/stale VACV exclusions, identical source rules, 6Re authority/lineage, reversed price observations, agency IFCI exclusion    |
| Partner/reporting | Multiple resource owners, agreement changes, one sale across channel/task tags, commission reversal, actual cost basis, undefined/zero metric denominators, external/test observations excluded from platform GMV |
| Migration         | Pilot IDs/history preserved, restrictive ownership backfill, clean production seed policy, demo data excluded from live reports                                                                                   |

Use unit/property-based tests for financial and stock invariants, real PostgreSQL integration tests for constraints and locking, provider contract tests, and a small number of end-to-end journeys. Avoid substituting mocked database tests for the concurrency behavior that matters.

## 12. Launch checklist and operational handoff

The controlled launch gate requires:

1. No unresolved critical authorization/security issue; staff MFA and least-privilege checks complete.
2. Paid, refunded and disputed pilot orders reconcile to provider records; credits and stock reconcile independently.
3. Unique-item contention, duplicated events, and late-payment scenarios pass with one valid financial/inventory outcome.
4. Every shipped or vaulted pilot item has sufficient identity/custody evidence and a clear exception path.
5. Finance approves fee disclosures, title/payout milestones, creator terms and reserve behavior; unapproved capabilities remain disabled.
6. Restore drill achieves agreed RPO/RTO; runbooks cover PSP outage, lost item, counterfeit claim, data incident and account takeover.
7. Support and warehouse staff complete realistic exercises for damaged return, rejected authentication, failed payout and credit dispute.
8. Product completes the frontend acceptance gates, including accessibility and recoverable failure states.

Deliver schema/migrations, OpenAPI/event specs, policy examples, permission matrix, dashboards, reconciliation procedures, evidence-retention policy, infrastructure definitions and on-call ownership with the release. The output of this workstream is an operable transaction system, not only a set of endpoints.

## 13. Next two delivery cycles

1. **Cycle 1 (B0/B1/B2/B4):** review D1–D16, finish the role/fee/metric dictionary, exercise an actual hosted test payment and provider refund, and design operator resolution for existing ambiguous attempts. Audit current invitation/staff/offer contracts; design additive rights, organization ownership and independent custody migrations. Outputs: reviewed decisions, F1 contract fixtures, provider evidence and revised estimate.
2. **Cycle 2 (B1/B2/B4/B6):** extend existing invitations with verified delivery/recovery and staff MFA; implement private evidence lifecycle, provider refund/exception workflows and physical-intake capture. Validate migrations 004–005 plus new migrations on external PostgreSQL; test account/mode-scoped replay and concurrent admissions. Pair each transition with frontend recovery states. Outputs: staging vertical slice, reconciliation evidence and operator runbooks.

Do not remove the explicit demo boundary until a separate live adapter path, production configuration checks and the paid-pilot gates are in place. Prioritize completing the physical/cash lifecycle over adding inactive channel menus or speculative automated valuations.
