import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { check, DomainError } from '../../../packages/domain/core';

export const stripeSessionSchema = z.object({
  id: z.string().startsWith('cs_test_'),
  livemode: z.literal(false),
  status: z.enum(['open', 'complete', 'expired']),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  amount_total: z.number().int(),
  currency: z.string(),
  client_reference_id: z.string(),
  metadata: z.object({ order_id: z.string() }),
  url: z.string().nullable(),
  payment_intent: z.string().nullable(),
});
export type StripeSession = z.infer<typeof stripeSessionSchema>;
export type SessionPayload = Record<string, string>;
export function checkoutPayload(
  orderId: string,
  totalCents: number,
  expiresAt: Date,
  origin: string,
): SessionPayload {
  return {
    mode: 'payment',
    'adaptive_pricing[enabled]': 'false',
    'allowed_payment_method_types[0]': 'card',
    client_reference_id: orderId,
    'metadata[order_id]': orderId,
    'payment_intent_data[metadata][order_id]': orderId,
    success_url: `${origin}/account/orders/${orderId}?payment_return=success`,
    cancel_url: `${origin}/account/orders/${orderId}?payment_return=canceled`,
    expires_at: String(Math.floor(expiresAt.getTime() / 1000)),
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(totalCents),
    'line_items[0][price_data][product_data][name]': `PixUP test order ${orderId.slice(0, 8)}`,
    'line_items[0][quantity]': '1',
  };
}
export interface CheckoutProvider {
  create(payload: SessionPayload, key: string): Promise<StripeSession>;
  retrieve(id: string): Promise<StripeSession>;
  expire(id: string): Promise<StripeSession>;
}
export class StripeCheckoutProvider implements CheckoutProvider {
  constructor(private secret: string) {
    check(
      /^(sk|rk)_test_/.test(secret),
      'STRIPE_TEST_KEY_REQUIRED',
      'Stripe checkout requires a test-mode secret key. Live payments are not enabled.',
      500,
    );
  }
  private async call(path: string, payload?: SessionPayload, key?: string): Promise<StripeSession> {
    let response: Response;
    try {
      response = await fetch(`https://api.stripe.com/v1/checkout/sessions${path}`, {
        method: payload ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${this.secret}`,
          'Stripe-Version': '2026-10-28.endive',
          ...(payload ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(payload ? { body: new URLSearchParams(payload) } : {}),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
    } catch {
      throw new DomainError(
        503,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Stripe could not be reached. Your order is saved; resume it from Orders.',
      );
    }
    // Do not forward provider bodies, headers, URLs or credentials into logs/errors.
    if (!response.ok)
      throw new DomainError(
        503,
        'STRIPE_REQUEST_FAILED',
        `Stripe could not complete this request (HTTP ${response.status}). Your reservation is preserved; retry from the order page or contact support.`,
      );
    const result = stripeSessionSchema.safeParse(await response.json());
    check(
      result.success,
      'STRIPE_RESPONSE_INVALID',
      'Stripe returned an unexpected test payment response. Contact support.',
      502,
    );
    return result.data;
  }
  create(payload: SessionPayload, key: string) {
    return this.call('', payload, key);
  }
  retrieve(id: string) {
    return this.call(`/${encodeURIComponent(id)}`);
  }
  expire(id: string) {
    return this.call(`/${encodeURIComponent(id)}/expire`, {});
  }
}

export function stripeConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const selection = env.PAYMENT_PROVIDER || 'auto';
  check(
    ['auto', 'demo', 'stripe_test'].includes(selection),
    'PAYMENT_CONFIGURATION',
    'PAYMENT_PROVIDER must be auto, demo or stripe_test.',
    500,
  );
  const enabled = selection === 'stripe_test' || (selection === 'auto' && !!env.STRIPE_SECRET_KEY);
  const provider = enabled ? new StripeCheckoutProvider(env.STRIPE_SECRET_KEY || '') : undefined;
  const origin = env.APP_ORIGIN || 'http://127.0.0.1:3000';
  const url = new URL(origin);
  check(
    ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.origin === origin,
    'PAYMENT_CONFIGURATION',
    'APP_ORIGIN must be an HTTP(S) origin without a path or credentials.',
    500,
  );
  return { provider, origin, webhookSecret: env.STRIPE_WEBHOOK_SECRET };
}

export function verifyStripeEvent(raw: Buffer, signature: string, secret?: string) {
  check(secret, 'WEBHOOK_NOT_CONFIGURED', 'Stripe webhook signing is not configured.', 503);
  const fields = signature.split(',').map((part) => part.split('='));
  const timestamp = fields.find(([name]) => name === 't')?.[1] || '';
  check(
    /^\d+$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300,
    'WEBHOOK_SIGNATURE_INVALID',
    'Invalid Stripe webhook signature.',
    400,
  );
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(raw)
    .digest();
  check(
    fields.some(
      ([name, value]) =>
        name === 'v1' &&
        /^[a-f0-9]{64}$/.test(value || '') &&
        timingSafeEqual(expected, Buffer.from(value, 'hex')),
    ),
    'WEBHOOK_SIGNATURE_INVALID',
    'Invalid Stripe webhook signature.',
    400,
  );
  try {
    return z
      .object({
        id: z.string().startsWith('evt_'),
        type: z.string(),
        livemode: z.literal(false),
        data: z.object({ object: z.object({ id: z.string().startsWith('cs_test_') }) }),
      })
      .parse(JSON.parse(raw.toString('utf8')));
  } catch {
    throw new DomainError(
      400,
      'WEBHOOK_EVENT_INVALID',
      'Expected a test-mode Checkout Session event.',
    );
  }
}
