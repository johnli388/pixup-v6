# PixUP Guide

Open **AI assistant** in the sidebar or **Ask PixUP** on any other page. The assistant requires a signed-in account with completed authentication and no account privacy restriction. It supports:

- Current public card listings, including title, category, seller and maximum USD price filters.
- Public sellers through their active listings; results link to individual cards.
- Buyer references from the signed-in user's own sales and orders where that user is a buyer or seller. It does not provide a general buyer directory or search account emails, addresses or private inventory. Staff receive the same participant-only search scope.
- Help for selling, publishing, RePool, certificates, channels, community, settings and support, with links to the relevant pages.
- Short follow-up questions, suggested prompts, explicit errors/retry and a clear-chat control.

The assistant cannot purchase, reserve stock, send messages, change accounts or approve operations. Prices and availability are checked again by normal checkout. Seller results reflect public listing names, not a separate verified-business directory. Buyer names are not newly disclosed: the guide returns the buyer reference already present in the participant's order records.

## AI setup

The sidebar language selector also controls Ask PixUP. Message requests accept `locale` (`en`, `es`, `fr`, `zh-CN`, `ja`, `ko`; default `en`). Suggested prompts, local help/answers and privacy notices are translated, and the local parser recognizes common search vocabulary in each language. Optional AI answers receive the selected locale. Recognized buyer/order searches remain local and scoped to the signed-in participant. See [internationalization](internationalization.md) for coverage and formatting details.

Local search and curated help work without a provider. To enable optional AI answers, add these server-only settings to the root `.env`, using your own API key, then restart the API:

```dotenv
ASSISTANT_PROVIDER=openai
OPENAI_API_KEY=your-server-side-key
OPENAI_ASSISTANT_MODEL=gpt-4.1-mini
```

Never prefix the key with `NEXT_PUBLIC_`. The browser receives only an `ai_available` boolean. Set `ASSISTANT_PROVIDER=local` to disable external AI; this is the default. An explicitly selected OpenAI provider without a key fails startup with a configuration message.

Users must select **Use AI answers** before a message is sent to OpenAI. The provider uses the [Responses API](https://developers.openai.com/api/docs/guides/text) with a [structured search plan](https://developers.openai.com/api/docs/guides/structured-outputs), followed by an answer based on current permitted public results and curated help. The model can select only a bounded intent and filters; it cannot supply SQL, a user identity, arbitrary tools or result URLs. Parameterized server queries enforce access independently of the model. Result links come from server code and model output is displayed as plain text.

Messages, up to six recent chat messages, public result projections and help facts may be sent to the provider after opt-in. Private buyer/order results are never passed to the provider, and recognized buyer/order searches use only local processing. User-entered text in later chat history may still contain details the user typed; avoid secrets or payment data in chat. Requests set [`store: false`](https://developers.openai.com/api/docs/guides/conversation-state), which does not itself establish zero provider retention. Review the provider's applicable data controls before a wider rollout.

Each provider call has a 12-second timeout, with at most two calls per message and bounded output tokens. Provider errors, incomplete output and invalid plans fall back to local search/help without exposing upstream error bodies. There is no automatic retry of billable provider calls. Local search is a keyword/category/budget parser; complex natural-language intent and paraphrases work best with AI enabled.

## Access, storage and limits

`POST /v1/assistant/messages` uses the existing session, origin, CSRF, MFA and database actor controls. Request schemas reject extra scope/identity fields. Results are limited to 12 and responses are not cached. Public card search excludes unpublished collections, private unlisted inventory, channel-allocated stock and closed sellers. Buyer/order queries always bind the current actor's ID, including for staff.

Conversations live only in the current page's memory, capped at 20 turns. They clear when leaving the page, clearing chat or changing session scope. No chat database tables or browser storage are added. Existing telemetry excludes request and response bodies. Migration 016 stores a shared budget of 12 requests per 60-second window per account and one in-flight lease across API processes. A lease expires after 60 seconds so a crashed process does not block the account indefinitely. Old requests cannot release a newer lease, and expired requests cannot return answers. Only counters, window time and lease metadata are stored; no chat content. Provider spend caps and deployment load acceptance remain rollout work.

Local startup applies migration 016 automatically. For hardened PostgreSQL, apply it with the migration role and reapply `infra/database/runtime-roles.sql` before starting the API/worker; runtime checks now require the assistant quota table policy. Do not grant the API a migration-owner or worker role.

The assistant is separate from the credential-based Query/Match/Route channel tools and does not change their activation gates, scopes or metering.

## Verification

```sh
npm run typecheck
node --import tsx --test tests/assistant.test.ts
npx playwright test tests/e2e/assistant.spec.ts
```

Backend tests cover scope isolation, private/unpublished records, authentication, privacy restrictions, request bounds, price filters, parameterized queries, opt-in, failure fallback, cross-instance quotas, expired windows/crashed leases/stale release protection, HTTP/CSRF and the Responses request/response contract. Browser checks exercise actual catalog search, result navigation, clear-chat, error recovery, AI opt-in, mobile accessibility, route error recovery, MFA and guest/account isolation. The PostgreSQL recovery harness also checks separate-pool quota enforcement, public retrieval and nonowner row isolation. See the [current-pilot gap review](planning/05-current-pilot-gap-review.md) for verification results. Provider behavior is tested with an injected transport; no live paid API call is made by the tests.
