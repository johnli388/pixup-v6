CREATE TABLE channel_gates (
  kind text PRIMARY KEY CHECK(kind IN ('cvm','liveup','goup','waxup','ai')),
  enabled boolean NOT NULL DEFAULT false, evidence text NOT NULL DEFAULT '', updated_by text REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO channel_gates(kind) VALUES ('cvm'),('liveup'),('goup'),('waxup'),('ai');
CREATE TABLE channel_contexts (
  id text PRIMARY KEY, kind text NOT NULL REFERENCES channel_gates(kind), org_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','paused','locked','completed','canceled')),
  terms jsonb NOT NULL, terms_version integer NOT NULL DEFAULT 1,
  deadline timestamptz, created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(kind IN ('cvm','liveup','goup','waxup'))
);
CREATE TABLE channel_devices (
  context_id text PRIMARY KEY REFERENCES channel_contexts(id), public_key text NOT NULL,
  revoked boolean NOT NULL DEFAULT false, last_seen_at timestamptz
);
ALTER TABLE assets ADD COLUMN kind text NOT NULL DEFAULT 'specimen' CHECK(kind IN ('specimen','sealed_pack'));
ALTER TABLE assets DROP CONSTRAINT assets_custody_check;
ALTER TABLE assets ADD CONSTRAINT assets_custody_check CHECK(custody IN ('seller','intake','vault','device','shipping','delivered','quarantine'));
CREATE TABLE sealed_packs (
  asset_id text PRIMARY KEY REFERENCES assets(id), supplier_reference text NOT NULL, seal_reference text NOT NULL,
  units integer NOT NULL CHECK(units BETWEEN 1 AND 100), status text NOT NULL DEFAULT 'sealed' CHECK(status IN ('sealed','opened')),
  registered_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pack_contents (
  pack_id text NOT NULL REFERENCES sealed_packs(asset_id), asset_id text UNIQUE NOT NULL REFERENCES assets(id),
  PRIMARY KEY(pack_id,asset_id)
);
CREATE TRIGGER immutable_pack_contents BEFORE UPDATE OR DELETE ON pack_contents FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TABLE channel_allocations (
  id text PRIMARY KEY, context_id text NOT NULL REFERENCES channel_contexts(id), asset_id text NOT NULL REFERENCES assets(id),
  listing_id text NOT NULL REFERENCES listings(id), slot text NOT NULL,
  state text NOT NULL DEFAULT 'assigned' CHECK(state IN ('assigned','committed','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_channel_allocation ON channel_allocations(asset_id) WHERE state<>'closed';
CREATE UNIQUE INDEX one_channel_slot ON channel_allocations(context_id,slot) WHERE state<>'closed';
ALTER TABLE quotes ADD COLUMN allocation_id text REFERENCES channel_allocations(id);
ALTER TABLE quotes ADD COLUMN channel_terms jsonb;
ALTER TABLE orders ADD COLUMN allocation_id text REFERENCES channel_allocations(id);
ALTER TABLE orders ADD COLUMN channel text NOT NULL DEFAULT 'web' CHECK(channel IN ('web','cvm','liveup','goup','waxup'));
ALTER TABLE orders ADD COLUMN channel_terms jsonb;
CREATE TABLE channel_orders (
  order_id text PRIMARY KEY REFERENCES orders(id), context_id text NOT NULL REFERENCES channel_contexts(id),
  state text NOT NULL DEFAULT 'awaiting_payment' CHECK(state IN ('awaiting_payment','awaiting_fulfillment','unknown','refund_required','fulfilled','refunded','canceled')),
  evidence text NOT NULL DEFAULT '', recording_reference text NOT NULL DEFAULT '', recording_offset_ms integer, reveal_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE device_commands (
  id text PRIMARY KEY, order_id text UNIQUE NOT NULL REFERENCES orders(id), device_id text NOT NULL REFERENCES channel_devices(context_id),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','issued','unknown','succeeded','failed')),
  payload jsonb NOT NULL, signature text NOT NULL, issued_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE device_events (
  device_id text NOT NULL REFERENCES channel_devices(context_id), event_id text NOT NULL, request_hash text NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(device_id,event_id)
);
CREATE TRIGGER immutable_device_event BEFORE UPDATE OR DELETE ON device_events FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TABLE device_returns (
  id text PRIMARY KEY, device_id text NOT NULL REFERENCES channel_devices(context_id), asset_id text NOT NULL REFERENCES assets(id),
  user_id text NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'expected' CHECK(status IN ('expected','deposited','received')),
  intake_id text UNIQUE REFERENCES intakes(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_device_return ON device_returns(asset_id) WHERE status<>'received';
CREATE TABLE group_pledges (
  allocation_id text PRIMARY KEY REFERENCES channel_allocations(id), user_id text NOT NULL REFERENCES users(id),
  accepted_terms_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE channel_businesses (
  user_id text PRIMARY KEY REFERENCES users(id), org_id text NOT NULL REFERENCES organizations(id),
  approved_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wholesale_returns (
  order_id text PRIMARY KEY REFERENCES orders(id), user_id text NOT NULL REFERENCES users(id),
  mode text NOT NULL CHECK(mode IN ('consignment','buyback')), status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected')),
  note text NOT NULL, decision_note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tool_keys (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id), created_by text NOT NULL REFERENCES users(id),
  name text NOT NULL, secret_hash text UNIQUE NOT NULL, scopes jsonb NOT NULL,
  daily_limit integer NOT NULL CHECK(daily_limit BETWEEN 1 AND 10000), expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tool_calls (
  key_id text NOT NULL REFERENCES tool_keys(id), request_id text NOT NULL, request_hash text NOT NULL,
  operation text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(key_id,request_id)
);
CREATE TRIGGER immutable_tool_call BEFORE UPDATE OR DELETE ON tool_calls FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION protect_device_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.order_id,NEW.device_id,NEW.payload,NEW.signature,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.order_id,OLD.device_id,OLD.payload,OLD.signature,OLD.created_at)
 THEN RAISE EXCEPTION 'Device command identity and signed payload are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER immutable_device_command BEFORE UPDATE ON device_commands FOR EACH ROW EXECUTE FUNCTION protect_device_command();
CREATE TRIGGER retain_device_command BEFORE DELETE ON device_commands FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE INDEX channel_order_queue ON channel_orders(context_id,state);
CREATE INDEX tool_daily_usage ON tool_calls(key_id,created_at);
