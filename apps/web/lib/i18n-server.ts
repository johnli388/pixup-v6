import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { localeCookie, resolveLocale } from '../../../packages/domain/i18n';

export const requestLocale = cache(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(
    cookieStore.get(localeCookie)?.value,
    headerStore.get('accept-language') || '',
  );
});
