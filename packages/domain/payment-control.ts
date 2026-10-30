import { one, type SQL } from '../database/index';
import { check } from './core';
export async function adjustments(tx: SQL, order: string) {
  return (await one(
    tx,
    "SELECT COALESCE(sum(amount_cents),0)::int AS cash,COALESCE(sum(seller_cents),0)::int AS seller,COALESCE(sum(fee_cents),0)::int AS fee,COALESCE(sum(shipping_cents),0)::int AS shipping FROM payment_adjustments WHERE order_id=$1 AND state='succeeded'",
    [order],
  ))!;
}
export async function noPaymentException(tx: SQL, order: string) {
  check(
    !(await one(
      tx,
      "SELECT id FROM provider_disputes WHERE order_id=$1 AND status NOT IN ('won','warning_closed') UNION ALL SELECT order_id AS id FROM payment_exceptions WHERE order_id=$1 AND state='open' UNION ALL SELECT e.event_id AS id FROM payment_control_events e JOIN payment_attempts p ON p.account_id=e.account_id AND p.payment_intent_id=e.payment_intent_id WHERE p.order_id=$1 AND e.event_type LIKE 'charge.dispute.%' AND e.processed_at IS NULL",
      [order],
    )),
    'PAYMENT_HOLD',
    'Resolve the provider dispute or reconciliation exception before moving funds.',
  );
}
export async function noPendingAdjustment(tx: SQL, order: string) {
  check(
    !(await one(
      tx,
      "SELECT id FROM payment_adjustments WHERE order_id=$1 AND state NOT IN ('succeeded','failed','canceled') UNION ALL SELECT id FROM settlement_transfers WHERE order_id=$1",
      [order],
    )),
    'PAYMENT_HOLD',
    'Reconcile the partial refund or transfer before another funds movement.',
  );
}
