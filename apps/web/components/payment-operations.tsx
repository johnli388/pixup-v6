'use client';
import { useState } from 'react';
import type { PaymentQueue } from '../../../packages/domain/contracts';
import { useData, useAction } from './providers';
import { Loading, ErrorNotice, Empty, Modal, money, date, Status } from './ui';
import { PaymentControlPanel } from './payment-controls';

type Payment = PaymentQueue['items'][number];
export function PaymentOperations() {
  const [cursor, setCursor] = useState('');
  const [selected, setSelected] = useState<Payment | null>(null);
  const { data, error, isPending } = useData<PaymentQueue>(
    `/ops/payments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
  if (isPending) return <Loading />;
  if (error || !data) return <ErrorNotice error={error} />;
  return (
    <>
      <div className="notice subtle">
        <strong>Stripe test payment recovery</strong>
        <p>
          Reconcile the original payment before releasing inventory. Full refunds return cash
          through Stripe and restore original credits after confirmation. Partial adjustments,
          failed-refund review and provider disputes use the controls below. Live payments remain
          disabled.
        </p>
      </div>
      {!data.items.length ? (
        <Empty
          title="No Stripe test orders"
          description="Orders using Stripe test checkout appear here."
        />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order / collectible</th>
                <th>Cash / credits</th>
                <th>Payment / refund</th>
                <th>Review owner / deadline</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.title}</strong>
                    <br />
                    <small>{row.id}</small>
                  </td>
                  <td>
                    {money(row.total_cents)}
                    <br />
                    {row.credit_units} credits
                  </td>
                  <td>
                    <Status status={row.payment_status} />
                    {row.refund_status && <p>Refund: {row.refund_status.replaceAll('_', ' ')}</p>}
                  </td>
                  <td>
                    {row.review_status === 'open' ? (
                      <>
                        {row.review_reason?.replaceAll('_', ' ')}
                        <br />
                        {row.assigned_to || 'Unassigned'} · {row.due_at ? date(row.due_at) : ''}
                      </>
                    ) : (
                      'No open review'
                    )}
                  </td>
                  <td>
                    <button className="button small secondary" onClick={() => setSelected(row)}>
                      Review payment
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="button-row">
        <button className="button secondary" disabled={!cursor} onClick={() => setCursor('')}>
          First page
        </button>
        <button
          className="button secondary"
          disabled={!data.next_cursor}
          onClick={() => setCursor(data.next_cursor!)}
        >
          Next page
        </button>
      </div>
      <PaymentControlPanel />
      {selected && <PaymentReview payment={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
function PaymentReview({ payment: p, onClose }: { payment: Payment; onClose: () => void }) {
  const action = useAction();
  const [note, setNote] = useState(''),
    [reference, setReference] = useState(''),
    [confirm, setConfirm] = useState(false);
  const ready = note.trim().length >= 10 && !action.busy;
  const prefix = `/ops/payments/${p.id}`;
  async function run(path: string, body: unknown) {
    if (await action.run(prefix + path, body, 'Payment record updated.')) onClose();
  }
  const refundPending =
    p.refund_status && !['succeeded', 'failed', 'canceled'].includes(p.refund_status);
  return (
    <Modal title="Review Stripe test payment" onClose={onClose}>
      <p>
        <strong>{p.title}</strong>
        <br />
        {p.id}
      </p>
      <p>
        Remaining cash: {money(p.total_cents - (p.adjusted_cash_cents || 0))} · Credits:{' '}
        {p.credit_units}. Refunds require retained vault custody and held settlement. Returned or
        resold items need separate investigation.
      </p>
      <p>
        Original session:{' '}
        {p.provider_session_id ||
          'Unknown — find the original session in the Stripe test dashboard.'}
      </p>
      <ErrorNotice error={action.error} />
      <label>
        Review note
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          minLength={10}
          maxLength={2000}
        />
      </label>
      {((p.review_status === 'open' && !p.provider_session_id) ||
        (refundPending && !p.provider_refund_id)) && (
        <label>
          {refundPending ? 'Original refund ID (optional)' : 'Original Checkout Session ID'}
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={refundPending ? 're_…' : 'cs_test_…'}
            maxLength={255}
          />
        </label>
      )}
      {p.review_status === 'open' && !p.refund_id && (
        <div className="button-row">
          <button
            className="button secondary"
            disabled={action.busy}
            onClick={() => void run('/claim', { expected_version: p.version })}
          >
            Assign review to me
          </button>
          <button
            className="button"
            disabled={!ready}
            onClick={() =>
              void run('/reconcile', {
                expected_version: p.version,
                note,
                cancel: false,
                ...(!p.provider_session_id && reference ? { session_id: reference } : {}),
              })
            }
          >
            Reconcile original payment
          </button>
          <button
            className="button secondary"
            disabled={!ready}
            onClick={() =>
              void run('/reconcile', {
                expected_version: p.version,
                note,
                cancel: true,
                ...(!p.provider_session_id && reference ? { session_id: reference } : {}),
              })
            }
          >
            Cancel if still unpaid
          </button>
        </div>
      )}
      {refundPending ? (
        <button
          className="button"
          disabled={!ready}
          onClick={() =>
            void run('/refund-status', { note, ...(reference ? { refund_id: reference } : {}) })
          }
        >
          Check original refund
        </button>
      ) : !p.refund_id && ['paid', 'fulfilled', 'pending_payment'].includes(p.status) ? (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            I reviewed custody, payment and the full refund amount.
          </label>
          <button
            className="button"
            disabled={!ready || !confirm}
            onClick={() => void run('/refund', { reason: note })}
          >
            Issue full test refund
          </button>
        </>
      ) : (
        <p>
          Refund outcome: {p.refund_status || 'No refund available'}. Failed or canceled refunds
          require finance investigation; this workflow never silently creates a replacement.
        </p>
      )}
    </Modal>
  );
}
