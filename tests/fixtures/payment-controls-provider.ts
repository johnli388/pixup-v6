import { id } from '../../packages/domain/core';
import type { SessionPayload, StripeSession, StripeRefund } from '../../apps/api/src/stripe';
import type {
  PaymentOperationsProvider,
  PaymentSnapshot,
} from '../../apps/api/src/stripe-control-contracts';
export class FakePaymentControls implements PaymentOperationsProvider {
  account = 'acct_fixture_platform';
  sessions = new Map<string, StripeSession>();
  refunds = new Map<string, StripeRefund>();
  recipients = new Map<string, any>();
  transfers = new Map<string, any>();
  disputes = new Map<string, any>();
  keys = new Map<string, string>();
  refundOutcome: StripeRefund['status'] = 'succeeded';
  loseRefund = false;
  loseRecipient = false;
  loseTransfer = false;
  async identity() {
    return this.account;
  }
  async create(p: SessionPayload, key: string) {
    let sid = this.keys.get(key);
    if (!sid) {
      sid = `cs_test_${id()}`;
      this.keys.set(key, sid);
      this.sessions.set(sid, {
        id: sid,
        livemode: false,
        status: 'open',
        payment_status: 'unpaid',
        amount_total: Number(p['line_items[0][price_data][unit_amount]']),
        currency: 'usd',
        client_reference_id: p.client_reference_id,
        metadata: { order_id: p.client_reference_id },
        url: `https://checkout.stripe.com/c/pay/${sid}`,
        payment_intent: null,
      });
    }
    return structuredClone(this.sessions.get(sid)!);
  }
  async retrieve(sid: string) {
    return structuredClone(this.sessions.get(sid)!);
  }
  async expire(sid: string) {
    const s = this.sessions.get(sid)!;
    s.status = 'expired';
    s.url = null;
    return structuredClone(s);
  }
  paid(sid: string) {
    const s = this.sessions.get(sid)!;
    s.status = 'complete';
    s.payment_status = s.amount_total ? 'paid' : 'no_payment_required';
    s.payment_intent = s.amount_total ? `pi_${id()}` : null;
    s.url = null;
    return s;
  }
  async refund(p: SessionPayload, key: string) {
    let rid = this.keys.get(key);
    if (!rid) {
      rid = `re_${id()}`;
      this.keys.set(key, rid);
      this.refunds.set(rid, {
        id: rid,
        amount: Number(p.amount),
        currency: 'usd',
        payment_intent: p.payment_intent,
        metadata: { order_id: p['metadata[order_id]'], refund_id: p['metadata[refund_id]'] },
        status: this.refundOutcome,
      });
    }
    if (this.loseRefund) {
      this.loseRefund = false;
      throw new Error('fixture lost refund response');
    }
    return this.retrieveRefund(rid);
  }
  async retrieveRefund(rid: string) {
    return structuredClone(this.refunds.get(rid)!);
  }
  async payment(pi: string): Promise<PaymentSnapshot> {
    const s = [...this.sessions.values()].find((x) => x.payment_intent === pi)!;
    const refunds = [...this.refunds.values()].filter((r) => r.payment_intent === pi);
    return {
      id: pi,
      livemode: false,
      status: 'succeeded',
      amount_received: s.amount_total,
      currency: 'usd',
      metadata: { order_id: s.client_reference_id },
      latest_charge: {
        id: `ch_${pi}`,
        paid: true,
        disputed: [...this.disputes.values()].some((d) => d.payment_intent === pi),
        amount: s.amount_total,
        amount_refunded: refunds
          .filter((r) => r.status === 'succeeded')
          .reduce((sum, r) => sum + r.amount, 0),
        currency: 'usd',
        balance_transaction: {
          id: `txn_${pi}`,
          amount: s.amount_total,
          fee: 30,
          net: s.amount_total - 30,
          currency: 'usd',
          status: 'available',
        },
      },
      refunds: structuredClone(refunds),
    };
  }
  async dispute(did: string) {
    return structuredClone(this.disputes.get(did)!);
  }
  async createRecipient(p: SessionPayload, key: string) {
    let rid = this.keys.get(key);
    if (!rid) {
      rid = `acct_${id()}`;
      this.keys.set(key, rid);
      this.recipients.set(rid, {
        id: rid,
        type: 'express',
        country: p.country,
        metadata: {
          pixup_user_id: p['metadata[pixup_user_id]'],
          pixup_recipient_id: p['metadata[pixup_recipient_id]'],
        },
        details_submitted: false,
        payouts_enabled: false,
        capabilities: { transfers: 'pending' },
        requirements: { currently_due: ['fixture_requirement'] },
      });
    }
    if (this.loseRecipient) {
      this.loseRecipient = false;
      throw new Error('fixture lost account response');
    }
    return this.recipient(rid);
  }
  async recipient(rid: string) {
    return structuredClone(this.recipients.get(rid)!);
  }
  ready(user: string) {
    const r = [...this.recipients.values()].find((r) => r.metadata.pixup_user_id === user)!;
    r.details_submitted = true;
    r.payouts_enabled = true;
    r.capabilities.transfers = 'active';
    r.requirements.currently_due = [];
  }
  async accountLink(account: string) {
    return {
      url: `https://connect.stripe.com/setup/${account}`,
      expires_at: Math.floor(Date.now() / 1000) + 300,
    };
  }
  async createTransfer(p: SessionPayload, key: string) {
    let tid = this.keys.get(key);
    if (!tid) {
      tid = `tr_${id()}`;
      this.keys.set(key, tid);
      this.transfers.set(tid, {
        id: tid,
        livemode: false,
        amount: Number(p.amount),
        currency: p.currency,
        destination: p.destination,
        source_transaction: p.source_transaction,
        amount_reversed: 0,
        reversed: false,
        metadata: {
          pixup_transfer_id: p['metadata[pixup_transfer_id]'],
          order_id: p['metadata[order_id]'],
        },
      });
    }
    if (this.loseTransfer) {
      this.loseTransfer = false;
      throw new Error('fixture lost transfer response');
    }
    return this.transfer(tid);
  }
  async transfer(tid: string) {
    return structuredClone(this.transfers.get(tid)!);
  }
}
