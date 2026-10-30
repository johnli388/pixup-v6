import { one, type SQL } from '../database/index';
import { check, audit } from './core';
import { canonical } from './trust';
export async function consumeApproval(
  tx: SQL,
  actor: string,
  approvalId: string | undefined,
  kind: string,
  resource: string,
  payload: unknown,
) {
  check(
    approvalId,
    'FINANCE_APPROVAL_REQUIRED',
    'A second finance reviewer must approve this exact action.',
  );
  const a = await one(tx, 'SELECT * FROM finance_approvals WHERE id=$1 FOR UPDATE', [approvalId]);
  check(
    await one(
      tx,
      "SELECT u.id FROM users u JOIN staff_permissions p ON p.user_id=u.id WHERE u.id=$1 AND u.is_staff AND u.closed_at IS NULL AND p.permission='finance' FOR SHARE OF u,p",
      [actor],
    ),
    'APPROVAL_STALE',
    'The approving reviewer no longer has finance authority.',
  );
  check(
    a &&
      a.kind === kind &&
      a.resource_id === resource &&
      a.state === 'approved' &&
      a.decided_by === actor &&
      a.requested_by !== actor &&
      Date.parse(a.expires_at) > Date.now(),
    'FINANCE_APPROVAL_REQUIRED',
    'A current independent approval is required.',
  );
  check(
    canonical(a.payload) === canonical(payload),
    'APPROVAL_STALE',
    'The approved business inputs changed; request a new approval.',
  );
  if (kind !== 'inventory_assign')
    check(
      await one(
        tx,
        "SELECT u.id FROM users u JOIN staff_permissions p ON p.user_id=u.id WHERE u.id=$1 AND u.is_staff AND u.closed_at IS NULL AND p.permission='finance' FOR SHARE OF u,p",
        [a.requested_by],
      ),
      'APPROVAL_STALE',
      'The requester no longer has finance authority.',
    );
  await tx.query("UPDATE finance_approvals SET state='executed',version=version+1 WHERE id=$1", [
    approvalId,
  ]);
  await audit(tx, actor, 'finance.approval_executed', approvalId, { kind, resource });
}
