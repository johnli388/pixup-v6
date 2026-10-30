'use client';
import { AttributionReport } from './price-trust';
import { OrganizationInventory } from './saas-inventory';
import type { RePoolOffer as Offer, RePoolTerms } from '../../../packages/domain/contracts';
import Link from 'next/link';
import { useState } from 'react';
import {
  Plus,
  ArrowRight,
  ArrowUpRight,
  Package,
  Wallet,
  Layers,
  Palette,
  ShieldCheck,
  Repeat2,
  Store,
  Check,
  Send,
} from 'lucide-react';
import { useSession, useData, useAction, type Row } from './providers';
import { CardArt } from './art';
import {
  PageTitle,
  SectionTitle,
  Stat,
  Status,
  Badge,
  Loading,
  Empty,
  ErrorNotice,
  AccountGate,
  Modal,
  money,
  date,
} from './ui';

const categories = ['Sports', 'K-pop', 'Art', 'Gaming'];
const artOptions = [
  ['court', 'Court culture'],
  ['court2', 'Courtside'],
  ['idol', 'Luna'],
  ['idol2', 'Neon'],
  ['orbit', 'Orbital'],
  ['orbit2', 'Geometry'],
  ['pixel', 'Cloud runner'],
  ['pixel2', 'Forest spirit'],
];
function ArtworkPicker({
  value,
  onChange,
  onBusyChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { user } = useSession();
  const { data: uploads, refetch: refreshUploads } = useData('/evidence');
  const [pending, setPending] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      if (file.size > 6 * 1024 * 1024) throw new Error('Choose an image under 6 MB.');
      const response = await fetch('/api/uploads', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type, 'X-CSRF-Token': user?.csrf || '' },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Upload failed.');
      if (data.state && data.state !== 'approved') {
        setPending(
          `Upload ${data.id} is saved and awaits scanning and independent review. Select it below after approval.`,
        );
        await refreshUploads();
        return;
      }
      onChange(data.artwork);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <fieldset className="artwork-field">
      <legend>Collection artwork</legend>
      <div className="artwork-picker">
        {artOptions.map(([v, label]) => (
          <button
            type="button"
            aria-label={`Choose ${label} artwork`}
            disabled={busy}
            aria-pressed={value === v}
            key={v}
            className={value === v ? 'selected' : ''}
            onClick={() => onChange(v)}
          >
            <CardArt variant={v} />
            {value === v && (
              <span>
                <Check size={12} />
              </span>
            )}
          </button>
        ))}
      </div>
      <label className="field upload-field">
        {busy ? 'Processing your image…' : 'Or upload your own artwork'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </label>
      {value.startsWith('media:') && (
        <div className="uploaded-preview">
          <CardArt variant={value} />
          <span>Artwork saved privately. Public only after publishing.</span>
        </div>
      )}
      <ErrorNotice error={error} />
      {pending && <p role="status">{pending}</p>}
      {!!uploads?.files.some((f: Row) => f.purpose === 'artwork' && f.state === 'approved') && (
        <label className="field">
          Use approved artwork
          <select
            value={value.startsWith('media:') ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="" disabled>
              Select approved upload
            </option>
            {uploads.files
              .filter(
                (f: Row) =>
                  f.purpose === 'artwork' && f.state === 'approved' && f.owner_id === user?.id,
              )
              .map((f: Row) => (
                <option key={f.id} value={`media:${f.id}`}>
                  {f.id}
                </option>
              ))}
          </select>
        </label>
      )}
      {pending && (
        <button
          type="button"
          className="button small secondary"
          onClick={() => void refreshUploads()}
        >
          Refresh approved artwork
        </button>
      )}
      <small>
        PNG, JPEG or WebP · Up to 6 MB / 24 MP. Images are decoded, resized, and metadata is
        removed.
      </small>
    </fieldset>
  );
}

export function Seller() {
  return (
    <AccountGate>
      <SellerInner />
    </AccountGate>
  );
}
function SellerInner() {
  const { data, error, isPending } = useData('/portfolio');
  const { data: settlements } = useData('/settlements');
  const [tab, setTab] = useState('Inventory'),
    [modal, setModal] = useState<{ type: string; item?: Row } | null>(null);
  const action = useAction();
  if (isPending) return <Loading />;
  if (error) return <ErrorNotice error={error} />;
  const held = (settlements || [])
    .filter((s: Row) => s.status === 'held')
    .reduce((sum: number, s: Row) => sum + s.amount_cents, 0);
  return (
    <>
      <PageTitle
        eyebrow="SELLER STUDIO"
        title="Good finds deserve a next chapter."
        description="Your inventory, listings, and sale proceeds. Everything in its place."
      >
        <button className="button" onClick={() => setModal({ type: 'add' })}>
          <Plus size={17} />
          Add collectible
        </button>
      </PageTitle>
      <div className="stats-grid">
        <Stat
          label="Total inventory"
          value={data.items.length}
          note="Collectibles currently owned"
          icon={<Layers size={18} />}
        />
        <Stat
          label="Active listings"
          value={data.items.filter((a: Row) => a.listing_status === 'active').length}
          note="Available in the marketplace"
          icon={<Store size={18} />}
        />
        <Stat
          label="Held seller proceeds"
          value={money(held)}
          note="Demo USD · separate from credits"
          icon={<Wallet size={18} />}
        />
      </div>
      <OrganizationInventory />
      <div className="tabs spaced">
        {['Inventory', 'Intakes', 'Settlements'].map((t) => (
          <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>
            {t}
            {t === 'Intakes' && <span>{data.intakes.length}</span>}
          </button>
        ))}
      </div>
      <ErrorNotice error={action.error} />
      {tab === 'Inventory' ? (
        data.items.length ? (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Collectible</th>
                  <th>Authentication</th>
                  <th>Custody</th>
                  <th>Listing</th>
                  <th>Next chapter</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a: Row) => {
                  const pending = data.intakes.some(
                    (i: Row) =>
                      i.asset_id === a.id && ['awaiting_receipt', 'received'].includes(i.status),
                  );
                  return (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/items/${a.id}`} className="table-item">
                          <CardArt variant={a.artwork} />
                          <div>
                            <strong>{a.title}</strong>
                            <small>{a.serial}</small>
                          </div>
                        </Link>
                      </td>
                      <td>
                        <Status status={a.certification} />
                        <small className="block muted">Grade {a.grade}</small>
                      </td>
                      <td>
                        <Status status={a.custody} />
                      </td>
                      <td>
                        {['active', 'reserved'].includes(a.listing_status) ? (
                          <>
                            <strong>{money(a.price_cents)}</strong>
                            <small className="block muted">{a.listing_status}</small>
                          </>
                        ) : (
                          <span className="muted">Not listed</span>
                        )}
                      </td>
                      <td>
                        <div className="table-actions">
                          {a.listing_status === 'active' ? (
                            <button
                              disabled={action.busy}
                              className="button small secondary"
                              onClick={() =>
                                void action.run(
                                  `/listings/${a.listing_id}/withdraw`,
                                  {},
                                  'Listing withdrawn',
                                )
                              }
                            >
                              Withdraw listing
                            </button>
                          ) : a.listing_status === 'reserved' ? (
                            <Badge>Checkout in progress</Badge>
                          ) : pending ? (
                            <Badge>Intake in progress</Badge>
                          ) : a.custody === 'vault' && a.certification === 'verified' ? (
                            <>
                              <button
                                className="button small"
                                onClick={() => setModal({ type: 'list', item: a })}
                              >
                                List for sale
                              </button>
                              <button
                                className="icon-button"
                                aria-label={`Recirculate ${a.title}`}
                                onClick={() => setModal({ type: 'repool', item: a })}
                              >
                                <Repeat2 size={17} />
                              </button>
                            </>
                          ) : (
                            <button
                              className="button small secondary"
                              onClick={() => setModal({ type: 'vault', item: a })}
                            >
                              Request vault intake
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Give your collection a little room."
            description="Add a collectible, then request authentication and vault custody before listing it."
          >
            <button className="button" onClick={() => setModal({ type: 'add' })}>
              Add your first collectible
            </button>
          </Empty>
        )
      ) : tab === 'Intakes' ? (
        data.intakes.length ? (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Collectible</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Provisional offer</th>
                  <th>Review notes</th>
                </tr>
              </thead>
              <tbody>
                {data.intakes.map((i: Row) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.title}</strong>
                      <small className="block muted">{date(i.created_at)}</small>
                    </td>
                    <td>{i.kind === 'repool' ? 'RePool buyback' : 'Vault intake'}</td>
                    <td>
                      <Status status={i.status} />
                    </td>
                    <td>{i.offered_credits ? `${i.offered_credits} credits` : '—'}</td>
                    <td>
                      {i.review_note || 'Awaiting receipt and inspection.'}
                      {i.kind === 'repool' && (
                        <>
                          <small className="block muted">
                            Offer v{i.offer_version} · {i.offer_status.replaceAll('_', ' ')}
                          </small>
                          <button
                            className="button small secondary"
                            onClick={() => setModal({ type: 'offer', item: i })}
                          >
                            Review offer
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Nothing in transit."
            description="Your authentication, vault, and recirculation requests will appear here."
          />
        )
      ) : (
        <SettlementTable settlements={settlements || []} />
      )}
      <div className="notice subtle">
        <ShieldCheck size={19} />
        <div>
          <strong>Trust before trade.</strong>
          <p>
            Collectibles need VIA review and vault custody before they can be sold. Seller proceeds
            are separate from nonwithdrawable ecosystem credits.
          </p>
        </div>
      </div>
      {modal &&
        (modal.type === 'offer' ? (
          <RePoolOffer intake={modal.item!} onClose={() => setModal(null)} />
        ) : (
          <SellerModal type={modal.type} item={modal.item} onClose={() => setModal(null)} />
        ))}
    </>
  );
}
function RePoolOffer({ intake, onClose }: { intake: Row; onClose: () => void }) {
  const { data, error, refetch } = useData<Offer>(`/repool/intakes/${intake.id}/offer`);
  const action = useAction();
  const [acceptedVersion, setAcceptedVersion] = useState<number | null>(null);
  const previous = data?.versions.find((v) => v.version === data.accepted_offer_version);
  async function decide(accept: boolean) {
    if (!data) return;
    const result = await action.run(
      `/repool/intakes/${intake.id}/offer/decision`,
      { expected_version: data.offer_version, accept },
      accept
        ? 'Offer accepted. Inspection completion is still required.'
        : 'Offer declined. Operations will arrange the demo return.',
    );
    if (result) onClose();
    else {
      setAcceptedVersion(null);
      await refetch();
    }
  }
  return (
    <Modal title="Review RePool offer" onClose={onClose}>
      {error ? (
        <ErrorNotice error={error} />
      ) : !data ? (
        <Loading />
      ) : (
        <div className="form-panel">
          <h3>{intake.title}</h3>
          <p>
            Previously accepted: {previous?.credit_units ?? '—'} credits (v
            {data.accepted_offer_version ?? '—'}).
          </p>
          <div className="offer-panel">
            <small>CURRENT DEMO OFFER · v{data.offer_version}</small>
            <strong>
              {data.offered_credits} <span>credits</span>
            </strong>
            <p>
              Expires {date(data.offer_expires_at)} · {data.terms.policy_version}
            </p>
          </div>
          <p>
            {data.terms.title_effect} {data.terms.redemption_scope}{' '}
            {data.terms.inspection_conditions}
          </p>
          <Status status={data.offer_status} />
          <p>
            {data.status === 'accepted'
              ? 'Admission complete: title transferred and credits issued.'
              : data.offer_status === 'declined'
                ? 'No credits or title transfer. Contact support to arrange return; the item stays in custody until Operations records it.'
                : 'You retain ownership. Credits are not spendable until final admission.'}
          </p>
          {data.offer_status === 'awaiting_consent' && data.status === 'received' && (
            <>
              <label className="checkbox terms">
                <input
                  type="checkbox"
                  checked={acceptedVersion === data.offer_version}
                  onChange={(e) => setAcceptedVersion(e.target.checked ? data.offer_version : null)}
                />
                <span>
                  I accept this version, credit amount, title transfer and redemption restrictions.
                </span>
              </label>
              <div className="button-row">
                <button
                  className="button"
                  disabled={
                    action.busy ||
                    acceptedVersion !== data.offer_version ||
                    new Date(data.offer_expires_at).getTime() <= Date.now()
                  }
                  onClick={() => void decide(true)}
                >
                  Accept revised offer
                </button>
                <button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() => void decide(false)}
                >
                  Decline & request return
                </button>
              </div>
            </>
          )}
          <ErrorNotice error={action.error} />
          <h3>Offer history</h3>
          {data.versions.map((v: Row) => (
            <p key={v.version}>
              v{v.version} · {v.credit_units} credits · {v.note}
            </p>
          ))}
          <Link href="/account/support">Contact support</Link>
        </div>
      )}
    </Modal>
  );
}
function SettlementTable({ settlements }: { settlements: Row[] }) {
  return settlements.length ? (
    <div className="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>Collectible</th>
            <th>Order payment</th>
            <th>Platform fee</th>
            <th>Seller proceeds</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {settlements.map((s) => (
            <tr key={s.id}>
              <td>
                <Link href={`/account/orders/${s.order_id}`}>
                  <strong>{s.title}</strong>
                </Link>
                <small className="block muted">{date(s.created_at)}</small>
              </td>
              <td>{money(s.total_cents)}</td>
              <td>{money(s.fee_cents)}</td>
              <td>
                <strong>{money(s.amount_cents)}</strong>
              </td>
              <td>
                <Status status={s.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-note">
        All payouts are simulated. “Released” does not mean a real bank transfer occurred.
      </p>
    </div>
  ) : (
    <Empty
      title="Your first sale starts a story."
      description="When a collectible sells, its fees and proceeds will be recorded here."
    />
  );
}
function SellerModal({ type, item, onClose }: { type: string; item?: Row; onClose: () => void }) {
  const { data: terms, error: termsError } = useData<RePoolTerms>(
    '/repool/terms',
    type === 'repool',
  );
  const [uploadBusy, setUploadBusy] = useState(false);
  const action = useAction();
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [category, setCategory] = useState('Sports'),
    [artwork, setArtwork] = useState('court'),
    [price, setPrice] = useState('50'),
    [evidence, setEvidence] = useState(''),
    [accepted, setAccepted] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (uploadBusy) return;
    let result;
    if (type === 'add')
      result = await action.run(
        '/assets',
        { title, description, category, artwork },
        'Collectible added to your inventory.',
      );
    else if (type === 'list')
      result = await action.run(
        '/listings',
        { asset_id: item!.id, price_cents: Math.round(Number(price) * 100) },
        'Your collectible is live in the marketplace.',
      );
    else
      result = await action.run(
        '/intakes',
        { asset_id: item!.id, kind: type, evidence, accepted_terms: accepted },
        'Intake requested. Follow its progress in your workspace.',
      );
    if (result) onClose();
  }
  return (
    <Modal
      title={
        type === 'add'
          ? 'Add a collectible'
          : type === 'list'
            ? 'Give it a next chapter'
            : type === 'repool'
              ? 'Recirculate with RePool'
              : 'Request vault intake'
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="form-panel">
        {type === 'add' ? (
          <>
            <label className="field">
              Collectible name
              <input
                required
                minLength={3}
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="A name that makes it easy to find"
              />
            </label>
            <label className="field">
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Description & condition
              <textarea
                required
                minLength={10}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Edition, condition, and anything worth knowing."
              />
            </label>
            <ArtworkPicker value={artwork} onChange={setArtwork} onBusyChange={setUploadBusy} />
          </>
        ) : (
          <>
            <div className="mini-item">
              <CardArt variant={item?.artwork} />
              <div>
                <h3>{item?.title}</h3>
                <p>{item?.serial}</p>
              </div>
            </div>
            {type === 'list' ? (
              <>
                <label className="field">
                  Your asking price (USD)
                  <input
                    required
                    type="number"
                    min="1"
                    max="100000"
                    step=".01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </label>
                <dl className="spec-list">
                  <div>
                    <dt>Demo platform fee · 5%</dt>
                    <dd>{money(Math.round(Number(price) * 5))}</dd>
                  </div>
                  <div>
                    <dt>Expected seller proceeds</dt>
                    <dd>
                      {money(Math.round(Number(price) * 100) - Math.round(Number(price) * 5))}
                    </dd>
                  </div>
                </dl>
                <p className="muted">
                  Settlement is held after the sale and reviewed separately. No automatic creator
                  royalty is deducted.
                </p>
              </>
            ) : (
              <>
                {type === 'repool' && (
                  <div className="offer-panel">
                    <small>PROVISIONAL DEMO OFFER</small>
                    <strong>
                      {terms?.initial_credit_units ?? '…'} <span>credits</span>
                    </strong>
                    <p>
                      A fixed demo offer, not a market valuation. Credits are granted only after
                      receipt and acceptance.
                    </p>
                  </div>
                )}
                <label className="field">
                  Intake evidence & notes
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    placeholder="Describe identifying details, condition, and packaging."
                  />
                </label>
                <label className="checkbox terms">
                  <input
                    required
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  <span>
                    {type === 'repool'
                      ? `I accept the provisional ${terms?.initial_credit_units ?? '…'}-credit demo offer (${terms?.policy_version ?? 'loading'}). ${terms?.title_effect ?? ''} ${terms?.redemption_scope ?? ''}`
                      : 'I authorize receipt and inspection in the demo vault. Ownership remains mine. No real shipping label is generated.'}
                  </span>
                </label>
              </>
            )}
          </>
        )}
        <ErrorNotice error={action.error} />
        <ErrorNotice error={termsError} />
        <button
          className="button full"
          disabled={action.busy || uploadBusy || (type === 'repool' && !terms)}
        >
          {action.busy
            ? 'Saving…'
            : type === 'add'
              ? 'Add collectible'
              : type === 'list'
                ? 'Publish listing'
                : 'Request intake'}
          <ArrowRight size={17} />
        </button>
      </form>
    </Modal>
  );
}

export function Creator() {
  return (
    <AccountGate>
      <CreatorInner />
    </AccountGate>
  );
}
function CreatorInner() {
  const { user, clearPrivateData } = useSession();
  const organizations = user!.organizations.filter((o) => ['creator', 'platform'].includes(o.kind));
  const [chosen, setChosen] = useState('');
  const workspace = organizations.find((o) => o.id === chosen) || organizations[0];
  const org = workspace?.id;
  const canPublish = ['owner', 'publisher'].includes(workspace?.role || '');
  const { data, error, isPending } = useData(`/creator/${org}`, !!org);
  const action = useAction();
  const [modal, setModal] = useState<{ type: string; collection?: Row } | null>(null);
  if (!org)
    return (
      <>
        <PageTitle
          eyebrow="CREATOR STUDIO"
          title="Your ideas deserve a first edition."
          description="A shared home for your collections, your community, and your next big idea."
        />
        <div className="creator-invite">
          <span className="mini-spark">✳</span>
          <h2>Good things begin with an invitation.</h2>
          <p>
            Creator publishing is currently open to invited studios. Use the Creator demo account to
            try the full publishing and review workflow, or open a support case to request access.
          </p>
          <div className="button-row">
            <Link href="/account/settings" className="button">
              Switch to creator demo
              <ArrowRight size={16} />
            </Link>
            <Link href="/account/support" className="button secondary">
              Request access
            </Link>
          </div>
        </div>
      </>
    );
  if (isPending) return <Loading />;
  if (error) return <ErrorNotice error={error} />;
  return (
    <>
      <PageTitle
        eyebrow="CREATOR STUDIO"
        title="Make something worth collecting."
        description="From an idea to a first edition. Your creative world starts here."
      >
        <button disabled={!canPublish} className="button" onClick={() => setModal({ type: 'new' })}>
          <Plus size={17} />
          New collection
        </button>
      </PageTitle>
      <label className="workspace-select">
        Publishing workspace
        <select
          value={org}
          onChange={async (e) => {
            const value = e.target.value;
            setModal(null);
            await clearPrivateData();
            setChosen(value);
          }}
        >
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <div className="stats-grid">
        <Stat
          label="Your collections"
          value={data.collections.length}
          note="Original editions, together"
          icon={<Palette size={18} />}
        />
        <Stat
          label="Published"
          value={data.collections.filter((c: Row) => c.status === 'published').length}
          note="Live in the PixUP catalog"
          icon={<Layers size={18} />}
        />
        <Stat
          label="Recorded circulation"
          value={data.sales.filter((o: Row) => ['paid', 'fulfilled'].includes(o.status)).length}
          note="Attribution records · not guaranteed earnings"
          icon={<Repeat2 size={18} />}
        />
      </div>
      {!canPublish && (
        <p className="notice">
          Viewer access: you can read collections. An owner or publisher must make changes.
        </p>
      )}
      <SectionTitle title="Your collections" />
      <AttributionReport data={data.attribution} />
      <ErrorNotice error={action.error} />
      {data.collections.length ? (
        <div className="creator-collections">
          {data.collections.map((c: Row) => (
            <article className="panel creator-collection" key={c.id}>
              <div className={`creator-collection-art art-bg-${c.artwork}`}>
                <CardArt variant={c.artwork} />
              </div>
              <div className="creator-collection-body">
                <div className="section-title">
                  <span className="eyebrow">
                    {c.category} · {c.stock_count}/{c.edition_size} RECEIVED
                  </span>
                  <Status status={c.status} />
                </div>
                <h2>{c.title}</h2>
                <p>{c.description}</p>
                <div className="step-row">
                  {['Draft', 'Review', 'Production', 'Published'].map((label, index) => (
                    <span
                      className={
                        index <=
                        (['draft', 'changes_requested'].includes(c.status)
                          ? 0
                          : c.status === 'submitted'
                            ? 1
                            : c.status === 'published'
                              ? 3
                              : 2)
                          ? 'done'
                          : ''
                      }
                      key={label}
                    >
                      <i>{index + 1}</i>
                      {label}
                    </span>
                  ))}
                </div>
                {c.review_note && (
                  <div className="review-note">
                    <strong>Review note:</strong> {c.review_note}
                  </div>
                )}
                <div className="button-row">
                  {canPublish && ['draft', 'changes_requested'].includes(c.status) && (
                    <>
                      <button
                        className="button small secondary"
                        onClick={() => setModal({ type: 'edit', collection: c })}
                      >
                        Edit draft
                      </button>
                      <button
                        className="button small"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(
                            `/collections/${c.id}/actions`,
                            { action: 'submit' },
                            'Collection submitted for rights review.',
                          )
                        }
                      >
                        <Send size={14} />
                        Submit for review
                      </button>
                    </>
                  )}
                  {c.status === 'submitted' && (
                    <span className="muted">Your collection is with the review team.</span>
                  )}
                  {c.status === 'approved' && (
                    <span className="muted">
                      Approved. Operations must receive and assess stock before publishing.
                    </span>
                  )}
                  {canPublish && c.status === 'stock_ready' && (
                    <button
                      className="button small"
                      onClick={() => setModal({ type: 'publish', collection: c })}
                    >
                      Set price & publish
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                  {c.status === 'published' && (
                    <Link href={`/collections/${c.id}`} className="button small secondary">
                      View collection
                      <ArrowUpRight size={14} />
                    </Link>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="The first edition is yours to imagine."
          description="Create a collection, provide your rights evidence, and submit it for review."
        >
          <button
            disabled={!canPublish}
            className="button"
            onClick={() => setModal({ type: 'new' })}
          >
            Create your first collection
          </button>
        </Empty>
      )}
      <div className="notice subtle">
        <ShieldCheck size={22} />
        <div>
          <strong>Credit where it belongs.</strong>
          <p>
            {data.attribution_note} Revenue from your own inventory sales is reported in Seller
            Studio.
          </p>
        </div>
      </div>
      {modal && (
        <CreatorModal
          type={modal.type}
          collection={modal.collection}
          org={org}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
function CreatorModal({
  type,
  collection,
  org,
  onClose,
}: {
  type: string;
  collection?: Row;
  org: string;
  onClose: () => void;
}) {
  const [uploadBusy, setUploadBusy] = useState(false);
  const action = useAction();
  const [title, setTitle] = useState(collection?.title || ''),
    [description, setDescription] = useState(collection?.description || ''),
    [rights, setRights] = useState(collection?.rights_evidence || ''),
    [category, setCategory] = useState('Art'),
    [artwork, setArtwork] = useState('orbit'),
    [size, setSize] = useState('100'),
    [price, setPrice] = useState('50');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (uploadBusy) return;
    let result;
    if (type === 'publish')
      result = await action.run(
        `/collections/${collection!.id}/actions`,
        { action: 'publish', price_cents: Math.round(Number(price) * 100) },
        'Your collection is published.',
      );
    else if (type === 'edit')
      result = await action.run(
        `/collections/${collection!.id}/actions`,
        { action: 'save', title, description, rights_evidence: rights },
        'Draft saved.',
      );
    else
      result = await action.run(
        '/collections',
        {
          org_id: org,
          title,
          description,
          rights_evidence: rights,
          category,
          artwork,
          edition_size: Number(size),
        },
        'Your first draft is ready.',
      );
    if (result) onClose();
  }
  return (
    <Modal
      title={
        type === 'publish'
          ? 'Your first edition is ready.'
          : type === 'edit'
            ? 'Make it your own.'
            : 'Every collection starts with an idea.'
      }
      onClose={onClose}
    >
      <form className="form-panel" onSubmit={submit}>
        {type === 'publish' ? (
          <>
            <h3>{collection?.title}</h3>
            <p>
              {collection?.stock_count} assessed, vaulted specimens will be published as individual
              listings.
            </p>
            <label className="field">
              Price per collectible (USD)
              <input
                required
                type="number"
                min="1"
                max="100000"
                step=".01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              Collection title
              <input
                required
                minLength={3}
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give your first edition a name"
              />
            </label>
            <label className="field">
              The story behind it
              <textarea
                required
                minLength={20}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What makes this collection worth keeping?"
              />
            </label>
            {type === 'new' && (
              <>
                <div className="form-two">
                  <label className="field">
                    Category
                    <select value={category} onChange={(e) => setCategory(e.target.value)}>
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Edition size
                    <input
                      required
                      type="number"
                      min="1"
                      max="10000"
                      value={size}
                      onChange={(e) => setSize(e.target.value)}
                    />
                  </label>
                </div>
                <ArtworkPicker value={artwork} onChange={setArtwork} onBusyChange={setUploadBusy} />
              </>
            )}
            <label className="field">
              Rights & ownership evidence
              <textarea
                required
                minLength={20}
                maxLength={4000}
                value={rights}
                onChange={(e) => setRights(e.target.value)}
                placeholder="Describe ownership, licensing scope, territory, and authorization. Use fictional evidence for this demo."
                rows={4}
              />
            </label>
            <p className="muted">
              Publishing requires independent rights review, physical stock receipt, and VIA
              assessment. Creating a draft does not make items purchasable.
            </p>
          </>
        )}
        <ErrorNotice error={action.error} />
        <button className="button full" disabled={action.busy || uploadBusy}>
          {action.busy
            ? 'Saving…'
            : type === 'publish'
              ? 'Publish collection'
              : type === 'edit'
                ? 'Save changes'
                : 'Create draft'}
          <ArrowRight size={16} />
        </button>
      </form>
    </Modal>
  );
}
