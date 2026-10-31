# PixUP UI and frontend development plan

Updated October 30, 2026 after reviewing all 40 pages of [PixUP-BP-J.pdf](../../PixUP-BP-J.pdf) and all 18 pages of [PixUP-Pitch-J.pdf](../../PixUP-Pitch-J.pdf), and comparing them with the implemented local pilot. Page references use PDF page numbers, including BP appendices on pages 25–40.

This is an incremental development plan for **web marketplace and invited creators first, then CVM and LiveUP pilots**, preserving the user’s selected sequence. The PDFs’ agency/CVM/LiveUP-first rollout is the business baseline; moving a moderated creator pilot forward is an explicit scope choice, not a claim that broad self-service publishing is ready. Read with the [backend plan](02-backend-development-plan.md), [architecture](01-system-architecture.md), [business decisions D1–D16](README.md#decisions-and-inconsistencies-to-resolve) and [implementation status](../implementation-status.md). The updated delivery sequence below replaces this workstream’s original greenfield schedule.

Implementation baseline reconciled October 30, 2026 through migrations **001–016**, Community Hub, display-only Operations/community/channel previews, and **Ask PixUP / PixUP Guide**. The current-pilot gap review implements shared assistant quotas, dedicated assistant route recovery, unknown-route HTTP 404s and preview isolation coverage. See the [implementation gap review](05-current-pilot-gap-review.md) for source references, verification and the remaining roadmap. Existing identity, evidence, commerce, SaaS, trust, channel and commercial-policy controls remain in place. Hosted-provider acceptance, actual hardware/carrier operation, production commercial approval and live-money readiness remain outstanding.

Internationalization increment: the persistent sidebar language selector supports English, Spanish, French, Simplified Chinese, Japanese and Korean. Main interface copy, Ask PixUP, document language, metadata and date/number formatting follow the selection while preserving forms, chat and canonical URLs. Stored content remains in its original language; advanced operational/provider copy can fall back to English. See [coverage and frontend maintenance](../internationalization.md).

## 0. PDF requirements and current UI baseline

Community Hub extension (migration 015): the [Community Hub plan](04-community-hub-development-plan.md) now has a gated member-only text implementation covering topics, posts, stories, comments, profiles, interests, notifications and scoped moderation/appeals. It reuses identity and safe catalog projections while remaining separate from commerce and provenance. See the [pilot runbook](../community-hub.md) for role/MFA setup, privacy behavior, verification and remaining rollout/media work; both rollout flags default off.

Item 1 local UI increment: Operations → Commercial exposes all seven commercial decision areas, owner references, immutable proposals, independent review, stale/expired proposal guidance and version history. Web/channel checkout and order details disclose their stored pilot terms. Production decisions remain unresolved; historical orders never imply newly recorded assent. See [workflow and boundaries](../commercial-policy.md).

### Recent implemented additions

**Ask PixUP / PixUP Guide:** `/assistant` is now a signed-in chat page, reachable through **AI assistant** in the Explore navigation and the floating **Ask PixUP** link elsewhere. It searches current public cards/seller listings, buyer references from the user's own sales, their purchase/sale orders, and curated platform help. Local search works without AI configuration. Optional AI answers require both backend configuration and the user's checkbox selection; the interface labels each answer as AI or local. This is an implemented read-only assistant, not an autonomous purchasing or account-management agent.

**Display-only previews:** Operations has sample/live switching across seven core tabs; Community has seven fictional topics, eight posts and ten replies with search and detail views; Channels has three California pilot concepts. These are separate from member content, transactional records and activated channels. They are not evidence of physical operations, member engagement or commercial readiness. See section 5 for the preview interaction rules and the [assistant runbook](../assistant.md) for setup.

### Source-to-experience traceability

R01–R16 match the backend plan so each business requirement has both a server contract and a user-visible outcome.

| ID  | Source requirement                                                                         | Frontend consequence                                                                                                                    | Delivery                  |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R01 | Continuous identity/history across channels; BP pp. 2, 6–9; Pitch pp. 2, 9                 | One item passport connects issuance, assessments, custody, sales and recirculation; expose relevant evidence without private identities | F2/F3/F5                  |
| R02 | Four issuance modes and origin participation; BP pp. 10, 17; Pitch p. 5                    | Creator onboarding, approved rights scope, edition/variant editor, proof/QC and separate sales/attribution views                        | F2                        |
| R03 | Independent VIA authentication and grading; BP pp. 4, 33, 39; Pitch p. 6                   | Explain authenticity versus condition, assessment date/validity, fixed assessment fee and reassessment/appeal actions                   | F3                        |
| R04 | Three PinUP inventory arrangements; BP p. 12                                               | Distinguish PixUP-owned, vaulted consignment and seller-held draft stock, including authority, fees and fulfillment                     | F2/F3                     |
| R05 | Governed, multi-source RePool; BP pp. 5, 37, 39; Pitch p. 10                               | Separate buyback-for-credits from custody/consignment; show provisional/revised offers, receipt, decision and return/exit states        | F3/F6                     |
| R06 | Credits are restricted ecosystem units; cash obligations also exist; BP pp. 11, 29, 38, 40 | Credits, cash payments and seller proceeds have separate labels, histories and actions; disclose scope before offer acceptance          | F2/F3                     |
| R07 | PulseRate from credible completed trades; BP pp. 4, 39                                     | Reference range, sample size, as-of time, methodology and insufficient-data states; never imply a guaranteed sale price                 | F3/F4                     |
| R08 | IFCI records versus source earnings; BP pp. 10, 23, 38–39; Pitch p. 5                      | Separate circulation observations, provisional score and contractual earnings; explain agency exclusion from payments                   | F2/F6                     |
| R09 | Player, channel and creator SaaS sides; BP pp. 7, 34; Pitch pp. 7, 12                      | Personal membership plus organization service plans, entitlement usage, billing and downgrade recovery                                  | F1 foundations/F6 billing |
| R10 | CVM, LiveUP, MeetUP, GOUP, WaxUP and events; BP pp. 13–15, 25–30; Pitch p. 9               | QR handoff, pack/reveal/order continuity, host/field tools and later community/wholesale workflows                                      | F5/F6                     |
| R11 | VACV/FPCR/6Re governance; BP pp. 37, 39                                                    | Specialist dashboards with eligibility/unpriced coverage and reviewed actions; no consumer “investment balance”                         | F4 shadow/F6 activation   |
| R12 | Human-authorized Query/Match/Route and provenance interoperability; BP p. 8; Pitch p. 11   | Explain recommendations and their freshness; preview consequences before any authorized action; inspect provenance claims precisely     | F6                        |
| R13 | Own-issued pool cap and equal rules; BP pp. 4, 40                                          | Staff concentration/conflict views with policy version; explain blocked admission; no paid-plan exemption                               | F3/F4/F6                  |
| R14 | Five resource owners and partner terms; BP pp. 15, 25, 29                                  | Agreement-scoped resource/commission statements; distinguish sales from servicing and referral attribution                              | F5/F6                     |
| R15 | Economics/valuation definitions; BP pp. 12, 15, 17–19, 34, 37; Pitch pp. 4, 13, 15         | Explicit metric units/periods/denominators, actual cost/margin and observed versus forecast views                                       | F2/F4/F5                  |
| R16 | Category, jurisdiction and entity boundaries; BP pp. 35–36, 39                             | Eligibility-aware onboarding/catalog; unavailable categories stay disabled; no unsupported legal or licensing claims                    | F0/F1/F6                  |

### Existing screens versus remaining product work

| Surface          | Existing local/test screens                                                                                                                                                                | Required next increment                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Consumer         | Discovery/catalog, item passports, price-reference panels, saved items with current visibility, certificate status and commercial quote/order disclosures                                  | Richer facets/galleries and detail metadata; calibrated price context, real-device accessibility/performance and hosted journey acceptance   |
| Account/commerce | Managed sign-in option, verification/reset links, MFA/recovery/replacement, sessions, age/privacy controls, Checkout resume, partial-adjustment status, Connect settings and billing usage | Configured provider acceptance, authenticated account linking/all-factor-loss recovery, actual shipping/returns and approved tax/refund copy |
| Creator          | Moderated draft/review/stock/publication, observational attribution, workspace invitations/ownership and private evidence                                                                  | Versioned rights/territory/expiry, variants, production proofs, draft recovery and contractual earnings                                      |
| Seller           | Structured Sports/K-pop inventory, organization delegation, intake/settlements and conditional Connect test onboarding                                                                     | Organizational title/consignment, paginated stock/imports, actual payout recovery and complete statements                                    |
| Operations       | Evidence/physical handling, payments/reconciliation, pricing/signatures, billing/finance approvals, commercial decisions, privacy/monitoring and independent access administration         | Deployed provider procedures, paginated queues, dispute/transfer-loss recovery, protected staff deployment and governance                    |
| Channels/tools   | Channel browse/purchase, CVM status, LiveUP reveal/lineage, GOUP shares, business-gated WaxUP and developer credential/query tools                                                         | Real hardware/video/fulfillment acceptance, outbound custody selection, field tasks, partner statements and evaluated model integrations     |
| Community Hub | Member-only feed, topics, stories/posts/comments, profiles, interests, notifications and moderation/recovery; separate sample browsing | Moderator coverage, staged rollout, richer media and retention/accessibility acceptance |
| Ask PixUP | Responsive chat, suggestions, live search result cards, bounded history, AI opt-in, local fallback and sign-in/error states | Live-provider/relevance validation, fuller keyboard/screen-reader testing and evaluated follow-up behavior |
| Foundation       | Next.js/React/TanStack Query, responsive shell, scoped cache cleanup, native dialogs, typed error states and CSP nonces                                                                    | Explicit feature routes, complete generated client, component fixtures, localization and broader accessibility/device coverage               |

The existing green/cream/lime visual system and sample artwork remain pilot assets, not branding established by the PDFs. Art/Gaming fixtures do not establish physical-category readiness. Demo and Stripe test behavior remain explicitly labeled: partial refunds/dispute holds, gated Connect test transfers and subscription controls now exist, while hosted provider acceptance, bank payouts and real carrier/hardware operation remain outstanding. Commercial version disclosures preserve the demo terms and 18+ baseline without implying approved production prices, tax treatment, contracts or jurisdiction launch.

## 1. Product experience

Make three actions easy to understand: discover and buy a collectible, publish a collection, and sell an item already owned. Trust information should be visible at the decision point: what the object is, who holds it, what was checked, when it was checked, what it costs, and what happens after purchase.

Use the business brands where they aid recognition, with plain-language explanations. “VIA authentication,” “Sell or recirculate,” “Price reference,” and “Creator attribution” are clearer than requiring users to learn the entire protocol vocabulary. VACV, FPCR and governance ratios belong primarily in specialist reporting. BP p. 32 explicitly advocates keeping protocol complexity beneath the consumer experience.

Deliver responsive web applications first. Mobile web supports QR entry, camera uploads, collecting and purchasing; desktop supports publishing, bulk inventory and operational queues. Native apps follow only if retention and device features justify a second product surface.

## 2. Personas and workspaces

| Persona                 | Primary needs                                                                                                          | Initial workspace                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Buyer / collector       | Discover authentic items, understand condition, pay, track orders, view collection and history                         | Consumer marketplace                                   |
| Individual seller       | Organize cards, submit to custody, set price, track sale, understand fees and payout                                   | Seller workspace linked to the same account            |
| Professional seller     | Bulk inventory, staff permissions, custody and settlement reports                                                      | Organization seller workspace; advanced imports staged |
| IP owner / creator      | Establish rights, define collection/edition, upload art, approve production, publish, understand sales and attribution | Creator workspace; invitation required initially       |
| VIA reviewer            | Inspect evidence, compare specimens, record decisions and reassessments                                                | Protected operations console                           |
| Warehouse operator      | Receive/scan/store/ship, reconcile custody, resolve mismatches                                                         | Operations console with mobile scanning views          |
| Finance / support       | Explain fees, review exceptions, resolve returns/disputes and payouts                                                  | Permission-specific operations queues                  |
| Retail partner / MeetUP | Device health, stock, tasks, commission statements                                                                     | Later channel workspace                                |
| LiveUP host             | Stream schedule, paid order queue, pack allocation, reveal evidence                                                    | Later live workspace                                   |

A user may have several roles. Provide an explicit workspace switcher, organization name, and role-appropriate navigation. Switching organizations clears private cached data. For paid launch, staff operations must use a separate authentication boundary with MFA and scoped roles; the shared app implements seven staff scopes, MFA/recovery and independent access review, while enforced deployment MFA and a separate staff deployment remain acceptance work. Paid subscription status must never grant staff permissions.

## 3. Information architecture and route evolution

Keep existing links working while splitting the current catch-all client router into explicit feature routes. The table distinguishes implemented routes from proposed extensions. Community has an explicit `/community/[[...path]]` route; Ask PixUP now has `app/assistant/page.tsx`, `loading.tsx` and `error.tsx`, with noindex metadata and dynamic rendering to preserve per-request CSP nonces. The remaining catch-all and Community routes reject unsupported URL shapes with HTTP 404 before catalog fetching; unknown resource IDs still use their existing API-driven error states. Do not expose empty future-product navigation to ordinary customers.

| Area             | Current pilot route                                                                                                 | Target extension / migration                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public discovery | `/`, `/marketplace`, `/collections`, `/collections/:id`                                                             | Add category facets, collection versions and `/creators/:slug`; preserve collection IDs and canonical URLs                                               |
| Item/passport    | `/items/:assetId`, `/verify/:certificateId`                                                                         | Keep stable; add gallery, assessment/custody details and source-linked history                                                                           |
| Checkout         | `/checkout/:assetId`                                                                                                | Preserve item entry; create/retrieve a durable checkout/order on the server and resume through `/account/orders/:orderId`                                |
| Account          | `/login`, `/identity/action`, `/account/security`, collection/saved/orders/credits/activity/settings/support routes | Preserve implemented verification/reset/MFA and Settings billing/Connect flows; add addressable authentication/recirculation history as workflows expand |
| Creator          | `/workspace/creator`                                                                                                | Add `/workspace/creator/collections/:id`, `/workspace/creator/rights`, `/workspace/creator/earnings`; old overview links to new sections                 |
| Seller           | `/workspace/seller` with Inventory/Intakes/Settlements tabs                                                         | Add addressable `/workspace/seller/inventory`, `/listings`, `/intakes`, `/orders`, `/settlements` beneath the same prefix                                |
| Organization     | Workspace selectors plus invitation acceptance, invitation/member administration in `/account/settings`             | Preserve Settings verification, owner-transfer and subscription/usage controls; extract addressable team/billing routes without duplicating workflows    |
| Operations       | `/ops` with staff tabs                                                                                              | Move to protected staff deployment with `/ops/reviews`, `/via`, `/custody`, `/orders`, `/repool`, `/finance`, `/policies`, `/audit` beneath `/ops`       |
| Physical/live    | `/channels`, `/channels/:id`, `/workspace/channels`                                                                 | Add real-provider location/live/field routes after acceptance; retain channel context and order IDs                                                      |
| Community | `/community`, following/topics/mine/saved/notifications/settings/recovery, post/member detail and `/community/samples` routes | Preserve member gates and moderation/privacy controls; sample paths remain distinct from actual post/topic identities |
| Ask PixUP | `/assistant`; **AI assistant** navigation and **Ask PixUP** floating shortcut | Dedicated route, loading/error recovery and noindex metadata; preserve account-scoped memory, result links and explicit AI opt-in; no transactional agent controls |
| Partner/API      | GOUP/WaxUP through `/channels/:id`; `/workspace/developer` for scoped tools                                         | Add dedicated group/wholesale views and partner statements only as operational contracts expand                                                          |

Operations suffixes in the table are all relative to `/ops`; seller suffixes are relative to `/workspace/seller`. Keep redirect mappings and permission-aware breadcrumbs as routes move. A missing ID must produce a useful not-found state and appropriate HTTP response; private records must not be inferred from error differences.

Public, private and held inventory need distinct recovery states. Unpublished collection stock is absent from public item/artwork/certificate, saved-item and channel projections even when a legacy listing exists; backend row-policy filtering must never turn it into a public orphan. Saved references can still be removed after access is lost. New tool results exclude held stock. Public GOUP filtering preserves original shipping allocation; the UI must use server amounts instead of dividing shipping among only the visible cards.

The current mobile drawer works as the starting navigation. Evaluate a collector bottom bar through usability testing rather than assuming the original proposal was implemented. Prioritize Discover, Marketplace, My Collection and Account; expose Sell when eligible. Creator, merchant and field tools use a workspace switcher with explicit organization context. Desktop retains persistent search and workspace navigation.

## 4. Target screen specifications

These requirements include unfinished work beyond the current screen inventory in section 0. Backend state and permission checks remain authoritative.

| Screen                  | Required content / actions                                                                                           | Important states                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Discover                | Category entry for sports/K-pop, featured collections, clear marketplace entry, creator stories                      | Empty launch catalog, personalized opt-out, unavailable region                                        |
| Marketplace             | Search, category-specific facets, price, condition, language, edition, certification, custody and availability       | No matches, reset filters, stale results, network failure                                             |
| Collection page         | Verified publisher identity, artwork, edition information, rights/availability status, variants and stock            | Preview only, upcoming, live, sold out, archived, suspended                                           |
| Item detail             | Front/back images, zoom, exact specimen, condition/date, VIA status, custody, seller, price, delivery, history       | Unauthenticated, superseded/revoked certificate, reserved, sold, unavailable, insufficient price data |
| Checkout                | Server total, fees, tax, shipping, permitted credits, receipt details, Stripe-hosted Checkout handoff/resume         | Quote expired, stock lost, authentication needed, pending confirmation, failed/retry, confirmed       |
| My Collection           | Asset grid, category filters, custody/ownership labels, history and eligible next action                             | Owned in vault, shipped, intake pending, listed, sold, disputed                                       |
| Order detail            | Timeline, payment status, delivery or vault location, receipt, return/support route                                  | Partial refund, tracking delay, lost item, disputed payment, payout unaffected by buyer display       |
| Credits                 | Available/held credits, origin, allowed redemption, activity, terms                                                  | Restricted grant, reversed grant, held credit, approved expiry if applicable                          |
| Seller inventory        | Specimen list, condition, custody, certification, listing price, import/scan, bulk drafts                            | Draft only, intake needed, certification pending, eligible to list, reserved, sold                    |
| Sell wizard             | Choose item, authority check, custody intake if needed, condition evidence, pricing, fee/net preview, publish        | Not eligible, rights dispute, changed quote, inventory conflict                                       |
| Creator editor          | Draft steps, rights upload, metadata, variants, edition size, art proof, channel/territory, commercial terms, submit | Autosaving, validation errors, changes requested, approved, production/QC, stock ready                |
| Creator dashboard       | Sales by collection, stock, approved payable, payout status, attribution with methodology                            | No sales, insufficient data, provisional score, contract not eligible, payment hold                   |
| VIA console             | Image comparison, batch/serial evidence, checklist, grade, reviewer decision and rationale                           | Inconclusive, suspected duplicate, reject, approve, reassessment                                      |
| Custody console         | Scan intake, expected vs received, photos, seal, bin assignment, shipment/release                                    | Missing/extra item, mismatch, damaged, quarantine, count discrepancy                                  |
| Finance console         | Provider vs ledger difference, order context, funds status, case owner and age                                       | Timing difference, missing posting, failed payout, recovery, approval pending                         |
| Personal membership     | Benefits, price/period/tax, current entitlement, invoices, cancellation                                              | Ineligible region, trial, active, past due, grace, canceled; existing records remain accessible       |
| Partner/creator billing | Organization payer, plan/usage, seats/API/channel access, invoice history                                            | Owner-only billing change, quota reached, downgrade, failed invoice, pending change                   |
| RePool operations       | Supply origin, title/custody/authority, offer version, VIA eligibility, admission/exit                               | Requote awaiting consent, missing evidence, consignment, ineligible, quarantine                       |
| Governance reporting    | Shadow VACV, valued/unpriced counts, freshness, policy version, 6Re review queue, reserve movements when authorized  | No-data, stale snapshot, undefined metric, approval required; no implied price floor                  |

The customer must be able to distinguish source registration, creator identity verification, licensing review, VIA authenticity, condition grading, and custody. Do not collapse them into one unexplained “verified” badge.

## 5. Critical journeys

### Buyer: discover → purchase → collect

1. Search for an athlete, team, artist/member, franchise, or series; category facets adapt to the selected collectible type.
2. Open the exact item and inspect images, grade/date, authenticity status, seller, custody and fulfillment.
3. Review the total and choose shipment or continued vault custody where supported. A displayed price reference has date, confidence and sample context.
4. Sign in or register when checkout requires an account; preserve the browsing context. Initial paid transactions require an account so history and support are connected.
5. Complete payment through the provider. Show “Confirming payment” until the backend confirms; refresh/revisit safely.
6. Show order receipt and what happens next. My Collection distinguishes a purchase in progress from confirmed ownership.
7. Offer later actions only when eligible: request authentication, sell from vault, withdraw, or request a recirculation offer.

Acceptance: the same user can resume on another device; a failed/late payment never presents ownership as confirmed; a sold item cannot be bought from a cached page.

### Ask PixUP: question → permitted results → normal workflow

1. Select **Ask PixUP** or **AI assistant**. Guests see the existing sign-in gate; accounts requiring MFA complete Account security first.
2. Ask a question or choose one of six prompts, such as “Find sports cards under $100,” “Show sellers with K-pop cards,” “Find buyers from my sales,” or “How do I sell a card?”
3. The assistant returns a plain-text answer with linked cards/help entries and, where applicable, artwork and USD prices. Seller results link to their public card listings. Buyer references and orders are limited to the signed-in user's transactions; no general buyer directory or new buyer-name disclosure is introduced.
4. Open the returned item, order or workflow page to continue. The guide does not purchase, reserve, grant credits, message members or change accounts. Current stock, prices, permissions and payment holds are checked by the normal destination flow.
5. When configuration reports AI availability, users may select **Use AI answers**. The checkbox starts off. Explain that opted-in questions, recent chat and public search results may go to OpenAI; private buyer/order result records stay local. A previous user message may still contain sensitive text the user typed.
6. Continue with a short follow-up or clear chat. Provider failures show a local-answer notice; request failures retain the unsent question for a deliberate retry. Do not treat an AI answer or a sample record as a confirmed state transition.

### Operations, Community and channel previews

| Surface | Implemented preview behavior | Boundary to preserve |
| --- | --- | --- |
| Operations | Sample records for Intakes, Publishing, Fulfillment, Settlements, Support, Reconciliation and Audit; permission-filtered statistics/queues, live/sample toggle; automatic samples when the main queues are empty and a supported tab is selected | Staff access remains required. Sample action buttons and operation modals are disabled; other tabs retain their live components. Samples do not fill individual gaps in a nonempty live workspace |
| Community | `/community/samples`, `/community/samples/topics`, topic-filtered views and `/community/samples/posts/:id`; seven topics, eight posts, ten replies, text/type filtering and sample engagement counts | Signed-in preview; separate IDs/routes; no database posts, reactions, consent or moderation decisions. Automatic preview is limited to the closed-pilot landing page or empty unfiltered Latest feed, not personal feeds/search no-results |
| California channels | Three preview cards and `/channels/:sampleId` detail pages alongside a separate **Available channels** section for actual records | No purchase controls, confirmed venue/operator/schedule, channel context, device identity, allocated inventory or gate activation |

The three channel concepts are **Arts District Collect Station** (CVM, Arts District, Los Angeles), **Santa Monica Live Collect** (LiveUP, downtown Santa Monica, Los Angeles area) and **SoMa Collector Circle** (GOUP, SoMa, San Francisco). Keep “Pilot preview” and fictional-location labels visible in both directory and detail views. Fixture code lives in `operations-samples.ts`, `community-samples.ts` / `community-sample-preview.tsx`, and `channel-samples.ts` / `channel-pilot-preview.tsx` under `apps/web/components`.

### Source registration and pack opening (R01–R03)

BP p. 3 starts with unverified sealed packs and optional subsequent certification. Show “Source registered,” “Not yet VIA assessed,” authenticity result and condition grade as distinct states. A QR lookup opens a record; it cannot claim ownership or turn an unopened pack into certified contents. The current web pilot sells assessed specimens; raw-pack sales stay gated until the backend adds the separate eligibility policy.

The local LiveUP/pack flow already links the purchased pack, witnessed opening and resulting specimens; complete real recording/stream integration and outbound custody selection. Reveal only authorized contents; retain an accessible text/evidence timeline after the stream ends. Interrupted reveals remain pending with support recovery. Offer certification, vaulting or recirculation only when the resulting specimen is eligible; an opening alone never grants credits.

Acceptance: an unverified pack has no VIA approval badge; each revealed specimen links to its source pack without invented earlier assessment dates; replaying a reveal cannot create duplicate collection items.

### Creator: invitation → rights → collection → publication

1. Accept an organization invitation and complete required business/payout onboarding.
2. Choose an issuance mode available to the organization, submit rights evidence and identify credited IP owners/authors. Explain what evidence review establishes.
3. Create the collection: category, audience/territory, edition cap, variants, language, artwork and descriptions.
4. Review manufacturing/fulfillment arrangements, costs, fees, beneficiary terms and versioned agreements. MVP uses a manual production handoff tracked in the workspace.
5. Submit for rights/content review; receive actionable change requests on exact fields/assets.
6. Approve production proof and record QC/stock intake. “Approved collection” does not imply “available to buy.”
7. Publish available approved stock and see sales, inventory, contractual earnings and separate circulation attribution.

Acceptance: interrupted drafts resume; unpublished artwork remains private; edition increases require a new approved edition/version; expired rights stop affected new issuance. Attribution scores are never displayed as guaranteed income.

### Seller: owned item → custody → listing → payout

1. Add an existing collectible by catalog lookup, scan, or photos; show any match as a suggestion until confirmed.
2. Enter specimen details and evidence. Match an existing asset only through a verified claim/transfer process; users cannot claim ownership from a public QR code alone.
3. Accept vault/consignment terms, request intake, receive packaging/shipping instructions and track receipt.
4. Resolve intake discrepancies and VIA review. Only eligible accepted stock becomes listable in the MVP.
5. Set a price; see comparable data if sufficient, fee breakdown, expected net proceeds and payout conditions.
6. Publish; view reservation/sale state and buyer fulfillment without exposing buyer data unnecessarily.
7. Review a settlement statement showing gross, fees, any approved deductions, held/releasable amount, transfer and bank-payout status.

Acceptance: seller can distinguish “sold,” “funds held,” “transfer submitted” and “paid out.” Marketplace proceeds are presented separately from nonwithdrawable credits.

### Collector: recirculation quote → intake → credits

1. Select an eligible item and request an offer showing unit, terms, expiry and any inspection conditions.
2. Explain whether the transaction transfers ownership or only grants custody/sale authority.
3. User accepts and sends/delivers the item. Display “awaiting inspection,” not a spendable balance.
4. If inspection changes the offer, require explicit acceptance of the new terms; support rejection/return.
5. Once the backend confirms final admission, show the credit grant and where it can be redeemed.

Acceptance: rejected or duplicated intake cannot produce credits; credits do not offer a cash-out action; redemption scope is visible before acceptance.

### Inventory arrangement and custody decisions (R04/R05)

| Arrangement                  | Buyer/seller explanation                                                                                            | Allowed initial action                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PixUP-owned, vaulted         | PixUP sells the physical item; approved credits may apply under current terms                                       | Fixed-price purchase; show cash/credit totals separately                                                 |
| Seller-owned, vaulted        | Seller retains title until the sale; PixUP holds the item and performs agreed fulfillment                           | Purchase with approved cash payment; seller sees consignment fees and payout conditions                  |
| Seller-held                  | Physical custody is outside PixUP; catalog entry and any past certificate do not establish current verified custody | Private inventory/draft and request-intake flow; no seller-shipped checkout in the first paid release    |
| Buyback accepted into RePool | Agreed ownership transfers on final acceptance; credits are issued under the accepted offer                         | Show title change, grant origin/restrictions and pool admission separately                               |
| Consigned into RePool        | Owner grants defined custody/governance/sale authority; title remains theirs until an agreed transfer               | Show consignment terms, allowed actions and withdrawal conditions; do not display a buyback credit grant |

Do not describe all these arrangements as “trade in.” A vault location, VIA certificate and RePool membership are separate facts. If an item leaves continuous custody or condition changes, show reassessment requirements before another eligible listing.

### Player, partner and creator subscription journeys (R09)

1. Identify the payer and beneficiary: individual membership or named organization. Display only benefits the backend can enforce; no invented plan names, prices or limits.
2. Explain period, renewal, tax/fees, usage limits and cancellation before provider confirmation. Separate a creator’s subscription bill from earnings owed to that creator.
3. Confirm entitlement only from authoritative subscription state; show pending, authentication-required, past-due and grace states.
4. Give owners access to invoices and usage. A downgrade can restrict new premium actions but must preserve orders, collected items, statements and support access.

Acceptance: an organization switch cannot show another organization’s invoices; payment completion alone cannot grant staff/rights-review permissions; retried invoice events do not briefly alternate access incorrectly. A player membership does not guarantee VIA approval, a higher collectible price or RePool acceptance.

### Specialist governance journey (R11)

Finance/operations sees an as-of snapshot with eligible pool stock, valued/unpriced/stale cohorts and the methodology behind VACV. Reviewers can inspect the three proposed 6Re inputs—circulation interval, PulseRate percentile and VIA status—and the supporting item history before proposing an action. An authorized approver sees custody authority, required owner consent, proposed physical change and expected financial effects. Completion requires evidence and new assessment/lineage where appropriate.

Use the PDF labels ReGra/ReGlo/ReFin/ReMix/ReAsc/ReFac only with approved plain-language definitions; those definitions are not yet supplied. Until rules and funding authority are approved, reserve/6Re displays are explicitly shadow reports and cannot trigger automatic deductions, destruction or promised price support. FPCR balances, if activated, are separate from seller proceeds and customer credits. Add own-issued concentration, affiliation, denominator, current threshold/policy and conflict flags (BP pp. 4, 40). Show “policy not configured” until approved and keep affected admission unavailable; do not invent a cap. Staff can compare own/third-party criteria and inspect the reason for each exit. Source: BP pp. 37, 39.

## 6. Layout and visual system

Retain the pilot’s green/cream/lime palette as the working design baseline and validate it with users. The PDFs inform the cultural-collectibles positioning; neither their presentation colors nor the current UI are an approved brand specification. Avoid an unrelated redesign while completing the workflows. Pair expressive collection artwork with quiet, readable commerce surfaces. Use generous images for browsing and denser tables in workspaces; financial and condition information should remain legible regardless of artwork colors.

Create semantic tokens for background/surface/text/border/action/focus/success/warning/error, plus typography, spacing, radii and elevation. Test actual contrast before approving token combinations. Do not encode rarity, risk or availability through color alone. Use numeric alignment for prices and clear unit labels for credits.

Extend existing components in [`apps/web/components`](../../apps/web/components) into a documented shared system. Core components: application shells, workspace switcher, search/filter controls, collectible card, image gallery, identity/authentication badges, custody label, price reference panel, provenance timeline, fee breakdown, status timeline, upload/proof editor, review checklist, data table, scanner view, empty/error state and accessible dialog.

Illustrative item-detail layout:

```text
Desktop
┌───────────────────────────────────────────────────────────────────┐
│ PixUP   Search collectibles             Sell   Collection  Account│
├──────────────────────────────┬────────────────────────────────────┤
│ Front / back / details       │ Collection · edition · serial      │
│                              │ Item name                          │
│ Large specimen image         │ VIA status · assessed date         │
│ and zoom                     │ Condition · held in PixUP vault     │
│                              │ Price + delivery/fee information    │
│ Thumbnails                   │ [Buy]  [Save]                       │
├──────────────────────────────┴────────────────────────────────────┤
│ Details    Authentication    History    Shipping and returns      │
│ Price reference: range, sample count, date, insufficient-data state│
└───────────────────────────────────────────────────────────────────┘

Mobile: gallery → item identity → trust/custody → price/delivery →
purchase action → details/history. Sticky purchase control must not
obscure content, keyboard focus, errors, or payment dialogs.
```

Design should avoid artificial countdowns, automatic repeat purchases and language implying guaranteed appreciation. Any reservation countdown reflects a real server expiry. Show final costs before commitment and offer clear support/return paths.

## 7. Frontend implementation architecture

### Build on the existing application

Retain Next.js, React, TypeScript, TanStack Query, Lucide and the shared same-origin API boundary. Today `app/[[...slug]]/page.tsx` supplies initial catalog data and `components/application.tsx` selects client views. Incrementally introduce route-specific layouts/loading/error/not-found boundaries and feature modules. Public detail/collection routes need their own server-fetched public projections, canonical URLs, metadata and image optimization; the existing initial catalog fetch does not complete per-item SEO.

Keep one shared consumer/creator/seller codebase. Extract the staff surface into a separately protected deployment before paid launch while sharing accessible UI and contracts. Separate deployments are not separate inventories or commerce engines. Lazy-load host/video/device features so later channels do not enlarge ordinary marketplace pages.

### Ask PixUP implementation and state ownership

[`assistant.tsx`](../../apps/web/components/assistant.tsx) uses `AccountGate`, `useSession`, `useData`, existing UI primitives, `CardArt` and [`packages/domain/assistant.ts`](../../packages/domain/assistant.ts). `shell.tsx` supplies the sidebar entry and floating link, while `app/assistant/page.tsx` renders the dedicated route with loading/error boundaries and noindex metadata. The floating control sits in a named navigation landmark and navigates to a full page; it is not a persistent cross-page chat overlay. The existing visual system is extended with responsive sidebar/chat, suggestion, result and composer styles in `globals.css`.

The browser reads `/api/assistant/config` and posts to `/api/assistant/messages` through the existing API proxy/session helper. Configuration reveals only `ai_available`; keys/model configuration stay server-side. The response supplies `answer`, `mode`, `notice` and at most 12 result links. Render text literally, never as raw HTML or model-generated executable links. Show the actual local/AI mode for each turn, including fallback and private-search notices.

Chat state is local to the current page: at most 20 turns, with only the last three turns (six messages) sent as context and a 2,000-character composer limit. No chat is stored in localStorage, a browser database or a server history table. Clear chat resets the view; navigation unmounts it; session-scope remounting clears another account's conversation. In-flight fetches are aborted on unmount, submissions are serialized and AI choice cannot change while a request is pending. Aborting the browser request is not a guarantee that an already-started provider call stops billing.

The implemented UI includes a labeled conversation log, pending status, keyboard-operable suggestions, visible error feedback with retained input, empty-result copy, no-provider explanation and an explicit AI data-sharing checkbox. Preserve local search when AI is disabled/unavailable. Broader screen-reader and device coverage, complex query relevance, live-provider latency and AI answer quality remain acceptance work.

### Contracts and server state

Shared response schemas already cover organizations/invitations, RePool and payment configuration/status; errors carry code, field errors, retryability and correlation ID. Legacy responses still use loose records. B2 extends these into complete OpenAPI response/error schemas; F1 generates a typed client and replaces these records feature by feature. Target contracts include:

| Projection        | Required fields / meaning                                                                                                          | UI behavior                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Item passport     | Specimen/variant/pack lineage, seller, issuance source, authenticity, grade/date, certificate validity, custody, available actions | Distinct labels and evidence links; never derive ownership from QR or grade                           |
| Eligibility       | `allowed_actions`, safe blocked reason, scope and version                                                                          | Hide irrelevant actions; explain remediable blocks; still handle server rejection                     |
| Quote/order       | Tender amounts/units, fees/tax/delivery, expiry, payment/fulfillment/return states, accepted terms                                 | Refresh totals and require reconfirmation when terms change; resume existing order after interruption |
| Settlement        | Gross, fee items, approved deductions, held/releasable/transfer/payout state and reasons                                           | Financial statement with explicit currency; “released” cannot imply bank receipt                      |
| RePool offer      | Version, expiry, offered unit/amount, inspection conditions, title effect, redemption scope and permitted next action              | Compare changed offers and obtain new consent; no spendable balance before admission                  |
| Assistant | `ai_available`; bounded message/history plus explicit `use_ai`; answer/mode/notice and typed result links, prices and artwork | Keep secrets server-side, labels truthful and private results scoped; explain fallback and unknown/no-result states |
| Price/attribution | Methodology/version, sources, sample/window/as-of, confidence, exclusions, provisional/eligible status                             | Honest insufficient-data and methodology views; distinguish reference/score from money owed           |
| Subscription      | Payer, plan/version, period, state, effective entitlements, usage and invoice links                                                | Permission-scoped billing, graceful downgrade and pending activation                                  |

Use TanStack Query for server state, scoped keys containing account/org where relevant, and invalidation after transitions. Clear private caches on logout, revocation and org switch; cancel in-flight requests so a late response cannot repopulate a previous tenant’s screen. The pilot already cancels in-flight queries, removes old private scopes and remounts private views; preserve this during route extraction. Active session refresh runs every 15 seconds and on focus, while backend authorization is immediate. Keep UI-only state local. Forms need shared schema validation, field-level backend errors, explicit save status and conflict handling; add a form library only when it reduces editor complexity.

### Sessions, uploads and recovery

Preserve HTTP-only session cookies and CSRF protection. Managed identity/recovery and staff MFA are backend increments; the UI must handle sign-in expiry without replaying an unapproved financial action. Do not place tokens, keys or private evidence in analytics or browser persistent storage.

Current image uploads send bytes through `/api/uploads`, re-encode them and store a bounded WebP. Private evidence already has resumable upload, scanning, review and database/S3 adapter flows. Preserve those references and validate configured storage/scanner behavior; extend progress, retry/cancel, scan pending/rejected states and accessible previews where incomplete. Disable submission while required upload processing is incomplete. Publishing exposes only approved artwork derivatives; rights and intake evidence remain private even when artwork becomes public. A failed form save must not force a successful upload to be repeated.

Poll authoritative status initially for payment, custody and payouts. Add server-sent events only when justified; reconnect refetches current state. Invalidate quotes and request fresh eligibility after material changes. Do not optimistically confirm ownership, credits, payout or VIA approval. Offline draft support requires a privacy decision and conflict rules; checkout, custody confirmation and credit redemption always require the server.

Preserve the server-provided payment configuration and hosted Stripe test handoff. PixUP does not collect card fields or expose the server secret. Demo confirmations stay visibly simulated; any future live mode needs explicit activation and actual backend-confirmed outcomes. Gate unsupported features from navigation and disable them on the server. Removing a demo banner is not a production integration.

Checkout/order screens must map the existing start/status/cancel endpoints to explicit states: redirecting, action on provider page, confirming, confirmed, expired/canceled and `requires_review`. Resume the same order after tab loss; retrieve status after a success or cancel return. If cancellation loses a race to payment, display the confirmed outcome. For `requires_review`, preserve the order/support reference and explain review without inviting a second charge. Zero-cash orders still wait for authoritative completion. The UI hides simulated Stripe refunds; scoped partial adjustments, refund replacement review and dispute holds now have local/test payment surfaces. External dispute-loss accounting, transfer reversal and bank payout acceptance remain outstanding. Do not display a saved-card manager or bank payout success merely because Checkout exists.

## 8. Incremental frontend delivery sequence

F0–F6 retain the original identifiers. Weeks are estimates from the next implementation kickoff aligned with B0–B12 in the backend plan, assuming two frontend/full-stack engineers plus shared design/QA. Existing screens are reusable pilot assets, not a reason to skip production state handling. Rebaseline dates after provider selection and two delivery cycles.

| Workstream                            | Window                                          | Remaining output                                                                                                                                                               | Dependencies / acceptance gate                                                                             |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| F0 Product/state audit                | Weeks 1–2                                       | Validate PDF traceability, four key journeys, inventory arrangements, fee/credit wording and physical intake expectations; research with representative users                  | B0 rules; agreed state/copy inventory and screen gaps                                                      |
| F1 UI/identity/contracts              | Weeks 1–5                                       | Extract feature routes/components and extend typed fixtures/localization; validate configured identity/email, staff administration and MFA recovery against deployed providers | B1/B2; preserve implemented scope cancellation and role checks; keyboard-complete onboarding               |
| F2 Paid commerce and creator issuance | Weeks 4–11                                      | Validate hosted payment/authentication and approved return/tax disclosures; extend structured galleries, versioned rights/proofs and creator production workflows              | B2–B5; interrupted payment resumes; changed terms require consent; reviewed stock only becomes purchasable |
| F3 Trust, seller and RePool           | Weeks 7–15                                      | Validate implemented passports/capture/incidents and Connect controls with physical operators; add consignment, payout/return statements and governed pool authority           | B6–B8; physical lifecycle and authority work; no regression in revised/expired/declined offer behavior     |
| F4 Paid-pilot acceptance              | Weeks 14–24                                     | Validate existing reconciliation, price/signature, commercial/access and monitoring screens; complete usability, accessibility, performance and deployment security evidence   | B9/B10; section 11 evidence and no unresolved critical journey blockers                                    |
| F5 CVM / LiveUP pilots                | After paid-pilot gate; indicative months 7–9    | Validate implemented QR/channel/reveal/recovery screens with real devices and streaming/fulfillment; complete outbound custody, retail statements and MeetUP tasks             | B11; interrupted/ambiguous physical outcomes resolve without duplicate purchases                           |
| F6 SaaS and partner expansion         | After validated pilot; indicative months 10–12+ | Validate implemented subscription/usage and GOUP/WaxUP/developer tools with providers; add approved partner statements, wholesale disposition and governed extensions          | B12; billing/permissions separate, audited actions and per-channel acceptance                              |
| F7 Ask PixUP acceptance | Local chat/search implementation complete; before broader AI rollout | Validate configured-provider answers, representative card/seller/buyer-reference queries, opt-in/fallback comprehension and keyboard/screen-reader behavior | B13; preserve participant-only private search, memory clearing and navigation to ordinary transaction flows |

Local billing/usage, CVM/LiveUP, GOUP/WaxUP and developer-tool screens are already implemented. F1/F5/F6 now cover route/component improvements, hosted-provider acceptance and the remaining operational contracts; they are not greenfield UI work. Ask PixUP is also implemented: F7/B13 covers acceptance and rollout rather than building the assistant from scratch, and can proceed without enabling physical-channel gates. The inherited windows are sequencing placeholders to re-estimate around those dependencies. Mock contract fixtures do not count as hosted provider validation. Frontend and backend acceptance for each feature must be reviewed together.

### 8.1 Channel and partner screen backlog

The local CVM, LiveUP, GOUP/WaxUP and developer-tool flows below have executable pilot screens. Remaining work includes actual device/stream/fulfillment integration, LiveUP outbound custody selection, field operations and partner resource statements. Keep all commercial and channel gates explicit; simulator or contract-fixture success does not establish paid production readiness.

| Product surface   | User journey and key states                                                                                                                                         | Gate before showing it to customers                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CVM consumer      | Locate node with stock freshness → scan device/pack context → sign in → confirm real order → show dispense state and receipt; failed/unknown vend routes to support | Signed device session and server stock; never show “collect your pack” from payment alone or auto-charge/re-vend an unknown outcome    |
| CVM return intake | Scan intake identity → consent/terms → deposit acknowledgment → inspection status → accepted/revised/rejected result                                                | Deposit acknowledgment does not grant credits or claim completed VIA; expose item retrieval/exception support                          |
| LiveUP viewer     | Browse session → inspect physical-pack offer → purchase → paid queue → witnessed reveal → choose custody/eligible next action                                       | Stream failure preserves order; each reveal links to the purchased pack, evidence and resulting specimen IDs                           |
| LiveUP host       | Session setup, allocated stock, paid order queue, pack scan, reveal evidence and completion                                                                         | Unpaid/canceled order cannot be opened as a fulfilled sale; controls prevent duplicate allocation; captions/text status path available |
| Retail / MeetUP   | Assigned device tasks, refill manifest, scans/counts, incident photos, maintenance history and commission statement                                                 | Scoped task access and backend acknowledgment; offline capture remains pending until synchronized                                      |
| GOUP              | Organizer creates group/terms, participants choose shares, deadline/funding/shortfall, allocation and shipping status                                               | Explicit cancellation/reallocation consent; organizer does not control a withdrawable participant wallet                               |
| WaxUP             | Case catalog, quantity/wholesale price, cash invoice/payment, shipment and conditional consignment/return request                                                   | Business account eligibility; clearly distinguish a paid wholesale order from restricted credits and conditional buyback               |
| Events / GlowUP   | Event-tagged purchase/intake and consumables checkout, staff stock/count tools                                                                                      | Consumables are quantity products, not collectible certificates/VACV; no fake completed sale while offline                             |
| AI / developer | Implemented Ask PixUP session chat and separate credential-based Query/Match/Route tools; suggestions link to cards, own transactions and help | AI provider configuration plus per-request opt-in; private results remain local; tool/channel gates are unchanged; autonomous transactions remain deferred |

Partner statements identify each contracted resource—device, stock, protocol, operations or site—its effective agreement, earning trigger, gross basis, fees/credits, held amount and reversals. Separate an operator's assigned task from a sale and from its attributed contribution. One sale must not inflate both CVM and MeetUP GMV. Show device deployment date, uptime, stockouts, actual costs and observation period next to any payback comparison (R14/R15).

Card-show/GlowUP manual research can precede CVM scale, and GOUP discovery can run early (BP pp. 27–28), alongside the confirmed web-first sequence. Use event tags and existing approved flows for authorized trials; proposed group-funding, wholesale return promises and device sales stay behind backend gates. Partner routing can retain shop attribution without exposing unrelated customer data.

Do not introduce online random draws, auctions, VIP uniform-price issuance or prepaid “genesis” products as cosmetic UI additions. Their commercial state machines and permissions are deferred backend work (BP pp. 6, 10–11). Display no purchase affordance until those contracts and operational gates exist.

## 9. Accessibility, localization, and performance

Target WCAG 2.2 AA and validate keyboard operation, semantic controls, focus management, form errors, screen-reader labels, contrast, zoom, touch targets and reduced-motion behavior. Payment recovery, image upload and workspace switching must be usable without a mouse. LiveUP later needs captions and an equivalent text order/status path. [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)

The current pilot supports English, Spanish, French, Simplified Chinese, Japanese and Korean through a shared translation catalog, browser preference negotiation and a persistent language selector. Main workflows and Ask PixUP are localized; advanced operational/provider copy retains an English fallback until its translations are added. Keep Unicode artist names and multilingual item metadata in their original form, and store content language/edition separately from the interface locale. Locale changes do not imply country/payment eligibility. Currency formatting remains USD without conversion; localized date/time formatting uses UTC, identified explicitly on timestamps. See the [internationalization guide](../internationalization.md) for coverage, maintenance and verification.

Proposed performance targets on representative mobile devices: LCP ≤2.5 seconds, INP ≤200 ms and CLS ≤0.1 at the 75th percentile; verify field data after launch. Serve appropriately sized images, reserve gallery dimensions, lazy-load deep history, paginate inventory tables, and avoid downloading live-video code on ordinary item pages. Track a route-specific JavaScript budget after the first prototype rather than choosing arbitrary bundle limits.

Search should handle athlete/artist aliases, language variants and catalog identifiers without conflating distinct editions. Start with curated aliases and structured fields; semantic search can supplement exact filters after relevance evaluation.

## 10. Required loading, error and empty states

Sign-in fields and actions remain disabled until session initialization completes, preventing pre-hydration edits from being overwritten. Commercial/identity controls now have additional implemented states: stale or historical quotes require refresh; a reviewed checkout pause blocks new reservations while existing order recovery remains available; stale/expired commercial proposals need rejection and fresh review. MFA challenges route users to Account security. Historical orders show missing commercial snapshots explicitly, without invented consent. Keep these alongside the recovery cases below.

| Situation                           | User-visible response                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item sold while browsing            | Explain unavailability, preserve the item/history page and offer related listings                                                                 |
| Payment succeeded but response lost | “Confirming payment”; retrieve existing order; do not ask for a second charge                                                                     |
| Payment needs review                | Keep existing order/reservation visible; explain review/support route; disable duplicate payment creation and unsupported manual reversal         |
| Payment truly failed                | Explain next action and whether inventory remains reserved; reuse or replace attempt under backend rules                                          |
| VIA rejected/inconclusive           | Show review outcome, reason and allowed appeal/reassessment path; never keep a green badge                                                        |
| Custody discrepancy                 | Show expected/received discrepancy and required action; pause listing/credits                                                                     |
| Price has too little evidence       | “Not enough verified sales for a reference price”; preserve seller's fixed price                                                                  |
| Rights submission needs work        | Field-specific change request, evidence guidance, saved draft and resubmit path                                                                   |
| Payout held                         | Show reason category, required action and support route without promising an unconfirmed date                                                     |
| RePool offer changed                | Show old/new terms and require acceptance; permit decline and return route                                                                        |
| Provider unavailable                | Preserve work, show safe retry/status route and support reference                                                                                 |
| Empty creator/seller account        | One next action tied to real eligibility, such as create draft or request intake                                                                  |
| Invitation expired / wrong account  | Explain expiry or addressed account mismatch; preserve safe navigation and provide a request-for-new-invitation path; never auto-grant membership |
| Assistant unavailable or disabled | Keep local search/help available; show AI configuration/fallback explanation and actual answer mode; do not pretend a model responded |
| Assistant request failure or quota | Preserve the question, show the error/wait instruction and allow a deliberate retry; prevent overlapping submissions |
| Assistant no matches/private buyer search | Show a real empty result with a clearer-query suggestion; explain participant-only buyer references without inventing people or sample matches |
| Preview content | Label sample/fictional records and disabled actions; never replace API authorization/errors with a successful-looking sample transaction |
| Organization access revoked         | Stop private data display, clear cache and return to allowed workspace selection                                                                  |

## 11. Testing and acceptance

The [current-pilot gap review](05-current-pilot-gap-review.md) records this implementation's actual verification. Earlier evidence remains in the [cross-feature review](../code-review-2026-10-30.md) and [Community Hub runbook](../community-hub.md).

Assistant browser checks cover actual card/category/budget search and seller navigation, clearing chat, retry with preserved input, explicit AI opt-in through a provider fixture, guest/sign-out isolation, MFA, noindex metadata, route error recovery, a 390-pixel viewport and automated accessibility. Preview browser checks exercise disabled Operations mutations and live/sample switching, Community filters/topic/story navigation without member writes, and all three California concepts without channel API calls or checkout. Unsupported routes are checked for real HTTP 404 status. The launcher now has a navigation landmark. Live OpenAI calls, manual screen-reader work, full browser/device coverage and actual hosted/physical-provider acceptance remain outstanding.

Use a component catalog with loading, empty, success, error, permission and long-text examples. Add focused component/form tests, API-contract validation and Playwright journeys. Exercise real payment sandbox flows and backend state transitions; screenshots alone cannot validate commerce.

| Acceptance area    | Release evidence                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Buyer              | Discover → exact specimen → checkout → confirmed order → delivery/vault status, including payment interruption and stock collision                           |
| Creator            | Draft survives reload; rights review/change request works; preview differs from available stock; publish limited to approved inventory                       |
| Seller             | Intake/rejection/approval → list → sale → understandable fee and payout statement                                                                            |
| Recirculation      | Provisional offer → receipt → inspection → accepted credits, including changed/rejected offer                                                                |
| Trust              | Public certificate handles active, superseded and revoked records; history contains no owner PII                                                             |
| Roles              | Personal and multiple-organization sessions show correct data/actions; unauthorized routes and stale tabs fail safely                                        |
| Accessibility      | Automated checks plus manual keyboard/screen-reader review of critical journeys; no unresolved critical blockers                                             |
| Responsive/browser | Mobile Safari/Chrome and current desktop Chrome/Firefox/Safari/Edge; narrow screens, zoom and slow-network cases                                             |
| Operations         | Staff can receive, assess, quarantine, refund and reconcile using the interface; reason/approval audit is captured                                           |
| Ask PixUP | Retain search/link, error/retry, opt-in, no-provider/fallback and session-clearing coverage; add live-provider relevance, adversarial and manual assistive-technology evaluations |
| Preview isolation | Samples remain labeled and nonmutating; personal empty states and live authorization errors remain meaningful; preview IDs never enter operational requests or real engagement metrics |
| Performance        | Representative catalog and image-heavy detail pages measured against targets; regression budget monitored                                                    |
| Subscriptions      | Individual/org payer distinction, renewal failure, invoice history, usage/quota states, grace/downgrade, billing permission changes                          |
| Media/rights       | Interrupted upload/save, scan rejection, draft recovery, expired rights, private evidence after artwork publication, accessible upload feedback              |
| Channels           | Unknown CVM vend, duplicate QR session, lost stream/reveal recovery, pack allocation conflict, field-task synchronization                                    |
| Partner/metrics    | Multi-resource statements, commission holds/reversals, one sale with multiple channel tags, observed/scenario separation and explicit undefined denominators |
| Governance         | Buyback vs consignment, changed offer consent, stale/unpriced VACV, separate reserve units, inaccessible unauthorized/destructive actions                    |

Run usability sessions with approximately five collectors/buyers and three to five creators/sellers before finalizing workflows, plus actual warehouse/finance reviewers for operations. This is a proposed research sample, not completed validation. Success measures include task completion, misunderstood status/fees, time to publish/list, and support needed—not only aesthetic preference.

## 12. Analytics and handoff

Track discovery-to-item-to-checkout conversion, checkout failures by cause, creator invitation-to-first-publication, intake-to-listing time, first-sale activation, successful recirculation, and repeat collecting. Correlate UI events with server-authoritative order outcomes. Do not log payment details, identity documents or private evidence in analytics. Do not add assistant prompts, answer text or private result contents to analytics. Any future assistant metrics should be content-free (mode, latency, fallback and result-link usage); fictional preview activity must remain separate from real purchases, moderation and engagement.

Separate finance metrics: GMV, platform revenue, subscription MRR/ARR, seller liabilities, credit units/obligations, creator attribution and custody valuation. Dashboard labels must not combine these into a single balance or imply collectible appreciation.

Design handoff includes approved prototypes, responsive layouts, component variants, copy, status/action mappings, permission matrix, accessibility notes, and API field/error dependencies. Frontend handoff includes tested routes, generated client integration, analytics definitions, performance results and operational user guidance. A working local pilot already exists. Handoff must distinguish reused pilot behavior, completed live integrations, remaining simulations and disabled future features; it must not describe all screen presence as production readiness.

## 13. Product language, metrics and next delivery cycles

Use plain labels in consumer flows and branded explanations where useful: **PinUP marketplace**, **VIA authentication**, **price reference (PulseRate)** and **recirculate with RePool**. A collected item’s history should demonstrate the proposition in Pitch pp. 2, 5–6; avoid copying unqualified “AI-proof,” guaranteed appreciation or industry-wide legal claims into product copy. A certificate validates a recorded assessment, not every later physical handoff.

Creator reporting separates initial sales, contractual net earnings, circulation observations and any later approved IFCI-derived payable. Show agency items as recorded-but-not-payment-eligible where applicable. The BP’s proposed 50/50 attribution split is not a configured earnings percentage. Professional dashboards distinguish platform-owned sales margin, consignment service revenue, VIA fixed fees, SaaS subscription revenue, API usage, credit obligations and custody valuation. Do not call repeat consumables/assessment purchases subscription ARR merely because the deck groups them as recurring activity.

Track meaningful outcomes alongside conversion: invitation-to-approved-stock time, custody discrepancy rate, authentication appeal outcomes, settlement delay, confirmed repeat circulation, payment recovery, support resolution and plan activation/churn when launched. CVM/LiveUP views add actual availability, completed physical fulfillment, refund/unknown-outcome rates and partner commissions. Display source/as-of/denominator and distinguish observed results from forecasts; the decks’ registration, node and GMV targets are not live dashboard data. Use the [shared forecast and metric controls](README.md#forecast-and-metric-controls); do not translate the deck’s “full-caliber” or “net revenue” into an approved accounting label without finance review. Missing value or zero denominators display “unavailable.” Cost-bearing returned inventory cannot be labeled free supply. New category/market options require backend eligibility; locale or plan changes cannot activate them.

1. **Cycle 1 (F0/F1/F4/F7 with B0/B1/B2/B4/B10/B13):** review implemented commercial/access, evidence and payment states with operators; validate configured identity/email and hosted Checkout/Connect flows; check private/held inventory and historical-policy copy. Rebaseline component/route work and provider acceptance fixtures. Include F7/B13 configuration/opt-in and private-search review using the existing assistant fixtures. Outputs: observed recovery evidence, state-to-API gaps and updated accessibility plan.
2. **Cycle 2 (F2/F3/F5/F6/F7 with backend provider/physical work and B13):** integrate approved rights/refund/tax and carrier changes, extend actual payout/dispute recovery screens, and validate subscription renewal/dunning plus real device/stream fulfillment. Preserve original order terms, offer consent and query-scope revocation. Evaluate F7/B13 live AI relevance, failure behavior, latency and accessibility; exercise preview/live separation without representing the California concepts as operating locations. Outputs: staging journeys, operator instructions and focused browser/provider acceptance records.

The immediate goal is to validate a complete, explainable paid-pilot journey from published stock through payment, custody, settlement and recovery. Extend the existing CVM/LiveUP, SaaS, GOUP/WaxUP and tool screens after their provider and commercial gates pass; governance activation remains deferred. Reuse the same asset/order history and independent approval controls throughout.
