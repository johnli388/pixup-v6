import { CommunityHub } from '../../../components/community';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Community Hub', robots: { index: false, follow: false } };
export default function CommunityPage() {
  return <CommunityHub />;
}
