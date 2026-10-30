ALTER TABLE payment_attempts ADD COLUMN account_id text;
ALTER TABLE payment_attempts ADD COLUMN provider_mode text CHECK(provider_mode='test');
ALTER TABLE payment_event_inbox ADD COLUMN account_id text;
ALTER TABLE payment_event_inbox ADD COLUMN payload_hash text;
ALTER TABLE payment_refunds DROP CONSTRAINT payment_refunds_order_id_key;
ALTER TABLE payment_refunds ADD COLUMN attempt_number integer NOT NULL DEFAULT 1 CHECK(attempt_number>0);
ALTER TABLE payment_refunds ADD COLUMN previous_refund_id text UNIQUE REFERENCES payment_refunds(id);
CREATE UNIQUE INDEX refund_attempt_number ON payment_refunds(order_id,attempt_number);
CREATE UNIQUE INDEX one_active_full_refund ON payment_refunds(order_id) WHERE status NOT IN ('failed','canceled');
ALTER TABLE finance_approvals DROP CONSTRAINT finance_approvals_kind_check;
ALTER TABLE finance_approvals ADD CHECK(kind IN ('plan_activate','plan_retire','inventory_assign','settlement_release','partial_refund','refund_retry','connect_transfer'));
CREATE TABLE payment_adjustments (
 id text PRIMARY KEY REFERENCES finance_approvals(id), order_id text NOT NULL REFERENCES orders(id),
 requested_by text NOT NULL REFERENCES users(id), amount_cents integer NOT NULL CHECK(amount_cents>0),
 seller_cents integer NOT NULL CHECK(seller_cents>=0), fee_cents integer NOT NULL CHECK(fee_cents>=0), shipping_cents integer NOT NULL CHECK(shipping_cents>=0),
 account_id text NOT NULL, payment_intent_id text NOT NULL, payload jsonb NOT NULL,
 provider_refund_id text UNIQUE, state text NOT NULL DEFAULT 'created' CHECK(state IN ('created','pending','requires_action','requires_review','succeeded','failed','canceled')),
 sync_version integer NOT NULL DEFAULT 0, checked_at timestamptz, error_code text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(amount_cents=seller_cents+fee_cents+shipping_cents)
);
CREATE UNIQUE INDEX one_pending_adjustment ON payment_adjustments(order_id) WHERE state NOT IN ('succeeded','failed','canceled');
CREATE TABLE payment_control_events (
 account_id text NOT NULL, event_id text NOT NULL, event_type text NOT NULL, object_id text NOT NULL,
 payment_intent_id text, payload_hash text NOT NULL, processed_at timestamptz, checked_at timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,event_id)
);
CREATE TABLE payment_control_claims(account_id text NOT NULL,object_id text NOT NULL,version integer NOT NULL DEFAULT 1,PRIMARY KEY(account_id,object_id));
CREATE TABLE provider_disputes (
 account_id text NOT NULL, id text NOT NULL, order_id text NOT NULL REFERENCES orders(id),
 status text NOT NULL, amount_cents integer NOT NULL, currency text NOT NULL CHECK(currency='usd'),
 due_at timestamptz, checked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,id)
);
CREATE TABLE payment_reconciliations (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), account_id text NOT NULL,
 requested_by text NOT NULL REFERENCES users(id), state text NOT NULL CHECK(state IN ('matched','mismatch')),
 expected jsonb NOT NULL, observed jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_reconciliation BEFORE UPDATE OR DELETE ON payment_reconciliations FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TABLE payment_exceptions (
 order_id text NOT NULL REFERENCES orders(id), code text NOT NULL, state text NOT NULL CHECK(state IN ('open','resolved')),
 run_id text REFERENCES payment_reconciliations(id), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(order_id,code)
);
CREATE TABLE connect_recipients (
 id text PRIMARY KEY, user_id text UNIQUE NOT NULL REFERENCES users(id), platform_account text NOT NULL, country text NOT NULL,
 payload jsonb NOT NULL, provider_account text UNIQUE, state text NOT NULL DEFAULT 'created',
 transfers_active boolean NOT NULL DEFAULT false, payouts_enabled boolean NOT NULL DEFAULT false, details_submitted boolean NOT NULL DEFAULT false,
 requirements_count integer NOT NULL DEFAULT 0, sync_version integer NOT NULL DEFAULT 0, checked_at timestamptz, error_code text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE settlement_transfers (
 id text PRIMARY KEY REFERENCES finance_approvals(id), settlement_id text UNIQUE NOT NULL REFERENCES settlements(id),
 order_id text UNIQUE NOT NULL REFERENCES orders(id), account_id text NOT NULL, destination text NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents>0), payload jsonb NOT NULL, requested_by text NOT NULL REFERENCES users(id),
 provider_transfer_id text UNIQUE, state text NOT NULL DEFAULT 'created' CHECK(state IN ('created','succeeded','requires_review')),
 checked_at timestamptz, error_code text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION freeze_payment_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['state','provider_refund_id','provider_transfer_id','provider_account','checked_at','error_code','sync_version','transfers_active','payouts_enabled','details_submitted','requirements_count'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','provider_refund_id','provider_transfer_id','provider_account','checked_at','error_code','sync_version','transfers_active','payouts_enabled','details_submitted','requirements_count'])
 THEN RAISE EXCEPTION 'Payment command identity and terms are immutable'; END IF;
 IF (to_jsonb(OLD)->>'provider_refund_id' IS NOT NULL AND to_jsonb(NEW)->>'provider_refund_id' IS DISTINCT FROM to_jsonb(OLD)->>'provider_refund_id') OR
 (to_jsonb(OLD)->>'provider_transfer_id' IS NOT NULL AND to_jsonb(NEW)->>'provider_transfer_id' IS DISTINCT FROM to_jsonb(OLD)->>'provider_transfer_id') OR
 (to_jsonb(OLD)->>'provider_account' IS NOT NULL AND to_jsonb(NEW)->>'provider_account' IS DISTINCT FROM to_jsonb(OLD)->>'provider_account')
 THEN RAISE EXCEPTION 'Provider identity is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER frozen_adjustment BEFORE UPDATE ON payment_adjustments FOR EACH ROW EXECUTE FUNCTION freeze_payment_control();
CREATE TRIGGER frozen_recipient BEFORE UPDATE ON connect_recipients FOR EACH ROW EXECUTE FUNCTION freeze_payment_control();
CREATE TRIGGER frozen_transfer BEFORE UPDATE ON settlement_transfers FOR EACH ROW EXECUTE FUNCTION freeze_payment_control();
CREATE TRIGGER retain_adjustment BEFORE DELETE ON payment_adjustments FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER retain_recipient BEFORE DELETE ON connect_recipients FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER retain_transfer BEFORE DELETE ON settlement_transfers FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION freeze_payment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.account_id IS NOT NULL AND ROW(NEW.account_id,NEW.provider_mode) IS DISTINCT FROM ROW(OLD.account_id,OLD.provider_mode)
 THEN RAISE EXCEPTION 'Payment provider scope is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER immutable_payment_scope BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION freeze_payment_scope();
CREATE INDEX pending_control_events ON payment_control_events(account_id,checked_at,created_at) WHERE processed_at IS NULL;
CREATE FUNCTION freeze_refund_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF ROW(NEW.attempt_number,NEW.previous_refund_id) IS DISTINCT FROM ROW(OLD.attempt_number,OLD.previous_refund_id)
 THEN RAISE EXCEPTION 'Refund lineage is immutable'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER immutable_refund_lineage BEFORE UPDATE ON payment_refunds FOR EACH ROW EXECUTE FUNCTION freeze_refund_lineage();
