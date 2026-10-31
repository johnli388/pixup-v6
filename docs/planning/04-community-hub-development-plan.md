# PixUP Community Hub development plan

Created October 30, 2026. **Status: member-only text pilot implemented behind disabled gates; rollout and later media/public increments remain open.** This plan responds to the user’s request for a place where all users can discuss IP cards and favorite topics, exchange knowledge and experience, publish stories and leave comments. It extends the existing local pilot rather than introducing another application.

Read with the [system architecture](01-system-architecture.md), [backend plan](02-backend-development-plan.md), [UI/frontend plan](03-ui-frontend-development-plan.md), [implementation status](../implementation-status.md) and [recent code review](../code-review-2026-10-30.md). CH0–CH5 below identify this feature’s delivery phases. The original 139 backend tests and 23 browser journeys are the pre-Community baseline. Current behavior and validation are recorded in the [pilot runbook](../community-hub.md) and implementation status. The sections below preserve the development target; this reconciliation identifies the implemented subset.

## Implementation reconciliation — October 30, 2026

The requested text pilot is implemented through migration **015**. See [setup and current boundaries](../community-hub.md). CH1–CH4 now have working code for private drafts, submission/review, topics, feeds/search, stories/guides/questions, one-level comments, interests, card links, profiles, generic in-app notifications, moderation, independent appeals and scoped exports/closure. CH0 rollout decisions and CH5 operational acceptance are not marked complete by source implementation.

Implementation choices:

- A single `community_entries` table stores posts/comments with relational and depth constraints; `community_relations` stores typed private interactions. Migration 015 grants no moderator authority or consent.
- Every submitted or edited post/comment enters review. Moderators need a dedicated permission, enrolled MFA and recent verification. A successful visibility appeal returns content to pending review; it cannot silently republish a stale revision.
- The member-only, 18+ contribution baseline and separately accepted community guidelines are implemented behind `COMMUNITY_ENABLED` / `COMMUNITY_WRITES_ENABLED`, both defaulting off. General reading and new writes can be paused separately.
- Catalog references currently link individual public cards; collection links and official badges are deferred. All rendering is literal text, without automatic links, embeds or HTML.
- `/community/[[...path]]` integrates with the existing root shell/providers. Feed/search share one filtered API, own drafts use `feed=mine`, and interests share a typed relation command. These replace the illustrative endpoint/table decomposition below without changing its access boundaries.
- Community notifications use the transactional outbox and a separate worker with no commerce advisory lock. Read-time checks suppress hidden/deleted/muted reply notifications.
- Revision retention defaults to 90 days with open report/appeal holds; support closure erases authored text when existing commerce and community case gates permit it. Production retention/legal holds and scheduled case-metadata expiry remain outstanding.
- Local regression, browser and real-PostgreSQL concurrency/role coverage are added. Dedicated engagement dashboards, moderation alert thresholds, representative sustained load, operational rehearsal and member rollout remain CH5 work. Images, anonymous access, email and other subsequent increments remain unimplemented.

## 1. Product outcome and proposed pilot defaults

A collector, creator, seller or other platform member can find people interested in the same cards or IP, ask a question, share a collecting experience, tell a story and learn from replies. Participation does not require owning a card, making a purchase, belonging to a creator organization or buying a subscription.

Proposed defaults for implementation planning:

- Start with a **member-only, text-first pilot**. Every signed-in, active account can read published community content; eligible members can contribute. Anonymous visitors see an introduction and sign-in prompt. Public search indexing is a later decision.
- Carry forward the existing **18+ local-pilot declaration** for contributions, with separately versioned community guidelines acceptance. This is a proposed extension of the pilot baseline, not approval of a new audience or jurisdiction policy. Reading community rules, reporting abuse and accessing one’s recovery/export/deletion workflows remain possible when posting is restricted.
- Use personal community profiles. Creator, seller and staff badges come from current server-authorized relationships; buying a plan or writing a profile description cannot grant an official badge. Organization-authored posts are deferred.
- Keep community discussion separate from official card records: a story, comment, like or popularity count cannot certify a card, prove title, revise provenance, change a price reference, grant credits or create a creator payable.
- Topics can cover IP/franchises, sports, K-pop, collecting practices and broader interests. Discussion is not restricted to IP or cards already listed in the marketplace. Start with staff-curated topics and allow member suggestions.
- Community availability has its own gates. Pausing new commercial checkout must not silently close discussions or reporting. Community sanctions do not themselves seize inventory, block refunds or remove access to orders/support.

## 2. Scope and priorities

| Capability    | First member pilot                                                                                              | Subsequent increment                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Topics        | Topic directory, descriptions, follow/unfollow and suggested topics                                             | More taxonomy controls and reviewed community-led topic management        |
| Posts         | Discussion, question, knowledge/guide and story types; title, text, topics, draft, preview and edit             | Approved images, richer galleries and carefully scoped organization posts |
| Card context  | Optional references to existing publicly visible cards/collections; ordinary text can discuss anything relevant | Reviewed catalog/IP associations and deeper discovery links               |
| Comments      | Root comments and one level of replies; edit/delete own text; author/thread context                             | Additional reply organization only if usability requires it               |
| Discovery     | Latest feed, followed-topic feed, topic filters, content type and text search                                   | Transparent popular/helpful sorting after abuse and relevance evaluation  |
| Engagement    | One like per member/target, private saved posts, topic following and user/topic mute                            | More reactions or badges only after demonstrated need                     |
| Notifications | In-app replies to own posts/comments and moderation outcomes; preferences and deduplication                     | Opt-in topic digests and email after delivery/consent acceptance          |
| Profiles      | Explicit community display name, optional bio and a visible-post history                                        | Additional profile fields and user follows after privacy review           |
| Moderation    | Report content, review queue, hide/restore/remove, lock replies, temporary posting restrictions and appeal      | Additional automation and topic-level delegation after evaluation         |

Direct messages, live chat, private groups, video hosting, livestream transport, trading offers, community payments/tipping, rewards, auctions, paid posting and AI-generated answers are outside the first release. Do not turn discussion of a card into an unofficial checkout or authentication channel.

Example initial topics: sports-card collecting, K-pop photocards, original character/IP art, storage and preservation, collection stories and beginner questions. These are taxonomy examples, not new marketplace-category or licensing approvals.

## 3. Main journeys

### Discover and participate

1. Open Community from the main navigation and choose Latest or Following.
2. Browse a topic or search for an IP, card name or collecting question.
3. Read the post, its author’s chosen community identity, publication/edit status and replies.
4. Follow the topic, save the post privately or leave a like.
5. Accept current community guidelines and satisfy contribution eligibility before commenting or publishing.
6. Write a root comment or reply to a root comment. Use clear quote/context labels without copying hidden or deleted text into new previews.

### Publish a discussion, guide or story

1. Choose a post type and up to three active topics.
2. Write a title and body; optionally select a publicly visible card or collection from a permission-safe picker.
3. Save a private draft and preview the same safe formatting used by readers.
4. Publish or submit for review according to the author’s current moderation state. Retrying a submission after a timeout must not create a second post.
5. Edit with an expected revision. Preserve unsent changes when a newer version causes a conflict; do not silently overwrite it.
6. Delete the post through a confirmation explaining its effect on replies and retained moderation records. Public/member feeds, search and notification previews must stop serving deleted content.

### Report and resolve a problem

1. A member reports spam/scam, harassment, private information, inappropriate material, a rights concern or another explained issue.
2. Show a private receipt; never reveal the reporter to the author or other members.
3. A scoped moderator reviews the current content, limited necessary history and related reports, then records a reasoned action.
4. Notify the affected author with a safe reason and appeal route. Keep evidence, reporter details and internal notes private.
5. Route appeals to a different moderator. Topic ownership, finance access or creator status does not authorize moderation of another member’s content.

## 4. Integration and service boundaries

Keep Community Hub inside the modular Express backend and Next.js application. It owns community content and interaction records, with no journal, settlement, title or certificate writes.

| Existing capability                    | Reuse                                                                                     | Required extension or boundary                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions, CSRF, MFA and access reviews | Authenticated actors, current permissions and existing independent staff provisioning     | Add a dedicated `community_moderation` permission, MFA enforcement for moderator actions and community capability flags; never grant it to all staff automatically                                         |
| Age/privacy eligibility                | Current account closure/restriction and age-declaration checks                            | Separate community-guidelines acceptance and community-only sanctions; retain recovery/report/export access                                                                                                |
| Catalog visibility                     | Existing publication predicates and permission-safe public projections                    | Community links recheck visibility on attachment, every read and notification delivery; no private artwork or owner/workspace IDs                                                                          |
| Evidence/storage                       | Hash/size validation, quarantine, scanner, private object storage and moderation concepts | Current purposes are artwork/intake/rights/shipment/incident, so community uploads require a new purpose, access rules and delivery route; existing artwork approval is not community publication approval |
| Outbox/notifications                   | Transactional event delivery and retry mechanisms                                         | Add deduplicated community events, recipient preferences and delivery-time visibility checks; avoid storing post bodies in notification payloads                                                           |
| Telemetry and audit                    | Correlation IDs, bounded logs, metrics and reasoned operator actions                      | Record metadata, not raw stories/comments, credentials, reporter identities or image bytes, in general telemetry                                                                                           |
| Database roles                         | Separate API/worker roles and transaction-local actor context                             | Apply Community Hub row policies from its first migration and test nonowner roles, rather than relying on table-owner/PGlite behavior                                                                      |

Implemented code locations:

```text
apps/api/src/community.ts                 # Content, moderation, safe queries and notification worker
packages/domain/community.ts             # Zod contracts, limits, state and permission rules
packages/database/015-community-hub.sql   # Additive text-pilot migration
apps/web/app/community/                   # Feature route entries, consistent with app shell
apps/web/components/community.tsx         # Feed, composer, thread, profile and moderation views
tests/community.test.ts                   # Domain, HTTP and visibility regression coverage
tests/e2e/community.spec.ts               # Member/moderator and mobile browser journeys
```

The schema now includes migration 015. The text pilot extends `staffPermissions`, SQL permission constraints and the existing permission-management UI together; the access-request limit now derives from the eight-value enum. It preserves existing data and seeds no moderator privileges. Reapply runtime grants after migration and retain API/worker privilege separation.

The frontend now has a dedicated optional catch-all under `/community`, taking precedence over the original application catch-all while sharing root session/navigation providers. Installed Next.js routing guidance was consulted for this change.

## 5. Data model

| Proposed record                                        | Essential fields and constraints                                                                                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `community_profiles`                                   | `user_id`, public opaque profile ID, chosen display name, optional bio, version and timestamps; never publish account email, internal user ID or workspace membership lists |
| `community_guideline_acceptances`                      | User, guideline version and acceptance time; no automatic acceptance backfill                                                                                               |
| `community_topics`                                     | Stable ID, unique normalized slug, name, kind, description, active/archived state and ordering; member suggestions remain separate from approved taxonomy                   |
| `community_posts`                                      | Author, type, title/body, publication state, moderation state, reply-lock flag, version, timestamps and deletion marker                                                     |
| `community_post_topics`                                | Unique post/topic pair; bounded number of active topics at publication                                                                                                      |
| `community_post_links`                                 | Post plus typed asset/collection foreign key; permission-safe projections, not copied private asset metadata                                                                |
| `community_comments`                                   | Post, author, optional root-comment parent, body, state, version and timestamps; parent must belong to the same post and cannot itself be a reply                           |
| `community_revisions`                                  | Author/edit version and restricted revision content; current revision pointer and retention classification; old hidden content is never public edit history                 |
| `community_reactions` / `community_saved_posts`        | Explicit post/comment targets and unique member/target/kind constraints; saves always private                                                                               |
| `community_topic_follows` / `community_mutes`          | Unique member/topic or member/profile relationship; private preferences                                                                                                     |
| `community_reports`                                    | Reporter, typed target, category, private explanation, status and assignment; deduplicate an active report from the same reporter/target                                    |
| `community_moderation_actions` / `community_sanctions` | Scoped actor, target, action, reason, previous/new state, expiry and appeal linkage; no financial side effects                                                              |
| `community_appeals`                                    | Affected author, moderation action, statement, state and independent reviewer decision                                                                                      |
| `community_attachments`                                | Later-phase post/revision/file binding, ordering and current approval/delivery state                                                                                        |

Use enforceable foreign keys/checks rather than unconstrained polymorphic IDs. Comment-parent validation, attachment bindings and transitions need transactional checks as well as database constraints. The relation names can be consolidated during CH0, provided these invariants remain testable.

Start with PostgreSQL text search and indexed filters. Index published feed ordering `(published_at, id)`, active topics, post/comment pagination, author drafts, moderation queues and unique interaction keys. Use stable keyset cursors tied to the selected filters; cap page size and query length. A separate search service is unnecessary for the first pilot.

## 6. State, concurrency and visibility rules

Separate publication state (`draft`, `published`, `deleted`) from moderation state (`pending`, `visible`, `hidden`, `removed`). Reply locking is a separate flag. Readers receive a post only when both publication and moderation allow it; comments additionally require a readable parent post and an allowed parent comment or its deletion placeholder. Hiding/removing a root comment also hides its replies until reviewed; author deletion alone preserves otherwise visible replies beneath a tombstone. Authors can inspect their own drafts and safe moderation outcomes through dedicated views, not by bypassing the general feed filter.

- First-time contributors or flagged submissions can require review; other eligible posts may publish immediately. CH0 selects the pilot rule. A clean scan does not establish that content is appropriate or truthful.
- Editing pending/hidden content does not restore visibility. Moderator restoration rechecks the current revision, author eligibility and linked media before publishing it.
- A deleted root comment with replies becomes an anonymous “Comment deleted” placeholder. Deleted post bodies and inaccessible threads never appear in search, previews or notifications. Post deletion hides its thread from general readers; contributors retain access to their own text for export/deletion where applicable.
- Concurrent publish retries return one result using an actor/operation-scoped idempotency key and canonical request hash. Reusing a key with different content returns conflict. Validate authorization before returning a stored response.
- Use expected versions for edits and moderation decisions. Lock the post before comment creation and thread-state changes; serialize “comment versus lock/delete/hide” so a stale request cannot append to an unavailable thread. Use a consistent post-before-comment lock order.
- Enforce one like/save/follow through unique constraints and idempotent add/remove operations. Avoid increment-only counters; derive counts or maintain tested projections that handle retries, hiding and deletion without becoming negative.
- Use community row locks rather than extending the existing global commerce/channel advisory lock. Social posting must not serialize checkout, refunds or device events.
- Muted users/topics are a reader preference, not a secrecy guarantee or an account ban. Mutes suppress feeds and optional notifications; they do not pretend to make published content inaccessible to another account.
- Do not broaden member-only posts to anonymous access through a configuration toggle. Any future public mode needs explicit author audience choice/republishing and reviewed cache, search and notification behavior.

Apply the same reader visibility predicate to detail, feed, search, saved posts, profile history, counts, comment pagination, media delivery and notifications. Personal exports and recovery views use separate ownership-scoped projections: members can recover their own eligible retained text without receiving hidden content authored by others or internal moderation records. Match missing and unauthorized content with safe not-found responses. Community text must not be appended to immutable public provenance chains; content deletion and moderation retention have different requirements from financial history.

## 7. Backend API and authorization

All routes below are **proposed**, under `/v1/community`. Use shared Zod request/response schemas, the existing error envelope, CSRF/session middleware, explicit output projections and bounded pagination. Organization IDs or frontend role flags never establish access.

| API group            | Proposed commands/queries                                                                                    | Scope                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Configuration/topics | `GET /config`, `GET /topics`, `POST /topic-suggestions`, `POST /topics/:id/follow`                           | Configuration may be anonymous-safe; topic/content access follows the pilot audience; preferences are personal |
| Feed/search          | `GET /posts`, `GET /search` with topic/type/feed/cursor filters                                              | Published, visible content only; Following derives from the caller’s preferences                               |
| Draft/publish/edit   | `POST /posts`, `GET /me/drafts`, `POST /posts/:id/publish`, `POST /posts/:id/edit`, `POST /posts/:id/delete` | Eligible author only; explicit draft state, expected version and replay protection                             |
| Thread               | `GET /posts/:id`, `GET /posts/:id/comments`, `POST /posts/:id/comments`                                      | Parent visibility, thread lock and contribution eligibility rechecked                                          |
| Comment changes      | `POST /comments/:id/edit`, `POST /comments/:id/delete`                                                       | Author ownership, parent visibility/recovery policy and expected version                                       |
| Engagement           | Typed `/reactions`, `/saved-posts` and `/mutes` commands; `GET /me/saved`                                    | Caller-owned relations; validate target access and never expose other members’ saves/mutes                     |
| Profile/preferences  | `GET /profiles/:publicId`, `POST /me/profile`, `POST /me/preferences`, `POST /guidelines/accept`             | Explicit community identity and visible posts; no implicit account PII publication                             |
| Reports/appeals      | `POST /reports`, `GET /me/reports`, `POST /appeals`                                                          | Active signed-in members may report even when posting is restricted; appeals belong to the affected author     |
| Moderation           | `/v1/ops/community` queues, topic administration, content decisions, thread locks and sanctions              | Dedicated permission, verified MFA, current authority, reasons and optimistic concurrency                      |

Contribution eligibility gates creation, publication and edits; deleting one's own content, appealing a decision and exercising privacy rights use dedicated recovery authorization even when posting is restricted. Do not make a new guideline acceptance or commercial eligibility check a prerequisite for those recovery actions.

Initial proposed limits: title 140 characters, body 20,000 characters, comment 3,000 characters, three topics, five linked catalog records and page size at most 50. Set separate persistent per-account write/report quotas and IP-level abuse controls, returning `Retry-After`; choose numerical quotas in CH0 after reviewing expected use. Community participation uses abuse limits, not paid SaaS/tool entitlements.

Capability flags should separately control member reading, contribution, attachments and anonymous reading; start disabled. Emergency write pause preserves reading, moderation, reports and personal recovery actions. A media/scanner outage must disable image publication without blocking safe text participation or commercial recovery.

## 8. UI and frontend work

| Route/surface                                     | Behavior                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/community`                                      | Latest/Following tabs, post-type/topic filters, responsive feed, search and a clear create-post action                    |
| `/community/topics` and `/community/topics/:slug` | Topic directory, guidelines, follow control, topic feed and suggestions                                                   |
| `/community/posts/:id`                            | Post type/title, author profile, timestamps/edit marker, safe card links, like/save/report actions and paginated comments |
| `/community/new` and `/community/posts/:id/edit`  | Draft autosave, type/topic selection, safe preview, version conflict recovery and publish/review status                   |
| `/community/mine` and `/community/saved`          | Own drafts/published/pending/removed states, private saves and actionable recovery                                        |
| `/community/members/:publicId`                    | Chosen community profile and currently visible contributions; no private account or collection inventory                  |
| Operations → Community                            | Report/review queues, content revision context, reasons, reply locking, sanctions and independent appeal handling         |
| Existing account notifications/settings           | Reply and moderation notifications, mute/follow preferences, community profile and guideline status                       |

Reuse the existing visual system, form/error components, dialogs and session-scoped TanStack Query patterns. Add community query keys to the existing cancellation/eviction behavior on account or permission changes. Member-only server-rendered pages and API responses must not enter a shared public cache. Moderation or deletion invalidates detail, feed, search, profile and notification projections.

Keep card references compact: display only approved public title/artwork and link to the existing item/collection page. Community comments are visually labeled as member contributions, distinct from official provenance, VIA assessments and creator statements. If a referenced item becomes private, render “Linked item unavailable” without preserving its title/image in cached cards.

Use plain text or a restricted Markdown subset with the same rendering contract in preview and final views. No raw HTML, scriptable URLs, remote embeds or automatic URL preview fetching. Normal external links must be clearly identified. Do not add server-side remote image/link fetching merely to improve previews.

Accessibility acceptance includes semantic heading/thread structure, keyboard-operable actions, explicit labels, focus return after dialogs, live status for save/publish failures, pagination accessible without infinite scroll, and usable layouts at 320px width and 200% zoom. Do not announce every incoming interaction or rely on color alone for moderation state.

Required empty/error states include no followed topics, no search results, deleted/private post, closed comments, expired session, guideline/age declaration required, temporarily restricted posting, moderation pending, rejected attachment, network loss after submit, rate limit, conflicting edit and unavailable linked card. Preserve unsent text in the active editor on recoverable failures; avoid retaining private drafts in shared browser storage by default.

## 9. Moderation, privacy and media

Publish concise community guidelines covering respectful discussion, spam/scams, private information, impersonation, rights complaints and responsible attribution of sources. Knowledge posts should identify personal experience versus sourced claims; likes do not validate authenticity or expertise. Moderators can redirect transaction disputes to existing support without publishing private order information.

Moderators do not silently edit a member’s words. Hiding/removal and sanctions are reasoned actions with audit metadata. Self-reports and conflicts of interest go to another reviewer; appeals require a different moderator from the original action. Report volume alone must not trigger an irreversible removal or account-wide restriction. Start with human review and bounded spam rules; no automated model moderation decision is required for the pilot.

Choose the public display name explicitly at onboarding. Do not automatically publish the account’s existing name, email, staff identity or transaction history. Staff verification badges should describe current authority without exposing private permission lists. Member display-name changes must not invalidate author identity references.

Extend account export and closure to include community profile, authored content, private preferences and the member’s own report/appeal submissions, excluding other reporters and internal moderation notes. Define deletion/retention classes for current content, revisions, attachments, reports and action metadata before rollout. Purge personal content where policy permits; keep only the required restricted evidence under reviewed holds. Pseudonymize deleted authors without breaking reply structure. Retention periods and deletion wording are CH0 decisions, not invented legal guarantees.

Image sharing follows the text pilot. Reuse storage/scanning machinery but add community-specific ownership, revision binding and visibility checks. Permit bounded single-frame image formats, strip metadata, create derivatives, quarantine originals and reject unsupported executable/document formats. A pending, rejected, removed, unbound or purged attachment must never be retrievable through a public or community-content URL. Recheck thread and attachment status on every delivery; do not reuse permanent public artwork URLs. Apply the same rules after edits, deletion, moderation restoration and delayed worker responses.

Do not send community email in the initial pilot. In-app notification events contain target IDs and generic text; workers recheck recipients, preferences, mutes and content visibility before delivery. Avoid copying deleted/hidden content into persisted notifications. Reply notifications skip self-notification and do not notify an entire topic by default.

## 10. Phased delivery and ownership

Planning assumption: one backend engineer and one frontend engineer, with shared design/QA and an available moderator/product owner. Rough sequencing is **six to eight weeks for a text pilot**, subject to CH0 decisions and existing delivery priorities. This is an estimate, not a commitment or a replacement for the core paid-pilot acceptance work. Image sharing/public expansion are separately estimated.

| Phase                                         | Indicative window | Deliverables                                                                                                                                                  | Exit gate                                                                                                                     |
| --------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| CH0 — Product and moderation contract         | Week 1            | Confirm audience/defaults, topic taxonomy, display identity, guidelines, new-contributor review, limits, retention and moderation owner; wireframes/state map | Named owner for each decision; approved scope and acceptance fixtures                                                         |
| CH1 — Data, access and contracts              | Weeks 1–2         | Additive schema, Community permission/gates, RLS, shared Zod schemas, drafts/topics and visibility helpers                                                    | Anonymous/private/cross-author access denied under actual nonowner PostgreSQL roles; no automatic moderator or consent grants |
| CH2 — Reading and publishing                  | Weeks 2–4         | Community routes/shell, topic directory, Latest/search, draft/preview/publish/edit, safe card references and profiles                                         | Author journey works; retry/conflict behavior verified; no publication or private-card leak                                   |
| CH3 — Conversation and interests              | Weeks 3–5         | Comment/reply lifecycle, likes, saves, follows/mutes, Following feed and deduplicated in-app notifications                                                    | Retry/count invariants and comment-versus-lock/delete races pass; all surfaces honor visibility                               |
| CH4 — Moderation and privacy                  | Weeks 4–6         | Reports, queues, reasoned actions, sanctions/appeals, guidelines gating, export/closure/retention and operational dashboards                                  | Moderators can handle the complete report/appeal flow; hidden/deleted content and private reporters stay protected            |
| CH5 — Controlled pilot and expansion decision | Weeks 6–8         | Cross-role/mobile/accessibility tests, bounded load and failure exercises, moderator rehearsal and small-member rollout                                       | Pilot checklist passes and moderator coverage exists; then decide images/public access separately                             |

CH1 → CH2 → CH3 is the main dependency chain; CH4 begins with CH1 contracts and must finish before any member rollout. Preview environments use synthetic content. Do not ship a “temporary” posting feature without reporting and moderation simply because its feed is ready first.

First two implementation cycles:

1. **Cycle A:** finalize CH0, schema/permissions, API fixtures and text-first reader/composer prototypes. Deliver negative authorization tests and a runnable draft-to-visible-post slice behind disabled gates.
2. **Cycle B:** complete comments/interests and the moderation/privacy slice, then exercise the entire contributor → report → decision → appeal journey. Deliver cross-role browser evidence and a pilot operations checklist before inviting members.

## 11. Verification and rollout gates

| Test area             | Required evidence                                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access                | All account roles may participate under the same eligibility rules; no subscription requirement; guests cannot read member content; closed/sanctioned users cannot publish; reporter identities and drafts stay private |
| PostgreSQL            | New RLS works under the API role; worker permissions are explicit; pooled context resets; no hidden-parent joins, direct-ID media leaks or public-cache leakage                                                         |
| Publication           | Draft → review/visible transitions, stale edits, topic archival, hidden revisions, deleted posts and linked-card visibility changes across every read surface                                                           |
| Concurrency/replay    | One post/comment/like/save/follow per intended request; different-payload replay conflicts; simultaneous thread lock/delete and reply creates no forbidden comment                                                      |
| Moderation            | Unauthorized/self-conflicted review denied; stale decisions fail; appeal has independent reviewer; sanctions expire correctly; reporting remains available when posting is paused                                       |
| Notifications         | Replay-safe delivery, no self-notification, preference/mute enforcement, suppression after hide/delete and recovery after worker interruption                                                                           |
| Content safety        | Scriptable URLs/raw HTML/XSS attempts remain inert; no server URL fetching; bounded text/search limits; image scan and access failures when attachments are added                                                       |
| Privacy               | Explicit community profile choice, scoped export, closure/pseudonymization, revision/media retention and purge with holds; no full bodies in general logs                                                               |
| Browser/accessibility | Browse/follow, draft/publish/edit, question/reply, save/mute/report and moderator/appeal journeys; mobile keyboard, focus and readable error recovery                                                                   |
| Core regression       | Existing marketplace, commercial policies, payments/refunds, identity, evidence and channel suites still pass; community locks/workers do not stall commerce                                                            |

Use service/HTTP tests plus real PostgreSQL concurrency/RLS tests and focused Playwright journeys. Add community scenarios to CI’s separate recovery/role checks and extend restore verification to the new tables. Backup fingerprints must include all community records, while object restoration remains a separate requirement for later attachments.

Pilot go/no-go requires named moderator coverage, published guidelines and reporting/appeal access; verified privacy/media boundaries; tested write-pause and worker recovery; no unresolved critical authorization issue; accessible main journeys; and a documented rollback that disables new writes while preserving reports, personal recovery and existing records. Do not drop tables or rewrite published content as rollback.

## 12. Success measures and decisions to confirm

Track weekly readers/contributors, topics followed, question reply rate, time to first non-self reply, repeat participation, draft-to-publish completion, moderation queue age, report resolution and appeal outcomes. Distinguish unique members from repeated actions; exclude synthetic/staff test traffic. Likes and posting volume alone are not success measures. Keep community engagement out of GMV, PulseRate, IFCI payouts and seller reputation unless a separate reviewed design explicitly introduces such use.

Operational dashboards track feed/search latency, failed writes, visibility denials, queue age, notification errors, spam pressure and any effect on checkout latency. Set measurable pilot thresholds after CH0 defines expected volume and staffing; there is no forecasted community scale in this request.

| Decision               | Proposed default                                                                          | Owner / needed by                         |
| ---------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| Audience and reading   | Member-only pilot; no automatic anonymous indexing                                        | Product/privacy, CH0                      |
| Eligibility            | All account roles; contributions use current 18+ declaration plus community guidelines    | Product/privacy, CH0                      |
| Identity               | Explicit community display name; no automatic account PII exposure                        | Product/design/privacy, CH0               |
| Topic creation         | Staff-curated topics with member suggestions                                              | Product/moderation, CH0                   |
| New-contributor review | Review initial or flagged submissions; define exact rule and staffing capacity            | Moderation/engineering, CH0               |
| Retention and deletion | Separate content/revision/report/media classes and reviewed evidence holds                | Privacy/moderation, before CH4 acceptance |
| Image sharing          | Text pilot first; enable only after community-specific scan, review and delivery controls | Engineering/moderation, after CH5 review  |
| Public expansion       | Explicit author audience choice and fresh access/cache/indexing review                    | Product/privacy, after member pilot       |

These defaults define the gated local implementation without approving production audience, moderation or retention policy. Implementation leaves both rollout gates disabled and does not provision providers, assign moderators or publish user content.
