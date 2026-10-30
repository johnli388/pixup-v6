import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { StripeCheckoutProvider } from '../apps/api/src/stripe';
// Explicit sandbox probe only; no application database and no real card or funds.
const secret = process.env.STRIPE_SECRET_KEY || '',
  provider = new StripeCheckoutProvider(secret, process.env.STRIPE_ACCOUNT_ID),
  reference = randomUUID();
let paymentIntent: string | undefined;
async function refund(amount: number, stage: string) {
  const r = await provider.refund(
    {
      payment_intent: paymentIntent!,
      amount: String(amount),
      'metadata[order_id]': reference,
      'metadata[refund_id]': `${reference}-${stage}`,
    },
    `pixup-controls-${reference}-${stage}`,
  );
  const current = await provider.retrieveRefund(r.id);
  if (
    current.status !== 'succeeded' ||
    current.amount !== amount ||
    current.payment_intent !== paymentIntent
  )
    throw new Error('Sandbox refund is unresolved; inspect Stripe test records.');
}
try {
  const account = await provider.identity();
  if (!account.startsWith('acct_')) throw new Error('Provider account verification failed.');
  const response = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Stripe-Version': '2026-10-28.endive',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `pixup-controls-${reference}`,
    },
    body: new URLSearchParams({
      amount: '100',
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: 'true',
      'allowed_payment_method_types[0]': 'card',
      'metadata[order_id]': reference,
    }),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Sandbox payment setup failed (HTTP ${response.status}).`);
  const p = await response.json();
  if (
    p.livemode !== false ||
    p.status !== 'succeeded' ||
    p.amount_received !== 100 ||
    typeof p.id !== 'string'
  )
    throw new Error('Expected $1 sandbox payment was not confirmed.');
  paymentIntent = p.id;
  await refund(40, 'partial');
  let snapshot = await provider.payment(paymentIntent!);
  if (snapshot.latest_charge.amount_refunded !== 40 || snapshot.refunds.length !== 1)
    throw new Error('Partial-refund reconciliation did not match.');
  await refund(60, 'remainder');
  snapshot = await provider.payment(paymentIntent!);
  if (
    snapshot.amount_received !== 100 ||
    snapshot.latest_charge.amount_refunded !== 100 ||
    snapshot.refunds.reduce((n, r) => n + r.amount, 0) !== 100
  )
    throw new Error('Final cash reconciliation did not match.');
  console.log(
    'Stripe test account retrieval, $1 fixture payment, $0.40 partial refund, $0.60 remaining refund and canonical payment/refund reconciliation passed. No real funds moved; hosted Checkout, disputes and Connect were not exercised.',
  );
} catch (e) {
  console.error(
    e instanceof Error && e.name !== 'ZodError'
      ? e.message
      : 'Stripe sandbox response validation failed. Inspect test records.',
  );
  process.exitCode = 1;
} finally {
  if (paymentIntent) {
    try {
      const p = await provider.payment(paymentIntent),
        remaining = 100 - p.latest_charge.amount_refunded;
      if (remaining > 0) await refund(remaining, 'cleanup');
    } catch {
      console.error(
        'Sandbox cleanup could not be confirmed; inspect the Stripe test dashboard before another probe.',
      );
      process.exitCode = 1;
    }
  }
}
