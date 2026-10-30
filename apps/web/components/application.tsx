'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useData, type Row } from './providers';
import { Discover, Marketplace, Collections, ItemDetail, Checkout, Verify } from './marketplace';
import { Login, MyCollection, Orders, Credits, Activity, Settings, Support } from './account';
import { Seller, Creator } from './workspaces';
import { Operations } from './operations';
import { Loading, ErrorNotice, Empty } from './ui';
export function Application({ initialCatalog }: { initialCatalog?: Row }) {
  const path = usePathname(),
    search = useSearchParams();
  const {
    data: catalog,
    error,
    isPending,
    refetch,
  } = useData<Row>('/catalog', true, initialCatalog);
  const parts = path.split('/').filter(Boolean);
  if (path === '/login') return <Login />;
  if (parts[0] === 'items' && parts[1]) return <ItemDetail key={path} id={parts[1]} />;
  if (parts[0] === 'checkout' && parts[1]) return <Checkout key={path} assetId={parts[1]} />;
  if (parts[0] === 'verify' && parts[1]) return <Verify id={parts[1]} />;
  if (path === '/account/collection') return <MyCollection />;
  if (path === '/account/saved') return <MyCollection saved />;
  if (parts[0] === 'account' && parts[1] === 'orders') return <Orders key={path} id={parts[2]} />;
  if (path === '/account/credits') return <Credits />;
  if (path === '/account/activity') return <Activity />;
  if (path === '/account/settings') return <Settings />;
  if (path === '/account/support') return <Support />;
  if (path === '/workspace/seller') return <Seller />;
  if (path === '/workspace/creator') return <Creator />;
  if (path === '/ops') return <Operations />;
  if (isPending) return <Loading />;
  if (error || !catalog)
    return (
      <>
        <ErrorNotice error={error || 'The catalog is unavailable.'} />
        <button className="button secondary" onClick={() => void refetch()}>
          Try again
        </button>
      </>
    );
  if (path === '/') return <Discover catalog={catalog} />;
  if (path === '/marketplace') return <Marketplace key={search.toString()} catalog={catalog} />;
  if (parts[0] === 'collections') return <Collections catalog={catalog} id={parts[1]} />;
  return (
    <Empty
      title="This page wandered off."
      description="There’s still a whole world worth collecting."
    >
      <Link className="button" href="/">
        Back to discover
      </Link>
    </Empty>
  );
}
