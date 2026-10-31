import { Application } from '../../components/application';
import { notFound } from 'next/navigation';
import { isApplicationRoute } from '../../lib/routes';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  if (!isApplicationRoute((await params).slug || [])) notFound();
  let initialCatalog;
  try {
    const r = await fetch(`${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/v1/catalog`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) initialCatalog = await r.json();
  } catch {
    /* Client presents a retryable API error if backend is unavailable. */
  }
  return <Application initialCatalog={initialCatalog} />;
}
