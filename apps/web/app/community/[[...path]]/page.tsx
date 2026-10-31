import { CommunityHub } from '../../../components/community';
import { notFound } from 'next/navigation';
import { isCommunityRoute } from '../../../lib/routes';
import { requestLocale } from '../../../lib/i18n-server';
import { translate } from '../../../../../packages/domain/i18n';
export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  return {
    title: translate(await requestLocale(), 'Community Hub'),
    robots: { index: false, follow: false },
  };
}
export default async function CommunityPage({ params }: { params: Promise<{ path?: string[] }> }) {
  if (!isCommunityRoute((await params).path || [])) notFound();
  return <CommunityHub />;
}
