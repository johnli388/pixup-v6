'use client';
import type { PaymentStatus } from '../../../packages/domain/contracts';
import { useEffect, useState } from 'react';
import { useSession, useAction, type Row } from './providers';
import { ErrorNotice } from './ui';

export function StripePayment({ order }: { order: Row }) {
  const { request, refresh } = useSession();
  const action = useAction();
  const [status, setStatus] = useState(''),
    [error, setError] = useState<string | Error>('');
  useEffect(() => {
    if (order.status !== 'pending_payment') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const payment = await request<PaymentStatus>(
          `/orders/${order.id}/payment-status`,
          {},
          undefined,
          controller.signal,
        );
        if (!active) return;
        setStatus(payment.payment_status);
        setError('');
        if (payment.status !== 'pending_payment') await refresh();
      } catch (e) {
        if (active) setError(e instanceof Error ? e : 'Payment status is temporarily unavailable.');
      }
      if (active) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [order.id, order.status, request, refresh]);
  async function resume() {
    const payment = await action.run<PaymentStatus>(`/orders/${order.id}/stripe-checkout`, {});
    if (payment?.url) window.location.assign(payment.url);
  }
  return (
    <div className="form-panel">
      <div className="notice subtle">
        <strong>Stripe test payment</strong>
        <p>
          Payment details are collected securely on Stripe. Use test payment details only; no real
          money moves.
        </p>
      </div>
      {order.status === 'pending_payment' && (
        <>
          <p role="status">
            {status === 'requires_review'
              ? 'This payment needs reconciliation. Your item remains reserved; contact support.'
              : 'Waiting for Stripe confirmation. Returning from checkout alone does not confirm payment.'}
          </p>
          <ErrorNotice error={error || action.error} />
          <div className="button-row">
            <button
              className="button"
              disabled={action.busy || status === 'requires_review'}
              onClick={() => void resume()}
            >
              Continue to Stripe Checkout
            </button>
            <button
              className="button secondary"
              disabled={action.busy || status === 'requires_review'}
              onClick={() =>
                void action.run(
                  `/orders/${order.id}/cancel-payment`,
                  {},
                  'Payment status checked with Stripe.',
                )
              }
            >
              Cancel payment
            </button>
          </div>
          <small>
            Cancellation releases inventory only after Stripe confirms the session expired. If
            payment already succeeded, the order is confirmed instead.
          </small>
        </>
      )}
      {['paid', 'fulfilled'].includes(order.status) && (
        <p>
          Stripe confirmed this test payment. Refunds and seller payouts require support
          reconciliation; local demo refunds are disabled for Stripe orders.
        </p>
      )}
    </div>
  );
}
