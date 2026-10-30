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
    const listing = await one(
      this.db,
      `SELECT l.*,a.platform_owned,a.custody,a.certification FROM listings l JOIN assets a ON a.id=l.asset_id WHERE l.id=$1`,
      [data.listing_id],
    );
    check(listing?.status === 'active', 'INVENTORY_CONFLICT', 'This item is no longer available.');
    check(listing.seller_id !== actor.id, 'OWN_ITEM', 'You cannot purchase your own item.');
    check(
      listing.custody === 'vault' && listing.certification === 'verified',
      'INELIGIBLE',
      'This item is not eligible for checkout.',
    );
    const available = await one(
      this.db,
      'SELECT COALESCE(sum(available),0)::int AS amount FROM credit_lots WHERE user_id=$1',
      [actor.id],
    );
    let credits =
      data.use_credits && listing.platform_owned
        ? Math.min(available?.amount || 0, listing.price_cents)
        : 0;
    // Stripe USD card charges require at least 50 cents, unless fully covered.
    const cash = listing.price_cents + (data.fulfillment === 'ship' ? 800 : 0) - credits;
    if (this.paymentProvider === 'stripe_test' && cash > 0 && cash < 50) credits -= 50 - cash;
    const qid = id(),
      shipping = data.fulfillment === 'ship' ? 800 : 0;
    await this.db.query(
      "INSERT INTO quotes(id,buyer_id,listing_id,price_cents,fee_cents,credit_units,fulfillment,shipping_cents,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes')",
      [
        qid,
        actor.id,
        listing.id,
        listing.price_cents,
        Math.round(listing.price_cents * 0.05),
        credits,
        data.fulfillment,
        shipping,
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
      policy_version: 'demo-v1',
      tax_note: 'Simulation only. Tax calculation and carrier fulfillment are not enabled.',
      credit_note: 'Demo valuation: 100 credits = $1 toward PixUP-owned items only.',
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
      check(
        new Date(q.expires_at).getTime() > Date.now(),
        'QUOTE_EXPIRED',
        'Your quote has expired. Please request a new one.',
      );
      const l = await one(
        tx,
        `SELECT l.*,a.owner_id,a.platform_owned,a.custody,a.certification FROM listings l JOIN assets a ON a.id=l.asset_id WHERE l.id=$1 FOR UPDATE OF a,l`,
        [q.listing_id],
      );
      check(
        l?.status === 'active' && l.price_cents === q.price_cents && l.owner_id === l.seller_id,
        'INVENTORY_CONFLICT',
        'This collectible is no longer available at the quoted price.',
      );
      check(
        l.seller_id !== actor.id && l.certification === 'verified' && l.custody === 'vault',
        'INELIGIBLE',
        'This collectible is no longer eligible.',
      );
      check(
        !q.credit_units || l.platform_owned,
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
        "INSERT INTO orders(id,quote_id,buyer_id,seller_id,asset_id,listing_id,status,total_cents,fee_cents,seller_cents,credit_units,fulfillment,shipping_cents,shipping_address,reservation_expires_at) VALUES ($1,$2,$3,$4,$5,$6,'pending_payment',$7,$8,$9,$10,$11,$12,$13,now()+interval '10 minutes')",
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
        ],
      );
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
      a && a.owner_id === o.seller_id && a.custody === 'vault' && a.certification === 'verified',
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
    const status = o.fulfillment === 'vault' ? 'fulfilled' : 'paid';
    await tx.query('UPDATE orders SET status=$2,paid_at=now() WHERE id=$1', [o.id, status]);
    await tx.query("UPDATE listings SET status='sold' WHERE id=$1", [o.listing_id]);
    await tx.query('UPDATE assets SET owner_id=$2,platform_owned=false WHERE id=$1', [
      o.asset_id,
      o.buyer_id,
    ]);
    await tx.query(
      'INSERT INTO settlements(id,order_id,seller_id,amount_cents) VALUES ($1,$2,$3,$4)',
      [id(), o.id, o.seller_id, o.seller_cents],
    );
    await provenance(
      tx,
      o.asset_id,
      o.buyer_id,
      'ownership_transferred',
      'Purchase confirmed. Recorded ownership transferred; vault custody retained.',
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
    await tx.query("UPDATE listings SET status='active' WHERE id=$1 AND status='reserved'", [
      o.listing_id,
    ]);
  }
  async expire() {
    await this.db.transaction(async (tx) => {
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
    return o;
  }
  async refund(actor: Actor, oid: string) {
    return this.db.transaction(async (tx) => {
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
      check(
        ['paid', 'fulfilled'].includes(o.status),
        'INVALID_STATE',
        'Only confirmed orders can be refunded.',
      );
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [o.asset_id]);
      check(
        a && a.owner_id === o.buyer_id && a.custody === 'vault',
        'RETURN_REQUIRED',
        'Refund requires the original item in vault custody. Open a support case for a physical return.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM orders WHERE asset_id=$1 AND id<>$2 AND paid_at>=$3 AND status IN ('paid','fulfilled')",
          [o.asset_id, oid, o.paid_at],
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
      const s = await one(tx, 'SELECT * FROM settlements WHERE order_id=$1 FOR UPDATE', [oid]);
      check(
        s?.status === 'held',
        'RECOVERY_REQUIRED',
        'Settlement already released. Open a support case for recovery.',
      );
      await journal(tx, `refund:${oid}`, 'USD', 'Simulated refund reversing original allocation', [
        ['demo_psp_clearing', -o.total_cents],
        ['credit_redemption_expense', -o.credit_units],
        [`seller_payable:${o.seller_id}`, o.seller_cents],
        ['platform_fees', o.fee_cents],
        ['shipping_liability', o.shipping_cents],
      ]);
      if (o.credit_units) {
        await this.holds(tx, o, 'restore');
        await journal(tx, `credit-refund:${oid}`, 'CREDIT', 'Original credits restored', [
          [`credits:${o.buyer_id}`, -o.credit_units],
          ['credit_redemption', o.credit_units],
        ]);
      }
      await tx.query("UPDATE orders SET status='refunded' WHERE id=$1", [oid]);
      await tx.query("UPDATE settlements SET status='reversed' WHERE order_id=$1", [oid]);
      await tx.query('UPDATE assets SET owner_id=$2,platform_owned=$3 WHERE id=$1', [
        o.asset_id,
        o.seller_id,
        o.seller_id === 'platform',
      ]);
      await tx.query("UPDATE listings SET status='active' WHERE id=$1", [o.listing_id]);
      await provenance(
        tx,
        o.asset_id,
        actor.id,
        'refund',
        'Sale reversed after vault return; recorded ownership restored.',
      );
      await audit(tx, actor.id, 'demo.refund', oid);
      return { ok: true };
    });
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
