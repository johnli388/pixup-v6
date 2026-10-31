import { messages } from './messages';

export const locales = ['en', 'es', 'fr', 'zh-CN', 'ja', 'ko'] as const;
export type Locale = (typeof locales)[number];
export const localeCookie = 'pixup_locale';
export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  'zh-CN': '简体中文',
  ja: '日本語',
  ko: '한국어',
};
export const intlLocales: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  'zh-CN': 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
};
export function supportedLocale(value?: string | null): Locale | undefined {
  const language = value?.trim().toLowerCase().split(/[-_]/)[0];
  return language === 'zh' ? 'zh-CN' : locales.find((locale) => locale === language);
}
export function resolveLocale(cookie?: string | null, acceptLanguage = ''): Locale {
  const saved = supportedLocale(cookie);
  if (saved) return saved;
  const requested = acceptLanguage
    .slice(0, 1000)
    .split(',')
    .map((entry, index) => {
      const [language, ...parameters] = entry.trim().split(';');
      const quality = parameters.find((p) => p.trim().startsWith('q='));
      const q = quality ? Number(quality.trim().slice(2)) : 1;
      return { locale: supportedLocale(language), q, index };
    })
    .filter((entry) => entry.locale && Number.isFinite(entry.q) && entry.q > 0 && entry.q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return requested[0]?.locale || 'en';
}
export type MessageValues = Record<string, string | number>;
export function translate(locale: Locale, source: string, values: MessageValues = {}): string {
  const key = source.trim().replace(/\s+/g, ' ');
  const index = locales.indexOf(locale) - 1;
  const translated = index < 0 ? undefined : messages[key]?.[index];
  const text = translated
    ? `${source.match(/^\s*/)?.[0] || ''}${translated}${source.match(/\s*$/)?.[0] || ''}`
    : source;
  return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
export function formatMoney(cents: number, locale: Locale = 'en') {
  return new Intl.NumberFormat(intlLocales[locale], {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}
export function formatNumber(value: number, locale: Locale = 'en') {
  return new Intl.NumberFormat(intlLocales[locale]).format(value);
}
export function formatDate(value: string, locale: Locale = 'en') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(intlLocales[locale], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDateTime(value: string | number, locale: Locale = 'en') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return (
    new Intl.DateTimeFormat(intlLocales[locale], {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date) + ' UTC'
  );
}

export function pluralMessage(locale: Locale, count: number, singular: string, plural: string) {
  const one = new Intl.PluralRules(intlLocales[locale]).select(count) === 'one';
  return translate(locale, one ? singular : plural, { count: formatNumber(count, locale) });
}
