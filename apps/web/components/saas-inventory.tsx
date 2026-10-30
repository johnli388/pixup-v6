'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useData, useAction, useSession, type Row } from './providers';
import { Loading, ErrorNotice, money, date } from './ui';
const limits = {
  seats: 5,
  asset_registrations: 50,
  collection_drafts: 5,
  listing_creations: 20,
  tool_calls: 100,
};
const label = (s: string) => s.replaceAll('_', ' ');
export function BillingSettings() {
  const { user, clearPrivateData } = useSession();
  const [selected, setSelected] = useState('');
  const orgs = user!.organizations.filter((o) => o.role === 'owner'),
    org = orgs.find((o) => o.id === selected) || orgs[0];
  return (
    <section className="panel">
      <h2>Subscription and usage</h2>
      <p>
        Monthly plans use Stripe test billing. Usage is included in the plan; no overage charges are
        made. Access permissions and commercial approval gates are separate.
      </p>
      <label>
        Billing workspace
        <select
          value={org?.id || ''}
          onChange={async (e) => {
            const id = e.target.value;
            await clearPrivateData();
            setSelected(id);
          }}
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {org && <BillingAccount key={org.id} org={org.id} />}
    </section>
  );
}
function BillingAccount({ org }: { org: string }) {
  const { data, error, isPending, refetch } = useData<Row>(`/billing/accounts/${org}`),
    { data: plans } = useData<Row>('/billing/plans'),
    action = useAction(),
    params = useSearchParams(),
    seen = useRef('');
  const [choice, setChoice] = useState(''),
    [agree, setAgree] = useState(false);
  useEffect(() => {
    const sid = params.get('billing_return');
    if (sid && data?.subscriptions.some((s: Row) => s.id === sid) && seen.current !== sid) {
      seen.current = sid;
      void action.run(`/billing/subscriptions/${sid}/refresh`, {}).then(() => refetch());
    }
  }, [data, params, action, refetch]);
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  const selected = plans?.plans.find((p: Row) => p.id === choice) || plans?.plans[0];
  const run = async (s: Row, mode: string, resume = false) => {
    const r = await action.run(`/billing/subscriptions/${s.id}/${mode}`, {});
    await refetch();
    if (resume && r?.checkout_url) window.location.assign(r.checkout_url);
  };
  return (
    <>
      <p>
        <strong>{data.entitlement.plan}</strong> · {label(data.entitlement.state)} ·{' '}
        {data.usage_window}
      </p>
      <ErrorNotice error={action.error} />
      <dl className="spec-list">
        {Object.entries(data.entitlement.limits).map(([k, v]) => (
          <div key={k}>
            <dt>{label(k)}</dt>
            <dd>
              {k === 'seats'
                ? 'Current seat cap'
                : `${data.usage.find((u: Row) => u.metric === k)?.quantity || 0} used this month`}{' '}
              / {String(v)}
            </dd>
          </div>
        ))}
      </dl>
      {!plans?.enabled && (
        <p className="notice">
          Subscription checkout is not configured. Existing pilot access remains available.
        </p>
      )}
      {selected ? (
        <form
          className="channel-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!agree) return;
            const r = await action.run(`/billing/accounts/${org}/checkout`, {
              plan_id: selected.id,
            });
            await refetch();
            if (r?.checkout_url) window.location.assign(r.checkout_url);
          }}
        >
          <label>
            Reviewed test plan
            <select
              value={selected.id}
              onChange={(e) => {
                setChoice(e.target.value);
                setAgree(false);
              }}
            >
              {plans!.plans.map((p: Row) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.audience} · {money(p.amount_cents)}/month
                </option>
              ))}
            </select>
          </label>
          <p>
            {selected.trial_days} trial days · {selected.grace_days} grace days after a renewal
            failure following paid service. Automatic monthly renewal in test mode. Changing plans
            requires cancellation at period end and a new checkout after termination; no prorations.
          </p>
          <label>
            <input
              type="checkbox"
              required
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            I agree to this test plan's recurring price and terms.
          </label>
          <button className="button" disabled={action.busy || !plans?.enabled || !agree}>
            Continue to test subscription checkout
          </button>
        </form>
      ) : (
        <p>No independently approved paid test plans are published.</p>
      )}
      {data.subscriptions.map((s: Row) => (
        <article className="notice" key={s.id}>
          <strong>
            {s.name} · {label(s.state)}
          </strong>
          <p>
            {s.period_end
              ? `Period ends ${date(s.period_end)}.`
              : 'Awaiting provider confirmation.'}{' '}
            {s.cancel_requested ? 'Period-end cancellation requested.' : ''}
          </p>
          {s.error_code && (
            <p role="status">
              Provider review: {label(s.error_code.toLowerCase())}. Your saved request remains
              available.
            </p>
          )}
          <div className="button-row">
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() => void run(s, 'refresh')}
            >
              Refresh subscription status
            </button>
            {s.state === 'pending' && (
              <button
                className="button secondary"
                disabled={action.busy}
                onClick={() => void run(s, 'refresh', true)}
              >
                Resume hosted checkout
              </button>
            )}
            {!['pending', 'canceled', 'expired'].includes(s.state) && !s.cancel_requested && (
              <button
                className="button secondary"
                disabled={action.busy}
                onClick={() => void run(s, 'cancel')}
              >
                Cancel at period end
              </button>
            )}
          </div>
        </article>
      ))}
      <h3>Subscription invoices</h3>
      {data.invoices.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Status</th>
                <th>Due</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((i: Row) => (
                <tr key={i.id}>
                  <td>{i.id}</td>
                  <td>{i.status}</td>
                  <td>{money(i.amount_due)}</td>
                  <td>{money(i.amount_paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>
          No subscription invoices. These are separate from marketplace orders and seller
          settlements.
        </p>
      )}
    </>
  );
}
export function BillingOperations() {
  const { data, error, isPending } = useData<Row>('/ops/billing'),
    action = useAction();
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  return (
    <section className="panel">
      <h2>Subscription plan versions</h2>
      <p>
        Draft explicit test prices and limits. A second finance reviewer must approve publication;
        this does not authorize live billing.
      </p>
      <ErrorNotice error={action.error} />
      <details>
        <summary>Draft a monthly test plan</summary>
        <form
          className="channel-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await action.run(
              '/ops/billing/plans',
              {
                name: f.get('name'),
                audience: f.get('audience'),
                amount_cents: Math.round(Number(f.get('price')) * 100),
                trial_days: Number(f.get('trial')),
                grace_days: Number(f.get('grace')),
                limits: Object.fromEntries(Object.keys(limits).map((k) => [k, Number(f.get(k))])),
              },
              'Immutable plan version drafted. Request independent review next.',
            );
          }}
        >
          <label>
            Plan name
            <input name="name" required minLength={3} maxLength={100} />
          </label>
          <label>
            Plan audience
            <select name="audience">
              <option value="demand">Demand / collectors</option>
              <option value="distribution">Distribution / partners</option>
              <option value="supply">Supply / creators</option>
            </select>
          </label>
          <label>
            Recurring USD per month
            <input name="price" required type="number" min="1" max="10000" step="0.01" />
          </label>
          <label>
            Trial days
            <input name="trial" required type="number" min="0" max="30" defaultValue="0" />
          </label>
          <label>
            Grace days
            <input name="grace" required type="number" min="0" max="14" defaultValue="0" />
          </label>
          {Object.entries(limits).map(([k, v]) => (
            <label key={k}>
              {label(k)} {k === 'seats' ? '(current cap)' : '(per UTC month)'}
              <input
                name={k}
                required
                type="number"
                min={k === 'seats' ? 1 : 0}
                max={
                  k === 'seats'
                    ? 1000
                    : k === 'collection_drafts'
                      ? 10000
                      : k === 'tool_calls'
                        ? 1000000
                        : 100000
                }
                defaultValue={v}
              />
            </label>
          ))}
          <button className="button" disabled={action.busy}>
            Save plan draft
          </button>
        </form>
      </details>
      {data.plans.map((p: Row) => (
        <article className="notice" key={p.id}>
          <strong>
            {p.name} · {p.state} · {money(p.amount_cents)}/month
          </strong>
          <p>
            {p.audience} · {p.trial_days} trial days · {p.grace_days} grace days
          </p>
          {['draft', 'active'].includes(p.state) && (
            <form
              className="channel-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await action.run(
                  '/ops/approvals',
                  {
                    kind: p.state === 'draft' ? 'plan_activate' : 'plan_retire',
                    resource_id: p.id,
                    reason: f.get('reason'),
                  },
                  'Independent finance review requested.',
                );
              }}
            >
              <label>
                Plan review reason
                <input name="reason" required minLength={10} maxLength={2000} />
              </label>
              <button className="button secondary" disabled={action.busy}>
                Request {p.state === 'draft' ? 'activation' : 'retirement'} review
              </button>
            </form>
          )}
        </article>
      ))}
      <h3>Subscription recovery</h3>
      <p>{data.note}</p>
      {data.subscriptions.map((s: Row) => (
        <details key={s.id}>
          <summary>
            {s.org_id} · {s.state} {s.error_code ? `· ${s.error_code}` : ''}
          </summary>
          <p>
            Recover the original provider session after an ambiguous create. Provider metadata,
            customer and exact plan terms are verified; this cannot force a paid state.
          </p>
          <form
            className="channel-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await action.run(
                `/ops/billing/subscriptions/${s.id}/recover`,
                { session_id: f.get('session'), reason: f.get('reason') },
                'Original provider session verified and reconciled.',
              );
            }}
          >
            <label>
              Original Stripe test subscription Checkout Session
              <input name="session" required pattern="cs_test_.*" maxLength={200} />
            </label>
            <label>
              Subscription recovery evidence
              <textarea name="reason" required minLength={10} maxLength={2000} />
            </label>
            <button className="button secondary" disabled={action.busy}>
              Verify original subscription session
            </button>
          </form>
        </details>
      ))}
      <h3>Pending billing events</h3>
      {data.pending_events.map((e: Row) => (
        <p key={e.id}>
          {e.type} · {e.object_id} · {date(e.created_at)}
        </p>
      ))}
    </section>
  );
}
export function FinanceApprovals() {
  const { data, error, isPending, refetch } = useData<Row[]>('/ops/approvals'),
    action = useAction(),
    { user } = useSession();
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  return (
    <section className="panel">
      <h2>Independent finance approvals</h2>
      <p>
        Review the exact owner, destination, price or settlement amount. Changed inputs require a
        fresh approval. Execution rechecks current authority and holds.
      </p>
      <ErrorNotice error={action.error} />
      <button className="button secondary" onClick={() => void refetch()}>
        Refresh approval queue
      </button>
      {data.map((a) => (
        <article className="notice" key={a.id}>
          <h3>
            {label(a.kind)} · {a.state}
          </h3>
          <p>{a.reason}</p>
          <p>
            Requested by {a.requested_by} · expires {date(a.expires_at)}
          </p>
          <dl className="spec-list">
            {Object.entries(a.payload).map(([k, v]) => (
              <div key={k}>
                <dt>{label(k)}</dt>
                <dd>
                  {typeof v === 'object' ? JSON.stringify(v) : String(v ?? 'Personal inventory')}
                </dd>
              </div>
            ))}
          </dl>
          {a.decision_note && <p>Review: {a.decision_note}</p>}
          {['pending', 'approved'].includes(a.state) && a.requested_by !== user!.id && (
            <form
              className="channel-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await action.run(
                  `/ops/approvals/${a.id}/decision`,
                  { version: a.version, decision: f.get('decision'), note: f.get('note') },
                  'Review recorded.',
                );
                await refetch();
              }}
            >
              <label>
                Approval decision
                <select name="decision">
                  <option value="reject">Reject</option>
                  {a.state === 'pending' && <option value="approve">Approve and execute</option>}
                </select>
              </label>
              <label>
                Independent review note
                <textarea name="note" required minLength={10} maxLength={2000} />
              </label>
              <button className="button" disabled={action.busy}>
                Record finance review
              </button>
            </form>
          )}
          {a.state === 'pending' && a.requested_by === user!.id && (
            <p>Another finance reviewer must decide this request.</p>
          )}
          {a.state === 'approved' && a.decided_by === user!.id && (
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={async () => {
                await action.run(`/ops/approvals/${a.id}/execute`, {}, 'Approved action executed.');
                await refetch();
              }}
            >
              Retry approved execution
            </button>
          )}
        </article>
      ))}
      {!data.length && <p>No finance requests yet.</p>}
    </section>
  );
}
const fields: Record<string, string[]> = {
  Sports: [
    'athlete',
    'team',
    'league',
    'season',
    'set',
    'manufacturer',
    'card_number',
    'parallel',
    'language',
  ],
  'K-pop': [
    'group',
    'member',
    'album',
    'era',
    'event',
    'store_variant',
    'issuer',
    'release',
    'language',
    'edition',
  ],
  Art: ['artist', 'medium', 'edition'],
  Gaming: ['franchise', 'set', 'card_number', 'language', 'edition'],
};
export function CatalogDetails({ attributes }: { attributes: Row }) {
  const entries = Object.entries(attributes || {}).filter(([k]) => k !== 'category');
  return entries.length ? (
    <section aria-label="Structured catalog details">
      <h3>Catalog details</h3>
      <dl className="spec-list">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt>{label(k)}</dt>
            <dd>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Declared catalog attributes; VIA evidence and rights review are separate.
      </p>
    </section>
  ) : null;
}
function AttributeFields({
  category,
  attributes,
  set,
  prefix,
}: {
  category: string;
  attributes: Row;
  set: (v: Row) => void;
  prefix: string;
}) {
  return (
    <>
      {fields[category]?.map((k) => (
        <label key={k}>
          {prefix} {label(k)}
          <input
            maxLength={120}
            value={attributes[k] || ''}
            onChange={(e) => {
              const next = { ...attributes };
              if (e.target.value.trim()) next[k] = e.target.value;
              else delete next[k];
              set(next);
            }}
          />
        </label>
      ))}
      {category === 'Sports' &&
        ['autograph', 'relic'].map((k) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={!!attributes[k]}
              onChange={(e) => set({ ...attributes, [k]: e.target.checked })}
            />
            {prefix} {k}
          </label>
        ))}
    </>
  );
}
export function OrganizationInventory() {
  const { user, clearPrivateData } = useSession(),
    [selected, setSelected] = useState(''),
    org = user!.organizations.find((o) => o.id === selected) || user!.organizations[0];
  return (
    <section className="panel">
      <h2>Organization inventory</h2>
      <p>
        Workspaces organize and delegate inventory management. Title and seller proceeds remain with
        the recorded owner.
      </p>
      <label>
        Inventory workspace
        <select
          value={org?.id || ''}
          onChange={async (e) => {
            const id = e.target.value;
            await clearPrivateData();
            setSelected(id);
          }}
        >
          {user!.organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.role}
            </option>
          ))}
        </select>
      </label>
      {org && <InventoryWorkspace key={org.id} org={org.id} />}
    </section>
  );
}
function InventoryWorkspace({ org }: { org: string }) {
  const { data, error, isPending } = useData<Row>(`/inventory/${org}`),
    { data: portfolio } = useData<Row>('/portfolio'),
    action = useAction(),
    [category, setCategory] = useState('Sports'),
    [attributes, setAttributes] = useState<Row>({});
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  return (
    <>
      <ErrorNotice error={action.error} />
      {data.can_edit && (
        <>
          <details>
            <summary>Register a workspace item</summary>
            <form
              className="channel-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await action.run(
                  '/assets',
                  {
                    org_id: org,
                    title: f.get('title'),
                    description: f.get('description'),
                    category,
                    artwork:
                      category === 'Sports'
                        ? 'court'
                        : category === 'K-pop'
                          ? 'idol'
                          : category === 'Art'
                            ? 'orbit'
                            : 'pixel',
                    attributes: { ...attributes, category },
                  },
                  'Workspace item registered; VIA and custody review are still required.',
                );
              }}
            >
              <label>
                Workspace item name
                <input name="title" required minLength={3} maxLength={120} />
              </label>
              <label>
                Workspace item description
                <textarea name="description" required minLength={10} maxLength={2000} />
              </label>
              <label>
                Workspace item category
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setAttributes({});
                  }}
                >
                  {Object.keys(fields).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <AttributeFields
                category={category}
                attributes={attributes}
                set={setAttributes}
                prefix="Declared"
              />
              <button className="button" disabled={action.busy}>
                Register workspace item
              </button>
            </form>
          </details>
          <details>
            <summary>Assign an existing owned item</summary>
            <form
              className="channel-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await action.run(
                  `/inventory/${org}/assignments`,
                  { asset_id: f.get('asset'), reason: f.get('reason') },
                  'Owner-authorized assignment awaits independent finance review.',
                );
              }}
            >
              <label>
                Owned item to assign
                <select name="asset" required defaultValue="">
                  <option value="" disabled>
                    Select owned stock
                  </option>
                  {portfolio?.items.map((a: Row) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Inventory assignment reason
                <textarea name="reason" required minLength={10} maxLength={2000} />
              </label>
              <button className="button secondary" disabled={action.busy}>
                Request inventory assignment
              </button>
            </form>
          </details>
        </>
      )}
      {data.assignments.map((a: Row) => (
        <p key={a.id}>
          Assignment {a.resource_id} · {a.state} {a.decision_note && `· ${a.decision_note}`}
        </p>
      ))}
      {!data.items.length && <p>No inventory assigned to this workspace.</p>}
      {data.items.map((a: Row) => (
        <InventoryItem key={a.id} item={a} canEdit={data.can_edit} />
      ))}
      <p className="muted">
        Showing up to 500 current workspace items. Original orders, refunds and proceeds remain in
        the owner's account.
      </p>
    </>
  );
}
function InventoryItem({ item: a, canEdit }: { item: Row; canEdit: boolean }) {
  const action = useAction(),
    [attributes, setAttributes] = useState<Row>(a.catalog_attributes || {});
  return (
    <details>
      <summary>
        {a.title} · {a.custody} · {a.certification}
        {a.listing_status ? ` · ${a.listing_status}` : ''}
      </summary>
      <p>
        Specimen {a.id} ·{' '}
        {a.is_owner ? 'You retain title.' : 'Managed on behalf of its recorded owner.'}
      </p>
      <ErrorNotice error={action.error} />
      <CatalogDetails attributes={a.catalog_attributes} />
      {canEdit && (
        <>
          <form
            className="channel-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await action.run(
                `/assets/${a.id}/attributes`,
                { ...attributes, category: a.category },
                'Catalog revision saved.',
              );
            }}
          >
            <AttributeFields
              category={a.category}
              attributes={attributes}
              set={setAttributes}
              prefix="Catalog"
            />
            <button
              className="button secondary"
              disabled={action.busy || ['active', 'reserved'].includes(a.listing_status)}
            >
              Save catalog attributes
            </button>
          </form>
          {a.listing_status === 'active' ? (
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(`/listings/${a.listing_id}/withdraw`, {}, 'Listing withdrawn.')
              }
            >
              Withdraw workspace listing
            </button>
          ) : (
            a.certification === 'verified' &&
            a.custody === 'vault' &&
            a.listing_status !== 'reserved' && (
              <form
                className="channel-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  await action.run(
                    '/listings',
                    { asset_id: a.id, price_cents: Math.round(Number(f.get('price')) * 100) },
                    'Workspace listing created for the recorded owner.',
                  );
                }}
              >
                <label>
                  Workspace asking price USD
                  <input name="price" required type="number" min="1" max="100000" step="0.01" />
                </label>
                <button className="button" disabled={action.busy}>
                  List workspace item
                </button>
              </form>
            )
          )}
        </>
      )}
    </details>
  );
}
