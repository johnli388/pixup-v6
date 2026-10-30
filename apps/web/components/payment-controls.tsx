'use client';
import { useState } from 'react';
import { useData, useAction, type Row } from './providers';
import { ErrorNotice, Status, money, date } from './ui';

export function PaymentControlPanel() {
  const { data, error, refetch } = useData('/ops/payment-controls'),
    action = useAction();
  const [order, setOrder] = useState('');
  return (
    <section className="panel spaced">
      <h2>Provider reconciliation and refund controls</h2>
      <p>
        Stripe test mode only. Partial refunds are explicit cash price adjustments that retain title
        and original credits. A second finance reviewer must approve the exact allocation.
      </p>
      <ErrorNotice error={error} />
      <button className="button secondary small" onClick={() => void refetch()}>
        Refresh payment controls
      </button>
      <form
        className="spaced"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await action.run(
              `/ops/payments/${order}/external-reconcile`,
              {},
              'Provider reconciliation recorded',
            )
          )
            void refetch();
        }}
      >
        <label className="field">
          Payment order
          <select value={order} onChange={(e) => setOrder(e.target.value)} required>
            <option value="">Choose a Stripe order</option>
            {data?.scopes.map((p: Row) => (
              <option key={p.order_id} value={p.order_id}>
                {p.order_id} · {p.account_id || 'Legacy scope review required'}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary" disabled={!order || action.busy}>
          Reconcile provider payment
        </button>
        <ErrorNotice error={action.error} />
      </form>
      {order && <PartialRequest key={order} order={order} />}
      {data?.scopes
        .filter((p: Row) => !p.account_id)
        .map((p: Row) => (
          <details className="panel spaced" key={p.order_id}>
            <summary>Bind legacy payment scope · {p.order_id}</summary>
            <LegacyScope payment={p} />
          </details>
        ))}
      {data?.adjustments.map((r: Row) => (
        <details className="panel spaced" key={r.id}>
          <summary>
            Partial refund {money(r.amount_cents)} · <Status status={r.state} />
          </summary>
          <p>
            Order {r.order_id} · Seller {money(r.seller_cents)} · Fee {money(r.fee_cents)} ·
            Shipping {money(r.shipping_cents)}
          </p>
          <p>{r.error_code || ''}</p>
          {!['succeeded', 'failed', 'canceled'].includes(r.state) && (
            <RecoveryForm
              path={`/ops/partial-refunds/${r.id}/refresh`}
              referenceName="refund_id"
              referenceLabel="Original partial refund ID (optional)"
              done={() => void refetch()}
            />
          )}
        </details>
      ))}
      {data?.refunds
        .filter((r: Row) => ['failed', 'canceled'].includes(r.status))
        .map((r: Row) => (
          <details className="panel spaced" key={r.id}>
            <summary>
              Failed refund attempt {r.attempt_number} · {r.order_id}
            </summary>
            <p>
              Provider outcome: {r.status}. Earlier attempts remain recorded; only the latest
              terminal attempt can be replaced.
            </p>
            <ApprovalRequest
              path={`/ops/payments/${r.order_id}/retry-refund`}
              label="Request refund retry review"
            />
          </details>
        ))}
      <details className="panel spaced">
        <summary>Retrieve a provider dispute</summary>
        <DisputeForm done={() => void refetch()} />
      </details>
      {data?.disputes.map((d: Row) => (
        <article className="panel spaced" key={`${d.account_id}/${d.id}`}>
          <strong>
            {d.id} · {d.status}
          </strong>
          <p>
            Order {d.order_id} · {money(d.amount_cents)} · Respond by{' '}
            {d.due_at ? date(d.due_at) : 'provider review'}
          </p>
          <p>
            Submit evidence in the Stripe test dashboard. Local refresh cannot decide the dispute or
            restore title.
          </p>
          <RecoveryForm path={`/ops/disputes/${d.id}/refresh`} done={() => void refetch()} />
        </article>
      ))}
      {data?.reconciliations.map((r: Row) => (
        <details className="panel spaced" key={r.id}>
          <summary>
            Reconciliation · {r.order_id} · {r.state}
          </summary>
          <p>
            Expected cash {money(r.expected.cash_cents)} / refunds{' '}
            {money(r.expected.refunded_cents)}. Provider cash {money(r.observed.cash_cents)} /
            refunds {money(r.observed.refunded_cents)}.
          </p>
          <p>
            Provider fee: {r.observed.balance ? money(r.observed.balance.fee) : 'Unavailable'}.
            Provider balance status: {r.observed.balance?.status || 'Unavailable'}. This is not bank
            reconciliation.
          </p>
        </details>
      ))}
      {!!data?.events.length && (
        <details className="panel spaced">
          <summary>Unprocessed provider events ({data.events.length})</summary>
          {data.events.map((e: Row) => (
            <p key={e.event_id}>
              {e.event_type} · {e.object_id} · {e.error_code || 'Awaiting retrieval'}
            </p>
          ))}
        </details>
      )}
      <ConnectOperations />
    </section>
  );
}
function PartialRequest({ order }: { order: string }) {
  const a = useAction();
  return (
    <details className="panel spaced">
      <summary>Request a partial cash refund</summary>
      <p>
        Enter the exact amounts charged back to seller proceeds, platform fees and shipping. Their
        sum must remain below the cash still paid. No allocation policy is assumed.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          await a.run(
            `/ops/payments/${order}/partial-refund`,
            {
              seller_cents: Math.round(Number(d.get('seller')) * 100),
              fee_cents: Math.round(Number(d.get('fee')) * 100),
              shipping_cents: Math.round(Number(d.get('shipping')) * 100),
              reason: d.get('reason'),
            },
            'Partial refund sent for independent finance approval',
          );
        }}
      >
        {['Seller', 'Fee', 'Shipping'].map((label) => (
          <label className="field" key={label}>
            {label} refund allocation (USD)
            <input
              type="number"
              name={label.toLowerCase()}
              min="0"
              max="100000"
              step="0.01"
              defaultValue="0"
              required
            />
          </label>
        ))}
        <label className="field">
          Partial refund reason
          <textarea name="reason" required minLength={10} maxLength={2000} />
        </label>
        <button className="button" disabled={a.busy}>
          Request partial refund review
        </button>
        <ErrorNotice error={a.error} />
      </form>
    </details>
  );
}
function ApprovalRequest({ path, label }: { path: string; label: string }) {
  const a = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await a.run(
          path,
          { reason: new FormData(e.currentTarget).get('reason') },
          'Independent review requested',
        );
      }}
    >
      <label className="field">
        Finance review reason
        <textarea name="reason" required minLength={10} maxLength={2000} />
      </label>
      <button className="button secondary" disabled={a.busy}>
        {label}
      </button>
      <ErrorNotice error={a.error} />
    </form>
  );
}
function RecoveryForm({
  path,
  referenceName,
  referenceLabel,
  done,
}: {
  path: string;
  referenceName?: string;
  referenceLabel?: string;
  done: () => void;
}) {
  const a = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget),
          reference = referenceName ? String(d.get(referenceName) || '').trim() : '';
        if (
          await a.run(
            path,
            {
              note: d.get('note'),
              ...(referenceName && reference ? { [referenceName]: reference } : {}),
            },
            'Provider state retrieved',
          )
        )
          done();
      }}
    >
      {referenceName && (
        <label className="field">
          {referenceLabel}
          <input name={referenceName} maxLength={255} required={referenceName === 'account_id'} />
        </label>
      )}
      <label className="field">
        Reconciliation note
        <textarea name="note" required minLength={10} maxLength={2000} />
      </label>
      <button className="button secondary" disabled={a.busy}>
        Retrieve original provider state
      </button>
      <ErrorNotice error={a.error} />
    </form>
  );
}
function LegacyScope({ payment: p }: { payment: Row }) {
  const a = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        await a.run(
          `/ops/payments/${p.order_id}/bind-scope`,
          { session_id: d.get('session_id'), note: d.get('note') },
          'Original provider account verified and bound',
        );
      }}
    >
      <label className="field">
        Original scoped Checkout Session ID
        <input name="session_id" defaultValue={p.provider_session_id || ''} required />
      </label>
      <label className="field">
        Scope verification note
        <textarea name="note" required minLength={10} maxLength={2000} />
      </label>
      <button className="button secondary" disabled={a.busy}>
        Verify and bind original account
      </button>
      <ErrorNotice error={a.error} />
    </form>
  );
}
function DisputeForm({ done }: { done: () => void }) {
  const a = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        if (
          await a.run(
            `/ops/disputes/${encodeURIComponent(String(d.get('id')))}/refresh`,
            { note: d.get('note') },
            'Provider dispute retrieved',
          )
        )
          done();
      }}
    >
      <label className="field">
        Stripe dispute ID
        <input name="id" required pattern="du_.+" />
      </label>
      <label className="field">
        Dispute retrieval reason
        <textarea name="note" required minLength={10} maxLength={2000} />
      </label>
      <button className="button secondary" disabled={a.busy}>
        Retrieve dispute
      </button>
      <ErrorNotice error={a.error} />
    </form>
  );
}
function ConnectOperations() {
  const { data, error, refetch } = useData('/ops/connect');
  return (
    <section className="spaced">
      <h3>Connected test balances</h3>
      <p>
        {data?.enabled
          ? 'Test transfers require fulfilled stock, available provider funds, ready recipients and independent approval.'
          : 'Test transfers are disabled.'}{' '}
        A transfer to a connected Stripe balance is not confirmation of a bank payout.
      </p>
      <ErrorNotice error={error} />
      {data?.recipients.map((r: Row) => (
        <details key={r.id} className="panel spaced">
          <summary>
            Recipient {r.user_id} · {r.state}
          </summary>
          <p>
            {r.country} · {r.requirements_count} provider requirements ·{' '}
            {r.error_code || 'No current error'}
          </p>
          {r.error_code && (
            <RecoveryForm
              path={`/ops/connect/${r.id}/recover`}
              referenceName="account_id"
              referenceLabel="Original connected account ID"
              done={() => void refetch()}
            />
          )}
        </details>
      ))}
      {data?.enabled &&
        data.settlements.map((s: Row) => (
          <details className="panel spaced" key={s.id}>
            <summary>
              Held test settlement {money(s.amount_cents)} · {s.seller_id}
            </summary>
            <p>Order {s.order_id}</p>
            <ApprovalRequest
              path={`/ops/settlements/${s.id}/test-transfer`}
              label="Request test transfer review"
            />
          </details>
        ))}
      {data?.transfers.map((t: Row) => (
        <details className="panel spaced" key={t.id}>
          <summary>
            Test transfer {money(t.amount_cents)} · {t.state}
          </summary>
          <p>
            Order {t.order_id} · {t.provider_transfer_id || 'Provider outcome pending'} ·{' '}
            {t.error_code || ''}
          </p>
          {
            <RecoveryForm
              path={`/ops/transfers/${t.id}/reconcile`}
              referenceName="transfer_id"
              referenceLabel="Original transfer ID (optional)"
              done={() => void refetch()}
            />
          }
          <p>Bank payout status is not tracked.</p>
        </details>
      ))}
    </section>
  );
}
export function ConnectSettings() {
  const { data, error, refetch } = useData('/connect'),
    a = useAction();
  const [agree, setAgree] = useState(false);
  return (
    <section className="panel spaced">
      <h2>Seller test onboarding</h2>
      <ErrorNotice error={error || a.error} />
      {!data?.enabled ? (
        <p>Connected-account onboarding is not enabled for this pilot.</p>
      ) : (
        <>
          <p>
            Stripe hosts identity and payout-detail collection. This is a test account; returning
            here does not confirm verification or bank payment.
          </p>
          {data.recipient && (
            <p>
              Provider readiness: {data.recipient.state} · {data.recipient.requirements_count}{' '}
              outstanding requirements
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await a.run('/connect/onboard', {
                country: new FormData(e.currentTarget).get('country'),
                accepted_terms: true,
              });
              if (result) window.location.assign(result.url);
            }}
          >
            <label className="field">
              Test recipient country
              <select name="country" defaultValue={data.recipient?.country || data.countries[0]}>
                {data.countries.map((c: string) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              I consent to hosted test seller onboarding for this account.
            </label>
            <button className="button" disabled={!agree || a.busy}>
              Continue to Stripe test onboarding
            </button>
          </form>
          {data.recipient && (
            <button
              className="button secondary"
              disabled={a.busy}
              onClick={async () => {
                if (await a.run('/connect/refresh', {}, 'Provider readiness refreshed'))
                  void refetch();
              }}
            >
              Refresh seller readiness
            </button>
          )}
        </>
      )}
    </section>
  );
}
export function OrderAdjustments({ orderId }: { orderId: string }) {
  const { data, error } = useData(`/orders/${orderId}/payment-adjustments`);
  if (error) return <ErrorNotice error={error} />;
  if (!data?.adjustments.length && !data?.disputes.length) return null;
  return (
    <section className="panel spaced">
      <h3>Payment adjustments</h3>
      {data.adjustments.map((a: Row) => (
        <p key={a.id}>
          Partial cash refund {money(a.amount_cents)} · {a.state}. Original credits and title are
          retained.
        </p>
      ))}
      {data.disputes.map((d: Row, i: number) => (
        <p key={i}>
          Provider dispute · {d.status} · {money(d.amount_cents)}. Support will coordinate next
          steps.
        </p>
      ))}
    </section>
  );
}
