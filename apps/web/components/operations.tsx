'use client';
import { AccessAdministrationPanel } from './identity-access';
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

export function Operations() {
  return (
    <AccountGate staff>
      <OperationsInner />
    </AccountGate>
  );
}
function OperationsInner() {
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
    ...(can('identity_admin') ? ['Access'] : []),
    ...(can('support') ? ['Support', 'Privacy'] : []),
    ...(can('audit') ? ['Audit', 'Monitoring', 'Signatures'] : []),
  ];
  const { data, error, isPending } = useData('/ops');
  const [tab, setTab] = useState(tabs.includes('Intakes') ? 'Intakes' : tabs[0] || ''),
    [modal, setModal] = useState<{ type: string; row: Row } | null>(null);
  if (isPending) return <Loading />;
  if (error) return <ErrorNotice error={error} />;
  const openIntakes = data.intakes.filter((i: Row) =>
    ['awaiting_receipt', 'received'].includes(i.status),
  );
  return (
    <>
      <PageTitle
        eyebrow="PIXUP OPERATIONS"
        title="Trust is in the details."
        description="Review carefully. Record clearly. Keep every chapter connected."
      >
        <Badge tone="green">
          <ShieldCheck size={14} />
          Authorized staff workspace
        </Badge>
      </PageTitle>
      <div className="stats-grid">
        <Stat
          label="Intakes awaiting action"
          value={openIntakes.length}
          note="Physical receipt and VIA review"
          icon={<Package size={18} />}
        />
        <Stat
          label="Collections in review"
          value={data.collections.length}
          note="Rights approval and stock intake"
          icon={<ClipboardCheck size={18} />}
        />
        <Stat
          label="Journal integrity"
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
              : 'Finance permission required'
          }
          icon={<Activity size={18} />}
        />
      </div>
      <div className="tabs spaced">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'selected' : ''}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Evidence' && <EvidenceWorkspace />}
      {tab === 'Commercial' && <CommercialOperations />}
      {tab === 'Physical handling' && <LogisticsOperations />}
      {tab === 'Intakes' && (
        <>
          {data.intakes.length ? (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Collectible / owner</th>
                    <th>Request</th>
                    <th>Status</th>
                    <th>Evidence</th>
                    <th>Next action</th>
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
                          : 'Vault & VIA'}
                      </td>
                      <td>
                        <Status status={i.status} />
                      </td>
                      <td className="evidence-cell">{i.evidence}</td>
                      <td>
                        {i.status === 'awaiting_receipt' && can('warehouse') ? (
                          <button
                            className="button small secondary"
                            onClick={() =>
                              data.physical_capture_required && !i.capture_id
                                ? setTab('Physical handling')
                                : setModal({ type: 'receive', row: i })
                            }
                          >
                            {data.physical_capture_required && !i.capture_id
                              ? 'Capture physical identity'
                              : 'Record receipt'}
                          </button>
                        ) : i.status === 'received' &&
                          i.offer_status === 'declined' &&
                          can('warehouse') ? (
                          <button
                            className="button small secondary"
                            onClick={() => setModal({ type: 'return', row: i })}
                          >
                            Record demo return
                          </button>
                        ) : i.status === 'received' && can('via') ? (
                          <div className="button-row">
                            <button
                              disabled={i.kind === 'repool' && i.offer_status !== 'accepted'}
                              className="button small"
                              onClick={() => setModal({ type: 'inspect', row: i })}
                            >
                              Inspect & decide
                            </button>
                            {i.kind === 'repool' && i.offer_status !== 'declined' && (
                              <button
                                className="button small secondary"
                                onClick={() => setModal({ type: 'reoffer', row: i })}
                              >
                                Revise offer
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="muted">{i.review_note || 'Review complete'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="The intake queue is clear."
              description="Seller vault and RePool requests will appear here."
            />
          )}
          <div className="notice subtle">
            <ShieldCheck size={18} />
            <div>
              <strong>Certificate correction</strong>
              <p>
                Revocation preserves earlier assessments and withdraws active listings. A pending
                checkout must be resolved first.
              </p>
              <button
                disabled={!can('via')}
                className="text-link"
                onClick={() => setModal({ type: 'revoke', row: {} })}
              >
                Revoke a certificate →
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
                  <small>RIGHTS EVIDENCE</small>
                  <p>{c.rights_evidence}</p>
                </div>
                <dl className="spec-list">
                  <div>
                    <dt>Publisher</dt>
                    <dd>{c.creator_name}</dd>
                  </div>
                  <div>
                    <dt>Edition cap</dt>
                    <dd>{c.edition_size}</dd>
                  </div>
                </dl>
                <button
                  className="button secondary full"
                  disabled={
                    c.status === 'submitted' ? !can('rights') : !(can('warehouse') && can('via'))
                  }
                  onClick={() =>
                    setModal({ type: c.status === 'submitted' ? 'rights' : 'stock', row: c })
                  }
                >
                  {c.status === 'submitted'
                    ? 'Review rights submission'
                    : 'Receive production stock'}
                  <ArrowRight size={16} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="No collections awaiting action."
            description="Creator submissions and approved editions awaiting stock will appear here."
          />
        ))}
      {tab === 'Fulfillment' &&
        (data.orders.length ? (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Collectible</th>
                  <th>Destination</th>
                  <th>Status</th>
                  <th>Tracking</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o: Row) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.title}</strong>
                      <small className="block muted">#{o.id.slice(0, 8)}</small>
                    </td>
                    <td>{o.fulfillment === 'vault' ? 'Retained in vault' : o.shipping_address}</td>
                    <td>
                      <Status status={o.status} />
                    </td>
                    <td>{o.tracking || '—'}</td>
                    <td>
                      {o.status === 'paid' && o.fulfillment === 'ship' ? (
                        <button
                          className="button small"
                          onClick={() =>
                            data.physical_capture_required || o.tracked
                              ? setTab('Physical handling')
                              : setModal({ type: 'fulfill', row: o })
                          }
                        >
                          {data.physical_capture_required || o.tracked
                            ? 'Open shipment tracking'
                            : 'Record demo shipment'}
                        </button>
                      ) : (
                        <span className="muted">Complete</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Nothing waiting to ship."
            description="Confirmed orders will appear here."
          />
        ))}
      {tab === 'Settlements' &&
        (data.settlements.length ? (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Collectible</th>
                  <th>Seller</th>
                  <th>Proceeds</th>
                  <th>Status</th>
                  <th>Action</th>
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
                          className="button small secondary"
                          onClick={() => setModal({ type: 'release', row: s })}
                        >
                          Review demo payout
                        </button>
                      ) : (
                        <span className="muted">
                          {s.payment_provider === 'stripe_test'
                            ? 'Stripe payouts unavailable'
                            : 'Recorded'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="table-note">
              Demo payout only. There is no payment-provider or bank connection.
            </p>
          </div>
        ) : (
          <Empty
            title="No settlements yet."
            description="Confirmed sales create held seller obligations here."
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
                {c.order_id && <code>Order: {c.order_id}</code>}
                {c.response && (
                  <div className="notice">
                    <p>{c.response}</p>
                  </div>
                )}
                {c.status === 'open' && (
                  <button
                    className="button secondary"
                    onClick={() => setModal({ type: 'resolve', row: c })}
                  >
                    Respond & resolve
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="No support cases open."
            description="Collector questions and order disputes will appear here."
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
              <strong>Internal demo reconciliation only</strong>
              <p>
                Journal balances do not verify external cash. Stripe test sessions and refunds are
                reconciled in Payments; bank statements and physical inventory feeds are not
                connected. USD and credits remain separate units.
              </p>
            </div>
          </div>
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ledger account</th>
                  <th>Unit</th>
                  <th>Signed balance</th>
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
                      {b.unit === 'USD'
                        ? money(b.balance)
                        : `${b.balance.toLocaleString()} credits`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Positive amounts are debits; negative amounts are credits. Every posted entry must net
            to zero within its unit.
          </p>
        </>
      )}
      {tab === 'Audit' &&
        (data.audit.length ? (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Resource</th>
                  <th>Date</th>
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
            title="Your audit trail starts here."
            description="Operational changes are recorded with actor, resource, and time."
          />
        ))}
      {modal && <OperationModal type={modal.type} row={modal.row} onClose={() => setModal(null)} />}
    </>
  );
}
function OperationModal({ type, row, onClose }: { type: string; row: Row; onClose: () => void }) {
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
              Previous offer: {row.offered_credits} credits · v{row.offer_version}. The new version
              expires in seven days and requires explicit owner acceptance.
            </p>
            <label className="field">
              Revised demo credits
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
            Record the simulated physical return. Ownership stays with the owner and no credits are
            issued. A fresh custody and VIA review is required before listing again.
          </p>
        )}

        {['rights', 'inspect'].includes(type) && (
          <label className="field">
            Decision
            <select
              value={approve ? 'approve' : 'reject'}
              onChange={(e) => setApprove(e.target.value === 'approve')}
            >
              <option value="approve">
                {type === 'rights' ? 'Approve rights submission' : 'Accept inspection'}
              </option>
              <option value="reject">
                {type === 'rights' ? 'Request changes' : 'Reject and quarantine'}
              </option>
            </select>
          </label>
        )}
        {type === 'inspect' && approve && (
          <label className="field">
            Condition grade
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              {['10', '9.5', '9', '8', '7'].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
        )}
        {type === 'stock' && (
          <>
            <label className="field">
              Specimens physically received
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
              Demo batch assessment records each received specimen as grade 10. Production requires
              individual evidence capture and QC.
            </p>
          </>
        )}
        {type === 'fulfill' && (
          <label className="field">
            Demo tracking reference
            <input
              required
              minLength={5}
              maxLength={150}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="DEMO-SHIP-0001"
            />
          </label>
        )}
        {type === 'release' && (
          <div className="notice warning">
            <strong>{money(row.amount_cents)} · simulated seller proceeds</strong>
            <p>
              The order must be fulfilled, with no open support cases. A different finance reviewer
              must approve this exact amount before a simulated release.
            </p>
          </div>
        )}
        {type === 'revoke' && (
          <label className="field">
            Collectible ID
            <input
              required
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              placeholder="ID from the collectible URL"
            />
          </label>
        )}
        {type !== 'fulfill' && (
          <label className="field">
            {type === 'resolve' ? 'Response' : 'Evidence & decision notes'}
            <textarea
              required
              minLength={10}
              maxLength={2000}
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe the evidence and reason for this action."
            />
          </label>
        )}
        <ErrorNotice error={action.error} />
        <button className="button full" disabled={action.busy}>
          {action.busy ? 'Recording…' : 'Record decision'}
          <Check size={17} />
        </button>
      </form>
    </Modal>
  );
}
