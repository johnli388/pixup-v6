# Stripe test payment controls — item 3

Migration `012-payment-controls.sql` extends the existing Checkout/refund core with explicit partial adjustments, failed-refund replacement approvals, signed refund/dispute events, account binding, immutable external reconciliation evidence, hosted Express onboarding and gated transfers to connected **test balances**. Real-money operation remains disabled. Existing orders and immutable financial history are preserved; historical provider accounts are not guessed.

## Configuration and account recovery

Keep `APP_MODE=demo`. `PAYMENT_PROVIDER=stripe_test` requires the existing server-only test secret; live credentials are rejected. Optional `STRIPE_ACCOUNT_ID=acct_…` pins the expected platform identity. Every new payment attempt records the verified platform account and test mode. Rotating a key within that account is supported; changing accounts cannot silently move old orders into the new account.

For an existing unscoped initiated order, Operations → Payments → Payment controls requires finance to supply the **original Checkout Session ID** and an audit note. The server retrieves it using the configured account and validates order identity, amount and currency before binding. Restore the original credential if retrieval fails. Do not create replacement sessions, edit account columns or mark payments successful manually.

The original marketplace webhook endpoint now accepts these events with `STRIPE_WEBHOOK_SECRET`:

```sh
stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,refund.created,refund.updated,refund.failed,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,charge.dispute.funds_withdrawn,charge.dispute.funds_reinstated --forward-to http://127.0.0.1:4000/v1/webhooks/stripe
```

Billing retains its separate webhook/secret. Raw signatures and test mode are checked; connected-account events are rejected by this platform-charge endpoint. Events are durably deduplicated and current provider objects are retrieved before transitions. Unknown or mismatched refunds remain in the review queue. Bounded workers retry with a cooldown so one unmapped event does not block later events. No card details or provider secrets are stored in browser state.

## Refunds and disputes

Operations → Payments accepts an explicit partial-refund allocation among seller proceeds, platform fee and shipping. Finance must supply a reason; a different currently authorized finance reviewer approves the exact amount in Operations → Approvals. The seed contains one staff identity, so independent review requires separately provisioning another finance account. No default percentage or commercial refund policy is inferred.

A partial refund is a cash price adjustment: the buyer retains title and the original credit expenditure. Original allocation caps, held seller funds, current ownership, pending refunds/transfers and physical/provider holds are checked again at execution. Only canonical successful refunds post a journal and reduce held seller proceeds. A later full refund returns the **remaining cash**, reverses the remaining allocations, restores the original credits and returns title exactly once. Adjusted sales are excluded from price evidence.

Full-refund attempts retain immutable lineage. Failed or canceled provider refunds can be replaced only after canonical confirmation and independent approval. Ambiguous pending creates resume the original idempotency key; after 23 hours they require recovery of the original provider object, not a blind new attempt. A replacement uses a new local refund ID and key while preserving the old attempt. Partial adjustments cannot be added after a full-refund history exists.

Dispute events retrieve current status, amount and response deadline. Mapped pending signed dispute events immediately hold new funds movement; canonical open or lost disputes hold financial activity and sale eligibility. Winning/closing a warning can release that dispute hold, but cannot clear unrelated exceptions. This does not change ownership, reverse journals or decide a dispute. Submit evidence in the Stripe test dashboard. Evidence submission APIs, loss accounting, chargeback fees and approved liability policies remain outstanding.

## External reconciliation and transfers

Finance can retrieve a payment's current charge/refunds. Each run saves immutable expected/observed **gross cash and refund** totals plus the provider balance transaction, fee and net observation. Unknown refunds, changed outcomes or unexplained disputes create a hold. Matching runs resolve only their own reconciliation exception. Fee/net accounting, credit-liability reconciliation, bank statements, payout reconciliation and tax reporting are not implemented by this check.

Connect is opt-in, with no enabled countries by default:

```dotenv
CONNECT_TEST_COUNTRIES=US
CONNECT_TEST_TRANSFERS=false
```

`US` is an example test configuration, not an approved launch jurisdiction. Enable only countries supported by the configured platform and your intended pilot. Settings → Seller onboarding records consent and creates one durable, owner-bound Express account request. Stripe hosts the identity/bank forms. Returning to Settings does not establish readiness: **Refresh seller readiness** retrieves current capability and requirements. Lost responses retain their original request; old ambiguous creates require finance to bind the original connected account. The application does not collect banking details or claim independent KYC verification.

Set `CONNECT_TEST_TRANSFERS=true` only when testing that separate capability. Operations → Payments → Connected test balances can request a transfer for a fulfilled, third-party, cash-only sale with held seller proceeds. Execution requires a second finance reviewer, matching external payment reconciliation, available provider funds, a current ready recipient, current seller eligibility and no unresolved payment/support/physical/shipment holds. The approved request binds the exact source charge, platform, destination and amount. Recovery retrieves the original transfer or replays its durable key within the bounded recovery window.

A successful transfer posts once and releases the internal settlement. It means funds reached a connected **Stripe test balance**; it does not mean a bank payout occurred. Successful transfers are periodically retrieved again. An external reversal raises a separate `TRANSFER_REVERSED` hold and preserves the original journal/history for finance review. Ordinary charge reconciliation cannot clear this hold. Automatic reversal accounting, refunds after transfer, transfer replacement and bank payout creation/tracking are intentionally unavailable pending an approved recovery policy.

The separate payment-control worker processes bounded event/adjustment/recipient/transfer batches alongside the API. Operations monitoring exposes unresolved provider reconciliation and payment-control backlog alerts. Account changes and provider outages retain durable work; staff must restore the original scope and resolve the original objects.

## Provider acceptance and verification

`npm run stripe:controls-check` creates a $1 test fixture payment, returns $0.40 then the remaining $0.60, and validates canonical charge/refund retrieval. This check passed against the configured Stripe test API on October 30, 2026. It does not access the application database or move real funds. Backend and browser tests use deterministic fixtures for disputes and Connect; their actual hosted/provider acceptance remains outstanding.

Actual hosted payment completion still requires a human acceptance step. Stripe documents that its frontend security prevents automated testing of hosted payment interfaces; browser tests therefore cover application contracts, while this harness keeps the real hosted step manual. See [Stripe automated-testing guidance](https://docs.stripe.com/automated-testing).

```sh
npm run stripe:hosted-check -- create /absolute/private/path/pixup-hosted-probe.json
# Open the emitted Stripe test URL and complete it with Stripe test payment details.
npm run stripe:hosted-check -- verify /absolute/private/path/pixup-hosted-probe.json
# If session creation succeeded but its response was lost:
npm run stripe:hosted-check -- bind /absolute/private/path/pixup-hosted-probe.json cs_test_ORIGINAL
```

Keep the same private probe file. It records account, immutable request identity and original session/refund IDs; completed verification returns the $1 test payment and writes an evidence result. It never migrates application data. The generated return URL has no corresponding application order; use the CLI verification as the result. Do not treat a return URL or created session as completed-payment evidence. This increment has **not** recorded a completed human hosted run.

Before live enablement, finish actual hosted Checkout/authentication and Connect acceptance, approve refund/fee/chargeback/recipient obligations, implement payout/reversal and bank reconciliation, validate operational account isolation and review deployment/security/commercial gates. This implementation does not grant production approval. API contracts follow [refund guidance](https://docs.stripe.com/refunds) and [separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers).
