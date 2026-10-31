# Community Hub local pilot

Implemented October 30, 2026 with migration **015**. This is the member-only, text-first increment of the [Community Hub development plan](planning/04-community-hub-development-plan.md). It is disabled by default and does not change commercial terms or provision moderator permissions.

## Enable locally

1. Apply migration 015. Normal local startup applies additive migrations automatically. Hardened PostgreSQL installations must run migrations with the migration role and reapply `infra/database/runtime-roles.sql` before starting the API/worker; runtime startup checks the new migration and private-table policies.
2. Assign `community_moderation` through the existing independently reviewed **Operations → Access** workflow. Configure at least two moderators for independent appeals. Each moderator must enroll an authenticator and verify it within the current 12-hour session window. Demo seeding does not grant this permission; finance, support, creator and topic ownership do not imply moderation access.
3. Enable the local member pilot:

   ```sh
   COMMUNITY_ENABLED=true COMMUNITY_WRITES_ENABLED=true npm run dev
   ```

   Both environment settings default to `false`; `.env.example` documents them. The existing `.env` is not modified by this increment. Flags are server-only and require restarting the API when changed.

4. Open **Community Hub** in the navigation or visit `/community`. Members choose a separate community display name and accept `community-pilot-v1`. Contributions require the existing minimum-age declaration (18+ by default), no account privacy restriction and no active community posting sanction. Community does not require owning a card, subscribing, buying something or accepting new commercial terms.
5. Publish a discussion, question, guide or story. Posts and comments enter **pending** review, including edited visible content. A scoped moderator uses **Operations → Community** to approve, hide/remove, lock replies or impose a posting restriction. Pending/hidden content never enters member feeds; authors retain their recovery view. An upheld appeal preserves the decision; overturning a hide/removal returns content to pending review rather than automatically publishing it.

## Available workflows

- **Sample community** at `/community/samples` provides seven fictional topics, eight stories/discussions/questions/guides and ten replies, with searchable feeds and topic/thread views. Signed-in members also see this preview on the landing page when the pilot is closed or the unfiltered Latest feed is empty. Preview content and engagement counts are display-only; posting still uses the existing profile, consent and moderation workflow. No accounts, consent, posts or reactions are seeded into the database.
- Curated topics and suggestions, topic follow/mute, Latest/Following feeds, type/topic filters and PostgreSQL text search.
- Private drafts, literal-text preview, explicit save and debounced autosave after the first draft save. Version conflicts preserve editor text and require loading the current version before another save. Draft text is not placed in persistent browser storage.
- Optional links to up to five public catalog cards. Every projection checks current catalog publication; a formerly public card becomes an unavailable placeholder without its old title. Collection-level attachments and images remain later work.
- Root comments and one level of replies; edits re-enter review, deletion leaves a root-comment tombstone, thread deletion hides its replies, and locks serialize with new comments.
- Likes, private saved posts, topic follows and member/topic mutes. Mutes filter feeds and reply notifications; they are not access bans.
- Explicit community profiles and visible contribution history, without account names/emails or private inventory being copied into the profile. Official badges and organization-authored posts are not part of this increment.
- Private report receipts, author-visible decisions, independent appeals, temporary posting restrictions and restoration. Self-moderation, moderation of one's own report and appeals to the original reviewer are denied. Reasons are visible to the affected author; reporters remain private.
- In-app community notifications at `/community/notifications`. Transactional outbox events contain IDs and kinds, not user text. A separate worker delivers once and rechecks visibility, recipient status, mutes and preferences. The read path rechecks visibility again. No community email is sent.
- Account privacy exports include own profile, entries/revisions, preferences, guidelines acceptance and own report/appeal submissions. Support closure purges authored text and revisions, removes personal preferences and pseudonymizes the profile. Open reports or appeals hold closure for review; retained transaction records retain their existing independent closure gates.

## Data and authorization

`community_entries` consolidates posts and comments; foreign keys, a shape trigger and service checks enforce one-level same-post replies. Separate tables store topics, references, profiles, guidelines, revisions, private interests, reports, actions, sanctions, appeals, request replay, quotas and notifications. Migration 015 does not backfill consent, publish content or assign staff privileges.

All community tables have row policies. Member-facing queries use explicit output projections; draft/revision/report access is separate from public member visibility. Ordinary members cannot update another author's visible post. Narrow security-definer functions acquire authorized thread/topic locks without broadening UPDATE policies. The API role cannot assume the worker role or mutate moderation history; actor context remains transaction-local.

API contracts live in `packages/domain/community.ts`; member routes are under `/v1/community`, moderator routes under `/v1/ops/community`. Discovery/search uses `GET /community/posts` filters; own drafts use `feed=mine`. Explicit `/community/[[...path]]` frontend routing shares the existing root shell, providers and session-scoped query invalidation. Member pages are dynamic, unindexed and served without public caching.

Feed and comment pagination use bounded keyset cursors. Initial limits are title 140 characters, post body 20,000, comment body 3,000, three topics, five card links and pages of at most 50. Persistent hourly account quotas allow 60 content/profile writes, 200 interest changes, 20 reports, 20 appeals and five topic suggestions. Community POST traffic has a separate 120/minute per-IP process-level guard, so it does not consume the login throttle. Multi-instance deployments still need coordinated edge limits.

Old revision bodies are purged after 90 days unless an open report or appeal references their entry. Author deletion removes current text immediately, while restricted revisions support review. This is a local pilot retention default, not a jurisdiction-specific legal policy. Report/action metadata and settled appeal records currently remain for restricted review; scheduled retention for those records, legal-hold administration and approved production retention periods remain launch work.

## Operations and rollout

Set `COMMUNITY_WRITES_ENABLED=false` and restart the API to pause contributions while preserving reading, reports, appeals, deletion and moderation. Set `COMMUNITY_ENABLED=false` to close general member reading; own-content recovery and reporting are retained. No rollback drops tables or rewrites commerce records.

Existing redacted HTTP metrics, community outbox backlog and worker heartbeat monitor failures. Moderator queues show pending/hidden entries, open reports, appeals and suggested topics. Community-specific engagement analytics, moderation service-level alerts, aggregate queue counters and representative sustained community load testing remain rollout work.

The pilot still needs named moderator coverage, a product/privacy review of the audience and retention defaults, operational rehearsal and staged member invitations. Images, anonymous indexing, email digests, richer badges, private messaging, organization posts and AI-generated answers are not enabled. Posts and engagement do not alter certification, provenance, pricing, title, credits or financial distributions.

## Verification

The final local run passed **150 backend tests**, **25 browser journeys**, the production build and PostgreSQL 18 migration/role/concurrency checks. A short encrypted restore drill verified 109 tables, including authored drafts, revisions and follows. These checks used disposable data; they do not establish production capacity or approve a member rollout.

- `npm test`: domain/HTTP regression suite, including Community Hub authorization, replay, revisions, mutes, notifications, age/guideline gating, closure and nonowner policy tests.
- `npm run test:e2e -- tests/e2e/community.spec.ts`: member → moderator → reply → report → independent appeal, mobile accessibility and guest isolation. The browser harness provisions two synthetic moderators only inside its fresh temporary database; production seeding is unchanged.
- `npm run postgres:recovery-check`: disposable PostgreSQL migrations through 015, separate API/worker roles, concurrent post/comment replay, denied foreign visible-post updates, thread-lock races, report privacy, appeals, notification deduplication and pooled context reset. This command refuses nonempty targets and never loads `.env`.
- `npm run build`: both TypeScript projects and production Next.js routes.

Existing encrypted backup fingerprints enumerate every public table automatically, including all new Community Hub tables. No media restoration is added because this increment accepts text only.
