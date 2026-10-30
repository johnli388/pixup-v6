import { z } from 'zod';
import { check, DomainError } from '../../../packages/domain/core';
export const billingSessionSchema = z.object({
  id: z.string().startsWith('cs_test_'),
  livemode: z.literal(false),
  mode: z.literal('subscription'),
  status: z.enum(['open', 'complete', 'expired']),
  client_reference_id: z.string(),
  metadata: z.object({ billing_attempt: z.string(), plan_id: z.string(), org_id: z.string() }),
  subscription: z.string().startsWith('sub_').nullable(),
  customer: z.string().startsWith('cus_').nullable(),
  url: z.string().nullable(),
});
const invoiceSchema = z.object({
  created: z.number().int(),
  id: z.string().startsWith('in_'),
  livemode: z.literal(false),
  customer: z.string(),
  currency: z.literal('usd'),
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']),
  amount_due: z.number().int().nonnegative(),
  amount_paid: z.number().int().nonnegative(),
  parent: z.object({ subscription_details: z.object({ subscription: z.string() }) }),
});
export const billingSubscriptionSchema = z.object({
  id: z.string().startsWith('sub_'),
  livemode: z.literal(false),
  customer: z.string(),
  created: z.number().int(),
  status: z.enum([
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'incomplete',
    'incomplete_expired',
    'paused',
  ]),
  metadata: z.object({ billing_attempt: z.string(), plan_id: z.string(), org_id: z.string() }),
  cancel_at_period_end: z.boolean(),
  trial_end: z.number().int().nullable(),
  items: z.object({
    data: z
      .array(
        z.object({
          quantity: z.literal(1),
          current_period_end: z.number().int(),
          price: z.object({
            currency: z.literal('usd'),
            unit_amount: z.number().int(),
            recurring: z.object({ interval: z.literal('month'), interval_count: z.literal(1) }),
          }),
        }),
      )
      .length(1),
  }),
  latest_invoice: invoiceSchema.nullable(),
});
export type BillingSession = z.infer<typeof billingSessionSchema>;
export type BillingSubscription = z.infer<typeof billingSubscriptionSchema>;
export interface BillingProvider {
  create(payload: Record<string, string>, key: string): Promise<BillingSession>;
  session(id: string): Promise<BillingSession>;
  subscription(id: string): Promise<BillingSubscription>;
  cancel(id: string, key: string): Promise<void>;
}
export type BillingOptions = {
  provider?: BillingProvider;
  origin?: string;
  webhookSecret?: string;
};
export class StripeBillingProvider implements BillingProvider {
  constructor(private secret: string) {
    check(
      /^(sk|rk)_test_/.test(secret),
      'BILLING_TEST_KEY_REQUIRED',
      'Subscription billing requires a Stripe test secret.',
      500,
    );
  }
  private async call(path: string, payload?: Record<string, string>, key?: string) {
    let response: Response;
    try {
      response = await fetch('https://api.stripe.com/v1' + path, {
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
        'BILLING_PROVIDER_UNAVAILABLE',
        'Subscription provider is unavailable; saved requests can be retried.',
      );
    }
    check(
      response.ok,
      'BILLING_PROVIDER_UNAVAILABLE',
      'Subscription provider rejected the request; contact support or retry.',
      503,
    );
    return response.json();
  }
  async create(payload: Record<string, string>, key: string) {
    return billingSessionSchema.parse(await this.call('/checkout/sessions', payload, key));
  }
  async session(id: string) {
    return billingSessionSchema.parse(
      await this.call('/checkout/sessions/' + encodeURIComponent(id)),
    );
  }
  async subscription(id: string) {
    return billingSubscriptionSchema.parse(
      await this.call('/subscriptions/' + encodeURIComponent(id) + '?expand[]=latest_invoice'),
    );
  }
  async cancel(id: string, key: string) {
    await this.call(
      '/subscriptions/' + encodeURIComponent(id),
      { cancel_at_period_end: 'true' },
      key,
    );
  }
}
export function billingConfiguration(env: NodeJS.ProcessEnv = process.env): BillingOptions {
  check(
    !env.BILLING_PROVIDER || ['disabled', 'stripe_test'].includes(env.BILLING_PROVIDER),
    'BILLING_CONFIGURATION',
    'Use disabled or stripe_test billing.',
    500,
  );
  const origin = env.APP_ORIGIN || 'http://127.0.0.1:3000';
  const u = new URL(origin);
  check(
    ['http:', 'https:'].includes(u.protocol) && u.origin === origin && !u.username && !u.password,
    'BILLING_CONFIGURATION',
    'Billing requires a valid application origin.',
    500,
  );
  return {
    provider:
      env.BILLING_PROVIDER === 'stripe_test'
        ? new StripeBillingProvider(env.STRIPE_SECRET_KEY || '')
        : undefined,
    origin,
    webhookSecret: env.STRIPE_BILLING_WEBHOOK_SECRET,
  };
}
