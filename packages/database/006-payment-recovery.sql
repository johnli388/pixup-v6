CREATE TABLE payment_reviews (
  order_id text PRIMARY KEY REFERENCES orders(id),
  reason text NOT NULL CHECK(reason IN ('ambiguous_create','inventory_exception')),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  assigned_to text REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  due_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
INSERT INTO payment_reviews(order_id,reason)
SELECT order_id,CASE WHEN provider_session_id IS NULL THEN 'ambiguous_create' ELSE 'inventory_exception' END
FROM payment_attempts WHERE status='requires_review';

CREATE TABLE payment_refunds (
  id text PRIMARY KEY, order_id text UNIQUE NOT NULL REFERENCES orders(id),
  requested_by text NOT NULL REFERENCES users(id), reason text NOT NULL,
  amount_cents integer NOT NULL CHECK(amount_cents>=0),
  payment_intent_id text, provider_refund_id text UNIQUE,
  request_payload jsonb NOT NULL,
  kind text NOT NULL CHECK(kind IN ('sale','unallocated_payment')),
  status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','pending','requires_action','succeeded','failed','canceled','requires_review')),
  last_checked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX pending_refunds ON payment_refunds(last_checked_at) WHERE status IN ('created','pending','requires_action');
CREATE FUNCTION protect_refund_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.order_id,NEW.requested_by,NEW.reason,NEW.amount_cents,NEW.payment_intent_id,NEW.request_payload,NEW.kind,NEW.created_at)
 IS DISTINCT FROM
 (OLD.id,OLD.order_id,OLD.requested_by,OLD.reason,OLD.amount_cents,OLD.payment_intent_id,OLD.request_payload,OLD.kind,OLD.created_at)
 THEN RAISE EXCEPTION 'Refund request is immutable'; END IF;
 IF OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id
 THEN RAISE EXCEPTION 'Refund provider identity is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER immutable_refund_request BEFORE UPDATE ON payment_refunds FOR EACH ROW EXECUTE FUNCTION protect_refund_request();
CREATE TRIGGER retain_refund_request BEFORE DELETE ON payment_refunds FOR EACH ROW EXECUTE FUNCTION deny_mutation();
