// Arguments are fixed source-code aliases/placeholders, never request input.
// Discovery, resale, physical movement and payment completion share these holds.
export function assetPaymentHoldSql(asset: string) {
  return `EXISTS (
    SELECT 1 FROM orders held_order WHERE held_order.asset_id=${asset} AND (
      EXISTS (SELECT 1 FROM payment_refunds r WHERE r.order_id=held_order.id AND r.status NOT IN ('succeeded','failed','canceled'))
      OR EXISTS (SELECT 1 FROM payment_adjustments r WHERE r.order_id=held_order.id AND r.state NOT IN ('succeeded','failed','canceled'))
      OR EXISTS (SELECT 1 FROM provider_disputes d WHERE d.order_id=held_order.id AND d.status NOT IN ('won','warning_closed'))
      OR EXISTS (SELECT 1 FROM settlement_transfers t WHERE t.order_id=held_order.id AND t.state<>'succeeded')
      OR EXISTS (SELECT 1 FROM payment_exceptions e WHERE e.order_id=held_order.id AND e.state='open')
      OR EXISTS (SELECT 1 FROM payment_attempts p JOIN payment_control_events e
        ON e.account_id=p.account_id AND e.payment_intent_id=p.payment_intent_id
        WHERE p.order_id=held_order.id AND e.event_type LIKE 'charge.dispute.%' AND e.processed_at IS NULL)
    ))`;
}
