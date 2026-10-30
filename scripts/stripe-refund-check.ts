import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { StripeCheckoutProvider } from '../apps/api/src/stripe';

// Explicit smoke check only: creates a $1 TEST PaymentIntent with Stripe's fixture
// payment method and refunds it. Does not use a real card or the application DB.
// API bodies, client secrets and credentials must never reach diagnostic output.
const secret = process.env.STRIPE_SECRET_KEY || '';
const provider = new StripeCheckoutProvider(secret); // Refuses live keys before any network call.
const reference = randomUUID();
let paymentIntent: string | undefined;
let completed = false;
async function refund() {
  const result = await provider.refund(
    {
      payment_intent: paymentIntent!,
      amount: '100',
      'metadata[order_id]': reference,
      'metadata[refund_id]': reference,
    },
    `pixup-refund-probe-${reference}`,
  );
  const retrieved = await provider.retrieveRefund(result.id);
  if (
    retrieved.status !== 'succeeded' ||
    retrieved.amount !== 100 ||
    retrieved.currency !== 'usd' ||
    retrieved.payment_intent !== paymentIntent ||
    retrieved.metadata.refund_id !== reference
  )
    throw new Error(
      'Test refund has not confirmed the expected result. Inspect the Stripe test dashboard.',
    );
  completed = true;
}
try {
  const payload = new URLSearchParams({
    amount: '100',
    currency: 'usd',
    payment_method: 'pm_card_visa',
    confirm: 'true',
    'allowed_payment_method_types[0]': 'card',
    'metadata[pixup_refund_probe]': reference,
  });
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Stripe-Version': '2026-10-28.endive',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': `pixup-refund-probe-payment-${reference}`,
        },
        body: payload,
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      break;
    } catch {
      if (attempt === 1)
        throw new Error('Stripe test payment could not be retrieved. Inspect the test dashboard.');
    }
  }
  if (!response?.ok)
    throw new Error(`Stripe test payment setup failed (HTTP ${response?.status}).`);
  const payment = await response.json();
  if (
    payment.livemode !== false ||
    payment.status !== 'succeeded' ||
    payment.amount_received !== 100 ||
    typeof payment.id !== 'string'
  )
    throw new Error('Stripe did not confirm the expected test payment.');
  paymentIntent = payment.id;
  await refund();
  console.log(
    'Stripe test payment and full refund create/retrieve passed for $1. No real money moved. Hosted Checkout interaction was not exercised.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Stripe refund smoke check failed.');
  process.exitCode = 1;
} finally {
  if (paymentIntent && !completed)
    await refund().catch(() =>
      console.error('Test refund cleanup remains unresolved; inspect the Stripe test dashboard.'),
    );
}
