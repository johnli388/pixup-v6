import type { Metadata } from 'next';
import { Providers } from '../components/providers';
import { Shell } from '../components/shell';
import { LocaleProvider } from '../components/i18n';
import { requestLocale } from '../lib/i18n-server';
import { translate } from '../../../packages/domain/i18n';
import './globals.css';
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: {
      default: translate(locale, 'PixUP — Collect what moves you.'),
      template: '%s · PixUP',
    },
    description: translate(
      locale,
      'Discover, collect, and give extraordinary collectibles their next chapter. A working PixUP demonstration.',
    ),
  };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();
  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
        <LocaleProvider initialLocale={locale}>
          <Providers>
            <Shell>{children}</Shell>
          </Providers>
        </LocaleProvider>
      </body>
    </html>
  );
}
