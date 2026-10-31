'use client';
import { useI18n } from './i18n';
import { CommercialTerms } from './commercial';
import { IdentitySignIn } from './identity-access';
import { BillingSettings } from './saas-inventory';
import { EvidenceWorkspace, ShipmentTimeline } from './evidence-logistics';
import { ConnectSettings, OrderAdjustments } from './payment-controls';
import { PrivacySettings } from './privacy-operations';
import { ChannelOrder } from './channels';
import { StripePayment } from './payments';
import { OrganizationSettings } from './organizations';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  Wallet,
  Package,
  CheckCircle,
  LogOut,
  Bell,
  LockKeyhole,
  Mail,
  LifeBuoy,
} from 'lucide-react';
import { useSession, useData, useAction, type Row } from './providers';
import { CardArt } from './art';
import {
  PageTitle,
  SectionTitle,
  ItemCard,
  Stat,
  Status,
  Badge,
  Loading,
  Empty,
  ErrorNotice,
  AccountGate,
  Modal,
} from './ui';

export function Login() {
  const { t: tr } = useI18n();

  const router = useRouter(),
    client = useQueryClient();
  const { request, toast, loading } = useSession();
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState('collector@pixup.demo'),
    [password, setPassword] = useState('PixupDemo2026!'),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || busy) return;
    setBusy(true);
    setError('');
    try {
      const signedIn = await request(register ? '/auth/register' : '/auth/login', {
        email,
        password,
        ...(register ? { name } : {}),
      });
      await client.cancelQueries();
      client.clear();
      await client.invalidateQueries();
      toast(
        register
          ? 'Welcome to PixUP. Your story starts here.'
          : 'Welcome back. Your collection is waiting.',
      );
      router.push(signedIn.user?.mfa_required ? '/account/security' : '/');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <div className="login-story">
        <span className="eyebrow">{tr('A HOME FOR WHAT YOU LOVE.')}</span>
        <h1>
          {tr('Some things')}
          <br />
          {tr('are worth')}
          <br />
          <em>{tr('holding on to.')}</em>
        </h1>
        <div className="login-cards">
          <CardArt variant="idol" />
          <CardArt variant="court" />
        </div>
        <p>{tr('Find your people. Find your next favorite.')}</p>
      </div>
      <div className="login-form panel">
        <span className="mini-spark">✳</span>
        <h2>{register ? tr('Start your collection.') : tr('Good to have you back.')}</h2>
        <p>
          {register
            ? tr('Create a personal account to collect and sell.')
            : tr('Sign in to your corner of collectible culture.')}
        </p>
        <IdentitySignIn />
        <form onSubmit={submit}>
          {register && (
            <label className="field">
              {tr('Your name')}
              <input
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                disabled={loading || busy}
              />
            </label>
          )}
          <label className="field">
            {tr('Email address')}
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={loading || busy}
            />
          </label>
          <label className="field">
            {tr('Password')}
            <input
              required
              type="password"
              minLength={register ? 12 : 1}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={register ? 'new-password' : 'current-password'}
              disabled={loading || busy}
            />
          </label>
          <ErrorNotice error={error} />
          <button className="button full" disabled={loading || busy}>
            {busy ? tr('One moment…') : register ? tr('Create account') : tr('Sign in')}
            <ArrowRight size={17} />
          </button>
        </form>
        <button
          className="text-link"
          disabled={loading || busy}
          onClick={() => {
            setRegister(!register);
            setError('');
            if (!register) {
              setEmail('');
              setPassword('');
            }
          }}
        >
          {register ? tr('Already collecting? Sign in') : tr('New here? Create an account')}
        </button>
        {!register && (
          <div className="demo-accounts">
            <span className="eyebrow">{tr('EXPLORE A DEMO WORKSPACE')}</span>
            <div>
              {['collector', 'creator', 'seller', 'ops'].map((role) => (
                <button
                  key={role}
                  disabled={loading || busy}
                  onClick={() => {
                    setEmail(`${role}@pixup.demo`);
                    setPassword('PixupDemo2026!');
                  }}
                  className={email === `${role}@pixup.demo` ? 'selected' : ''}
                >
                  {role === 'ops' ? tr('Operations') : role[0].toUpperCase() + role.slice(1)}
                </button>
              ))}
            </div>
            <small>
              {tr('These are shared demonstration accounts, not real customer identities.')}
            </small>
          </div>
        )}
      </div>
    </div>
  );
}
export function MyCollection({ saved = false }: { saved?: boolean }) {
  return (
    <AccountGate>
      <Portfolio saved={saved} />
    </AccountGate>
  );
}
function Portfolio({ saved }: { saved: boolean }) {
  const { t: tr } = useI18n();

  const { data, error, isPending } = useData('/portfolio');
  const [filter, setFilter] = useState('All');
  if (isPending) return <Loading />;
  if (error) return <ErrorNotice error={error} />;
  const source = saved ? data.saved : data.items,
    items = source.filter((a: Row) => filter === 'All' || a.category === filter);
  return (
    <>
      <PageTitle
        eyebrow={tr('YOUR OWN LITTLE UNIVERSE')}
        title={saved ? tr('On your radar.') : tr('Your collection, your story.')}
        description={
          saved
            ? tr('A few favorites you might come back for.')
            : tr('Every find, every memory, every next chapter. All in one place.')
        }
      >
        <Link href="/workspace/seller" className="button secondary">
          {tr('Manage inventory')}
          <ArrowUpRight size={16} />
        </Link>
      </PageTitle>
      {!saved && (
        <div className="stats-grid">
          <Stat
            label={tr('In your collection')}
            value={data.items.length}
            note={tr('Individually registered collectibles')}
            icon={<Package size={18} />}
          />
          <Stat
            label={tr('Held in the vault')}
            value={data.items.filter((a: Row) => a.custody === 'vault').length}
            note={tr('Custody tracked with each item')}
            icon={<ShieldCheck size={18} />}
          />
          <Stat
            label={tr('Intakes in progress')}
            value={
              data.intakes.filter((i: Row) => ['received', 'awaiting_receipt'].includes(i.status))
                .length
            }
            note={tr('Follow progress in seller studio')}
          />
        </div>
      )}
      <div className="tabs spaced">
        {['All', 'Sports', 'K-pop', 'Art', 'Gaming'].map((c) => (
          <button key={c} onClick={() => setFilter(c)} className={filter === c ? 'selected' : ''}>
            {tr(c)}
          </button>
        ))}
      </div>
      {items.length ? (
        <div className="product-grid">
          {items.map((a: Row) => (
            <ItemCard key={a.id} item={a} saved={data.saved.some((s: Row) => s.id === a.id)} />
          ))}
        </div>
      ) : (
        <Empty
          title={
            saved ? tr('Your next favorites go here.') : tr('A little room for something great.')
          }
          description={tr('Explore the marketplace and find a collectible that feels like you.')}
        >
          <Link href="/marketplace" className="button">
            {tr('Find your next favorite')}
            <ArrowRight size={17} />
          </Link>
        </Empty>
      )}
    </>
  );
}
export function Orders({ id }: { id?: string }) {
  return <AccountGate>{id ? <OrderDetail id={id} /> : <OrderList />}</AccountGate>;
}
function OrderList() {
  const { t: tr, date, money } = useI18n();

  const { user } = useSession();
  const { data, error, isPending } = useData('/orders');
  if (isPending) return <Loading />;
  if (error) return <ErrorNotice error={error} />;
  return (
    <>
      <PageTitle
        eyebrow={tr('EVERY TRANSACTION, TOGETHER')}
        title={tr('Your orders')}
        description={tr('From that first find to safely in your collection.')}
      />
      {data.length ? (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('Collectible')}</th>
                <th>{tr('Order')}</th>
                <th>{tr('Date')}</th>
                <th>{tr('Type')}</th>
                <th>{tr('Total')}</th>
                <th>{tr('Status')}</th>
                <th>
                  <span className="sr-only">{tr('Open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((o: Row) => (
                <tr key={o.id}>
                  <td>
                    <div className="table-item">
                      <CardArt variant={o.artwork} />
                      <strong>{o.title}</strong>
                    </div>
                  </td>
                  <td>
                    <code>#{o.id.slice(0, 8)}</code>
                  </td>
                  <td>{date(o.created_at)}</td>
                  <td>{o.buyer_id === user?.id ? tr('Purchase') : tr('Sale')}</td>
                  <td>{money(o.total_cents)}</td>
                  <td>
                    <Status status={o.status} />
                  </td>
                  <td>
                    <Link
                      className="icon-button"
                      href={`/account/orders/${o.id}`}
                      aria-label={`View order ${o.id.slice(0, 8)}`}
                    >
                      <ArrowUpRight size={18} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={tr('Your first find is waiting.')}
          description={tr('When you buy or sell a collectible, its order will live here.')}
        >
          <Link href="/marketplace" className="button">
            {tr('Explore collectibles')}
            <ArrowRight size={17} />
          </Link>
        </Empty>
      )}
    </>
  );
}
function OrderDetail({ id }: { id: string }) {
  const { t: tr, date, money } = useI18n();

  const { user } = useSession();
  const { data: o, error, isPending } = useData(`/orders/${id}`);
  const action = useAction();
  const [refund, setRefund] = useState(false);
  if (isPending) return <Loading />;
  if (error || !o) return <ErrorNotice error={error} />;
  return (
    <>
      <PageTitle
        eyebrow={`ORDER #${id.slice(0, 8).toUpperCase()}`}
        title={
          o.status === 'fulfilled'
            ? tr('A new chapter, confirmed.')
            : o.status === 'pending_payment'
              ? tr('One more step to make it yours.')
              : tr('Your order, at a glance.')
        }
        description={`Created ${date(o.created_at)} · Demonstration transaction`}
      />
      <div className="order-detail-grid">
        <div className="panel">
          <div className="order-item-large">
            <CardArt variant={o.artwork} />
            <div>
              <Status status={o.status} />
              <h2>{o.title}</h2>
              <code>{o.serial}</code>
              <p>
                {o.channel !== 'web'
                  ? `${o.channel.toUpperCase()} physical fulfillment`
                  : o.fulfillment === 'vault'
                    ? tr('Vault custody selected')
                    : tr('Demo delivery selected')}
              </p>
              <Link href={`/items/${o.asset_id}`} className="text-link">
                {tr('View collectible ')}
                <ArrowUpRight size={15} />
              </Link>
            </div>
          </div>
          <dl className="spec-list">
            <div>
              <dt>
                {o.payment_provider === 'stripe_test'
                  ? tr('Stripe test payment')
                  : tr('Demo payment')}
              </dt>
              <dd>{money(o.total_cents)}</dd>
            </div>
            <div>
              <dt>{tr('Credits redeemed')}</dt>
              <dd>
                {o.credit_units}
                {tr(' credits')}
              </dd>
            </div>
            <div>
              <dt>{tr('Fulfillment')}</dt>
              <dd>
                {o.channel !== 'web'
                  ? o.channel.toUpperCase()
                  : o.fulfillment === 'vault'
                    ? tr('PixUP vault')
                    : tr('Demo shipment')}
              </dd>
            </div>
            {o.tracking && (
              <div>
                <dt>{tr('Tracking reference')}</dt>
                <dd>{o.tracking}</dd>
              </div>
            )}
            {o.shipping_address && (
              <div>
                <dt>{tr('Demo address')}</dt>
                <dd>{o.shipping_address}</dd>
              </div>
            )}
          </dl>
          <ChannelOrder order={o} />
          <CommercialTerms snapshot={o.commercial_snapshot} />
          {o.payment_provider === 'stripe_test' && <OrderAdjustments orderId={o.id} />}
          {o.fulfillment === 'ship' && o.channel === 'web' && <ShipmentTimeline orderId={o.id} />}
          <ErrorNotice error={action.error} />
          {o.buyer_id === user?.id && o.payment_provider === 'stripe_test' && (
            <StripePayment order={o} />
          )}
          {o.buyer_id === user?.id &&
            o.payment_provider !== 'stripe_test' &&
            o.status === 'pending_payment' && (
              <div className="button-row">
                <button
                  className="button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      `/orders/${id}/demo-payment`,
                      { success: true },
                      'Demo purchase confirmed',
                    )
                  }
                >
                  {tr('Complete demo payment')}
                </button>
                <button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      `/orders/${id}/demo-payment`,
                      { success: false },
                      'Order canceled; reservation released',
                    )
                  }
                >
                  {tr('Cancel order')}
                </button>
              </div>
            )}
          {o.buyer_id === user?.id &&
            o.payment_provider !== 'stripe_test' &&
            ['paid', 'fulfilled'].includes(o.status) &&
            (o.channel !== 'cvm' || o.channel_fulfillment?.state === 'refund_required') &&
            (!o.channel_fulfillment ||
              ['refund_required', 'awaiting_fulfillment'].includes(
                o.channel_fulfillment.state,
              )) && (
              <button className="button secondary" onClick={() => setRefund(true)}>
                {tr('Request vault refund')}
              </button>
            )}
        </div>
        <aside className="panel">
          <h3>{tr('A record at every step.')}</h3>
          <div className="timeline">
            <div>
              <span className="timeline-dot" />
              <strong>{tr('Order created')}</strong>
              <p>{tr('Inventory reserved for this order.')}</p>
            </div>
            <div>
              <span className={`timeline-dot ${o.paid_at ? '' : 'inactive'}`} />
              <strong>{tr('Payment confirmed')}</strong>
              <p>
                {o.paid_at
                  ? date(o.paid_at)
                  : o.payment_provider === 'stripe_test'
                    ? tr('Waiting for Stripe confirmation.')
                    : tr('Waiting for demo payment.')}
              </p>
            </div>
            <div>
              <span className={`timeline-dot ${o.status === 'fulfilled' ? '' : 'inactive'}`} />
              <strong>{tr('Fulfillment')}</strong>
              <p>
                {o.status === 'fulfilled'
                  ? tr('Vault transfer or demo shipment completed.')
                  : tr('Follow the status here.')}
              </p>
            </div>
          </div>
          <Link href={`/account/support?order=${id}`} className="button secondary full">
            <LifeBuoy size={16} />
            {tr('Get help with this order')}
          </Link>
        </aside>
      </div>
      {refund && (
        <Modal title={tr('Request a demo refund')} onClose={() => setRefund(false)}>
          <p>
            {tr(
              'The original collectible must still be yours, held in the vault, and not listed or in an intake. Released settlements require a support case.',
            )}
          </p>
          <ErrorNotice error={action.error} />
          <button
            className="button full"
            disabled={action.busy}
            onClick={async () => {
              if (
                await action.run(
                  `/orders/${id}/refund`,
                  {},
                  'Refund recorded and ownership restored.',
                )
              )
                setRefund(false);
            }}
          >
            {tr('Confirm refund')}
          </button>
        </Modal>
      )}
    </>
  );
}
export function Credits() {
  return (
    <AccountGate>
      <CreditView />
    </AccountGate>
  );
}
function CreditView() {
  const { t: tr, date, number } = useI18n();

  const { data, error, isPending } = useData('/credits');
  if (isPending) return <Loading />;
  if (error) return <ErrorNotice error={error} />;
  return (
    <>
      <PageTitle
        eyebrow={tr('KEEP THE GOOD FINDS CIRCULATING')}
        title={tr('A little credit. More possibility.')}
        description={tr('Your ecosystem credits, with a clear record of where they came from.')}
      />
      <div className="credit-layout">
        <section className="credit-card">
          <span className="eyebrow">{tr('AVAILABLE PIXUP CREDITS')}</span>
          <strong>
            {number(Number(data.available))}
            <span>{tr(' credits')}</span>
          </strong>
          <p>
            {data.held}
            {tr(' currently held for pending orders')}
          </p>
          <Link href="/marketplace" className="button lime">
            {tr('Find something worth keeping')}
            <ArrowUpRight size={17} />
          </Link>
          <span className="credit-symbol">✳</span>
        </section>
        <div className="panel credit-rules">
          <h3>{tr('Good to know.')}</h3>
          <p>
            <CheckCircle size={17} />
            {tr('Spend on eligible PixUP-owned collectibles.')}
          </p>
          <p>
            <LockKeyhole size={17} />
            {tr('Credits cannot be transferred or withdrawn.')}
          </p>
          <p>
            <ShieldCheck size={17} />
            {tr('RePool grants follow receipt and inspection.')}
          </p>
          <small>
            {tr('Demo only: 100 credits = $1. This is not a production credit policy.')}
          </small>
        </div>
      </div>
      <SectionTitle title={tr('Your credit history')} />
      {data.history.length ? (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('Activity')}</th>
                <th>{tr('Date')}</th>
                <th>{tr('Credits')}</th>
                <th>{tr('Unit')}</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h: Row) => (
                <tr key={h.id}>
                  <td>
                    <strong>{h.description}</strong>
                  </td>
                  <td>{date(h.created_at)}</td>
                  <td className={h.amount < 0 ? 'positive' : ''}>
                    {h.amount < 0 ? '+' : '−'}
                    {Math.abs(h.amount)}
                  </td>
                  <td>{tr('Credits')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={tr('A fresh start')}
          description={tr('Accepted recirculation offers and credit activity will appear here.')}
        />
      )}
    </>
  );
}
export function Activity() {
  return (
    <AccountGate>
      <ActivityInner />
    </AccountGate>
  );
}
function ActivityInner() {
  const { t: tr, date } = useI18n();

  const { data, error, isPending } = useData('/activity');
  if (isPending) return <Loading />;
  return (
    <>
      <PageTitle
        title={tr('The latest in your world.')}
        description={tr('Updates from your collection, orders, and vault.')}
      />
      <ErrorNotice error={error} />
      {data?.length ? (
        <div className="activity-list">
          {data.map((a: Row) => (
            <div className="panel activity-row" key={a.id}>
              <span className="activity-icon">
                <Bell size={20} />
              </span>
              <div>
                <h3>{a.title}</h3>
                <p>{a.body}</p>
                <small>{date(a.created_at)}</small>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title={tr('All caught up.')}
          description={tr('Important updates will appear here as you collect.')}
        />
      )}
    </>
  );
}
export function Settings() {
  return (
    <AccountGate>
      <SettingsInner />
    </AccountGate>
  );
}
function SettingsInner() {
  const { t: tr } = useI18n();

  const { user, request } = useSession();
  const client = useQueryClient(),
    router = useRouter();
  const [error, setError] = useState('');
  return (
    <>
      <PageTitle
        title={tr('Your account')}
        description={tr('Your identity, your workspaces, your corner of PixUP.')}
      />
      <div className="panel settings-panel">
        <div className="profile-large">
          <span className="avatar">{user?.name.slice(0, 2)}</span>
          <div>
            <h2>{user?.name}</h2>
            <p>{user?.email}</p>
          </div>
          <Badge tone="green">{user?.is_staff ? tr('Operations') : tr('Personal account')}</Badge>
        </div>
        <h3>{tr('Your workspaces')}</h3>
        {user?.organizations.map((o) => (
          <div className="workspace-row" key={o.id}>
            <div>
              <strong>{o.name}</strong>
              <p>
                {o.kind} · {o.role}
              </p>
            </div>
            <Badge>{tr('Pilot plan')}</Badge>
          </div>
        ))}
        <div className="notice">
          <strong>{tr('Local demonstration environment')}</strong>
          <p>
            {tr(
              'Sessions use HTTP-only cookies. Account security provides authenticator enrollment, session controls and configured email/managed sign-in. External providers require setup.',
            )}
          </p>
        </div>
        <ErrorNotice error={error} />
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await request('/auth/logout', {});
              await client.cancelQueries();
              client.clear();
              router.push('/login');
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <LogOut size={17} />
          {tr('Sign out / switch demo account')}
        </button>
      </div>
      <Link className="button secondary" href="/account/security">
        {tr('Account security')}
      </Link>
      <PrivacySettings />
      <OrganizationSettings />
      <BillingSettings />
      <EvidenceWorkspace />
      <ConnectSettings />
    </>
  );
}
export function Support() {
  return (
    <AccountGate>
      <SupportInner />
    </AccountGate>
  );
}
function SupportInner() {
  const { t: tr, date } = useI18n();

  const { data, error } = useData('/support');
  const action = useAction();
  const [subject, setSubject] = useState(''),
    [body, setBody] = useState(''),
    [order, setOrder] = useState('');
  return (
    <>
      <PageTitle
        eyebrow={tr('WE’RE HERE FOR YOUR NEXT CHAPTER')}
        title={tr('A little help goes a long way.')}
        description={tr('Open a case for an order, authentication, custody, or your account.')}
      />
      <div className="support-grid">
        <form
          className="panel form-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await action.run(
                '/support',
                { subject, body, ...(order ? { order_id: order } : {}) },
                'Support case created.',
              )
            ) {
              setSubject('');
              setBody('');
              setOrder('');
            }
          }}
        >
          <h2>{tr('Let’s work it out.')}</h2>
          <label className="field">
            {tr('Subject')}
            <input
              required
              minLength={3}
              maxLength={150}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className="field">
            {tr('Order ID ')}
            <small>{tr('(optional)')}</small>
            <input
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              placeholder={tr('Full order ID from the order detail page')}
            />
          </label>
          <label className="field">
            {tr('What happened?')}
            <textarea
              required
              minLength={10}
              maxLength={3000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
            />
          </label>
          <ErrorNotice error={action.error} />
          <button className="button" disabled={action.busy}>
            {tr('Create support case')}
            <ArrowRight size={16} />
          </button>
        </form>
        <div>
          <h2>{tr('Your cases')}</h2>
          <ErrorNotice error={error} />
          {data?.length ? (
            data.map((c: Row) => (
              <article className="panel support-case" key={c.id}>
                <Status status={c.status} />
                <h3>{c.subject}</h3>
                <p>{c.body}</p>
                {c.response && (
                  <div className="notice">
                    <strong>{tr('Operations response')}</strong>
                    <p>{c.response}</p>
                  </div>
                )}
                <small>{date(c.created_at)}</small>
              </article>
            ))
          ) : (
            <Empty
              title={tr('No cases open')}
              description={tr('If you need a hand, your conversation starts here.')}
            />
          )}
        </div>
      </div>
    </>
  );
}
