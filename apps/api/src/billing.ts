import { z } from 'zod';
import { one, type Database } from '../../../packages/database/index';
import { audit, check, id, DomainError } from '../../../packages/domain/core';
import { hash } from '../../../packages/domain/security';
import { entitlement, workspaceMember, planInput } from '../../../packages/domain/saas';
import { requireEligibility } from '../../../packages/domain/privacy';
import { type Actor, requireStaff } from './auth';
import { lockChannels } from './channel-core';
import { verifyStripeSignature } from './stripe';
import {
  billingSessionSchema,
  billingSubscriptionSchema,
  type BillingOptions,
  type BillingSession,
} from './billing-provider';
export class BillingService {
  constructor(
    private db: Database,
    private options: BillingOptions = {},
  ) {}
  async plans(actor: Actor) {
    return {
      enabled: !!this.options.provider,
      mode: 'stripe_test',
      plans: (
        await this.db.query(
          "SELECT id,name,audience,amount_cents,currency,trial_days,grace_days,limits FROM plan_versions WHERE state='active' ORDER BY created_at",
        )
      ).rows,
    };
  }
  async createPlan(actor: Actor, input: unknown) {
    requireStaff(actor, 'finance');
    const d = planInput.parse(input);
    const pid = id();
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await tx.query(
        'INSERT INTO plan_versions(id,name,audience,amount_cents,trial_days,grace_days,limits,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          pid,
          d.name,
          d.audience,
          d.amount_cents,
          d.trial_days,
          d.grace_days,
          JSON.stringify(d.limits),
          actor.id,
        ],
      );
      await audit(tx, actor.id, 'billing.plan_drafted', pid);
      return { id: pid };
    });
  }
  async account(actor: Actor, org: string) {
    await workspaceMember(this.db, actor.id, org, false, true);
    return {
      org_id: org,
      entitlement: await entitlement(this.db, org),
      subscriptions: (
        await this.db.query(
          `SELECT s.id,s.plan_id,s.state,s.period_end,s.trial_end,s.past_due_since,s.cancel_at_period_end,s.cancel_requested,s.error_code,s.created_at,p.name FROM subscriptions s JOIN billing_accounts a ON a.id=s.account_id JOIN plan_versions p ON p.id=s.plan_id WHERE a.org_id=$1 ORDER BY s.created_at DESC`,
          [org],
        )
      ).rows,
      invoices: (
        await this.db.query(
          'SELECT i.id,i.status,i.currency,i.amount_due,i.amount_paid,i.period_end FROM subscription_invoices i JOIN subscriptions s ON s.id=i.subscription_id JOIN billing_accounts a ON a.id=s.account_id WHERE a.org_id=$1 ORDER BY i.updated_at DESC LIMIT 100',
          [org],
        )
      ).rows,
      usage: (
        await this.db.query(
          "SELECT metric,sum(quantity)::int AS quantity FROM usage_events WHERE org_id=$1 AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' GROUP BY metric",
          [org],
        )
      ).rows,
      usage_window: 'UTC calendar month',
      metering: 'Included usage only; no metered overage charges.',
    };
  }
  async start(actor: Actor, org: string, planId: string) {
    check(
      this.options.provider,
      'BILLING_DISABLED',
      'Stripe test subscription billing is not configured.',
      503,
    );
    const local = await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await workspaceMember(tx, actor.id, org, false, true);
      await requireEligibility(tx, actor.id);
      const plan = await one(tx, "SELECT * FROM plan_versions WHERE id=$1 AND state='active'", [
        planId,
      ]);
      check(plan, 'PLAN_UNAVAILABLE', 'Choose an independently approved active test plan.');
      await tx.query(
        'INSERT INTO billing_accounts(id,org_id) VALUES ($1,$2) ON CONFLICT(org_id) DO NOTHING',
        [id(), org],
      );
      const account = (await one(tx, 'SELECT id FROM billing_accounts WHERE org_id=$1', [org]))!;
      const existing = await one(
        tx,
        "SELECT * FROM subscriptions WHERE account_id=$1 AND state NOT IN ('canceled','expired')",
        [account.id],
      );
      if (existing) {
        check(
          existing.plan_id === planId && existing.state === 'pending',
          'SUBSCRIPTION_EXISTS',
          'Cancel at period end and wait for provider-confirmed termination before changing plans.',
        );
        return existing.id;
      }
      const sid = id(),
        origin = this.options.origin || 'http://127.0.0.1:3000';
      const payload: Record<string, string> = {
        mode: 'subscription',
        client_reference_id: sid,
        'metadata[billing_attempt]': sid,
        'metadata[plan_id]': planId,
        'metadata[org_id]': org,
        'subscription_data[metadata][billing_attempt]': sid,
        'subscription_data[metadata][plan_id]': planId,
        'subscription_data[metadata][org_id]': org,
        success_url: `${origin}/account/settings?billing_return=${sid}`,
        cancel_url: `${origin}/account/settings?billing_canceled=${sid}`,
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(plan.amount_cents),
        'line_items[0][price_data][recurring][interval]': 'month',
        'line_items[0][price_data][product_data][name]': `PixUP TEST ${plan.name}`,
        'line_items[0][quantity]': '1',
        'payment_method_types[0]': 'card',
        expires_at: String(Math.floor(Date.now() / 1000) + 86400),
      };
      if (plan.trial_days)
        payload['subscription_data[trial_period_days]'] = String(plan.trial_days);
      await tx.query(
        'INSERT INTO subscriptions(id,account_id,plan_id,payload,created_by) VALUES ($1,$2,$3,$4,$5)',
        [sid, account.id, planId, JSON.stringify(payload), actor.id],
      );
      await audit(tx, actor.id, 'billing.checkout_requested', sid, { plan_id: planId });
      return sid;
    });
    return this.resume(actor, local);
  }
  private async owned(actor: Actor, sid: string) {
    const s = await one(
      this.db,
      'SELECT s.*,a.org_id FROM subscriptions s JOIN billing_accounts a ON a.id=s.account_id WHERE s.id=$1',
      [sid],
    );
    check(s, 'NOT_FOUND', 'Subscription not found.', 404);
    await workspaceMember(this.db, actor.id, s.org_id, false, true);
    return s;
  }
  private validateSession(s: Record<string, any>, input: BillingSession) {
    const remote = billingSessionSchema.parse(input);
    check(
      remote.client_reference_id === s.id &&
        remote.metadata.billing_attempt === s.id &&
        remote.metadata.plan_id === s.plan_id &&
        remote.metadata.org_id === s.org_id &&
        (!s.session_id || remote.id === s.session_id),
      'BILLING_IDENTITY',
      'Subscription checkout identity does not match.',
    );
    if (remote.url) {
      const u = new URL(remote.url);
      check(
        u.protocol === 'https:' &&
          u.hostname === 'checkout.stripe.com' &&
          !u.username &&
          !u.password,
        'BILLING_URL',
        'Unexpected hosted checkout address.',
      );
    }
    return remote;
  }
  private async session(s: Record<string, any>) {
    check(this.options.provider, 'BILLING_DISABLED', 'Stripe test billing is not configured.', 503);
    let remote: BillingSession;
    if (s.session_id) remote = await this.options.provider.session(s.session_id);
    else {
      check(
        Date.now() - Date.parse(s.created_at) < 23 * 3600000,
        'BILLING_REVIEW_REQUIRED',
        'Ambiguous old checkout requires provider review; it will not be recreated.',
      );
      remote = await this.options.provider.create(s.payload, `billing:${s.id}`);
    }
    remote = this.validateSession(s, remote);
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const current = (await one(tx, 'SELECT * FROM subscriptions WHERE id=$1', [s.id]))!;
      check(
        !current.session_id || current.session_id === remote.id,
        'BILLING_IDENTITY',
        'Checkout session changed.',
      );
      check(
        !current.provider_id || !remote.subscription || current.provider_id === remote.subscription,
        'BILLING_IDENTITY',
        'Subscription identity changed.',
      );
      await tx.query(
        'UPDATE subscriptions SET session_id=$2,provider_id=COALESCE(provider_id,$3),customer_id=COALESCE(customer_id,$4),checkout_url=$5 WHERE id=$1',
        [s.id, remote.id, remote.subscription, remote.customer, remote.url],
      );
    });
    return remote;
  }
  async resume(actor: Actor, sid: string) {
    const s = await this.owned(actor, sid);
    if (s.state === 'pending') await requireEligibility(this.db, actor.id);
    await this.reconcile(sid);
    const current = await this.owned(actor, sid);
    return {
      id: sid,
      state: current.state,
      checkout_url: current.state === 'pending' ? current.checkout_url : null,
    };
  }
  async cancel(actor: Actor, sid: string) {
    await this.owned(actor, sid);
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const s = (await one(
        tx,
        'SELECT s.*,a.org_id FROM subscriptions s JOIN billing_accounts a ON a.id=s.account_id WHERE s.id=$1',
        [sid],
      ))!;
      await workspaceMember(tx, actor.id, s.org_id, false, true);
      check(
        s.provider_id,
        'CHECKOUT_PENDING',
        'Complete or let the hosted checkout expire before canceling.',
      );
      await tx.query('UPDATE subscriptions SET cancel_requested=true WHERE id=$1', [sid]);
      await audit(tx, actor.id, 'billing.cancellation_requested', sid);
    });
    await this.reconcile(sid);
    return { ok: true };
  }
  async recover(actor: Actor, sid: string, sessionId: string, reason: string) {
    requireStaff(actor, 'finance');
    check(this.options.provider, 'BILLING_DISABLED', 'Stripe test billing is not configured.', 503);
    const s = await one(
      this.db,
      'SELECT s.*,a.org_id FROM subscriptions s JOIN billing_accounts a ON a.id=s.account_id WHERE s.id=$1',
      [sid],
    );
    check(s, 'NOT_FOUND', 'Subscription not found.', 404);
    this.validateSession(s, await this.options.provider.session(sessionId));
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const current = (await one(tx, 'SELECT session_id FROM subscriptions WHERE id=$1', [sid]))!;
      check(
        !current.session_id || current.session_id === sessionId,
        'BILLING_IDENTITY',
        'A different session is already bound.',
      );
      await tx.query('UPDATE subscriptions SET session_id=$2 WHERE id=$1', [sid, sessionId]);
      await audit(tx, actor.id, 'billing.session_recovered', sid, {
        session_id: sessionId,
        reason,
      });
    });
    await this.reconcile(sid);
    return { ok: true };
  }
  async reconcile(sid: string) {
    check(this.options.provider, 'BILLING_DISABLED', 'Stripe test billing is not configured.', 503);
    const provider = this.options.provider;
    const s = await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      return one(
        tx,
        `UPDATE subscriptions SET sync_version=sync_version+1,last_checked=now() WHERE id=$1 RETURNING *, (SELECT org_id FROM billing_accounts WHERE id=subscriptions.account_id) AS org_id`,
        [sid],
      );
    });
    check(s, 'NOT_FOUND', 'Subscription not found.', 404);
    try {
      const remote = await this.session(s);
      check(
        !s.provider_id || !!remote.subscription,
        'BILLING_IDENTITY',
        'An established subscription cannot lose its provider identity.',
      );
      if (!remote.subscription) {
        await this.db.query(
          "UPDATE subscriptions SET state=CASE WHEN $3 THEN 'expired' ELSE state END,error_code=NULL WHERE id=$1 AND sync_version=$2",
          [sid, s.sync_version, remote.status === 'expired'],
        );
        return;
      }
      if (s.cancel_requested) await provider.cancel(remote.subscription, `billing-cancel:${sid}`);
      check(
        remote.status === 'complete' && remote.customer,
        'BILLING_IDENTITY',
        'Subscription checkout is not complete.',
      );
      const sub = billingSubscriptionSchema.parse(await provider.subscription(remote.subscription));
      const plan = (await one(this.db, 'SELECT * FROM plan_versions WHERE id=$1', [s.plan_id]))!;
      check(
        sub.id === remote.subscription &&
          sub.customer === remote.customer &&
          sub.metadata.billing_attempt === sid &&
          sub.metadata.org_id === s.org_id &&
          sub.metadata.plan_id === plan.id &&
          sub.items.data[0].price.unit_amount === plan.amount_cents,
        'BILLING_IDENTITY',
        'Provider subscription, price or customer mismatch.',
      );
      if (sub.status === 'trialing')
        check(
          plan.trial_days > 0 &&
            sub.trial_end &&
            sub.trial_end <= sub.created + plan.trial_days * 86400 + 60,
          'BILLING_TRIAL',
          'Unexpected trial terms.',
        );
      const inv = sub.latest_invoice,
        period = sub.items.data[0].current_period_end;
      if (inv)
        check(
          inv.customer === sub.customer &&
            inv.parent.subscription_details.subscription === sub.id &&
            [0, plan.amount_cents].includes(inv.amount_due) &&
            inv.amount_paid <= inv.amount_due,
          'BILLING_INVOICE',
          'Provider invoice identity or amount mismatch.',
        );
      if (sub.status === 'active')
        check(
          inv?.status === 'paid' &&
            inv.amount_due === plan.amount_cents &&
            inv.amount_paid === plan.amount_cents,
          'BILLING_PAYMENT_REQUIRED',
          'An active paid plan requires its fully paid invoice.',
        );
      const state =
        sub.status === 'trialing'
          ? 'trial'
          : sub.status === 'incomplete'
            ? 'pending'
            : sub.status === 'incomplete_expired'
              ? 'expired'
              : sub.status;
      await this.db.transaction(async (tx) => {
        await lockChannels(tx);
        const current = (await one(tx, 'SELECT * FROM subscriptions WHERE id=$1', [sid]))!;
        if (current.sync_version !== s.sync_version) return;
        check(
          !current.customer_id || current.customer_id === sub.customer,
          'BILLING_IDENTITY',
          'Provider customer changed.',
        );
        if (inv)
          await tx.query(
            `INSERT INTO subscription_invoices(id,subscription_id,status,currency,amount_due,amount_paid,period_end) VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7)) ON CONFLICT(id) DO UPDATE SET status=$3,amount_due=$5,amount_paid=$6,period_end=to_timestamp($7),updated_at=now() WHERE subscription_invoices.subscription_id=$2`,
            [inv.id, sid, inv.status, inv.currency, inv.amount_due, inv.amount_paid, period],
          );
        await tx.query(
          `UPDATE subscriptions SET state=$2,period_end=to_timestamp($3),trial_end=CASE WHEN $4::double precision IS NULL THEN NULL ELSE to_timestamp($4) END,cancel_at_period_end=$5,past_due_since=CASE WHEN $2='past_due' THEN COALESCE(past_due_since,to_timestamp($7)) ELSE NULL END,last_paid_at=CASE WHEN $6 THEN COALESCE(last_paid_at,now()) ELSE last_paid_at END,error_code=NULL WHERE id=$1`,
          [
            sid,
            state,
            period,
            sub.trial_end,
            sub.cancel_at_period_end,
            !!inv && inv.status === 'paid' && inv.amount_paid > 0,
            inv?.created || sub.created,
          ],
        );
        if (current.state !== state)
          await audit(tx, s.created_by, 'billing.state_changed', sid, {
            from: current.state,
            to: state,
          });
      });
    } catch (e) {
      await this.db.query(
        'UPDATE subscriptions SET error_code=$2 WHERE id=$1 AND sync_version=$3',
        [sid, e instanceof DomainError ? e.code : 'BILLING_RESPONSE_INVALID', s.sync_version],
      );
      throw e;
    }
  }
  async webhook(raw: Buffer, signature: string) {
    verifyStripeSignature(raw, signature, this.options.webhookSecret);
    const e = z
      .object({
        id: z.string().startsWith('evt_'),
        type: z.string(),
        livemode: z.literal(false),
        data: z.object({
          object: z.object({
            id: z.string(),
            metadata: z.record(z.string(), z.string()).optional(),
            subscription: z.string().nullable().optional(),
            parent: z
              .object({
                subscription_details: z.object({ subscription: z.string() }).nullable().optional(),
              })
              .nullable()
              .optional(),
          }),
        }),
      })
      .parse(JSON.parse(raw.toString('utf8')));
    if (
      ![
        'checkout.session.completed',
        'checkout.session.expired',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.paid',
        'invoice.payment_failed',
        'invoice.voided',
        'invoice.marked_uncollectible',
      ].includes(e.type)
    )
      return { received: true, ignored: true };
    const object = e.data.object,
      sub = e.type.startsWith('customer.subscription.')
        ? object.id
        : object.parent?.subscription_details?.subscription || object.subscription || null,
      attempt = object.metadata?.billing_attempt || null,
      digest = hash(raw.toString('utf8'));
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const old = await one(tx, 'SELECT content_hash FROM billing_events WHERE id=$1', [e.id]);
      if (old) {
        check(old.content_hash === digest, 'EVENT_CONFLICT', 'Event ID has different content.');
        return;
      }
      await tx.query(
        'INSERT INTO billing_events(id,type,object_id,subscription_ref,attempt_ref,content_hash) VALUES ($1,$2,$3,$4,$5,$6)',
        [e.id, e.type, object.id, sub, attempt, digest],
      );
    });
    return { received: true };
  }
  async worker() {
    if (!this.options.provider) return;
    const events = (
      await this.db.query(
        "SELECT e.* FROM billing_events e WHERE processed_at IS NULL AND EXISTS(SELECT 1 FROM subscriptions s WHERE (s.id=e.attempt_ref OR s.session_id=e.object_id OR s.provider_id=e.subscription_ref) AND (s.last_checked IS NULL OR s.last_checked<now()-interval '1 minute' OR e.created_at>s.last_checked)) ORDER BY e.created_at LIMIT 20",
      )
    ).rows;
    for (const e of events) {
      let s = await one(
        this.db,
        'SELECT s.*,a.org_id FROM subscriptions s JOIN billing_accounts a ON a.id=s.account_id WHERE s.id=$1 OR s.session_id=$2 OR s.provider_id=$3',
        [e.attempt_ref, e.object_id, e.subscription_ref],
      );
      if (!s) continue;
      try {
        if (e.type.startsWith('checkout.session.') && !s.session_id) {
          const remote = this.validateSession(s, await this.options.provider.session(e.object_id));
          await this.db.query(
            'UPDATE subscriptions SET session_id=$2 WHERE id=$1 AND session_id IS NULL',
            [s.id, remote.id],
          );
        }
        await this.reconcile(s.id);
        await this.db.query('UPDATE billing_events SET processed_at=now() WHERE id=$1', [e.id]);
      } catch {
        /* Retain event and sanitized subscription error for retry/review. */
      }
    }
    const rows = (
      await this.db.query(
        "SELECT id FROM subscriptions WHERE state NOT IN ('canceled','expired') AND (last_checked IS NULL OR last_checked<now()-interval '1 minute') ORDER BY last_checked NULLS FIRST LIMIT 10",
      )
    ).rows;
    for (const r of rows)
      try {
        await this.reconcile(r.id);
      } catch {
        /* Persisted error, bounded retries. */
      }
  }
  async dashboard(actor: Actor) {
    requireStaff(actor, 'finance');
    return {
      plans: (await this.db.query('SELECT * FROM plan_versions ORDER BY created_at DESC LIMIT 100'))
        .rows,
      subscriptions: (
        await this.db.query(
          'SELECT s.id,a.org_id,s.state,s.plan_id,s.period_end,s.error_code FROM subscriptions s JOIN billing_accounts a ON a.id=s.account_id ORDER BY s.created_at DESC LIMIT 100',
        )
      ).rows,
      invoices: (
        await this.db.query(
          'SELECT * FROM subscription_invoices ORDER BY updated_at DESC LIMIT 100',
        )
      ).rows,
      note: 'Stripe test subscription invoices are separate from marketplace sales, credits and seller liabilities.',
      pending_events: (
        await this.db.query(
          'SELECT id,type,object_id,created_at FROM billing_events WHERE processed_at IS NULL ORDER BY created_at LIMIT 100',
        )
      ).rows,
    };
  }
}
