import { CommunityHub } from '../../../components/community';
import { notFound } from 'next/navigation';
import { isCommunityRoute } from '../../../lib/routes';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Community Hub', robots: { index: false, follow: false } };
export default async function CommunityPage({ params }: { params: Promise<{ path?: string[] }> }) {
  if (!isCommunityRoute((await params).path || [])) notFound();
  return <CommunityHub />;
}
