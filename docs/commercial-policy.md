# Commercial decisions and local pilot policy

Item 1's local implementation preserves the existing demo terms and the user-approved 18+ pilot baseline. It adds an auditable review workflow; it does not decide the outstanding contracts, tax treatment, consumer obligations or jurisdiction approvals in the business plans.

## Decision register

Finance staff can open **Operations → Commercial**. The register covers all seven item 1 areas and names their planning references and external decision owners:

| Area                 | Preserved executable baseline                                                                                             | Production decision still required                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Credit redemption    | 100 credit units per USD 1, PixUP-owned item price only; no shipping, third-party proceeds, transfer or cash-out          | D2: approved redemption scope, funding/accounting, limits and payments review                    |
| Creator entitlements | Observational attribution; no automatic royalties or IFCI payments                                                        | D4: signed beneficiary rights, fee base, territory, duration, caps and authority                 |
| Seller protection    | Certified vaulted stock, or allocated CVM device custody; seller-shipped checkout remains unavailable                     | D3/D7: protection obligations, loss allocation, reserves and insurance authority                 |
| Title and payout     | Title after confirmed payment; settlement held for separate review and existing payment/custody/channel gates             | D13/D14: title terms, partner earning/reversal triggers, payout obligations and accounting       |
| Refund windows       | Existing demo reversal eligibility and Stripe test staff review; no newly invented deadline                               | D7/D9: return windows, exceptions, shipping/credit treatment and applicable consumer obligations |
| Taxation             | Test/demo USD transactions; no tax computation                                                                            | D9/D14: approved tax treatment and an implemented, validated calculation/reporting integration   |
| Jurisdiction and age | Local pilot; configured minimum age defaults to 18 and cannot be below 18; current age/terms/privacy declaration required | D9: product-specific market and launch approval; self-declaration is not identity verification   |

The existing 5% seller fee and $8 web delivery simulation remain unchanged. Channel quotes continue to snapshot their own approved local channel configuration. None of these constants establishes production commercial approval.

## Proposals and independent review

1. A currently authorized finance user selects a topic, records a statement and evidence reference, and submits against the displayed policy version.
2. A different currently authorized finance user approves or rejects the exact proposal, with a review note. The requester must still have finance authority at approval time. No reviewer is automatically created or promoted; provision a second reviewer through the existing [identity/access controls](identity-and-access.md).
3. Approval atomically appends a policy version, records the decision reference and advances the current version. Rejection records the review without changing policy. Proposed inputs, evidence, expiry, completed reviews and policy versions cannot be rewritten or deleted through normal DML.
4. Proposals expire after seven days. Approval against a superseded version fails; reject the stale proposal and submit a fresh one after reviewing current terms. Concurrent approvals against the same version yield one winner.

`record_review` only records a local review. Free-text statements and evidence references never become executable terms, approved contracts or verified external evidence. Production approval remains explicitly false, including after every topic has been locally reviewed. Updating a reviewed decision requires a new proposal; its previous record and policy versions remain available. The dashboard shows the latest 200 decisions and 100 versions; older records remain retained in the database.

Only these additional actions are executable:

- **Credit redemption:** `disable_credits` suspends redemption on new quotes; `restore_pilot_credits` restores PixUP-owned-only redemption. Both require independent approval.
- **Jurisdiction/age:** `pause_sales` pauses new quotes and uncommitted checkout; `resume_pilot_sales` resumes the local pilot. Neither action enables real-money mode, approves a market or changes minimum age.

This is a reviewed checkout control, not an immediate emergency kill switch. A pending pause has no effect until independently approved. It does not stop registration, catalog work, RePool intake, subscription activity, or completion/recovery of an already committed order. Existing operational controls remain responsible for those workflows.

## Transaction behavior

New web, CVM, LiveUP, GOUP and WaxUP quotes all pass through the shared transaction core. Each stores the current commercial policy version, full pilot terms, redemption control, reviewed decision references and applicable minimum age. Checkout rechecks current policy under a shared database lock held through reservation; approval takes the corresponding exclusive lock. A changed policy or minimum age invalidates an uncommitted quote, which must be refreshed.

The order receives the exact quote snapshot in the reservation transaction. Quote and order commercial fields are immutable. Buyer checkout screens and order details display these terms; internal proposal evidence and reviewer notes are not exposed to buyers. This snapshot records applicable operational terms, **not new evidence of contractual assent**. Existing account consent and channel confirmation requirements still apply.

Already committed orders keep their original snapshot. Idempotent checkout retries, payment confirmation, cancellation, refunds and settlement recovery continue using the existing checks and original amounts even when new checkout or credit redemption is paused. Refunds restore original credits where the existing full-refund rules require them; changing current credit scope cannot confiscate those credits. Unsupported production tax, royalty, insurance, cash-out or market activation fields are rejected by strict API schemas.

Migration **014** leaves historical order/quote snapshots null; no assent or commercial approval is fabricated. Historical orders remain recoverable and are labeled accordingly in the UI. Uncommitted historical quotes must be refreshed.

## API and deployment

All routes require a signed-in user with current finance permission; mutations retain the existing CSRF and staff MFA middleware.

- `GET /v1/ops/commercial`: current policy, seven decision owners, decision history and version history.
- `POST /v1/ops/commercial/decisions`: `{ topic, action, base_version, statement, evidence }`.
- `POST /v1/ops/commercial/decisions/:id/review`: `{ decision: "approve" | "reject", note }`.

Apply migration 014 through the migration role. Reapply `infra/database/runtime-roles.sql` to grant access to the new tables and deny policy-version mutation and decision deletion for nonowner runtime roles. Hardened startup requires migration 014. Local development migration remains automatic, but verification for this change used disposable databases only.

Verification covers approval independence and revocation, exact immutable inputs, concurrent/stale/expired decisions, unsupported activation, HTTP scope/CSRF, snapshots, legacy quote rejection, pause/replay/payment/refund recovery, and restoration of the restricted pilot controls. The PostgreSQL recovery script also exercises concurrent approval and immutability through the nonowner API role. Browser coverage checks the seven-topic register, proposal submission/self-approval denial and buyer quote/order disclosures.
