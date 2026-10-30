CREATE TABLE users (
  id text PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL, is_staff boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organizations (
  id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL CHECK(kind IN ('personal','creator','merchant','platform')),
  plan text NOT NULL DEFAULT 'pilot'
);
CREATE TABLE memberships (
  user_id text NOT NULL REFERENCES users(id), org_id text NOT NULL REFERENCES organizations(id),
  role text NOT NULL CHECK(role IN ('owner','publisher','operator','viewer')),
  PRIMARY KEY(user_id,org_id)
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collections (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id), title text NOT NULL,
  description text NOT NULL, category text NOT NULL CHECK(category IN ('Sports','K-pop','Art','Gaming')),
  edition_size integer NOT NULL CHECK(edition_size BETWEEN 1 AND 10000),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','changes_requested','approved','stock_ready','published')),
  rights_evidence text NOT NULL DEFAULT '', review_note text NOT NULL DEFAULT '',
  artwork text NOT NULL DEFAULT 'orbit', issuance_mode text NOT NULL DEFAULT 'platform' CHECK(issuance_mode IN ('agency','licensed','platform','own')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assets (
  id text PRIMARY KEY, collection_id text REFERENCES collections(id), owner_id text NOT NULL REFERENCES users(id),
  title text NOT NULL, category text NOT NULL CHECK(category IN ('Sports','K-pop','Art','Gaming')),
  serial text UNIQUE NOT NULL, artwork text NOT NULL, description text NOT NULL DEFAULT '',
  grade text NOT NULL DEFAULT 'Ungraded', certification text NOT NULL DEFAULT 'unverified' CHECK(certification IN ('unverified','verified','rejected','revoked')),
  custody text NOT NULL DEFAULT 'seller' CHECK(custody IN ('seller','intake','vault','shipping','delivered','quarantine')),
  platform_owned boolean NOT NULL DEFAULT false, edition_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assessments (
  id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), reviewer_id text NOT NULL REFERENCES users(id),
  result text NOT NULL CHECK(result IN ('verified','rejected','revoked')), grade text NOT NULL,
  evidence text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE certificates (
  id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), assessment_id text NOT NULL REFERENCES assessments(id),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE listings (
  id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), seller_id text NOT NULL REFERENCES users(id),
  price_cents integer NOT NULL CHECK(price_cents BETWEEN 100 AND 10000000),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','reserved','sold','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_live_listing ON listings(asset_id) WHERE status IN ('active','reserved');
CREATE TABLE quotes (
  id text PRIMARY KEY, buyer_id text NOT NULL REFERENCES users(id), listing_id text NOT NULL REFERENCES listings(id),
  price_cents integer NOT NULL, fee_cents integer NOT NULL, credit_units integer NOT NULL DEFAULT 0,
  fulfillment text NOT NULL CHECK(fulfillment IN ('vault','ship')), shipping_cents integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL, policy_version text NOT NULL DEFAULT 'demo-v1', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE orders (
  id text PRIMARY KEY, quote_id text UNIQUE NOT NULL REFERENCES quotes(id), buyer_id text NOT NULL REFERENCES users(id),
  seller_id text NOT NULL REFERENCES users(id), asset_id text NOT NULL REFERENCES assets(id), listing_id text NOT NULL REFERENCES listings(id),
  status text NOT NULL CHECK(status IN ('pending_payment','paid','fulfilled','refunded','canceled')),
  total_cents integer NOT NULL, fee_cents integer NOT NULL, seller_cents integer NOT NULL,
  credit_units integer NOT NULL DEFAULT 0, fulfillment text NOT NULL, shipping_cents integer NOT NULL DEFAULT 0,
  shipping_address text NOT NULL DEFAULT '', tracking text NOT NULL DEFAULT '',
  reservation_expires_at timestamptz NOT NULL, paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_pending_order ON orders(asset_id) WHERE status='pending_payment';
CREATE TABLE settlements (
  id text PRIMARY KEY, order_id text UNIQUE NOT NULL REFERENCES orders(id), seller_id text NOT NULL REFERENCES users(id),
  amount_cents integer NOT NULL CHECK(amount_cents>=0), status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','released','reversed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE intakes (
  id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), user_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK(kind IN ('vault','repool')), status text NOT NULL DEFAULT 'awaiting_receipt' CHECK(status IN ('awaiting_receipt','received','accepted','rejected')),
  offered_credits integer NOT NULL DEFAULT 0, evidence text NOT NULL DEFAULT '', review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_open_intake ON intakes(asset_id) WHERE status IN ('awaiting_receipt','received');
CREATE TABLE credit_lots (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), intake_id text UNIQUE REFERENCES intakes(id),
  issued integer NOT NULL CHECK(issued>0), available integer NOT NULL CHECK(available>=0), held integer NOT NULL DEFAULT 0 CHECK(held>=0),
  origin text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(available+held<=issued)
);
CREATE TABLE credit_holds (
  order_id text NOT NULL REFERENCES orders(id), lot_id text NOT NULL REFERENCES credit_lots(id),
  units integer NOT NULL CHECK(units>0), status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','consumed','released','restored')),
  PRIMARY KEY(order_id,lot_id)
);
CREATE TABLE journal_entries (
  id text PRIMARY KEY, reference text UNIQUE NOT NULL, unit text NOT NULL CHECK(unit IN ('USD','CREDIT')),
  description text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE journal_lines (
  id text PRIMARY KEY, entry_id text NOT NULL REFERENCES journal_entries(id), account text NOT NULL,
  amount integer NOT NULL CHECK(amount<>0)
);
CREATE FUNCTION deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append-only record cannot be changed'; END; $$;
CREATE TRIGGER immutable_journal_entry BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_journal_line BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_assessment BEFORE UPDATE OR DELETE ON assessments FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION check_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint; n bigint;
BEGIN SELECT COALESCE(SUM(amount),0),COUNT(*) INTO total,n FROM journal_lines WHERE entry_id=NEW.id;
IF total<>0 OR n<2 THEN RAISE EXCEPTION 'Journal must have at least two lines and balance'; END IF;
RETURN NEW; END; $$;
CREATE CONSTRAINT TRIGGER balanced_journal AFTER INSERT ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
CREATE TABLE provenance_events (
  id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), sequence integer NOT NULL,
  type text NOT NULL, description text NOT NULL, actor_id text NOT NULL REFERENCES users(id),
  previous_hash text NOT NULL, hash text NOT NULL, created_at timestamptz NOT NULL,
  UNIQUE(asset_id,sequence)
);
CREATE TRIGGER immutable_provenance BEFORE UPDATE OR DELETE ON provenance_events FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TABLE outbox (
  id text PRIMARY KEY, type text NOT NULL, aggregate_id text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
  processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE activity (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), title text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
  id text PRIMARY KEY, actor_id text NOT NULL REFERENCES users(id), action text NOT NULL, resource_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TABLE idempotency (
  actor_id text NOT NULL REFERENCES users(id), key text NOT NULL, request_hash text NOT NULL,
  response jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,key)
);
CREATE TABLE saved_items (
  user_id text NOT NULL REFERENCES users(id), asset_id text NOT NULL REFERENCES assets(id), PRIMARY KEY(user_id,asset_id)
);
CREATE TABLE support_cases (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), order_id text REFERENCES orders(id),
  subject text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  response text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_buyer ON orders(buyer_id,created_at DESC);
CREATE INDEX events_asset ON provenance_events(asset_id,sequence);
CREATE INDEX collections_org ON collections(org_id);
CREATE INDEX outbox_pending ON outbox(created_at) WHERE processed_at IS NULL;
