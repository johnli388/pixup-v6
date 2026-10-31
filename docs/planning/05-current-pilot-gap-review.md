# Current-pilot implementation gap review

Reviewed October 30, 2026 against the [system architecture](01-system-architecture.md), [backend plan](02-backend-development-plan.md) and [frontend plan](03-ui-frontend-development-plan.md). Scope confirmed by the user: complete current-pilot software gaps. This review separates the working pilot from the plans' later products and paid-launch acceptance requirements.

## Existing features confirmed

Operations already has permission-filtered sample queues and a live/sample toggle. Community already has member topics, stories, posts, comments and moderation, plus a separate read-only sample experience. Channels already has three fictional California pilot concepts, separate from activated channel records. Ask PixUP already provides authenticated public-card/seller search, participant-only buyer/order lookup, curated help and optional user-authorized AI answers. These features were extended and verified without duplicating their data or workflows.

## Gaps implemented

| Plan area | Gap found | Implementation and evidence |
| --- | --- | --- |
| Architecture / B13: shared assistant budgets | Limits were in API-process memory and reset on restart or another instance | [Migration 016](../../packages/database/016-assistant-limits.sql) and [AssistantService](../../apps/api/src/assistant.ts) atomically claim a shared 12-request/60-second account budget and one expiring lease. No transaction spans a provider call. Token-checked release and expiry checks prevent a delayed request from clearing a newer lease or returning a stale answer. |
| B1/B10/B13: database acceptance | Assistant retrieval and quotas lacked nonowner PostgreSQL acceptance | [Separate-pool checks](../../tests/fixtures/assistant-postgres.ts) run in the existing [recovery harness](../../scripts/postgres-recovery-check.ts). They verify quota persistence/concurrency, permitted public retrieval, hidden foreign quota rows and denied foreign writes. Hardened startup checks migration 016 and seven RLS-enabled tables. |
| F1/F7: route recovery | Ask PixUP shared the catalog catch-all and had no dedicated metadata, loading or error boundary | [Assistant route](../../apps/web/app/assistant/page.tsx) now has loading/error recovery and noindex metadata. It preserves sign-in/MFA checks and avoids fetching the catalog. Browser checks cover MFA and recovery from an injected render failure. |
| F1: unknown routes | Unsupported paths rendered a client empty state with HTTP 200; extra path segments could resolve as valid screens | Both catch-all routes validate their supported [route shapes](../../apps/web/lib/routes.ts) before rendering. Browser checks verify HTTP 404 for unknown paths and extra segments, including Community. Resource IDs still use their existing API-driven states; this does not complete per-resource server rendering/SEO. |
| F1: sign-in readiness | Inputs could be edited before session initialization, allowing hydration to replace typed values | [Login](../../apps/web/components/account.tsx) disables credential fields and actions until session initialization finishes and while submitting. The existing enrollment/logout/MFA journey exercises this boundary. |
| F4/F7: accessibility | The floating Ask PixUP link sat outside a page landmark | The [shell](../../apps/web/components/shell.tsx) places the shortcut in a named navigation landmark, preserving its label and placement. Full-page accessibility checks retain coverage. |
| F4: sample isolation | The three preview surfaces lacked browser coverage for their read-only boundary | [Preview journeys](../../tests/e2e/previews.spec.ts) cover disabled Operations actions and live/sample switching; Community search, type filters, topics and stories without member writes; and all three California previews without channel API calls or checkout. |
| Verification harness | Added journeys could exhaust the shared localhost authentication budget; the Community accessibility scan could run before hydration | The [browser fixture](../../tests/e2e/fixtures.ts) honors an actual auth `RATE_LIMIT` response's bounded `Retry-After` once, with matching test timeouts. Production limits stay unchanged. Community's accessibility scan waits for the rendered surface. |

## Deployment

Normal local startup applies migration 016. Hardened PostgreSQL deployments must apply it with the migration role, then reapply [runtime grants](../../infra/database/runtime-roles.sql) before API/worker startup. The new table contains only account ID, request count/window and lease metadata; prompts, answers and result cards remain unpersisted. A crashed request's slot expires after 60 seconds.

No application `.env`, persistent user database, provider credentials, commercial approval or rollout flag was changed by this review. Optional AI remains explicitly configured and user opt-in. The three California channels remain fictional previews.

## Verification

- `npm test`: **159 passed**, including 9 assistant tests.
- Disposable PostgreSQL 18 recovery harness: migrations **001–016**, replay, separate API/worker roles, denied DDL/TRUNCATE, tenant isolation, pooled actor reset and shared assistant quota checks passed. The temporary server was stopped afterward.
- Complete Playwright regression suite: **34 passed**, including 5 assistant journeys and 4 preview/404 journeys. The run used installed Chrome, disposable PGlite data and local assistant mode; AI/provider responses are fixtures, not live acceptance.
- `npm run build`: passed, including both TypeScript projects. `/assistant` is dynamically rendered for CSP nonce support.
- Temporary production frontend + Chrome smoke check: assistant hydration, sign-in gate, title/noindex metadata, fresh matching CSP nonces and unknown-route HTTP 404 passed. The temporary frontend was stopped afterward.
- Formatting, `git diff --check`, and planning/runbook relative-link and code-fence checks passed.

## Work remaining outside this increment

| Area | Remaining work and reason |
| --- | --- |
| AI rollout | Real provider acceptance, broader relevance/adversarial evaluation, provider data review, spend ceilings/alerts and deployed load/latency evidence. Injected provider responses establish contract behavior, not live model quality. |
| Payments, identity, evidence and operations | Hosted Checkout/Connect/subscription and IdP/email/storage/scanner acceptance; actual carrier, warehouse, device and stream procedures. Their local adapters and controls already exist; real provider/operator evidence is required. |
| Commercial and partner terms | Approved rights/territory/expiry, consignment/title authority, taxes/refunds, partner agreements, payouts/bank recovery and governance definitions. Existing pilot terms and activation gates remain authoritative. |
| Later software expansion | Broader pagination/facets, complete generated clients, remaining explicit feature routes and per-resource SEO/HTTP status, production proofs/variants, account linking/all-factor recovery, wider RLS coverage, independent workers, richer community media and full device/screen-reader coverage remain incremental roadmap work. |

The plans continue to track these items under B0–B13/F0–F7 and CH0–CH5. Completing the listed pilot gaps does not mark the entire paid-launch or year-one roadmap complete.
