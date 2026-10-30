ALTER TABLE orders ADD COLUMN payment_provider text NOT NULL DEFAULT 'demo'
  CHECK(payment_provider IN ('demo','stripe_test'));
CREATE TABLE payment_attempts (
  id text PRIMARY KEY, order_id text UNIQUE NOT NULL REFERENCES orders(id),
  status text NOT NULL DEFAULT 'created' CHECK(status IN ('created','open','succeeded','canceled','requires_review')),
  request_payload jsonb, provider_session_id text UNIQUE, payment_intent_id text,
  provider_payment_status text, last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_event_inbox (
  event_id text PRIMARY KEY, event_type text NOT NULL, session_id text NOT NULL,
  processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pending_payment_events ON payment_event_inbox(created_at) WHERE processed_at IS NULL;
