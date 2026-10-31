'use client';
import { useI18n } from './i18n';
import { CommercialTerms } from './commercial';
import { ItemPassport } from './item-passport';
import { PriceReference } from './price-trust';
import { CatalogDetails } from './saas-inventory';
import type { PaymentConfiguration } from '../../../packages/domain/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  ScanLine,
  Repeat2,
  Sparkles,
  SlidersHorizontal,
  Search,
  Check,
  Box,
  Globe,
  ChevronRight,
  LockKeyhole,
  Heart,
} from 'lucide-react';
import { CardArt } from './art';
import { useSession, useData, useAction, type Row } from './providers';
import {
  Badge,
  Status,
  Loading,
  Empty,
  PageTitle,
  SectionTitle,
  ItemCard,
  CollectionCard,
  ErrorNotice,
  AccountGate,
} from './ui';

export function Discover({ catalog }: { catalog: Row }) {
  const { t: tr } = useI18n();

  const { user } = useSession();
  const { data: portfolio } = useData('/portfolio', !!user);
  const saved = new Set(portfolio?.saved?.map((a: Row) => a.id));
  return (
    <>
      <div className="discovery-heading">
        <div>
          <span className="eyebrow">{tr('A LITTLE OBSESSION. A LOT OF POSSIBILITY.')}</span>
          <h1>
            {tr('Collect what moves you')}
            <span>.</span>
          </h1>
          <p>{tr('The cards, the culture, the stories. Find your next favorite.')}</p>
        </div>
        <Link href="/workspace/seller" className="button secondary">
          <PlusSymbol />
          {tr('Start selling')}
        </Link>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <Badge tone="lime">
            <span className="live-dot" />
            {tr('THE NEXT CHAPTER OF COLLECTING')}
          </Badge>
          <h2>
            {tr('Great finds.')}
            <br />
            {tr('Even better stories.')}
          </h2>
          <p>
            {tr('Discover extraordinary collectibles.')}
            <br />
            {tr('Verified, cared for, and ready for you.')}
          </p>
          <Link href="/marketplace" className="button lime">
            {tr('Explore the marketplace')}
            <ArrowUpRight size={18} />
          </Link>
          <div className="hero-foot">
            <span className="avatar-stack">
              <i>J</i>
              <i>A</i>
              <i>M</i>
            </span>
            <span>{tr('For the love of collecting.')}</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <span className="floating-spark spark-one">✳</span>
          <span className="floating-spark spark-two">✦</span>
          <CardArt variant="idol" className="hero-card card-left" />
          <CardArt variant="court" className="hero-card card-center" />
          <CardArt variant="orbit2" className="hero-card card-right" />
          <div className="floating-proof">
            <span>
              <ShieldCheck size={19} />
            </span>
            <div>
              <strong>{tr('A story you can trust')}</strong>
              <small>{tr('VIA authentication & provenance')}</small>
            </div>
            <Check size={16} />
          </div>
        </div>
      </section>
      <div className="trust-strip">
        <div>
          <ShieldCheck />
          <span>
            <strong>{tr('Trust comes standard')}</strong>
            <small>{tr('Authentication you can trace')}</small>
          </span>
        </div>
        <div>
          <Box />
          <span>
            <strong>{tr('Your collection, cared for')}</strong>
            <small>{tr('Secure vault custody')}</small>
          </span>
        </div>
        <div>
          <Repeat2 />
          <span>
            <strong>{tr('Keep the story going')}</strong>
            <small>{tr('Collect, sell, and recirculate')}</small>
          </span>
        </div>
      </div>
      <div className="category-links">
        {[
          ['Sports', 'For the love of the game', '↗'],
          ['K-pop', 'Closer to your favorites', '✧'],
          ['Art', 'Made to be different', '✳'],
          ['Gaming', 'A world of your own', '⊞'],
        ].map(([name, desc, symbol]) => (
          <Link key={name} href={`/marketplace?category=${encodeURIComponent(name)}`}>
            <span className={`category-icon ${name.toLowerCase()}`}>{symbol}</span>
            <span>
              <strong>{tr(name)}</strong>
              <small>{tr(desc)}</small>
            </span>
            <ArrowUpRight size={17} />
          </Link>
        ))}
      </div>
      <SectionTitle
        title={tr('Worth a closer look')}
        href="/marketplace"
        label={tr('Explore all')}
      />
      <div className="product-grid">
        {catalog.items.slice(0, 4).map((a: Row) => (
          <ItemCard key={a.id} item={a} saved={saved.has(a.id)} />
        ))}
      </div>
      <div className="section-sub">
        <span>{tr('Handpicked from the demo vault. Your next favorite might be right here.')}</span>
      </div>
      <SectionTitle title={tr('Collections with a point of view')} href="/collections" />
      <div className="collection-grid">
        {catalog.collections.slice(0, 3).map((c: Row) => (
          <CollectionCard key={c.id} collection={c} />
        ))}
      </div>
      <section className="bottom-banner">
        <div className="banner-icon">✳</div>
        <div>
          <span className="eyebrow">{tr('MADE BY YOU. COLLECTED BY THEM.')}</span>
          <h2>{tr('Your ideas deserve a first edition.')}</h2>
          <p>{tr('Publish your collection with a little help from PixUP.')}</p>
        </div>
        <Link href="/workspace/creator" className="button secondary">
          {tr('Explore creator studio')}
          <ArrowUpRight size={17} />
        </Link>
      </section>
    </>
  );
}
function PlusSymbol() {
  return <span className="plus-symbol">+</span>;
}
export function Marketplace({ catalog }: { catalog: Row }) {
  const { t: tr, plural } = useI18n();

  const params = useSearchParams();
  const { user } = useSession();
  const { data: portfolio } = useData('/portfolio', !!user);
  const [category, setCategory] = useState(params.get('category') || 'All'),
    [q, setQ] = useState(params.get('q') || ''),
    [sort, setSort] = useState('curated'),
    [max, setMax] = useState(''),
    [onlyPlatform, setOnlyPlatform] = useState(false);
  const items = useMemo(() => {
    let rows = catalog.items.filter(
      (a: Row) =>
        (category === 'All' || a.category === category) &&
        `${a.title} ${a.collection_title} ${a.category} ${tr(a.category)} ${Object.values(a.catalog_attributes || {}).join(' ')}`
          .toLowerCase()
          .includes(q.toLowerCase()) &&
        (!max || a.price_cents <= Number(max) * 100) &&
        (!onlyPlatform || a.platform_owned),
    );
    if (sort === 'low') rows = [...rows].sort((a: Row, b: Row) => a.price_cents - b.price_cents);
    if (sort === 'high') rows = [...rows].sort((a: Row, b: Row) => b.price_cents - a.price_cents);
    return rows;
  }, [catalog, category, q, max, sort, onlyPlatform, tr]);
  return (
    <>
      <PageTitle
        eyebrow={tr('THE GOOD FINDS LIVE HERE')}
        title={tr('The marketplace')}
        description={tr('One-of-a-kind finds. A history behind every one.')}
      />
      <div className="market-tools">
        <div className="tabs" aria-label={tr('Collectible categories')}>
          {['All', 'Sports', 'K-pop', 'Art', 'Gaming'].map((c) => (
            <button
              key={c}
              className={category === c ? 'selected' : ''}
              onClick={() => setCategory(c)}
            >
              {c === 'All' ? tr('All collectibles') : tr(c)}
            </button>
          ))}
        </div>
        <label className="sort-control">
          {tr('Sort by')}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="curated">{tr('Curated picks')}</option>
            <option value="low">{tr('Price: low to high')}</option>
            <option value="high">{tr('Price: high to low')}</option>
          </select>
        </label>
      </div>
      <div className="filter-bar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label={tr('Filter collectibles')}
            placeholder={tr('Search a card, collection, or category')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="price-filter">
          <SlidersHorizontal size={16} />
          {tr(' Max price')}{' '}
          <input
            aria-label={tr('Maximum price in dollars')}
            type="number"
            min="0"
            placeholder={tr('$ Any')}
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={onlyPlatform}
            onChange={(e) => setOnlyPlatform(e.target.checked)}
          />
          {tr('Accepts credits')}
        </label>
      </div>
      <p className="result-count">
        {plural(items.length, '{count} collectible', '{count} collectibles')}{' '}
        <span>{tr('· Individually registered, ready for a new chapter')}</span>
      </p>
      {items.length ? (
        <div className="product-grid">
          {items.map((a: Row) => (
            <ItemCard
              key={a.id}
              item={a}
              saved={!!portfolio?.saved?.some((x: Row) => x.id === a.id)}
            />
          ))}
        </div>
      ) : (
        <Empty
          title={tr('No finds just yet')}
          description={tr('Try a different search or give those filters a little breathing room.')}
        >
          <button
            className="button secondary"
            onClick={() => {
              setQ('');
              setCategory('All');
              setMax('');
              setOnlyPlatform(false);
            }}
          >
            {tr('Reset filters')}
          </button>
        </Empty>
      )}
    </>
  );
}
export function Collections({ catalog, id }: { catalog: Row; id?: string }) {
  const { t: tr } = useI18n();

  const { data, error, isPending } = useData(`/collections/${id}`, !!id);
  if (id && isPending) return <Loading />;
  if (error) return <ErrorNotice error={error} />;
  if (id && data)
    return (
      <>
        <PageTitle
          eyebrow={`${data.category.toUpperCase()} · LIMITED EDITION`}
          title={data.title}
          description={data.description}
        />
        <div className="collection-intro">
          <span className="creator-avatar">✳</span>
          <div>
            <strong>{data.creator_name}</strong>
            <p>
              {tr('Original demo collection · Edition of ')}
              {data.edition_size}
            </p>
          </div>
          <Badge tone="green">
            <ShieldCheck size={13} />
            {tr('Publisher reviewed')}
          </Badge>
        </div>
        <SectionTitle title={tr('Find your edition')} />
        {data.items.length ? (
          <div className="product-grid">
            {data.items.map((a: Row) => (
              <ItemCard key={a.id} item={a} />
            ))}
          </div>
        ) : (
          <Empty
            title={tr('Every edition has found a home')}
            description={tr('Explore other collections while you wait for new listings.')}
          />
        )}
      </>
    );
  return (
    <>
      <PageTitle
        eyebrow={tr('GOOD IDEAS BECOME GREAT COLLECTIONS')}
        title={tr('A world worth collecting')}
        description={tr(
          'Explore independent voices, original editions, and a little of the unexpected.',
        )}
      />
      <div className="collection-grid">
        {catalog.collections.map((c: Row) => (
          <CollectionCard key={c.id} collection={c} />
        ))}
      </div>
    </>
  );
}
export function ItemDetail({ id }: { id: string }) {
  const { t: tr, money, date } = useI18n();

  const { data: item, error, isPending } = useData(`/assets/${id}`);
  const [tab, setTab] = useState('Details');
  if (isPending) return <Loading />;
  if (error || !item) return <ErrorNotice error={error} />;
  return (
    <>
      <div className="breadcrumbs">
        <Link href="/marketplace">{tr('Marketplace')}</Link>
        <ChevronRight size={13} />
        <span>{tr(item.category)}</span>
        <ChevronRight size={13} />
        <span>{item.collection_title || tr('Independent collectible')}</span>
      </div>
      <div className="detail-grid">
        <div className={`detail-gallery art-bg-${item.artwork}`}>
          <CardArt variant={item.artwork} number={String(item.edition_number).padStart(3, '0')} />
          <span className="gallery-label">
            <ScanLine size={15} />
            {item.artwork.startsWith('media:')
              ? tr('Uploaded collectible artwork')
              : tr('Original demonstration artwork')}
          </span>
        </div>
        <div className="detail-copy">
          <span className="eyebrow">
            {item.collection_title || item.category} · #
            {String(item.edition_number).padStart(3, '0')}
          </span>
          <h1>{item.title}</h1>
          <div className="detail-badges">
            <Badge tone={item.certification === 'verified' ? 'green' : 'neutral'}>
              <ShieldCheck size={14} />
              {item.certification === 'verified'
                ? tr('VIA authenticity recorded')
                : item.certification === 'unverified'
                  ? tr('Not yet VIA assessed')
                  : item.certification}
            </Badge>
            <Badge>
              {tr('Condition: ')}
              {item.grade}
            </Badge>
            <Badge>
              <Box size={13} />
              {item.custody === 'vault' ? tr('Held in PixUP vault') : item.custody}
            </Badge>
          </div>
          <p className="description">{item.description}</p>
          <div className="seller-row">
            <span className="avatar">{(item.seller_name || 'PX').slice(0, 2)}</span>
            <div>
              <small>{item.is_owner ? tr('In your collection') : tr('Listed by')}</small>
              <strong>
                {item.is_owner ? tr('You') : item.seller_name || tr('Not currently listed')}
              </strong>
            </div>
            {item.platform_owned && <Badge tone="green">{tr('PixUP owned')}</Badge>}
          </div>
          <div className="purchase-panel">
            <small>
              {item.listing_status === 'active' ? tr('Current price') : tr('Listing status')}
            </small>
            <div className="big-price">
              {item.price_cents ? money(item.price_cents) : tr('Not listed')}
              <span>{tr('USD')}</span>
            </div>
            <p>{tr('Keep it in the vault, or choose delivery at checkout.')}</p>
            {item.is_owner ? (
              <Link className="button full" href="/workspace/seller">
                {tr('Manage this collectible ')}
                <ArrowRight size={17} />
              </Link>
            ) : item.listing_status === 'active' ? (
              <Link
                className="button full"
                href={item.channel_id ? `/channels/${item.channel_id}` : `/checkout/${id}`}
              >
                {tr('Make it yours')}
                <ArrowRight size={17} />
              </Link>
            ) : (
              <button className="button full" disabled>
                {item.listing_status === 'reserved'
                  ? tr('Reserved for another collector')
                  : tr('Currently unavailable')}
              </button>
            )}
            <span className="purchase-note">
              <LockKeyhole size={12} />
              {tr('Demo checkout · No real payment collected')}
            </span>
          </div>
          {item.certificate_id && (
            <Link className="certificate-link" href={`/verify/${item.certificate_id}`}>
              <ShieldCheck size={21} />
              <span>
                <strong>{tr('Its story is part of the collectible.')}</strong>
                <small>{tr('View VIA certificate & assessment details')}</small>
              </span>
              <ArrowUpRight size={17} />
            </Link>
          )}
        </div>
      </div>
      <div className="detail-lower">
        <div>
          {item.passport && <ItemPassport passport={item.passport} />}
          <CatalogDetails attributes={item.catalog_attributes} />
          <div className="tabs">
            {['Details', 'Provenance', 'Price reference'].map((t) => (
              <button key={t} onClick={() => setTab(t)} className={tab === t ? 'selected' : ''}>
                {tr(t)}
              </button>
            ))}
          </div>
          {tab === 'Details' ? (
            <dl className="spec-list">
              {[
                ['Category', item.category],
                ['Collection', item.collection_title || 'Independent'],
                ['Serial number', item.serial],
                ['Condition grade', item.grade],
                ['Authentication', item.certification],
                ['Custody', item.custody],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : tab === 'Provenance' ? (
            <div className="timeline">
              {item.history.map((h: Row) => (
                <div key={h.id}>
                  <span className="timeline-dot" />
                  <small>
                    {date(h.created_at)}
                    {tr(' · Event ')}
                    {h.sequence}
                  </small>
                  <strong>{h.type.replaceAll('_', ' ')}</strong>
                  <p>{h.description}</p>
                  <code title={h.hash}>{h.hash.slice(0, 22)}…</code>
                </div>
              ))}
            </div>
          ) : (
            <PriceReference data={item.price_reference} />
          )}
        </div>
        <aside className="detail-aside">
          <h3>{tr('A little more peace of mind.')}</h3>
          <p>
            <ShieldCheck size={19} />
            {tr('Authentication recorded with the item')}
          </p>
          <p>
            <Box size={19} />
            {tr('Custody tracked independently of ownership')}
          </p>
          <p>
            <Repeat2 size={19} />
            {tr('A history that follows every new chapter')}
          </p>
          <Link href="/account/support">
            {tr('Questions? We’re here to help ')}
            <ArrowUpRight size={14} />
          </Link>
        </aside>
      </div>
    </>
  );
}
export function Checkout({ assetId }: { assetId: string }) {
  return (
    <AccountGate>
      <CheckoutInner assetId={assetId} />
    </AccountGate>
  );
}
function CheckoutInner({ assetId }: { assetId: string }) {
  const { t: tr, money } = useI18n();

  const router = useRouter();
  const { data: item, error, isPending } = useData(`/assets/${assetId}`);
  const { data: credits } = useData('/credits');
  const { data: paymentConfig, error: paymentConfigError } =
    useData<PaymentConfiguration>('/payments/config');
  const stripe = paymentConfig?.provider === 'stripe_test';
  const action = useAction();
  const [fulfillment, setFulfillment] = useState('vault'),
    [useCredits, setUseCredits] = useState(false),
    [address, setAddress] = useState(''),
    [quote, setQuote] = useState<Row | null>(null),
    [orderId, setOrderId] = useState('');
  const key = useRef('');
  if (isPending) return <Loading />;
  if (error) return <ErrorNotice error={error} />;
  if (!item) return null;
  async function review(e: React.FormEvent) {
    e.preventDefault();
    const q = await action.run('/quotes', {
      listing_id: item.listing_id,
      fulfillment,
      use_credits: useCredits,
    });
    if (q) {
      setQuote(q);
      key.current = crypto.randomUUID();
    }
  }
  async function confirm() {
    if (!quote) return;
    const order = await action.run(
      '/checkouts',
      { quote_id: quote.id, shipping_address: address },
      undefined,
      key.current,
    );
    if (!order) return;
    setOrderId(order.id);
    if (order.payment_provider === 'stripe_test') {
      const payment = await action.run(`/orders/${order.id}/stripe-checkout`, {});
      if (payment?.url) window.location.assign(payment.url);
      else router.push(`/account/orders/${order.id}`);
      return;
    }
    const paid = await action.run(
      `/orders/${order.id}/demo-payment`,
      { success: true },
      'Your collectible has a new chapter.',
    );
    if (paid) router.push(`/account/orders/${order.id}`);
  }
  return (
    <>
      <PageTitle
        eyebrow={tr('ONE STEP CLOSER')}
        title={tr('Make it part of your story.')}
        description={tr('Review your collectible and decide where its next chapter begins.')}
      />
      <div className="checkout-grid">
        <form className="panel checkout-form" onSubmit={review}>
          <h2>{tr('Where should we keep it?')}</h2>
          <label className={`choice ${fulfillment === 'vault' ? 'chosen' : ''}`}>
            <input
              type="radio"
              name="fulfillment"
              checked={fulfillment === 'vault'}
              onChange={() => {
                setFulfillment('vault');
                setQuote(null);
              }}
            />
            <Box />
            <span>
              <strong>{tr('Keep in the PixUP vault')}</strong>
              <small>
                {tr('Ownership transfers to you. The collectible stays securely stored.')}
              </small>
            </span>
            <b>{tr('Free')}</b>
          </label>
          <label className={`choice ${fulfillment === 'ship' ? 'chosen' : ''}`}>
            <input
              type="radio"
              name="fulfillment"
              checked={fulfillment === 'ship'}
              onChange={() => {
                setFulfillment('ship');
                setQuote(null);
              }}
            />
            <Globe />
            <span>
              <strong>{tr('Deliver to me')}</strong>
              <small>{tr('Demo shipping workflow. No actual package will be sent.')}</small>
            </span>
            <b>$8</b>
          </label>
          {fulfillment === 'ship' && (
            <label className="field">
              {tr('Demo shipping address')}
              <textarea
                minLength={12}
                maxLength={1000}
                required
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setQuote(null);
                }}
                placeholder={tr('Use a fictional address for this demonstration.')}
              />
            </label>
          )}
          <h2>{tr('Your credits')}</h2>
          {item.platform_owned ? (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={useCredits}
                onChange={(e) => {
                  setUseCredits(e.target.checked);
                  setQuote(null);
                }}
              />
              {tr('Use available credits (')}
              {credits?.available || 0})
            </label>
          ) : (
            <p className="muted">
              {tr(
                'Credits are available on PixUP-owned inventory only. This collectible belongs to an independent seller.',
              )}
            </p>
          )}
          <div className="notice subtle">
            <strong>{tr('This is a demonstration.')}</strong>
            <p>
              {stripe
                ? tr(
                    'Stripe collects test payment details on its hosted checkout page. No real money moves. Credits remain demo units; tax and carrier integration are not enabled.',
                  )
                : tr(
                    'No real money moves. Demo credits use 100 credits = $1. Tax calculation, payment-provider processing, and carrier integration are not enabled.',
                  )}
            </p>
          </div>
          <ErrorNotice error={action.error || paymentConfigError} />
          <button
            className="button secondary full"
            disabled={action.busy || !paymentConfig}
            type="submit"
          >
            {action.busy ? tr('Preparing…') : tr('Review total')}
            <ArrowRight size={16} />
          </button>
        </form>
        <div className="panel order-summary">
          <div className="summary-item">
            <CardArt variant={item.artwork} />
            <div>
              <small>{tr(item.category)}</small>
              <h3>{item.title}</h3>
              <Badge tone="green">
                {tr('VIA ')}
                {item.grade}
              </Badge>
            </div>
          </div>
          <dl className="spec-list">
            <div>
              <dt>{tr('Collectible')}</dt>
              <dd>{money(item.price_cents || 0)}</dd>
            </div>
            <div>
              <dt>{tr('Delivery')}</dt>
              <dd>{fulfillment === 'ship' ? '$8' : tr('Free vault custody')}</dd>
            </div>
            <div>
              <dt>{tr('Buyer platform fee')}</dt>
              <dd>$0</dd>
            </div>
            {quote && (
              <div>
                <dt>{tr('Credits applied')}</dt>
                <dd>−{money(quote.credit_units)}</dd>
              </div>
            )}
            <div className="total">
              <dt>{tr('Demo total')}</dt>
              <dd>{quote ? money(quote.total_cents) : tr('Review to calculate')}</dd>
            </div>
          </dl>
          {quote && (
            <>
              <CommercialTerms snapshot={quote.commercial_snapshot} />
              <small className="muted">
                {tr('Quote valid for 10 minutes. Seller fees are deducted from seller proceeds.')}
              </small>
              <button className="button full" disabled={action.busy} onClick={() => void confirm()}>
                {action.busy
                  ? tr('Preparing payment…')
                  : stripe
                    ? tr('Continue to Stripe Checkout')
                    : tr('Confirm demo purchase')}
                <LockKeyhole size={16} />
              </button>
            </>
          )}
          {orderId && (
            <Link href={`/account/orders/${orderId}`} className="text-link">
              {tr('View or resume your order →')}
            </Link>
          )}
          <p className="purchase-note">
            <ShieldCheck size={13} />
            {tr('Backed by a traceable collectible record')}
          </p>
        </div>
      </div>
    </>
  );
}
export function Verify({ id }: { id: string }) {
  const { t: tr, date } = useI18n();

  const { data, error, isPending } = useData(`/certificates/${id}/verify`);
  if (isPending) return <Loading />;
  if (error || !data) return <ErrorNotice error={error} />;
  return (
    <>
      <PageTitle
        eyebrow={tr('VIA · VISUAL / INTEGRITY / AUTHENTICATION')}
        title={tr('The record behind the collectible.')}
      />
      <div className="certificate-panel panel">
        <div className="certificate-art">
          <CardArt variant={data.artwork} />
        </div>
        <div>
          <span className="certificate-seal">
            <ShieldCheck size={40} />
          </span>
          <h2>{data.title}</h2>
          <Status status={data.status} />
          <dl className="spec-list">
            {[
              ['Certificate', data.id],
              ['Serial', data.serial],
              ['Assessed', date(data.assessed_at)],
              ['Condition', data.grade],
              ['Custody', data.custody],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className={`notice ${data.valid ? '' : 'warning'}`}>
            <strong>
              {data.valid ? tr('Active demo certificate') : tr('Certificate is no longer active')}
            </strong>
            <p>{data.scope}</p>
            <p>
              {tr('Record signature: ')}
              {data.integrity?.state?.replaceAll('_', ' ') || tr('unsigned')}.
            </p>
            {data.integrity?.signed && (
              <p>
                {tr('Verification key: ')}
                {data.integrity.key_id}
                {tr('. Assessment status above remains authoritative for current eligibility.')}
              </p>
            )}
            <p>
              {data.integrity?.checkpoint
                ? `Signed checkpoint ${data.integrity.checkpoint.payload.sequence} · ${data.integrity.checkpoint.current_head ? 'covers the current recorded head' : 'new history exists after this checkpoint'}.`
                : tr('No trusted checkpoint covers this record.')}
            </p>
          </div>
          <Link href={`/items/${data.asset_id}`} className="button secondary">
            {tr('See collectible history ')}
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </>
  );
}
