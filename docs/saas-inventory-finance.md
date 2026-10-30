# SaaS billing, catalog and organization inventory

Production increment 5 adds Stripe test subscriptions, included-usage metering, structured collectible attributes, organization-scoped inventory management and independent finance approvals. Migration 010 is additive. It creates no paid plan, approved price, provider customer/subscription or inventory delegation for existing records. Existing orders, custody, credits and recovery continue to use the transaction core.

## Subscription setup and ownership

Billing remains disabled unless the operator sets `BILLING_PROVIDER=stripe_test`. The server uses `STRIPE_SECRET_KEY`, which must be a test key; live keys are rejected. Set `APP_ORIGIN` to the application origin and use a separate `STRIPE_BILLING_WEBHOOK_SECRET` for the billing destination. Never expose these secrets to the browser. The existing marketplace Checkout webhook and configuration remain separate.

The adapter uses hosted [Stripe subscription Checkout](https://docs.stripe.com/api/checkout/sessions/create) with a single monthly USD recurring item and a pinned API version, `2026-10-28.endive`. Plan metadata is attached to both the session and subscription. Provider subscription periods come from the item, following Stripe's [item-level billing period model](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end). No card data enters PixUP.

Account settings → Subscription and usage is restricted to the current workspace owner. A personal workspace represents an individual billing account; creator, merchant and platform workspaces can also have their own accounts. One current subscription is permitted per account. A subscription grants limits only: it does not grant organization membership, publishing authority, staff permissions, channel admission, authentication priority or RePool eligibility.

Operations → Billing lets finance draft immutable plan versions for the demand, distribution and supply audiences. The price, trial days, grace days and included limits are explicit operator inputs. No prices from the business model have been silently approved. Each plan requires another finance reviewer to activate it through Operations → Approvals. The plan author and request author cannot approve their own activation. Retirement also requires independent review and blocks new checkout while preserving existing subscriptions' versioned terms. New commercial terms require a new plan ID.

The seed has one staff account. Independent review requires another properly provisioned finance identity; this work does not promote demo accounts or add staff administration. The production identity/administration work remains increment 2. Tests provision temporary staff fixtures explicitly.

## Lifecycle, invoices and recovery

The owner reviews the recurring test price/terms and explicitly accepts them before being redirected to hosted Checkout. The persisted request contains the immutable provider payload and stable idempotency key. Competing or repeated requests resume the same attempt. Visiting a return URL does not grant access: the API retrieves the session, subscription and latest invoice, validates test mode, local/organization/plan metadata, customer identity, monthly price, quantity, currency and invoice ownership, then records current provider state.

| State                           | New paid-plan usage                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Pending/incomplete checkout     | Pilot limits only; resume the same hosted session                                                                  |
| Trial                           | Approved plan limits until the provider-confirmed trial end                                                        |
| Active                          | Approved limits through the recorded billing period, after validating the fully paid invoice                       |
| Past due                        | Grace only after prior paid service, using the approved grace window anchored to the failing invoice creation time |
| Grace elapsed, paused or unpaid | Pilot limits; existing data and recovery remain accessible                                                         |
| Canceled or expired             | Pilot limits; history and invoices remain accessible                                                               |

Period-end cancellation is durable and retried against the provider. The current period is preserved; canonical provider status governs termination. Plan changes use cancellation at period end followed by a new checkout after provider-confirmed termination. Immediate changes, prorations, coupons, customer credit adjustments, multi-item/multi-currency plans, subscription refunds and an embedded payment-method management/portal flow are not implemented. Payment-method/dunning recovery outside the supported checkout flow needs provider/support handling.

Invoices are scoped to the billing account and stored separately from marketplace orders, seller settlements and credit journals. They show provider due/paid amounts and status. These are test provider billing records, not a production revenue-recognition ledger, tax system or approved MRR/ARR report. No external seller payout or reserve movement follows a subscription invoice.

Configure `/v1/webhooks/billing` for `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided` and `invoice.marked_uncollectible`. Signature verification runs over raw bytes with timestamp tolerance and test-mode validation. The inbox deduplicates event IDs and rejects different contents for an existing ID. Events route reconciliation rather than directly granting access, consistent with [Stripe's asynchronous subscription lifecycle](https://docs.stripe.com/billing/subscriptions/webhooks). Out-of-order events therefore retrieve current provider truth. A local synchronization version prevents a delayed older retrieval from replacing a newer result.

The worker processes mapped inbox events and polls current subscriptions with a bounded retry interval. Unmapped events remain visible to finance and trigger backlog monitoring; they do not block mapped events. Failures preserve a sanitized error code and the original attempt. A create with no saved provider session after 23 hours is held for review rather than blindly recreated beyond the provider idempotency window. Finance can recover the **original** Checkout Session through Operations → Billing: the API retrieves it, verifies its local identity/plan metadata and reconciles provider truth before applying state. The action is audited; it cannot mark an invoice paid or change the price. Never copy a guessed session into the database or delete a held attempt to retry a charge.

Billing errors or inbox records older than five minutes feed the existing monitoring dashboard. After an outage, check provider configuration, mapped identities, pending events and sanitized errors; reconcile before diagnosing an entitlement discrepancy. Without a fresh renewal, an active/trial entitlement cannot extend past its recorded period. Grace is bounded and repeated events do not extend it.

## Included-usage metering

Monthly limits use UTC calendar months, separately from Stripe's subscription billing anniversary. There are **no metered overage charges** and no public API for clients to submit billable usage. Server-side events are deduplicated by workspace, metric and business resource and committed in the same transaction as the action. Failed actions roll back their meter entries. The shared transaction lock serializes competing attempts at the cap.

| Limit               | Meaning                                                                                                        | Local pilot fallback |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------- |
| Seats               | Current members plus outstanding unexpired invitation reservations; acceptance rechecks the current-member cap | 5                    |
| Asset registrations | New collectible registrations during the UTC month                                                             | 50                   |
| Collection drafts   | Newly created collection drafts during the UTC month                                                           | 5                    |
| Listing creations   | New listings during the UTC month, including each specimen in a collection publication                         | 20                   |
| Tool calls          | Successful unique Query/Match/Route requests across the workspace's keys during the UTC month                  | 100                  |

These are local implementation limits, not approved business plan entitlements. Stock created by controlled production intake is not charged as owner-entered asset registration; publishing its specimens consumes listing creations. Tool credentials retain their own scope, daily quota, expiry and membership checks in addition to the aggregate monthly cap.

Upgrades apply the new subscription's approved limit snapshot. Downgrades/expiry revert new activity to the pilot limits without deleting excess members, inventory, drafts, keys, orders, invoices or usage history. Existing monthly usage still counts, so an account already above the fallback cap cannot create more of that resource until capacity is available. Viewing records, withdrawing listings, refunds, custody recovery, support and privacy controls remain available. Existing records are not retroactively charged or fabricated into usage events during migration.

## Structured catalog and organization inventory

Seller studio → Organization inventory selects one current membership at a time. Owners/publishers/operators can manage authorized stock; viewers only read it. Private inventory and artwork checks consult current membership. Removing membership invalidates subsequent access; changing workspace clears private query data and resets the editor. Reads are bounded to 500 items per selected workspace in this increment; pagination remains future work.

Registering a new item in a workspace records the submitting user as title owner. Assigning an existing owned item requires an owner-authored request and an independent finance review of the exact asset, current owner, previous workspace and destination. Execution rechecks title, destination membership and listing/payment/intake/refund/channel holds. Withdraw active listings first. A stale approval cannot move changed or reserved stock.

Workspace delegation does **not** transfer legal title, rewrite old orders or redirect seller proceeds. A permitted delegate can list for the recorded owner; checkout and settlements retain that owner as seller. Ownership changes automatically clear workspace delegation, including sales, refunds and RePool transfers. A subsequent owner must authorize a fresh assignment. The user-only title model remains; true organizational title, consignment contracts, warehouse/location transfers and accounting ownership are separate roadmap work.

The category-specific attributes are:

- Sports: athlete, team, league, season, set, manufacturer, card number, parallel, language, autograph and relic declarations.
- K-pop: group/member, album/era, event/store variant, issuer, release, language and edition.
- Art: artist, medium and edition, retained for legacy demonstration inventory.
- Gaming: franchise, set, card number, language and edition, retained for legacy demonstration inventory.

Unknown or incompatible fields are rejected. Existing records keep empty attributes rather than invented metadata. Authorized edits append immutable catalog revisions, and public item details/search expose declared fields. Listing, reservation, intake, refund and channel holds prevent edits at sensitive stages. Curated price-cohort assignments freeze comparable metadata pending a data review. These declarations never set VIA authenticity/condition, change certificate evidence or grant rights; the reviewed launch-category constraints still apply.

## Independent finance approvals

The approval queue handles plan activation/retirement, existing-inventory assignment and simulated settlement release. Every request records its actor, reason, exact inputs, expiry and version. Another current finance reviewer records a decision note. Execution compares the current inputs with the approved payload, rechecks relevant authority/holds and consumes the approval in the same transaction as the effect. Both requester and reviewer finance permissions are revalidated where applicable. Request/decision/execution audits are append-only; approval scope and plan terms cannot be rewritten.

An approved action can fail a newly discovered business hold. It remains approved for the same reviewer to retry after the hold clears; changed inputs require rejection and a new request. Repeated completed execution returns the existing outcome. Pending/approved requests can be rejected independently; stale versions and self-review are rejected. The seven-day expiry bounds an unused approval.

The old settlement release endpoint now **requests** review and requires a reason. Direct service release without a valid approval fails. Approval does not bypass fulfillment, support disputes or Stripe payout restrictions. The eventual demo release still posts exactly one balanced simulated payout; Stripe seller payouts remain disabled. Existing payment/refund recovery keeps its established authorization model—this increment does not impose a second approval on every finance operation.

## Validation and remaining launch work

Backend tests cover lost/competing creates, immutable payload replay, provider identity/amount mismatch, trial/grace/cancellation, old events and delayed response races, deduplicated usage at the cap, permission separation, protected invoices, pending seat reservations, inventory title/payee preservation, structured schema/revision rules and stale finance authority. Browser journeys cover plan drafting/self-review prevention, structured workspace stock and a hosted-subscription **contract fixture**. Real PostgreSQL checks exercise migration 010, approval execution, concurrent subscription replay, invoice and entitlement serialization, metering and structured inventory.

No real Stripe subscription or charge was created during implementation. The new provider adapter is based on the official API contracts above and exercised with deterministic provider/browser fixtures; completing hosted subscription payment, renewal, dunning and cancellation against the configured Stripe test account remains an integration acceptance step. Live billing, approved commercial prices, tax/invoicing compliance, revenue recognition, subscription refunds, verified identity and external paid-pilot gates remain outstanding. See [implementation status](implementation-status.md) and [operational readiness](operational-readiness.md).
