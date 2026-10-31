'use client';
import { useI18n } from './i18n';
import { AccessAdministrationPanel } from './identity-access';
import { CommunityModeration } from './community';
import { CommercialOperations } from './commercial';
import { useState } from 'react';
import {
  ShieldCheck,
  Package,
  ArrowRight,
  Check,
  AlertCircle,
  Wallet,
  Activity,
  ClipboardCheck,
} from 'lucide-react';
import { useData, useAction, useSession, type Row } from './providers';
import { CardArt } from './art';
import { PrivacyQueue, MonitoringPanel } from './privacy-operations';
import { PricingOperations, TrustOperations } from './price-trust';
import { BillingOperations, FinanceApprovals } from './saas-inventory';
import { PaymentOperations } from './payment-operations';
import { EvidenceWorkspace, LogisticsOperations } from './evidence-logistics';
import { operationsSamples, operationsSampleTabs } from './operations-samples';
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
} from './ui';

export function Operations() {
  return (
    <AccountGate staff>
      <OperationsInner />
    </AccountGate>
  );
}
function OperationsInner() {
  const { t: tr, money, date, number } = useI18n();

  const { user } = useSession();
  const permissions = user?.staff_permissions || [];
  const can = (permission: (typeof permissions)[number]) => permissions.includes(permission);
  const tabs = [
    ...(can('warehouse') || can('via') || can('support') ? ['Physical handling'] : []),
    ...(can('warehouse') || can('rights') || can('support') || can('audit') ? ['Evidence'] : []),
    ...(can('warehouse') || can('via') ? ['Intakes'] : []),
    ...(can('rights') || (can('warehouse') && can('via')) ? ['Publishing'] : []),
    ...(can('warehouse') ? ['Fulfillment'] : []),
    ...(can('finance')
      ? [
          'Payments',
          'Settlements',
          'Reconciliation',
          'Pricing',
          'Billing',
          'Approvals',
          'Commercial',
        ]
      : []),
    ...(can('community_moderation') ? ['Community'] : []),
    ...(can('identity_admin') ? ['Access'] : []),
    ...(can('support') ? ['Support', 'Privacy'] : []),
    ...(can('audit') ? ['Audit', 'Monitoring', 'Signatures'] : []),
  ];
  const { data: liveData, error, isPending } = useData('/ops');
  const [samplePreference, setSamplePreference] = useState<boolean | null>(null);
  const [tab, setTab] = useState(tabs.includes('Intakes') ? 'Intakes' : tabs[0] || ''),
    [modal, setModal] = useState<{ type: string; row: Row } | null>(null);
  if (isPending) return <Loading />;
  if (error) return <ErrorNotice error={error} />;
  const emptyWorkspace = ['intakes', 'collections', 'orders', 'settlements', 'cases'].every(
    (queue) => liveData[queue].length === 0,
  );
  const sampleMode = (samplePreference ?? emptyWorkspace) && operationsSampleTabs.has(tab);
  const data = sampleMode ? operationsSamples(permissions) : liveData;
  const openIntakes = data.intakes.filter((i: Row) =>
    ['awaiting_receipt', 'received'].includes(i.status),
  );
  return (
    <>
      <PageTitle
        eyebrow={tr('PIXUP OPERATIONS')}
        title={tr('Trust is in the details.')}
        description={tr('Review carefully. Record clearly. Keep every chapter connected.')}
      >
        <Badge tone="green">
          <ShieldCheck size={14} />
          {tr('Authorized staff workspace')}
        </Badge>
      </PageTitle>
      {operationsSampleTabs.has(tab) && (
        <div className="notice subtle">
          <Activity size={18} />
          <div>
            <strong>
              {sampleMode ? tr('Sample operations data') : tr('Live operations data')}
            </strong>
            <p>
              {sampleMode
                ? tr(
                    'Fictional records for exploring the workspace. Sample actions are disabled and nothing is saved.',
                  )
                : tr(
                    'Showing saved records. Preview sample data to explore typical queues and statuses.',
                  )}
            </p>
            <button
              className="button small secondary"
              onClick={() => {
                setModal(null);
                setSamplePreference(!sampleMode);
              }}
            >
              {sampleMode ? tr('Show live data') : tr('Show sample data')}
            </button>
          </div>
        </div>
      )}
      <div className="stats-grid">
        <Stat
          label={tr('Intakes awaiting action')}
          value={openIntakes.length}
          note={tr('Physical receipt and VIA review')}
          icon={<Package size={18} />}
        />
        <Stat
          label={tr('Collections in review')}
          value={data.collections.length}
          note={tr('Rights approval and stock intake')}
          icon={<ClipboardCheck size={18} />}
        />
        <Stat
          label={tr('Journal integrity')}
          value={
            data.integrity
              ? data.integrity.unbalanced === 0
                ? 'Balanced'
                : 'Review needed'
              : 'Restricted'
          }
          note={
            data.integrity
              ? `${data.integrity.pending_events} notifications awaiting dispatch`
              : tr('Finance permission required')
          }
          icon={<Activity size={18} />}
        />
      </div>
      <div className="tabs spaced">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'selected' : ''}>
            {tr(t)}
          </button>
        ))}
      </div>
      {tab === 'Evidence' && <EvidenceWorkspace />}
      {tab === 'Community' && <CommunityModeration />}
      {tab === 'Commercial' && <CommercialOperations />}
      {tab === 'Physical handling' && <LogisticsOperations />}
      {tab === 'Intakes' && (
        <>
          {data.intakes.length ? (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tr('Collectible / owner')}</th>
                    <th>{tr('Request')}</th>
                    <th>{tr('Status')}</th>
                    <th>{tr('Evidence')}</th>
                    <th>{tr('Next action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.intakes.map((i: Row) => (
                    <tr key={i.id}>
                      <td>
                        <div className="table-item">
                          <CardArt variant={i.artwork} />
                          <div>
                            <strong>{i.title}</strong>
                            <small>
                              {i.owner_name} · {i.serial}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {i.kind === 'repool'
                          ? `RePool · ${i.offered_credits} credits`
                          : tr('Vault & VIA')}
                      </td>
                      <td>
                        <Status status={i.status} />
                      </td>
                      <td className="evidence-cell">{i.evidence}</td>
                      <td>
                        {i.status === 'awaiting_receipt' && can('warehouse') ? (
                          <button
                            disabled={sampleMode}
                            className="button small secondary"
                            onClick={() =>
                              data.physical_capture_required && !i.capture_id
                                ? setTab('Physical handling')
                                : setModal({ type: 'receive', row: i })
                            }
                          >
                            {data.physical_capture_required && !i.capture_id
                              ? tr('Capture physical identity')
                              : tr('Record receipt')}
                          </button>
                        ) : i.status === 'received' &&
                          i.offer_status === 'declined' &&
                          can('warehouse') ? (
                          <button
                            disabled={sampleMode}
                            className="button small secondary"
                            onClick={() => setModal({ type: 'return', row: i })}
                          >
                            {tr('Record demo return')}
                          </button>
                        ) : i.status === 'received' && can('via') ? (
                          <div className="button-row">
                            <button
                              disabled={
                                sampleMode || (i.kind === 'repool' && i.offer_status !== 'accepted')
                              }
                              className="button small"
                              onClick={() => setModal({ type: 'inspect', row: i })}
                            >
                              {tr('Inspect & decide')}
                            </button>
                            {i.kind === 'repool' && i.offer_status !== 'declined' && (
                              <button
                                disabled={sampleMode}
                                className="button small secondary"
                                onClick={() => setModal({ type: 'reoffer', row: i })}
                              >
                                {tr('Revise offer')}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="muted">{i.review_note || tr('Review complete')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={tr('The intake queue is clear.')}
              description={tr('Seller vault and RePool requests will appear here.')}
            />
          )}
          <div className="notice subtle">
            <ShieldCheck size={18} />
            <div>
              <strong>{tr('Certificate correction')}</strong>
              <p>
                {tr(
                  'Revocation preserves earlier assessments and withdraws active listings. A pending checkout must be resolved first.',
                )}
              </p>
              <button
                disabled={sampleMode || !can('via')}
                className="text-link"
                onClick={() => setModal({ type: 'revoke', row: {} })}
              >
                {tr('Revoke a certificate →')}
              </button>
            </div>
          </div>
        </>
      )}
      {tab === 'Publishing' &&
        (data.collections.length ? (
          <div className="review-grid">
            {data.collections.map((c: Row) => (
              <article key={c.id} className="panel review-card">
                <div className="section-title">
                  <Badge>{c.category}</Badge>
                  <Status status={c.status} />
                </div>
                <h2>{c.title}</h2>
                <p>{c.description}</p>
                <div className="review-evidence">
                  <small>{tr('RIGHTS EVIDENCE')}</small>
                  <p>{c.rights_evidence}</p>
                </div>
                <dl className="spec-list">
                  <div>
                    <dt>{tr('Publisher')}</dt>
                    <dd>{c.creator_name}</dd>
                  </div>
                  <div>
                    <dt>{tr('Edition cap')}</dt>
                    <dd>{c.edition_size}</dd>
                  </div>
                </dl>
                <button
                  className="button secondary full"
                  disabled={
                    sampleMode ||
                    (c.status === 'submitted' ? !can('rights') : !(can('warehouse') && can('via')))
                  }
                  onClick={() =>
                    setModal({ type: c.status === 'submitted' ? 'rights' : 'stock', row: c })
                  }
                >
                  {c.status === 'submitted'
                    ? tr('Review rights submission')
                    : tr('Receive production stock')}
                  <ArrowRight size={16} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title={tr('No collections awaiting action.')}
            description={tr(
              'Creator submissions and approved editions awaiting stock will appear here.',
            )}
          />
        ))}
      {tab === 'Fulfillment' &&
        (data.orders.length ? (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr('Collectible')}</th>
                  <th>{tr('Destination')}</th>
                  <th>{tr('Status')}</th>
                  <th>{tr('Tracking')}</th>
                  <th>{tr('Action')}</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o: Row) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.title}</strong>
                      <small className="block muted">#{o.id.slice(0, 8)}</small>
                    </td>
                    <td>
                      {o.fulfillment === 'vault' ? tr('Retained in vault') : o.shipping_address}
                    </td>
                    <td>
                      <Status status={o.status} />
                    </td>
                    <td>{o.tracking || '—'}</td>
                    <td>
                      {o.status === 'paid' && o.fulfillment === 'ship' ? (
                        <button
                          disabled={sampleMode}
                          className="button small"
                          onClick={() =>
                            data.physical_capture_required || o.tracked
                              ? setTab('Physical handling')
                              : setModal({ type: 'fulfill', row: o })
                          }
                        >
                          {data.physical_capture_required || o.tracked
                            ? tr('Open shipment tracking')
                            : tr('Record demo shipment')}
                        </button>
                      ) : (
                        <span className="muted">{tr('Complete')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={tr('Nothing waiting to ship.')}
            description={tr('Confirmed orders will appear here.')}
          />
        ))}
      {tab === 'Settlements' &&
        (data.settlements.length ? (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr('Collectible')}</th>
                  <th>{tr('Seller')}</th>
                  <th>{tr('Proceeds')}</th>
                  <th>{tr('Status')}</th>
                  <th>{tr('Action')}</th>
                </tr>
              </thead>
              <tbody>
                {data.settlements.map((s: Row) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.title}</strong>
                    </td>
                    <td>{s.seller_id}</td>
                    <td>{money(s.amount_cents)}</td>
                    <td>
                      <Status status={s.status} />
                    </td>
                    <td>
                      {s.status === 'held' && s.payment_provider === 'demo' ? (
                        <button
                          disabled={sampleMode}
                          className="button small secondary"
                          onClick={() => setModal({ type: 'release', row: s })}
                        >
                          {tr('Review demo payout')}
                        </button>
                      ) : (
                        <span className="muted">
                          {s.payment_provider === 'stripe_test'
                            ? tr('Stripe payouts unavailable')
                            : tr('Recorded')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="table-note">
              {tr('Demo payout only. There is no payment-provider or bank connection.')}
            </p>
          </div>
        ) : (
          <Empty
            title={tr('No settlements yet.')}
            description={tr('Confirmed sales create held seller obligations here.')}
          />
        ))}
      {tab === 'Support' &&
        (data.cases.length ? (
          <div className="review-grid">
            {data.cases.map((c: Row) => (
              <article className="panel review-card" key={c.id}>
                <div className="section-title">
                  <small>{c.user_name}</small>
                  <Status status={c.status} />
                </div>
                <h2>{c.subject}</h2>
                <p>{c.body}</p>
                {c.order_id && (
                  <code>
                    {tr('Order: ')}
                    {c.order_id}
                  </code>
                )}
                {c.response && (
                  <div className="notice">
                    <p>{c.response}</p>
                  </div>
                )}
                {c.status === 'open' && (
                  <button
                    disabled={sampleMode}
                    className="button secondary"
                    onClick={() => setModal({ type: 'resolve', row: c })}
                  >
                    {tr('Respond & resolve')}
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title={tr('No support cases open.')}
            description={tr('Collector questions and order disputes will appear here.')}
          />
        ))}
      {tab === 'Privacy' && <PrivacyQueue />}
      {tab === 'Pricing' && <PricingOperations />}
      {tab === 'Billing' && <BillingOperations />}
      {tab === 'Approvals' && <FinanceApprovals />}
      {tab === 'Signatures' && <TrustOperations />}
      {tab === 'Monitoring' && <MonitoringPanel />}
      {tab === 'Access' && <AccessAdministrationPanel />}
      {tab === 'Payments' && <PaymentOperations />}
      {tab === 'Reconciliation' && (
        <>
          <div className="notice warning">
            <AlertCircle size={21} />
            <div>
              <strong>{tr('Internal demo reconciliation only')}</strong>
              <p>
                {tr(
                  'Journal balances do not verify external cash. Stripe test sessions and refunds are reconciled in Payments; bank statements and physical inventory feeds are not connected. USD and credits remain separate units.',
                )}
              </p>
            </div>
          </div>
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr('Ledger account')}</th>
                  <th>{tr('Unit')}</th>
                  <th>{tr('Signed balance')}</th>
                </tr>
              </thead>
              <tbody>
                {data.balances.map((b: Row) => (
                  <tr key={`${b.unit}-${b.account}`}>
                    <td>
                      <code>{b.account}</code>
                    </td>
                    <td>
                      <Badge>{b.unit}</Badge>
                    </td>
                    <td>
                      {b.unit === 'USD' ? money(b.balance) : `${number(Number(b.balance))} credits`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {tr(
              'Positive amounts are debits; negative amounts are credits. Every posted entry must net to zero within its unit.',
            )}
          </p>
        </>
      )}
      {tab === 'Audit' &&
        (data.audit.length ? (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr('Action')}</th>
                  <th>{tr('Actor')}</th>
                  <th>{tr('Resource')}</th>
                  <th>{tr('Date')}</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((a: Row) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.action}</strong>
                    </td>
                    <td>{a.actor_name}</td>
                    <td>
                      <code>{a.resource_id.slice(0, 16)}</code>
                    </td>
                    <td>{date(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={tr('Your audit trail starts here.')}
            description={tr('Operational changes are recorded with actor, resource, and time.')}
          />
        ))}
      {!sampleMode && modal && (
        <OperationModal type={modal.type} row={modal.row} onClose={() => setModal(null)} />
      )}
    </>
  );
}
function OperationModal({ type, row, onClose }: { type: string; row: Row; onClose: () => void }) {
  const { t: tr, money } = useI18n();

  const action = useAction();
  const [note, setNote] = useState(''),
    [approve, setApprove] = useState(true),
    [grade, setGrade] = useState('9.5'),
    [quantity, setQuantity] = useState('1'),
    [tracking, setTracking] = useState(''),
    [assetId, setAssetId] = useState(''),
    [credits, setCredits] = useState(String(row.offered_credits || 500));
  const titles: Record<string, string> = {
    reoffer: 'Revise provisional RePool offer',
    return: 'Record demo return to owner',
    receive: 'Record physical receipt',
    inspect: 'VIA inspection & intake decision',
    rights: 'Review collection rights',
    stock: 'Receive & assess production stock',
    fulfill: 'Record a demonstration shipment',
    release: 'Request settlement release review',
    resolve: 'Respond to a support case',
    revoke: 'Revoke active VIA certification',
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let result;
    if (type === 'reoffer')
      result = await action.run(
        `/ops/intakes/${row.id}/reoffer`,
        { expected_version: row.offer_version, credit_units: Number(credits), note },
        'Revised offer sent for owner consent.',
      );
    if (type === 'return')
      result = await action.run(
        `/ops/intakes/${row.id}`,
        { action: 'return', note },
        'Demo return recorded; no credits issued.',
      );
    if (type === 'receive' || type === 'inspect')
      result = await action.run(
        `/ops/intakes/${row.id}`,
        { action: type === 'receive' ? 'receive' : approve ? 'accept' : 'reject', note, grade },
        'Intake updated.',
      );
    if (type === 'rights')
      result = await action.run(
        `/ops/collections/${row.id}/review`,
        { approve, note },
        'Rights review recorded.',
      );
    if (type === 'stock')
      result = await action.run(
        `/ops/collections/${row.id}/stock`,
        { quantity: Number(quantity), evidence: note },
        'Stock received. The creator can now publish.',
      );
    if (type === 'fulfill')
      result = await action.run(
        `/ops/orders/${row.id}/fulfill`,
        { tracking },
        'Demo shipment recorded.',
      );
    if (type === 'release')
      result = await action.run(
        `/ops/settlements/${row.id}/release`,
        { reason: note },
        'Independent finance approval requested. No payout has occurred.',
      );
    if (type === 'resolve')
      result = await action.run(
        `/ops/support/${row.id}/resolve`,
        { response: note },
        'Response saved and case resolved.',
      );
    if (type === 'revoke')
      result = await action.run(
        `/ops/assets/${assetId}/revoke`,
        { note },
        'Certificate revoked and asset quarantined.',
      );
    if (result) onClose();
  }
  return (
    <Modal title={titles[type]} onClose={onClose}>
      <form className="form-panel" onSubmit={submit}>
        {row.title && <h3>{row.title}</h3>}
        {row.subject && <h3>{row.subject}</h3>}
        {type === 'reoffer' && (
          <>
            <p>
              {tr('Previous offer: ')}
              {row.offered_credits}
              {tr(' credits · v')}
              {row.offer_version}
              {tr(
                '. The new version expires in seven days and requires explicit owner acceptance.',
              )}
            </p>
            <label className="field">
              {tr('Revised demo credits')}
              <input
                required
                type="number"
                min="1"
                max="1000000"
                step="1"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
              />
            </label>
          </>
        )}
        {type === 'return' && (
          <p>
            {tr(
              'Record the simulated physical return. Ownership stays with the owner and no credits are issued. A fresh custody and VIA review is required before listing again.',
            )}
          </p>
        )}

        {['rights', 'inspect'].includes(type) && (
          <label className="field">
            {tr('Decision')}
            <select
              value={approve ? 'approve' : 'reject'}
              onChange={(e) => setApprove(e.target.value === 'approve')}
            >
              <option value="approve">
                {type === 'rights' ? tr('Approve rights submission') : tr('Accept inspection')}
              </option>
              <option value="reject">
                {type === 'rights' ? tr('Request changes') : tr('Reject and quarantine')}
              </option>
            </select>
          </label>
        )}
        {type === 'inspect' && approve && (
          <label className="field">
            {tr('Condition grade')}
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              {['10', '9.5', '9', '8', '7'].map((g) => (
                <option key={g} value={g}>
                  {tr(g)}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === 'stock' && (
          <>
            <label className="field">
              {tr('Specimens physically received')}
              <input
                required
                type="number"
                min="1"
                max={Math.min(100, row.edition_size)}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <p className="muted">
              {tr(
                'Demo batch assessment records each received specimen as grade 10. Production requires individual evidence capture and QC.',
              )}
            </p>
          </>
        )}
        {type === 'fulfill' && (
          <label className="field">
            {tr('Demo tracking reference')}
            <input
              required
              minLength={5}
              maxLength={150}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder={tr('DEMO-SHIP-0001')}
            />
          </label>
        )}
        {type === 'release' && (
          <div className="notice warning">
            <strong>
              {money(row.amount_cents)}
              {tr(' · simulated seller proceeds')}
            </strong>
            <p>
              {tr(
                'The order must be fulfilled, with no open support cases. A different finance reviewer must approve this exact amount before a simulated release.',
              )}
            </p>
          </div>
        )}
        {type === 'revoke' && (
          <label className="field">
            {tr('Collectible ID')}
            <input
              required
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              placeholder={tr('ID from the collectible URL')}
            />
          </label>
        )}
        {type !== 'fulfill' && (
          <label className="field">
            {type === 'resolve' ? tr('Response') : tr('Evidence & decision notes')}
            <textarea
              required
              minLength={10}
              maxLength={2000}
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={tr('Describe the evidence and reason for this action.')}
            />
          </label>
        )}
        <ErrorNotice error={action.error} />
        <button className="button full" disabled={action.busy}>
          {action.busy ? tr('Recording…') : tr('Record decision')}
          <Check size={17} />
        </button>
      </form>
    </Modal>
  );
}
