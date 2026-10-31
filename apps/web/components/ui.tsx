'use client';
import { useI18n } from './i18n';
import { ApiError } from './providers';
import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ShieldCheck, Heart, ArrowRight, Box, X, LoaderCircle } from 'lucide-react';
import { CardArt } from './art';
import { useAction, useSession, type Row } from './providers';
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Status({ status }: { status: string }) {
  const { t: tr } = useI18n();
  return (
    <Badge
      tone={
        [
          'verified',
          'active',
          'published',
          'accepted',
          'fulfilled',
          'released',
          'stock_ready',
        ].includes(status)
          ? 'green'
          : ['rejected', 'revoked', 'refunded', 'canceled'].includes(status)
            ? 'red'
            : 'neutral'
      }
    >
      {tr(status.replaceAll('_', ' '))}
    </Badge>
  );
}
export function ErrorNotice({ error }: { error?: string | Error | null }) {
  const { t: tr } = useI18n();

  return error ? (
    <div className="error-notice" role="alert">
      {tr(typeof error === 'string' ? error : error.message)}
      {error instanceof ApiError && (
        <>
          {!!error.details.field_errors?.length && (
            <ul>
              {error.details.field_errors.map((field, index) => (
                <li key={index}>
                  {field.field || tr('Request')}: {field.message}
                </li>
              ))}
            </ul>
          )}
          {error.details.correlation_id && (
            <small className="block">
              {tr('Support reference: ')}
              {error.details.correlation_id}
            </small>
          )}
        </>
      )}
    </div>
  ) : null;
}
export function Loading() {
  const { t: tr } = useI18n();

  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} />
      <span>{tr('Finding your next chapter…')}</span>
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Box size={28} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function SectionTitle({
  title,
  href,
  label = 'View all',
}: {
  title: string;
  href?: string;
  label?: string;
}) {
  const { t: tr } = useI18n();
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {href && (
        <Link href={href}>
          {tr(label)}
          <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}
export function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function ItemCard({ item, saved = false }: { item: Row; saved?: boolean }) {
  const { t: tr, money } = useI18n();

  const { user, toast } = useSession();
  const action = useAction();
  return (
    <article className="item-card">
      <div className={`item-image art-bg-${item.artwork}`}>
        <Link href={`/items/${item.id}`} aria-label={`View ${item.title}`}>
          <CardArt
            variant={item.artwork}
            number={String(item.edition_number || 1).padStart(3, '0')}
          />
        </Link>
        <button
          className={`save-button ${saved ? 'saved' : ''}`}
          aria-label={saved ? `Unsave ${item.title}` : `Save ${item.title}`}
          disabled={action.busy}
          onClick={() => {
            if (!user) {
              toast('Sign in to save a collectible.');
              return;
            }
            void action.run(
              `/saved/${item.id}`,
              { saved: !saved },
              saved ? 'Removed from saved items' : 'Added to your saved items',
            );
          }}
        >
          <Heart size={17} fill={saved ? 'currentColor' : 'none'} />
        </button>
        <span className="grade">
          <ShieldCheck size={12} />
          {tr('VIA ')}
          {item.grade}
        </span>
      </div>
      <div className="item-info">
        <span className="item-category">
          {tr(item.category)} <span>·</span>{' '}
          {item.collection_title || tr('Independent collectible')}
        </span>
        <Link href={`/items/${item.id}`}>
          <h3>{item.title}</h3>
        </Link>
        <div className="item-bottom">
          <div>
            <small>
              {item.listing_status === 'active'
                ? tr('Current price')
                : item.listing_status === 'reserved'
                  ? tr('Reserved')
                  : tr('Your collectible')}
            </small>
            <strong>
              {item.price_cents ? money(item.price_cents) : <Status status={item.certification} />}
            </strong>
          </div>
          <span className="vault-caption">
            <ShieldCheck size={13} />
            {item.custody === 'vault' ? tr('In vault') : item.custody}
          </span>
        </div>
        <ErrorNotice error={action.error} />
      </div>
    </article>
  );
}
export function CollectionCard({ collection }: { collection: Row }) {
  const { t: tr, number } = useI18n();

  return (
    <Link
      href={`/collections/${collection.id}`}
      className={`collection-card art-bg-${collection.artwork}`}
    >
      <div className="collection-preview">
        <CardArt variant={collection.artwork} />
        <CardArt
          variant={
            collection.artwork.startsWith('media:')
              ? collection.artwork
              : `${collection.artwork.replace('2', '')}2`
          }
        />
      </div>
      <div>
        <small>
          {tr(collection.category)} · {number(collection.edition_size)}
          {tr(' edition')}
        </small>
        <h3>
          {collection.title}
          <ArrowUpRight size={20} />
        </h3>
        <p>
          {tr('By ')}
          {collection.creator_name}
        </p>
      </div>
    </Link>
  );
}
export function AccountGate({ children, staff = false }: { children: ReactNode; staff?: boolean }) {
  const { t: tr } = useI18n();

  const { user, loading } = useSession();
  if (loading) return <Loading />;
  if (!user)
    return (
      <Empty
        title={tr('Your collection starts here.')}
        description={tr('Sign in to buy, publish, sell, and keep every chapter together.')}
      >
        <Link href="/login" className="button">
          {tr('Sign in ')}
          <ArrowRight size={16} />
        </Link>
      </Empty>
    );
  if (staff && !user.is_staff)
    return (
      <Empty
        title={tr('Operations access required')}
        description={tr(
          'This workspace is available to authorized staff. Switch accounts from your profile to use the operations demo.',
        )}
      />
    );
  return <>{children}</>;
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t: tr } = useI18n();

  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label={tr('Close dialog')}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
