import { one, type Database, type SQL } from '../../../packages/database/index';
import { audit, check, id, assertNoRefund } from '../../../packages/domain/core';
import { workspaceMember } from '../../../packages/domain/saas';
import { consumeApproval } from '../../../packages/domain/finance-approval';
import { requireEligibility } from '../../../packages/domain/privacy';
import { lockChannels, assertChannelFree } from './channel-core';
import { requireStaff, type Actor } from './auth';
import { OperationsService } from './operations';
export class FinanceService {
  constructor(
    private db: Database,
    private executePayment?: (
      actor: Actor,
      aid: string,
      kind: string,
    ) => Promise<{ ok: boolean; replayed?: boolean }>,
  ) {}
  async queue(actor: Actor) {
    requireStaff(actor, 'finance');
    return (
      await this.db.query('SELECT * FROM finance_approvals ORDER BY created_at DESC LIMIT 100')
    ).rows;
  }
  private async snapshot(tx: SQL, actor: Actor, kind: string, resource: string, org?: string) {
    if (kind === 'inventory_assign') {
      const a = await one(
        tx,
        'SELECT id,owner_id,inventory_org_id FROM assets WHERE id=$1 FOR UPDATE',
        [resource],
      );
      check(
        a?.owner_id === actor.id,
        'FORBIDDEN',
        'Only the title owner may delegate inventory authority.',
        403,
      );
      check(org, 'WORKSPACE_REQUIRED', 'Choose the receiving workspace.');
      await workspaceMember(tx, actor.id, org, true);
      await requireEligibility(tx, actor.id);
      await assertNoRefund(tx, resource);
      await assertChannelFree(tx, resource);
      check(
        !(await one(
          tx,
          "SELECT id FROM listings WHERE asset_id=$1 AND status IN ('active','reserved')",
          [resource],
        )),
        'INVENTORY_BUSY',
        'Withdraw active listings before assigning inventory.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM orders WHERE asset_id=$1 AND (status='pending_payment' OR (status='paid' AND fulfillment='ship'))",
          [resource],
        )),
        'INVENTORY_BUSY',
        'Resolve pending orders or shipment before assigning inventory.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM intakes WHERE asset_id=$1 AND status IN ('awaiting_receipt','received')",
          [resource],
        )),
        'INVENTORY_BUSY',
        'Resolve intake before assigning inventory.',
      );
      return {
        asset_id: resource,
        owner_id: a.owner_id,
        from_org_id: a.inventory_org_id,
        to_org_id: org,
      };
    }
    requireStaff(actor, 'finance');
    if (kind === 'plan_activate' || kind === 'plan_retire') {
      const p = await one(tx, 'SELECT * FROM plan_versions WHERE id=$1', [resource]);
      check(p, 'NOT_FOUND', 'Plan not found.', 404);
      check(
        p.state === (kind === 'plan_activate' ? 'draft' : 'active'),
        'INVALID_STATE',
        'Plan state changed.',
      );
      return {
        plan_id: p.id,
        state: p.state,
        name: p.name,
        amount_cents: p.amount_cents,
        limits: p.limits,
        trial_days: p.trial_days,
        grace_days: p.grace_days,
        audience: p.audience,
        author: p.created_by,
      };
    }
    check(kind === 'settlement_release', 'ACTION_UNAVAILABLE', 'Unknown finance action.', 400);
    const s = await one(
      tx,
      'SELECT s.*,o.status AS order_status,o.payment_provider FROM settlements s JOIN orders o ON o.id=s.order_id WHERE s.id=$1',
      [resource],
    );
    check(s, 'NOT_FOUND', 'Settlement not found.', 404);
    check(s.status === 'held', 'INVALID_STATE', 'Settlement is no longer held.');
    check(
      s.payment_provider === 'demo',
      'STRIPE_PAYOUT_NOT_ENABLED',
      'Stripe payouts remain disabled.',
    );
    return {
      settlement_id: s.id,
      order_id: s.order_id,
      seller_id: s.seller_id,
      amount_cents: s.amount_cents,
    };
  }
  async request(actor: Actor, kind: string, resource: string, reason: string, org?: string) {
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const payload = await this.snapshot(tx, actor, kind, resource, org);
      const old = await one(
        tx,
        "SELECT id FROM finance_approvals WHERE kind=$1 AND resource_id=$2 AND state IN ('pending','approved')",
        [kind, resource],
      );
      check(
        !old,
        'APPROVAL_PENDING',
        'An approval is already pending; resolve it before requesting another.',
      );
      const aid = id();
      await tx.query(
        'INSERT INTO finance_approvals(id,kind,resource_id,payload,requested_by,reason) VALUES ($1,$2,$3,$4,$5,$6)',
        [aid, kind, resource, JSON.stringify(payload), actor.id, reason],
      );
      await audit(tx, actor.id, 'finance.approval_requested', aid, { kind, resource });
      return { id: aid };
    });
  }
  async decide(
    actor: Actor,
    aid: string,
    version: number,
    decision: 'approve' | 'reject',
    note: string,
  ) {
    requireStaff(actor, 'finance');
    await this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const a = await one(tx, 'SELECT * FROM finance_approvals WHERE id=$1 FOR UPDATE', [aid]);
      check(a, 'NOT_FOUND', 'Approval not found.', 404);
      check(
        a.requested_by !== actor.id,
        'SELF_APPROVAL',
        'A different finance reviewer must decide.',
        403,
      );
      check(
        a.version === version &&
          ['pending', 'approved'].includes(a.state) &&
          (a.state === 'pending' || decision === 'reject'),
        'APPROVAL_VERSION',
        'Approval state changed; refresh the queue.',
      );
      check(
        decision === 'reject' || Date.parse(a.expires_at) > Date.now(),
        'APPROVAL_EXPIRED',
        'Reject this expired request and create a fresh one.',
      );
      if (decision === 'approve' && (a.kind === 'plan_activate' || a.kind === 'plan_retire'))
        check(
          a.payload.author !== actor.id,
          'SELF_APPROVAL',
          'The plan author cannot approve activation or retirement.',
          403,
        );
      await tx.query(
        'UPDATE finance_approvals SET state=$2,version=version+1,decided_by=$3,decision_note=$4,decided_at=now() WHERE id=$1',
        [aid, decision === 'approve' ? 'approved' : 'rejected', actor.id, note],
      );
      await audit(tx, actor.id, 'finance.approval_decided', aid, { decision, note });
    });
    if (decision === 'approve') return this.execute(actor, aid);
    return { ok: true };
  }
  async execute(actor: Actor, aid: string) {
    requireStaff(actor, 'finance');
    const a = await one(this.db, 'SELECT * FROM finance_approvals WHERE id=$1', [aid]);
    check(a, 'NOT_FOUND', 'Approval not found.', 404);
    check(
      a.decided_by === actor.id,
      'FORBIDDEN',
      'Only the approving reviewer may retry execution.',
      403,
    );
    if (a.state === 'executed') return { ok: true, replayed: true };
    if (['partial_refund', 'refund_retry', 'connect_transfer'].includes(a.kind)) {
      check(
        this.executePayment,
        'PAYMENT_OPERATIONS_UNAVAILABLE',
        'Payment approval execution is unavailable.',
        503,
      );
      return this.executePayment(actor, aid, a.kind);
    }
    if (a.kind === 'settlement_release')
      return new OperationsService(this.db).releaseSettlement(actor, a.resource_id, aid);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const requester = await one(
        tx,
        'SELECT id,is_staff FROM users WHERE id=$1 AND closed_at IS NULL',
        [a.requested_by],
      );
      check(requester, 'APPROVAL_STALE', 'The requester account is no longer available.');
      if (a.kind !== 'inventory_assign')
        check(
          requester.is_staff &&
            (await one(
              tx,
              "SELECT user_id FROM staff_permissions WHERE user_id=$1 AND permission='finance'",
              [requester.id],
            )),
          'APPROVAL_STALE',
          'The requester no longer has finance authority.',
        );
      const payload = await this.snapshot(
        tx,
        { ...actor, id: a.requested_by },
        a.kind,
        a.resource_id,
        a.payload.to_org_id,
      );
      await consumeApproval(tx, actor.id, aid, a.kind, a.resource_id, payload);
      if (a.kind === 'inventory_assign')
        await tx.query('UPDATE assets SET inventory_org_id=$2 WHERE id=$1', [
          a.resource_id,
          a.payload.to_org_id,
        ]);
      else
        await tx.query('UPDATE plan_versions SET state=$2 WHERE id=$1', [
          a.resource_id,
          a.kind === 'plan_activate' ? 'active' : 'retired',
        ]);
      return { ok: true };
    });
  }
}
