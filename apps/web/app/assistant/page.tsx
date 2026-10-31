import type { Metadata } from 'next';
import { Assistant } from '../../components/assistant';

// The site's CSP uses a fresh script nonce for each request.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ask PixUP',
  description: 'Search collectibles and get help with PixUP.',
  robots: { index: false, follow: false },
};

export default function AssistantPage() {
  return <Assistant />;
}
