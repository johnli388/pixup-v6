# Internationalization

The sidebar's **Language** selector supports English (`en`), Spanish (`es`), French (`fr`), Simplified Chinese (`zh-CN`), Japanese (`ja`) and Korean (`ko`). On mobile, open the navigation menu to reach it. Languages are listed by their native names.

The initial language comes from the `pixup_locale` cookie, then the browser's `Accept-Language` preferences, then English. Regional variants map to their supported base language; Chinese variants currently use Simplified Chinese. The browser remembers an explicit choice for one year. This is a browser preference, not an account setting synchronized across devices.

Changing languages updates the interface, document language and page metadata without changing URLs or clearing current form values and chat history. Server rendering and client hydration use the same locale. Request locale resolution is isolated per request; there is no process-wide current language.

## Coverage and content

Translations cover navigation, discovery and marketplace controls, checkout, primary account/workspace headings, Community Hub controls, pilot-channel and Operations preview controls, and Ask PixUP. Advanced operational explanations, provider responses and technical validation messages can still use the English fallback. The shared translation helper is connected throughout these screens so additional copy can be translated centrally.

Member posts, stories, names, collectible titles, descriptions, evidence and other stored content retain their original text. Selecting a language does not translate or modify database records. Marketplace category searches accept both the original and currently translated category name. API enums, IDs, filter values and URLs remain stable across languages.

Dates and numbers use the selected locale's `Intl` formatting. Date displays use UTC for consistent server/browser rendering; date/time displays identify UTC explicitly. Prices remain USD and monetary calculations remain integer cents. Language selection does not convert currency or change commercial terms. Hosted payment and identity providers control their own screens.

Ask PixUP sends the selected locale in each message request. Local responses, help, notices and suggested searches are translated. Its bounded local parser recognizes common search, category, price and buyer/order terms in all six languages. Exact titles can still be searched in their original language; complex paraphrases may require the optional AI planner. Opted-in AI answers are instructed to use the selected language. Recognized private searches remain local and participant-scoped in every language. Existing chat messages retain the language in which they were sent.

## Maintaining translations

- `packages/domain/i18n/index.ts`: locale negotiation, translation/interpolation, plural selection and formatting.
- `packages/domain/i18n/messages.ts`: English source keys with five translations in Spanish, French, Simplified Chinese, Japanese and Korean order.
- `apps/web/lib/i18n-server.ts`: request-scoped server locale.
- `apps/web/components/i18n.tsx`: client provider, `useI18n()` and language selector.
- `apps/api/src/assistant-languages.ts`: bounded multilingual local search vocabulary.

Use `const { t, money, date, dateTime, number, plural } = useI18n()` in client components. Translate application-owned labels with `t('Source text')`; use named placeholders for variable text and provide complete sentences where grammar requires reordering. For counts, supply singular and plural source messages through `plural(count, singular, plural)`. Preserve placeholder names in every translation. Render these strings as text, never HTML.

Use `requestLocale()` and the shared `translate()` helper in server components or metadata functions. Add new source keys with all five translations. Missing keys safely retain the English source. Never translate API enum values or stored member content to make a label localized; translate the displayed label separately.

## Verification

`tests/i18n.test.ts` covers locale precedence, regional variants, invalid input, fallback, catalog placeholders, formatting and multilingual search intent. `tests/assistant.test.ts` checks localized inventory results and private-search isolation in all six languages, plus forwarding the locale to the optional provider. `tests/e2e/i18n.spec.ts` checks switching and persistence, server negotiation, independent visitors, translated 404s, preserved forms/chat, stable filter values and mobile accessibility.

Run `npm test`, `npm run typecheck`, `npm run test:e2e` and `npm run build`. Browser tests can use an installed Chrome with `PLAYWRIGHT_EXECUTABLE_PATH` as described in the project test setup. No database migration, new dependency or external translation service is required.

Verified October 30, 2026: all 164 backend/domain tests and all 39 browser tests passed, including the five internationalization browser journeys. Type checking and the production build passed. A production smoke test also verified locale negotiation, switching, persistence, translated 404s, CSP headers and hydration using a local catalog/session fixture. External AI translation quality and hosted-provider screens were not exercised.
