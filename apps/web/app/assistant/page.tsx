import type { Metadata } from 'next';
import { Assistant } from '../../components/assistant';
import { requestLocale } from '../../lib/i18n-server';
import { translate } from '../../../../packages/domain/i18n';

// The site's CSP uses a fresh script nonce for each request.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: translate(locale, 'Ask PixUP'),
    description: translate(locale, 'Search collectibles and get help with PixUP.'),
    robots: { index: false, follow: false },
  };
}

export default function AssistantPage() {
  return <Assistant />;
}
