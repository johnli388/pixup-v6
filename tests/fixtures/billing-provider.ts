import assert from 'node:assert/strict';
import { id } from '../../packages/domain/core';
import type {
  BillingProvider,
  BillingSession,
  BillingSubscription,
} from '../../apps/api/src/billing-provider';
export class FakeBilling implements BillingProvider {
  sessions = new Map<string, BillingSession>();
  subscriptions = new Map<string, BillingSubscription>();
  payloads = new Map<string, Record<string, string>>();
  calls = 0;
  lose = false;
  async create(payload: Record<string, string>, key: string) {
    this.calls++;
    const old = this.payloads.get(key);
    if (old) assert.deepEqual(payload, old);
    this.payloads.set(key, structuredClone(payload));
    let session = [...this.sessions.values()].find(
      (s) => s.client_reference_id === payload.client_reference_id,
    );
    if (!session) {
      session = {
        id: `cs_test_${id()}`,
        livemode: false,
        mode: 'subscription',
        status: 'open',
        client_reference_id: payload.client_reference_id,
        metadata: {
          billing_attempt: payload.client_reference_id,
          plan_id: payload['metadata[plan_id]'],
          org_id: payload['metadata[org_id]'],
        },
        subscription: null,
        customer: null,
        url: 'https://checkout.stripe.com/c/pay/test',
      };
      this.sessions.set(session.id, session);
    }
    if (this.lose) {
      this.lose = false;
      throw new Error('Simulated response lost after provider create');
    }
    return structuredClone(session);
  }
  async session(sid: string) {
    return structuredClone(this.sessions.get(sid)!);
  }
  async subscription(sid: string) {
    return structuredClone(this.subscriptions.get(sid)!);
  }
  async cancel(sid: string) {
    this.subscriptions.get(sid)!.cancel_at_period_end = true;
  }
  complete(local: string, state: BillingSubscription['status'] = 'active') {
    const session = [...this.sessions.values()].find((s) => s.client_reference_id === local)!;
    const payload = [...this.payloads.values()].find((p) => p.client_reference_id === local)!;
    const now = Math.floor(Date.now() / 1000),
      sid = `sub_${id()}`,
      customer = `cus_${id()}`,
      amount = Number(payload['line_items[0][price_data][unit_amount]']);
    session.status = 'complete';
    session.subscription = sid;
    session.customer = customer;
    session.url = null;
    const sub: BillingSubscription = {
      id: sid,
      livemode: false,
      customer,
      created: now,
      status: state,
      metadata: session.metadata,
      cancel_at_period_end: false,
      trial_end:
        state === 'trialing'
          ? now + Number(payload['subscription_data[trial_period_days]']) * 86400
          : null,
      items: {
        data: [
          {
            quantity: 1,
            current_period_end: now + 30 * 86400,
            price: {
              currency: 'usd',
              unit_amount: amount,
              recurring: { interval: 'month', interval_count: 1 },
            },
          },
        ],
      },
      latest_invoice: {
        id: `in_${id()}`,
        created: now,
        livemode: false,
        customer,
        currency: 'usd',
        status: 'paid',
        amount_due: state === 'trialing' ? 0 : amount,
        amount_paid: state === 'trialing' ? 0 : amount,
        parent: { subscription_details: { subscription: sid } },
      },
    };
    this.subscriptions.set(sid, sub);
    return sub;
  }
}
