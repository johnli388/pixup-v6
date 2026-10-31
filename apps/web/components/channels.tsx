'use client';
import { CommercialTerms } from './commercial';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAction, useData, useSession, type Row } from './providers';
import { AccountGate, ErrorNotice, Loading, PageTitle, Status, money, Empty } from './ui';
import { pilotChannels } from './channel-samples';
import { PilotChannelDetail, PilotChannelDirectory } from './channel-pilot-preview';

type Field = {
  name: string;
  label: string;
  type?: string;
  options?: string[];
  value?: string | number;
  optional?: boolean;
};
function ActionForm({
  title,
  fields = [],
  path,
  body,
  submit = 'Save',
  done,
}: {
  title: string;
  fields?: Field[];
  path: string;
  body?: (d: Row) => Row;
  submit?: string;
  done?: (r: Row) => void;
}) {
  const action = useAction();
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      d: Row = Object.fromEntries(new FormData(form));
    for (const f of fields) if (f.type === 'number') d[f.name] = Number(d[f.name]);
    const result = await action.run(path, body ? body(d) : d, 'Recorded');
    if (result) done?.(result);
  }
  return (
    <form className="channel-form" onSubmit={send}>
      <h2>{title}</h2>
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.options ? (
            <select name={f.name} defaultValue={f.value}>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea name={f.name} defaultValue={f.value} required={!f.optional} rows={3} />
          ) : (
            <input
              name={f.name}
              type={f.type || 'text'}
              defaultValue={f.value}
              required={!f.optional}
              min={f.type === 'number' ? 0 : undefined}
            />
          )}
        </label>
      ))}
      <ErrorNotice error={action.error} />
      <button className="button secondary" disabled={action.busy}>
        {action.busy ? 'Saving…' : submit}
      </button>
    </form>
  );
}
const evidence: Field = {
  name: 'evidence',
  label: 'Evidence or tracking reference (at least 10 characters)',
  type: 'textarea',
};
export function Channels({ id }: { id?: string }) {
  const pilot = pilotChannels.find((channel) => channel.id === id);
  if (pilot) return <PilotChannelDetail channel={pilot} />;
  return id ? <ChannelDetail id={id} /> : <ChannelDirectory />;
}
function ChannelDirectory() {
  const { data, error, isPending } = useData<Row[]>('/channels');
  if (isPending) return <Loading />;
  return (
    <>
      <PageTitle
        eyebrow="PHYSICAL CHANNELS"
        title="More ways to collect"
        description="Explore local pilot channels. Each purchase uses the same inventory, order and payment records."
      />
      <ErrorNotice error={error} />
      {!!data?.length && <h2>Available channels</h2>}
      <div className="channel-grid">
        {data?.map((c) => (
          <Link className="panel channel-card" href={`/channels/${c.id}`} key={c.id}>
            <span className="eyebrow">{c.kind.toUpperCase()}</span>
            <h2>{c.name}</h2>
            <Status status={c.status} />
            <p>{c.terms.description}</p>
            {c.kind === 'cvm' && (
              <p>{c.online ? 'Device online' : 'Device offline · purchases unavailable'}</p>
            )}
            <span className="text-link">View channel →</span>
          </Link>
        ))}
      </div>
      <PilotChannelDirectory />
    </>
  );
}
function ChannelDetail({ id }: { id: string }) {
  const { user } = useSession(),
    router = useRouter();
  const { data: c, error, isPending, refetch } = useData<Row>(`/channels/${id}`);
  const action = useAction();
  const [selected, setSelected] = useState<Row | null>(null),
    [quote, setQuote] = useState<Row | null>(null),
    [credits, setCredits] = useState(false),
    [address, setAddress] = useState('');
  const [checkoutKey, setCheckoutKey] = useState(''),
    [receipt, setReceipt] = useState('');
  if (isPending) return <Loading />;
  if (!c) return <ErrorNotice error={error} />;
  async function review(item: Row) {
    const q = await action.run('/quotes', {
      listing_id: item.listing_id,
      allocation_id: item.id,
      fulfillment: 'vault',
      use_credits: credits,
    });
    if (q) {
      setSelected(item);
      setQuote(q);
      setCheckoutKey(crypto.randomUUID());
    }
  }
  async function purchase() {
    const order = await action.run(
      '/checkouts',
      { quote_id: quote!.id, shipping_address: address },
      undefined,
      checkoutKey,
    );
    if (order) router.push(`/account/orders/${order.id}`);
  }
  return (
    <>
      <PageTitle eyebrow={c.kind.toUpperCase()} title={c.name} description={c.terms.description} />
      <div className="panel channel-terms">
        <Status status={c.status} />
        <p>
          Terms version {c.terms_version}
          {c.deadline && ` · Deadline ${new Date(c.deadline).toLocaleString()}`}
        </p>
        {c.kind === 'cvm' && (
          <p>
            {c.online
              ? 'Device online. Payment is followed by a confirmed physical dispense.'
              : 'Device offline. New paid vends are disabled.'}{' '}
            An uncertain dispense waits for staff review; do not pay a second time.
          </p>
        )}
        {c.kind === 'liveup' && (
          <p>
            Your paid pack stays allocated until the host records its physical reveal. Opening
            records do not certify the revealed items; VIA review is separate.
          </p>
        )}
        {c.kind === 'goup' && (
          <p>
            {c.terms.target_units} participant slots · Shared shipping{' '}
            {money(c.terms.shipping_total_cents)}. Pledge your fixed share before the group locks.
            Each participant pays their own order. A deadline shortfall requires refund review
            before any shipment.
          </p>
        )}
        {c.kind === 'waxup' && (
          <p>
            Approved business buyers only · {c.terms.units_per_case} units per sealed case · Cash
            only. Conditional return: {c.terms.return_mode}, within {c.terms.return_days} days of
            payment. Returns require inspection and do not grant automatic credits or payouts.
          </p>
        )}
        <button className="button secondary" onClick={() => void refetch()}>
          Refresh availability
        </button>
      </div>
      <ErrorNotice error={error || action.error} />
      {!user && (
        <Link className="button" href="/login">
          Sign in to participate
        </Link>
      )}
      {user && c.kind !== 'waxup' && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={credits}
            onChange={(e) => {
              setCredits(e.target.checked);
              setQuote(null);
            }}
          />
          Use eligible ecosystem credits
        </label>
      )}
      <div className="channel-grid">
        {c.items.map((item: Row) => (
          <article className="panel" key={item.id}>
            <span className="eyebrow">Slot {item.slot}</span>
            <h2>{item.title}</h2>
            <Status status={item.listing_status} />
            <p>
              {item.kind === 'sealed_pack'
                ? 'Physical sealed pack · contents unverified'
                : `VIA: ${item.certification}`}{' '}
              · {money(item.price_cents)}
            </p>
            {['goup', 'waxup'].includes(c.kind) && (
              <p>Shipping share: {money(item.shipping_cents)}</p>
            )}
            {c.kind === 'goup' && c.status === 'open' ? (
              <>
                <button
                  className="button"
                  disabled={!user || action.busy || item.pledged}
                  onClick={() =>
                    void action.run(
                      `/channels/allocations/${item.id}/pledge`,
                      { terms_version: c.terms_version },
                      'Share pledged. No payment taken.',
                    )
                  }
                >
                  {item.is_pledged_by_me
                    ? 'Your share is pledged'
                    : item.pledged
                      ? 'Share pledged'
                      : 'Accept terms and pledge this share'}
                </button>
                {item.is_pledged_by_me && (
                  <button
                    className="button secondary"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(
                        `/channels/allocations/${item.id}/unpledge`,
                        {},
                        'Pledge withdrawn.',
                      )
                    }
                  >
                    Withdraw pledge
                  </button>
                )}
              </>
            ) : (
              <button
                className="button"
                disabled={
                  !user ||
                  action.busy ||
                  item.listing_status !== 'active' ||
                  item.state !== 'assigned' ||
                  (c.kind === 'goup'
                    ? !item.is_pledged_by_me || c.status !== 'locked'
                    : c.status !== 'open') ||
                  (c.kind === 'cvm' && !c.online)
                }
                onClick={() => void review(item)}
              >
                Review purchase
              </button>
            )}
          </article>
        ))}
      </div>
      {quote && selected && (
        <section className="panel channel-form" aria-label="Review channel purchase">
          <h2>Review {selected.title}</h2>
          <CommercialTerms snapshot={quote.commercial_snapshot} />
          <p>
            Price {money(quote.price_cents)} (includes seller fee {money(quote.fee_cents)}) ·
            Shipping {money(quote.shipping_cents)}
          </p>
          <p>
            {quote.credit_units} credits · Pay {money(quote.total_cents)}
          </p>
          <p>
            Quote expires {new Date(quote.expires_at).toLocaleTimeString()}. Payment confirmation
            does not confirm physical fulfillment.
          </p>
          {['goup', 'waxup'].includes(c.kind) && (
            <label>
              Delivery address
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} />
            </label>
          )}
          <button
            className="button"
            disabled={
              action.busy || (['goup', 'waxup'].includes(c.kind) && address.trim().length < 10)
            }
            onClick={() => void purchase()}
          >
            Confirm terms and continue to payment
          </button>
          <button className="button secondary" onClick={() => setQuote(null)}>
            Close review
          </button>
        </section>
      )}
      {c.kind === 'cvm' && user && (
        <section className="panel">
          <ActionForm
            title="Register a physical return"
            path={`/channels/${id}/returns`}
            fields={[{ name: 'asset_id', label: 'Your item registry ID' }]}
            done={(r) => setReceipt(r.id)}
            submit="Create return reference"
          />
          {receipt && (
            <p role="status">
              Return receipt <code>{receipt}</code>. Present this reference at the device. No
              credits granted.
            </p>
          )}
        </section>
      )}
    </>
  );
}
export function ChannelWorkspace() {
  return (
    <AccountGate>
      <Workspace />
    </AccountGate>
  );
}
function Workspace() {
  const { user } = useSession();
  const { data, error, isPending } = useData<Row>('/channels/workspace');
  const warehouse = !!user?.staff_permissions.includes('warehouse'),
    finance = !!user?.staff_permissions.includes('finance');
  const { data: gates } = useData<Row[]>('/ops/channels/gates', warehouse);
  const [created, setCreated] = useState<Row | null>(null);
  if (isPending) return <Loading />;
  const orgs =
    user?.organizations
      .filter((o) => ['owner', 'operator', 'publisher'].includes(o.role))
      .map((o) => o.id) || [];
  return (
    <>
      <PageTitle
        eyebrow="CHANNEL OPERATIONS"
        title="Channel workspace"
        description="Assign physical stock, track paid allocations and record witnessed fulfillment. Pilot activation is separate from production approval."
      />
      <ErrorNotice error={error} />
      {created && (
        <div className="panel" role="status">
          <p>
            Created reference: <code>{created.id || created.asset_id}</code>
          </p>
          {created.listing_id && (
            <p>
              Listing ID for allocation: <code>{created.listing_id}</code>
            </p>
          )}
        </div>
      )}
      {warehouse && (
        <details className="panel">
          <summary>Pilot activation gates</summary>
          <p>
            Activate CVM and LiveUP first, GOUP and WaxUP next, then AI tools. Disabling a gate
            prevents new transactions; existing orders remain recoverable.
          </p>
          <div className="channel-grid">
            {gates?.map((g) => (
              <ActionForm
                key={g.kind}
                title={`${g.kind.toUpperCase()} · ${g.enabled ? 'enabled' : 'disabled'}`}
                path={`/ops/channels/gates/${g.kind}`}
                fields={[evidence]}
                body={(d) => ({ ...d, enabled: !g.enabled })}
                submit={g.enabled ? 'Disable new transactions' : 'Record evidence and enable'}
              />
            ))}
          </div>
        </details>
      )}
      <details className="panel">
        <summary>Create a channel</summary>
        <ActionForm
          title="New pilot channel"
          path="/channels"
          done={setCreated}
          fields={[
            { name: 'kind', label: 'Channel', options: ['cvm', 'liveup', 'goup', 'waxup'] },
            { name: 'org_id', label: 'Organization', options: orgs },
            { name: 'name', label: 'Name' },
            {
              name: 'description',
              label: 'Buyer terms (at least 10 characters)',
              type: 'textarea',
            },
            { name: 'target_units', label: 'GOUP participant slots', type: 'number', value: 1 },
            {
              name: 'shipping_total_cents',
              label: 'GOUP total shipping / WaxUP per-case shipping (cents)',
              type: 'number',
              value: 0,
            },
            { name: 'units_per_case', label: 'WaxUP units per case', type: 'number', value: 1 },
            {
              name: 'return_mode',
              label: 'WaxUP conditional return mode',
              options: ['none', 'consignment', 'buyback'],
            },
            { name: 'return_days', label: 'WaxUP return window in days', type: 'number', value: 0 },
            { name: 'deadline', label: 'Deadline (ISO UTC; required for GOUP)', optional: true },
            {
              name: 'public_key',
              label: 'CVM device Ed25519 public key (PEM)',
              type: 'textarea',
              optional: true,
            },
          ]}
          body={(d) => ({
            kind: d.kind,
            org_id: d.org_id,
            name: d.name,
            terms: {
              description: d.description,
              target_units: d.target_units,
              shipping_total_cents: d.shipping_total_cents,
              units_per_case: d.units_per_case,
              return_mode: d.return_mode,
              return_days: d.return_days,
            },
            ...(d.deadline ? { deadline: d.deadline } : {}),
            ...(d.public_key ? { public_key: d.public_key } : {}),
          })}
        />
      </details>
      {warehouse && (
        <details className="panel">
          <summary>Register sealed physical stock</summary>
          <ActionForm
            title="Warehouse stock receipt"
            path="/ops/channels/packs"
            done={setCreated}
            fields={[
              { name: 'title', label: 'Stock title' },
              { name: 'category', label: 'Category', options: ['Sports', 'K-pop'] },
              {
                name: 'supplier_reference',
                label: 'Private supplier receipt reference (at least 10 characters)',
              },
              { name: 'seal_reference', label: 'Seal reference' },
              {
                name: 'units',
                label: 'Contents count (or wholesale units per case)',
                type: 'number',
                value: 1,
              },
              { name: 'price_cents', label: 'Price in cents', type: 'number', value: 1000 },
            ]}
          />
        </details>
      )}
      {finance && (
        <details className="panel">
          <summary>Business buyer approval</summary>
          <ActionForm
            title="Approve or revoke a business buyer"
            path="/ops/channels/businesses"
            fields={[
              { name: 'user_id', label: 'Buyer user ID' },
              { name: 'org_id', label: 'Buyer organization ID' },
              { name: 'decision', label: 'Decision', options: ['approve', 'revoke'] },
            ]}
            body={(d) => ({
              user_id: d.user_id,
              org_id: d.org_id,
              approved: d.decision === 'approve',
            })}
          />
        </details>
      )}
      {warehouse && (
        <details className="panel">
          <summary>Pin the simulator command verification key</summary>
          <p>
            Copy this public key to command-public.pem on the simulator. Configure a persistent
            server signing key before device integration.
          </p>
          <textarea
            aria-label="Server command public key"
            readOnly
            rows={4}
            value={data?.command_public_key || ''}
          />
        </details>
      )}
      <h2>Channels and stock</h2>
      {data?.contexts.map((c: Row) => (
        <details className="panel" key={c.id}>
          <summary>
            {c.kind.toUpperCase()} · {c.name} · {c.status}
          </summary>
          <p>
            <Link className="text-link" href={`/channels/${c.id}`}>
              Open buyer view
            </Link>{' '}
            · <code>{c.id}</code>
          </p>
          <ActionForm
            title="Assign existing stock"
            path={`/channels/${c.id}/allocations`}
            fields={[
              { name: 'listing_id', label: 'Listing ID' },
              { name: 'slot', label: 'Device slot / session pack / group share / case reference' },
            ]}
          />
          {c.kind === 'goup' && c.status === 'open' && (
            <ActionForm
              title="Lock fully pledged group"
              path={`/channels/${c.id}/lock`}
              submit="Lock shares and enable participant payments"
            />
          )}
          <ActionForm
            title="Channel availability"
            path={`/channels/${c.id}/status`}
            fields={[
              {
                name: 'status',
                label: 'Status',
                options: c.kind === 'goup' ? ['canceled'] : ['paused', 'open', 'canceled'],
              },
            ]}
            submit="Update channel"
          />
          {warehouse && c.kind === 'cvm' && (
            <ActionForm
              title="Revoke device identity"
              path={`/ops/channels/devices/${c.id}/revoke`}
              submit="Revoke device"
            />
          )}
          {data.allocations
            .filter((a: Row) => a.context_id === c.id)
            .map((a: Row) => (
              <details key={a.id}>
                <summary>
                  Slot {a.slot} · {a.state} · {a.listing_status}
                </summary>
                <p>
                  Asset <code>{a.asset_id}</code>
                </p>
                <ActionForm
                  title="Release unused or refunded allocation"
                  path={`/channels/allocations/${a.id}/release`}
                  fields={[evidence]}
                  submit="Confirm physical return to vault"
                />
              </details>
            ))}
        </details>
      ))}
      <h2>Fulfillment and recovery</h2>
      {data?.orders.map((o: Row) => (
        <details className="panel" key={o.order_id}>
          <summary>
            {o.channel.toUpperCase()} · {o.order_id.slice(0, 8)} · {o.state}
          </summary>
          <p>
            Order <code>{o.order_id}</code> · {o.payment_provider} · {o.order_status}
          </p>
          {o.shipping_address && <p>Participant delivery address: {o.shipping_address}</p>}
          {o.state === 'refund_required' && (
            <p>
              Physical outcome is resolved for refund review. For Stripe test orders, finance uses
              the payment operations queue. Demo buyers can request the refund from their order.
            </p>
          )}
          {o.state === 'unknown' && (
            <p>The slot remains blocked until staff reconciles the physical outcome.</p>
          )}
          {o.command_expires_at && ['issued', 'unknown'].includes(o.command_state) && (
            <p>
              Manual reconciliation opens after{' '}
              {new Date(Date.parse(o.command_expires_at) + 300000).toLocaleString()} (command expiry
              plus clock tolerance). Physically isolate the device before recording a final outcome.
            </p>
          )}
          {warehouse && o.command_id && ['issued', 'unknown'].includes(o.command_state) && (
            <ActionForm
              title="Reconcile physical dispense"
              path={`/ops/channels/commands/${o.command_id}/reconcile`}
              fields={[
                {
                  name: 'outcome',
                  label: 'Witnessed outcome',
                  options: ['not_dispensed', 'delivered'],
                },
                evidence,
              ]}
            />
          )}
          {o.channel === 'liveup' && o.state === 'awaiting_fulfillment' && (
            <ActionForm
              title="Record witnessed physical reveal"
              path={`/channels/orders/${o.order_id}/reveal`}
              fields={[
                { name: 'recording_reference', label: 'Recording reference' },
                {
                  name: 'recording_offset_ms',
                  label: 'Recording offset (milliseconds)',
                  type: 'number',
                  value: 0,
                },
                evidence,
                {
                  name: 'contents',
                  label:
                    'One physical item per line: title | description (at least 10 characters). Leave empty for a single registered specimen.',
                  type: 'textarea',
                  optional: true,
                },
              ]}
              body={(d) => ({
                ...d,
                contents: d.contents.trim()
                  ? d.contents
                      .split('\n')
                      .filter(Boolean)
                      .map((line: string) => {
                        const [title, ...description] = line.split('|');
                        return { title: title.trim(), description: description.join('|').trim() };
                      })
                  : [],
              })}
              submit="Record reveal and ownership lineage"
            />
          )}
          {warehouse &&
            ['goup', 'waxup'].includes(o.channel) &&
            o.state === 'awaiting_fulfillment' && (
              <ActionForm
                title="Confirm shipment"
                path={`/ops/channels/orders/${o.order_id}/fulfill`}
                fields={[evidence]}
                submit="Record physical dispatch"
              />
            )}
        </details>
      ))}
      {data?.returns.map((r: Row) => (
        <section className="panel" key={r.id}>
          <p>
            Device return {r.id} · {r.status}
          </p>
          {r.status === 'deposited' && (
            <ActionForm
              title="Receive return at warehouse"
              path={`/ops/channels/returns/${r.id}/receive`}
              fields={[evidence]}
              submit="Receive for independent VIA review"
            />
          )}
        </section>
      ))}
      {data?.wholesale_returns.map((r: Row) => (
        <section className="panel" key={r.order_id}>
          <p>
            Wholesale return · {r.mode} · {r.note}
          </p>
          <ActionForm
            title="Return inspection authorization"
            path={`/ops/channels/orders/${r.order_id}/return-decision`}
            fields={[
              { name: 'decision', label: 'Decision', options: ['approve', 'reject'] },
              { name: 'note', label: 'Decision evidence', type: 'textarea' },
            ]}
            body={(d) => ({ approved: d.decision === 'approve', note: d.note })}
          />
        </section>
      ))}
    </>
  );
}
export function ChannelOrder({ order: o }: { order: Row }) {
  const { user } = useSession();
  if (!o.channel_fulfillment) return null;
  return (
    <section className="channel-terms">
      <h3>{o.channel.toUpperCase()} fulfillment</h3>
      <Status status={o.channel_fulfillment.state} />
      <p>
        <Link className="text-link" href={`/channels/${o.channel_fulfillment.context_id}`}>
          View channel terms and availability
        </Link>
      </p>
      {o.channel_fulfillment.state === 'refund_required' && (
        <p>
          Refund review is required. Stripe test orders require finance reconciliation; open a
          support case.
        </p>
      )}
      {o.channel_fulfillment.state === 'unknown' && (
        <p>
          Physical outcome is uncertain. Your allocation remains held while staff reconciles the
          device. Do not repeat the purchase.
        </p>
      )}
      {o.channel_fulfillment.recording_reference && (
        <p>
          Reveal recording: {o.channel_fulfillment.recording_reference} · offset{' '}
          {o.channel_fulfillment.recording_offset_ms} ms
        </p>
      )}
      {o.pack_contents?.map((a: Row) => (
        <p key={a.asset_id}>
          <Link className="text-link" href={`/items/${a.asset_id}`}>
            {a.title}
          </Link>{' '}
          · VIA {a.certification}
        </p>
      ))}
      {o.invoice && (
        <p>
          Demo invoice {o.invoice.reference} · {money(o.invoice.amount_cents)} ·{' '}
          {o.invoice.units_per_case} units per case
        </p>
      )}
      {o.wholesale_return && (
        <p>
          Return review: {o.wholesale_return.status} · {o.wholesale_return.decision_note}
        </p>
      )}
      {o.channel === 'waxup' &&
        o.status === 'fulfilled' &&
        o.buyer_id === user?.id &&
        !o.wholesale_return &&
        o.channel_terms.return_mode !== 'none' && (
          <ActionForm
            title="Request conditional wholesale return"
            path={`/channels/orders/${o.id}/return`}
            fields={[{ name: 'note', label: 'Reason and stock condition', type: 'textarea' }]}
            submit="Request inspection"
          />
        )}
    </section>
  );
}
export function DeveloperTools() {
  return (
    <AccountGate>
      <Tools />
    </AccountGate>
  );
}
function Tools() {
  const { user, refresh } = useSession();
  const { data: keys, error } = useData<Row[]>('/tools/keys');
  const [secret, setSecret] = useState(''),
    [result, setResult] = useState<Row | null>(null),
    [failure, setFailure] = useState(''),
    [busy, setBusy] = useState(false);
  const orgs =
    user?.organizations
      .filter((o) => ['owner', 'publisher', 'operator'].includes(o.role))
      .map((o) => o.id) || [];
  async function execute(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setFailure('');
    setResult(null);
    try {
      const response = await fetch(`/api/tools/${d.operation}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': user!.csrf,
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          query: d.query,
          ...(d.asset_id ? { asset_id: d.asset_id } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setResult(body);
      await refresh();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Tool request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="DEVELOPER WORKSPACE"
        title="Scoped discovery tools"
        description="Query public inventory, match explicit criteria, or preview a purchase route. These tools cannot reserve stock, spend money or issue credits."
      />
      <ErrorNotice error={error || failure} />
      <section className="panel">
        <ActionForm
          title="Create a 30-day credential"
          path="/tools/keys"
          fields={[
            { name: 'org_id', label: 'Organization', options: orgs },
            { name: 'name', label: 'Credential name' },
            {
              name: 'scope',
              label: 'Allowed tools',
              options: ['query', 'match', 'route', 'query,match,route'],
            },
            { name: 'daily_limit', label: 'Daily request limit (UTC)', type: 'number', value: 100 },
          ]}
          body={(d) => ({
            org_id: d.org_id,
            name: d.name,
            scopes: d.scope.split(','),
            daily_limit: d.daily_limit,
          })}
          done={(r) => setSecret(r.secret)}
        />
        <p>
          The secret is returned once and kept only in this page’s memory. Copy it to your
          integration’s secret store. Revocation and membership changes take effect on the next
          call.
        </p>
      </section>
      <form className="panel channel-form" onSubmit={execute}>
        <h2>Try a read-only tool</h2>
        <label>
          Bearer credential
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            required
          />
        </label>
        {secret && (
          <button
            className="button secondary"
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(secret)
                .catch(() =>
                  setFailure('Clipboard unavailable. Select the credential field to copy it.'),
                )
            }
          >
            Copy credential
          </button>
        )}
        <label>
          Tool
          <select name="operation">
            <option>query</option>
            <option>match</option>
            <option>route</option>
          </select>
        </label>
        <label>
          Title search
          <input name="query" />
        </label>
        <label>
          Asset ID (required for route)
          <input name="asset_id" />
        </label>
        <button className="button" disabled={busy}>
          {busy ? 'Checking…' : 'Run tool'}
        </button>
      </form>
      {result && (
        <section className="panel">
          <p>
            Snapshot {result.as_of} · Fresh until {result.valid_until}
          </p>
          <p>{result.notice}</p>
          {result.items.map((a: Row) => (
            <p key={a.id}>
              {a.title} · {money(a.price_cents)} · {a.channel} {a.match_reason}
              {a.path && (
                <Link className="text-link" href={a.path}>
                  Review purchase route →
                </Link>
              )}
            </p>
          ))}
          {!result.items.length && <p>No eligible stock matches these criteria.</p>}
          <p>
            Usage today: {result.usage.used_today}/{result.usage.daily_limit}
          </p>
        </section>
      )}
      <h2>Credentials and usage</h2>
      {keys?.map((k) => (
        <section className="panel" key={k.id}>
          <h3>{k.name}</h3>
          <p>
            {k.scopes.join(', ')} · {k.used_today}/{k.daily_limit} today · Expires{' '}
            {new Date(k.expires_at).toLocaleDateString()}
          </p>
          {k.revoked_at ? (
            <Status status="revoked" />
          ) : (
            <ActionForm
              title="Revoke access"
              path={`/tools/keys/${k.id}/revoke`}
              submit="Revoke credential"
            />
          )}
        </section>
      ))}
    </>
  );
}
