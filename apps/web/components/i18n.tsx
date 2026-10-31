'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  locales,
  localeNames,
  localeCookie,
  translate,
  formatMoney,
  formatDate,
  formatNumber,
  formatDateTime,
  pluralMessage,
  type Locale,
  type MessageValues,
} from '../../../packages/domain/i18n';

function createValue(locale: Locale) {
  return {
    locale,
    t: (source: string, values?: MessageValues) => translate(locale, source, values),
    money: (cents: number) => formatMoney(cents, locale),
    date: (value: string) => formatDate(value, locale),
    number: (value: number) => formatNumber(value, locale),
    dateTime: (value: string | number) => formatDateTime(value, locale),
    plural: (count: number, singular: string, plural: string) =>
      pluralMessage(locale, count, singular, plural),
  };
}
const LocaleContext = createContext({ ...createValue('en'), setLocale: (_locale: Locale) => {} });
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState(initialLocale);
  const router = useRouter();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(
    () => ({
      ...createValue(locale),
      setLocale: (next: Locale) => {
        if (!locales.includes(next) || next === locale) return;
        document.cookie = `${localeCookie}=${encodeURIComponent(next)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
        setLocaleState(next);
        // Reconcile server-rendered metadata without replacing client form/chat state.
        router.refresh();
      },
    }),
    [locale, router],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export const useI18n = () => useContext(LocaleContext);
export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="language-selector">
      <span>{t('Language')}</span>
      <select
        aria-label={t('Language')}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        {locales.map((code) => (
          <option key={code} value={code} lang={code}>
            {localeNames[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
