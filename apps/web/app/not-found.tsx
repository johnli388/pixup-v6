'use client';
import { useI18n } from '../components/i18n';
import Link from 'next/link';
export default function NotFound() {
  const { t: tr } = useI18n();

  return (
    <div className="empty">
      <h1>{tr('This page wandered off.')}</h1>
      <p>{tr('There are still plenty of good finds out there.')}</p>
      <Link className="button" href="/marketplace">
        {tr('Explore the marketplace')}
      </Link>
    </div>
  );
}
