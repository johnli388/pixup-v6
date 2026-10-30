import { privacyPolicy, requireEligibility } from '../../../packages/domain/privacy';
import { commercialPolicy, requirePilotSales } from '../../../packages/domain/commercial-policy';
import { noPhysicalIncident } from './logistics';
import { adjustments, noPaymentException } from '../../../packages/domain/payment-control';
import {
  lockChannels,
  channelQuote,
  saleEligible,
  channelPaid,
  channelRefundGate,
  channelRefunded,
} from './channel-core';
import type { Database, SQL } from '../../../packages/database/index';
import { one } from '../../../packages/database/index';
import { check, id, journal, provenance, audit, notify } from '../../../packages/domain/core';
import { hash } from '../../../packages/domain/security';
import type { Actor } from './auth';

export class CommerceService {
  constructor(
    private db: Database,
    private paymentProvider: 'demo' | 'stripe_test' = 'demo',
  ) {}
  async quote(actor: Actor, data: any) {
    await requireEligibility(this.db, actor.id);
    const policy = await commercialPolicy(this.db);
    requirePilotSales(policy);
    const commercialSnapshot = { ...policy, minimum_age: privacyPolicy().minimum_age };
    const listing = await one(
      this.db,
      `SELECT l.*,a.platform_owned,a.custody,a.certification,a.kind FROM listings l JOIN assets a ON a.id=l.asset_id WHERE l.id=$1`,
      [data.listing_id],
    );
    check(listing?.status === 'active', 'INVENTORY_CONFLICT', 'This item is no longer available.');
    try {
      await requireEligibility(this.db, listing.seller_id);
    } catch {
      check(false, 'SELLER_RESTRICTED', 'This seller is not eligible for a new transaction.', 403);
    }
    check(listing.seller_id !== actor.id, 'OWN_ITEM', 'You cannot purchase your own item.');
    const channel = await channelQuote(this.db, actor, listing.asset_id, listing.id, data);
    check(
      await saleEligible(this.db, listing, channel?.kind),
      'INELIGIBLE',
      'This item is not eligible for checkout.',
    );
    const available = await one(
      this.db,
      'SELECT COALESCE(sum(available),0)::int AS amount FROM credit_lots WHERE user_id=$1',
      [actor.id],
    );
    let credits =
      data.use_credits && listing.platform_owned && policy.credit_scope === 'pixup_owned'
        ? Math.min(available?.amount || 0, listing.price_cents)
        : 0;
    // Stripe USD card charges require at least 50 cents, unless fully covered.
    const shipping = channel?.shipping ?? (data.fulfillment === 'ship' ? 800 : 0);
    const cash = listing.price_cents + shipping - credits;
    if (this.paymentProvider === 'stripe_test' && cash > 0 && cash < 50) credits -= 50 - cash;
    const qid = id();
    await this.db.query(
      "INSERT INTO quotes(id,buyer_id,listing_id,price_cents,fee_cents,credit_units,fulfillment,shipping_cents,expires_at,allocation_id,channel_terms,commercial_policy_version,commercial_snapshot,policy_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes',$9,$10,$11,$12,$13)",
      [
        qid,
        actor.id,
        listing.id,
        listing.price_cents,
        Math.round(listing.price_cents * 0.05),
        credits,
        data.fulfillment,
        shipping,
        channel?.id || null,
        channel ? JSON.stringify(channel.snapshot) : null,
        policy.version,
        JSON.stringify(commercialSnapshot),
        `pilot-commercial-v${policy.version}`,
      ],
    );
    return {
      id: qid,
      price_cents: listing.price_cents,
      shipping_cents: shipping,
      credit_units: credits,
      total_cents: listing.price_cents + shipping - credits,
      fee_cents: Math.round(listing.price_cents * 0.05),
      fulfillment: data.fulfillment,
      expires_at: new Date(Date.now() + 600000).toISOString(),
      policy_version: `pilot-commercial-v${policy.version}`,
      commercial_policy_version: policy.version,
      commercial_snapshot: commercialSnapshot,
      channel: channel?.kind || 'web',
      channel_terms: channel?.snapshot || null,
      tax_note: policy.terms.taxation,
      credit_note:
        policy.credit_scope === 'disabled'
          ? 'Credit redemption is paused for new quotes.'
          : policy.terms.credit_redemption,
    };
  }
  async checkout(actor: Actor, data: any, key: string) {
    check(
      key && key.length >= 8 && key.length <= 128,
      'IDEMPOTENCY_REQUIRED',
      'Provide an idempotency key.',
      400,
    );
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await requireEligibility(tx, actor.id);
      const requestHash = hash(JSON.stringify(data));
      await tx.query(
        'INSERT INTO idempotency(actor_id,key,request_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [actor.id, key, requestHash],
      );
      const prior = await one(
        tx,
        'SELECT * FROM idempotency WHERE actor_id=$1 AND key=$2 FOR UPDATE',
        [actor.id, key],
      );
      check(
        prior?.request_hash === requestHash,
        'IDEMPOTENCY_CONFLICT',
        'This request key was already used with different data.',
      );
      if (prior?.response) {
        const original = await one(tx, 'SELECT payment_provider FROM orders WHERE id=$1', [
          prior.response.id,
        ]);
        return { ...prior.response, payment_provider: original!.payment_provider };
      }
      const q = await one(tx, 'SELECT * FROM quotes WHERE id=$1 AND buyer_id=$2 FOR UPDATE', [
        data.quote_id,
        actor.id,
      ]);
      check(q, 'NOT_FOUND', 'Quote not found.', 404);
      const existing = await one(tx, 'SELECT id,payment_provider FROM orders WHERE quote_id=$1', [
        q.id,
      ]);
      if (existing) return { id: existing.id, payment_provider: existing.payment_provider };
      const policy = await commercialPolicy(tx, true);
      requirePilotSales(policy);
      check(
        q.commercial_policy_version === policy.version &&
          q.commercial_snapshot?.minimum_age === privacyPolicy().minimum_age,
        'POLICY_STALE',
        'Commercial terms changed or this quote predates versioned policy. Request a new quote.',
      );
      check(
        new Date(q.expires_at).getTime() > Date.now(),
        'QUOTE_EXPIRED',
        'Your quote has expired. Please request a new one.',
      );
      const l = await one(
        tx,
        `SELECT l.*,a.owner_id,a.platform_owned,a.custody,a.certification,a.kind FROM listings l JOIN assets a ON a.id=l.asset_id WHERE l.id=$1 FOR UPDATE OF a,l`,
        [q.listing_id],
      );
      check(
        l?.status === 'active' && l.price_cents === q.price_cents && l.owner_id === l.seller_id,
        'INVENTORY_CONFLICT',
        'This collectible is no longer available at the quoted price.',
      );
      try {
        await requireEligibility(tx, l.seller_id);
      } catch {
        check(
          false,
          'SELLER_RESTRICTED',
          'This seller is not eligible for a new transaction.',
          403,
        );
      }
      const channel = await channelQuote(tx, actor, l.asset_id, l.id, {
        allocation_id: q.allocation_id,
        fulfillment: q.fulfillment,
        use_credits: !!q.credit_units,
      });
      if (channel && ['goup', 'waxup'].includes(channel.kind))
        check(
          data.shipping_address?.trim().length >= 10,
          'ADDRESS_REQUIRED',
          'Provide the participant delivery address.',
          400,
        );
      check(
        !channel ||
          (q.channel_terms?.version === channel.terms_version &&
            q.shipping_cents === channel.shipping),
        'TERMS_CHANGED',
        'Channel terms changed. Request a new quote.',
      );
      check(
        l.seller_id !== actor.id && (await saleEligible(tx, l, channel?.kind)),
        'INELIGIBLE',
        'This collectible is no longer eligible.',
      );
      check(
        !q.credit_units || (l.platform_owned && policy.credit_scope === 'pixup_owned'),
        'CREDIT_SCOPE',
        'Credits cannot fund third-party seller proceeds.',
      );
      check(
        q.fulfillment !== 'ship' || data.shipping_address?.length >= 12,
        'ADDRESS_REQUIRED',
        'Enter a complete shipping address.',
        400,
      );
      const oid = id();
      await tx.query(
        "INSERT INTO orders(id,quote_id,buyer_id,seller_id,asset_id,listing_id,status,total_cents,fee_cents,seller_cents,credit_units,fulfillment,shipping_cents,shipping_address,reservation_expires_at,commercial_policy_version,commercial_snapshot) VALUES ($1,$2,$3,$4,$5,$6,'pending_payment',$7,$8,$9,$10,$11,$12,$13,now()+interval '10 minutes',$14,$15)",
        [
          oid,
          q.id,
          actor.id,
          l.seller_id,
          l.asset_id,
          l.id,
          q.price_cents + q.shipping_cents - q.credit_units,
          q.fee_cents,
          q.price_cents - q.fee_cents,
          q.credit_units,
          q.fulfillment,
          q.shipping_cents,
          data.shipping_address || '',
          q.commercial_policy_version,
          JSON.stringify(q.commercial_snapshot),
        ],
      );
      await tx.query('UPDATE orders SET policy_snapshot=$2 WHERE id=$1', [
        oid,
        JSON.stringify(privacyPolicy()),
      ]);
      if (channel) {
        await tx.query(
          'UPDATE orders SET allocation_id=$2,channel=$3,channel_terms=$4 WHERE id=$1',
          [oid, channel.id, channel.kind, JSON.stringify(channel.snapshot)],
        );
        await tx.query('INSERT INTO channel_orders(order_id,context_id) VALUES ($1,$2)', [
          oid,
          channel.context_id,
        ]);
      }
      if (this.paymentProvider === 'stripe_test') {
        await tx.query(
          "UPDATE orders SET payment_provider='stripe_test',reservation_expires_at=now()+interval '35 minutes' WHERE id=$1",
          [oid],
        );
        await tx.query('INSERT INTO payment_attempts(id,order_id) VALUES ($1,$2)', [id(), oid]);
      }
      if (q.credit_units) {
        await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
        const lots = (
          await tx.query(
            'SELECT * FROM credit_lots WHERE user_id=$1 AND available>0 ORDER BY created_at,id FOR UPDATE',
            [actor.id],
          )
        ).rows;
        check(
          lots.reduce((sum, l) => sum + l.available, 0) >= q.credit_units,
          'INSUFFICIENT_CREDITS',
          'Your credit balance changed. Request a new quote.',
        );
        let remaining = q.credit_units;
        for (const lot of lots) {
          const units = Math.min(remaining, lot.available);
          if (!units) break;
          await tx.query('UPDATE credit_lots SET available=available-$2,held=held+$2 WHERE id=$1', [
            lot.id,
            units,
          ]);
          await tx.query('INSERT INTO credit_holds(order_id,lot_id,units) VALUES ($1,$2,$3)', [
            oid,
            lot.id,
            units,
          ]);
          remaining -= units;
        }
      }
      await tx.query("UPDATE listings SET status='reserved' WHERE id=$1", [l.id]);
      await audit(tx, actor.id, 'checkout.reserved', oid);
      const response = { id: oid, payment_provider: this.paymentProvider };
      await tx.query('UPDATE idempotency SET response=$3 WHERE actor_id=$1 AND key=$2', [
        actor.id,
        key,
        JSON.stringify(response),
      ]);
      return response;
    });
  }
  async pay(actor: Actor, orderId: string, success: boolean) {
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      check(o?.buyer_id === actor.id, 'NOT_FOUND', 'Order not found.', 404);
      check(
        o.payment_provider === 'demo',
        'PROVIDER_CONFIRMATION_REQUIRED',
        'This order must be confirmed by Stripe; demo payment is disabled.',
      );
      if (['paid', 'fulfilled'].includes(o.status)) return { id: o.id, status: o.status };
      check(o.status === 'pending_payment', 'INVALID_STATE', 'This payment is no longer pending.');
      if (!success || new Date(o.reservation_expires_at).getTime() <= Date.now()) {
        await this.cancel(tx, o);
        return { id: o.id, status: 'canceled' };
      }
      return this.completePayment(tx, o);
    });
  }
  // Called only after a local demo confirmation or verified provider session.
  async completePayment(tx: SQL, o: any) {
    const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [o.asset_id]);
    check(
      a && a.owner_id === o.seller_id && (await saleEligible(tx, a, o.channel)),
      'INVENTORY_CONFLICT',
      'Item eligibility changed. Cancel this payment and contact support.',
    );
    const listing = await one(
      tx,
      "SELECT id FROM listings WHERE id=$1 AND status='reserved' FOR UPDATE",
      [o.listing_id],
    );
    check(
      listing && o.status === 'pending_payment',
      'INVENTORY_CONFLICT',
      'The reservation requires payment reconciliation.',
    );
    const gross = o.total_cents + o.credit_units;
    const lines: [string, number][] = [
      [
        o.payment_provider === 'stripe_test' ? 'stripe_test_clearing' : 'demo_psp_clearing',
        o.total_cents,
      ],
      ['credit_redemption_expense', o.credit_units],
      [`seller_payable:${o.seller_id}`, -o.seller_cents],
      ['platform_fees', -o.fee_cents],
      ['shipping_liability', -o.shipping_cents],
    ];
    check(
      gross === o.seller_cents + o.fee_cents + o.shipping_cents,
      'INVALID_TOTAL',
      'Order allocation mismatch.',
      500,
    );
    await journal(
      tx,
      `payment:${o.id}`,
      'USD',
      o.payment_provider === 'stripe_test'
        ? 'Stripe test payment and sale allocation'
        : 'Simulated payment and sale allocation',
      lines,
    );
    if (o.credit_units) {
      await this.holds(tx, o, 'consume');
      await journal(
        tx,
        `credit-spend:${o.id}`,
        'CREDIT',
        'Credits redeemed on PixUP-owned inventory',
        [
          [`credits:${o.buyer_id}`, o.credit_units],
          ['credit_redemption', -o.credit_units],
        ],
      );
    }
    const status = !o.allocation_id && o.fulfillment === 'vault' ? 'fulfilled' : 'paid';
    await tx.query('UPDATE orders SET status=$2,paid_at=now() WHERE id=$1', [o.id, status]);
    await tx.query("UPDATE listings SET status='sold' WHERE id=$1", [o.listing_id]);
    await tx.query('UPDATE assets SET owner_id=$2,platform_owned=false WHERE id=$1', [
      o.asset_id,
      o.buyer_id,
    ]);
    await channelPaid(tx, o);
    await tx.query(
      'INSERT INTO settlements(id,order_id,seller_id,amount_cents) VALUES ($1,$2,$3,$4)',
      [id(), o.id, o.seller_id, o.seller_cents],
    );
    await provenance(
      tx,
      o.asset_id,
      o.buyer_id,
      'ownership_transferred',
      o.allocation_id
        ? 'Payment confirmed. Ownership recorded; channel fulfillment is pending.'
        : 'Purchase confirmed. Recorded ownership transferred; vault custody retained.',
    );
    await notify(
      tx,
      o.buyer_id,
      'A new chapter in your collection',
      `${a.title} is now yours.`,
      o.id,
    );
    await notify(
      tx,
      o.seller_id,
      'Your collectible sold',
      `${a.title} sold. Settlement is held for review.`,
      o.id,
    );
    await audit(
      tx,
      o.buyer_id,
      o.payment_provider === 'stripe_test'
        ? 'stripe_test.payment.confirmed'
        : 'demo.payment.confirmed',
      o.id,
    );
    return { id: o.id, status };
  }
  private async holds(tx: SQL, o: any, action: 'consume' | 'release' | 'restore') {
    await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [o.buyer_id]);
    const desired = action === 'restore' ? 'consumed' : 'held';
    const holds = (
      await tx.query('SELECT * FROM credit_holds WHERE order_id=$1 AND status=$2 FOR UPDATE', [
        o.id,
        desired,
      ])
    ).rows;
    for (const h of holds) {
      if (action === 'consume')
        await tx.query('UPDATE credit_lots SET held=held-$2 WHERE id=$1', [h.lot_id, h.units]);
      else if (action === 'release')
        await tx.query('UPDATE credit_lots SET held=held-$2,available=available+$2 WHERE id=$1', [
          h.lot_id,
          h.units,
        ]);
      else
        await tx.query('UPDATE credit_lots SET available=available+$2 WHERE id=$1', [
          h.lot_id,
          h.units,
        ]);
      await tx.query('UPDATE credit_holds SET status=$3 WHERE order_id=$1 AND lot_id=$2', [
        o.id,
        h.lot_id,
        action === 'consume' ? 'consumed' : action === 'restore' ? 'restored' : 'released',
      ]);
    }
  }
  async cancel(tx: SQL, o: any) {
    await this.holds(tx, o, 'release');
    await tx.query("UPDATE orders SET status='canceled' WHERE id=$1", [o.id]);
    if (o.allocation_id)
      await tx.query(
        "UPDATE channel_orders SET state='canceled',updated_at=now() WHERE order_id=$1",
        [o.id],
      );
    await tx.query("UPDATE listings SET status='active' WHERE id=$1 AND status='reserved'", [
      o.listing_id,
    ]);
  }
  async expire() {
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const orders = (
        await tx.query(
          "SELECT * FROM orders WHERE status='pending_payment' AND payment_provider='demo' AND reservation_expires_at<=now() FOR UPDATE SKIP LOCKED",
        )
      ).rows;
      for (const o of orders) await this.cancel(tx, o);
    });
  }
  async orders(actor: Actor) {
    return (
      await this.db.query(
        `SELECT o.id,o.buyer_id,o.seller_id,o.asset_id,o.status,o.payment_provider,o.total_cents,o.credit_units,o.fee_cents,o.seller_cents,o.created_at,o.fulfillment,o.tracking,a.title,a.artwork FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.buyer_id=$1 OR o.seller_id=$1 ORDER BY o.created_at DESC`,
        [actor.id],
      )
    ).rows;
  }
  async order(actor: Actor, oid: string) {
    const o = await one(
      this.db,
      `SELECT o.*,a.title,a.artwork,a.serial FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.id=$1`,
      [oid],
    );
    check(
      o &&
        (o.buyer_id === actor.id ||
          o.seller_id === actor.id ||
          (actor.is_staff &&
            actor.staff_permissions.some((p) => ['finance', 'support'].includes(p)))),
      'NOT_FOUND',
      'Order not found.',
      404,
    );
    if (o.buyer_id !== actor.id && !(actor.is_staff && actor.staff_permissions.includes('support')))
      delete o.shipping_address;
    o.channel_fulfillment =
      (await one(
        this.db,
        'SELECT state,context_id,recording_reference,recording_offset_ms FROM channel_orders WHERE order_id=$1',
        [oid],
      )) || null;
    if (o.channel === 'waxup')
      o.invoice = {
        reference: `WX-${o.id}`,
        currency: 'USD',
        amount_cents: o.total_cents,
        units_per_case: o.channel_terms.units_per_case,
        simulation: true,
      };
    o.pack_contents = (
      await this.db.query(
        'SELECT p.asset_id,a.title,a.certification FROM pack_contents p JOIN assets a ON a.id=p.asset_id WHERE p.pack_id=$1',
        [o.asset_id],
      )
    ).rows;
    o.wholesale_return =
      (await one(
        this.db,
        'SELECT status,mode,note,decision_note FROM wholesale_returns WHERE order_id=$1',
        [oid],
      )) || null;
    return o;
  }
  async refund(actor: Actor, oid: string) {
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [oid]);
      check(
        o &&
          ((actor.is_staff && actor.staff_permissions.includes('finance')) ||
            o.buyer_id === actor.id),
        'NOT_FOUND',
        'Order not found.',
        404,
      );
      check(
        o.payment_provider === 'demo',
        'STRIPE_REFUND_REQUIRES_SUPPORT',
        'Stripe test refunds require support reconciliation; a local simulated refund cannot reverse a Stripe payment.',
      );
      if (o.status === 'refunded') return { ok: true };
      await this.assertRefundable(tx, o);
      await this.reverseRefund(tx, o, actor);
      return { ok: true };
    });
  }
  async assertRefundable(tx: SQL, o: any, allowQuarantine = false) {
    await noPaymentException(tx, o.id);
    await noPhysicalIncident(tx, o.asset_id);
    check(
      !(await one(
        tx,
        "SELECT id FROM shipments WHERE order_id=$1 AND state IN ('in_transit','exception','delivered')",
        [o.id],
      )),
      'RETURN_REQUIRED',
      'Record the physical return and resolve incidents before refunding.',
    );
    const deviceReturn = await channelRefundGate(tx, o);
    check(
      ['paid', 'fulfilled'].includes(o.status),
      'INVALID_STATE',
      'Only confirmed orders can be refunded.',
    );
    const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [o.asset_id]);
    check(
      a &&
        a.owner_id === o.buyer_id &&
        (a.custody === 'vault' ||
          (allowQuarantine && a.custody === 'quarantine') ||
          (deviceReturn && a.custody === 'device')),
      'RETURN_REQUIRED',
      'Refund requires the original item in vault custody. Open a support case for a physical return.',
    );
    check(
      !(await one(
        tx,
        "SELECT id FROM orders WHERE asset_id=$1 AND id<>$2 AND paid_at>=$3 AND status IN ('paid','fulfilled')",
        [o.asset_id, o.id, o.paid_at],
      )),
      'LATER_SALE',
      'This item has a later completed sale. Open a support case for review.',
    );
    check(
      !(await one(
        tx,
        "SELECT id FROM listings WHERE asset_id=$1 AND status IN ('active','reserved')",
        [o.asset_id],
      )),
      'ASSET_BUSY',
      'Withdraw your listing before requesting a refund.',
    );
    check(
      !(await one(
        tx,
        "SELECT id FROM intakes WHERE asset_id=$1 AND status IN ('awaiting_receipt','received')",
        [o.asset_id],
      )),
      'ASSET_BUSY',
      'An intake is in progress.',
    );
    const s = await one(tx, 'SELECT * FROM settlements WHERE order_id=$1 FOR UPDATE', [o.id]);
    check(
      s?.status === 'held',
      'RECOVERY_REQUIRED',
      'Settlement already released. Open a support case for recovery.',
    );
  }
  async reverseRefund(tx: SQL, o: any, actor: Pick<Actor, 'id'>) {
    const adjusted = await adjustments(tx, o.id);
    await journal(
      tx,
      `refund:${o.id}`,
      'USD',
      o.payment_provider === 'stripe_test'
        ? 'Stripe test refund reversing original allocation'
        : 'Simulated refund reversing original allocation',
      [
        [
          o.payment_provider === 'stripe_test' ? 'stripe_test_clearing' : 'demo_psp_clearing',
          -(o.total_cents - adjusted.cash),
        ],
        ['credit_redemption_expense', -o.credit_units],
        [`seller_payable:${o.seller_id}`, o.seller_cents - adjusted.seller],
        ['platform_fees', o.fee_cents - adjusted.fee],
        ['shipping_liability', o.shipping_cents - adjusted.shipping],
      ],
    );
    if (o.credit_units) {
      await this.holds(tx, o, 'restore');
      await journal(tx, `credit-refund:${o.id}`, 'CREDIT', 'Original credits restored', [
        [`credits:${o.buyer_id}`, -o.credit_units],
        ['credit_redemption', o.credit_units],
      ]);
    }
    await tx.query("UPDATE orders SET status='refunded' WHERE id=$1", [o.id]);
    await tx.query("UPDATE settlements SET status='reversed' WHERE order_id=$1", [o.id]);
    await channelRefunded(tx, o);
    await tx.query('UPDATE assets SET owner_id=$2,platform_owned=$3 WHERE id=$1', [
      o.asset_id,
      o.seller_id,
      o.seller_id === 'platform',
    ]);
    await tx.query(
      `UPDATE listings SET status=CASE WHEN EXISTS (SELECT 1 FROM assets WHERE id=$2 AND custody='vault' AND (certification='verified' OR (kind='sealed_pack' AND certification NOT IN ('revoked','rejected') AND EXISTS(SELECT 1 FROM sealed_packs p WHERE p.asset_id=assets.id AND p.status='sealed')))) THEN 'active' ELSE 'withdrawn' END WHERE id=$1`,
      [o.listing_id, o.asset_id],
    );
    await provenance(
      tx,
      o.asset_id,
      actor.id,
      'refund',
      o.channel === 'cvm'
        ? 'Undispensed sale reversed; title restored while stock remains in device custody.'
        : 'Sale reversed after vault return; recorded ownership restored.',
    );
    await audit(
      tx,
      actor.id,
      o.payment_provider === 'stripe_test' ? 'stripe_test.refund.completed' : 'demo.refund',
      o.id,
    );
  }
  async credits(actor: Actor) {
    const lots = (
      await this.db.query('SELECT * FROM credit_lots WHERE user_id=$1 ORDER BY created_at DESC', [
        actor.id,
      ])
    ).rows;
    const history = (
      await this.db.query(
        `SELECT e.*,l.amount FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE e.unit='CREDIT' AND l.account=$1 ORDER BY created_at DESC`,
        [`credits:${actor.id}`],
      )
    ).rows;
    return {
      available: lots.reduce((sum, l) => sum + l.available, 0),
      held: lots.reduce((sum, l) => sum + l.held, 0),
      lots,
      history,
    };
  }
  async settlements(actor: Actor) {
    return (
      await this.db.query(
        'SELECT s.*,o.total_cents,o.fee_cents,a.title,a.artwork FROM settlements s JOIN orders o ON o.id=s.order_id JOIN assets a ON a.id=o.asset_id WHERE s.seller_id=$1 ORDER BY s.created_at DESC',
        [actor.id],
      )
    ).rows;
  }
}
