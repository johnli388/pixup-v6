CREATE TABLE commercial_policy_versions (
  version integer PRIMARY KEY CHECK (version > 0),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO commercial_policy_versions(version,snapshot) VALUES (1,'{
  "scope":"local_pilot",
  "production_launch_approved":false,
  "credit_scope":"pixup_owned",
  "new_sales_enabled":true,
  "reviewed_decisions":{},
  "terms":{
    "credit_redemption":"100 credit units = USD 1 toward PixUP-owned item price only; no shipping, third-party seller proceeds, cash withdrawal or peer transfer.",
    "creator_entitlements":"Attribution is observational. No automatic creator royalty, IFCI payment or entitlement contract is activated.",
    "seller_protection":"Certified stock in vault custody (or allocated CVM device custody) only. No seller-shipped checkout or insurance guarantee.",
    "title_payout":"Title transfers after confirmed payment. Seller settlement remains held for separate review; payment, dispute, physical custody and channel gates still apply.",
    "refund_windows":"No automatic time-based return entitlement or deadline is configured. Existing payment, title, custody and channel checks govern demo reversals; Stripe test refunds require staff review. No statutory rights are determined here.",
    "taxation":"USD simulation/test payments only. Tax is not calculated; this is not a tax exemption or an approved production tax treatment.",
    "jurisdiction_age":"Local pilot only, with the configured minimum age (at least 18) self-declaration and current pilot terms/privacy consent. No jurisdiction is approved for paid production launch."
  }
}');
CREATE TABLE commercial_policy_current (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL REFERENCES commercial_policy_versions(version)
);
INSERT INTO commercial_policy_current(version) VALUES (1);
CREATE TABLE commercial_decisions (
  id text PRIMARY KEY,
  topic text NOT NULL CHECK (topic IN ('credit_redemption','creator_entitlements','seller_protection','title_payout','refund_windows','taxation','jurisdiction_age')),
  action text NOT NULL CHECK (action IN ('record_review','disable_credits','restore_pilot_credits','pause_sales','resume_pilot_sales')),
  base_version integer NOT NULL REFERENCES commercial_policy_versions(version),
  statement text NOT NULL CHECK (length(statement) BETWEEN 20 AND 4000),
  evidence text NOT NULL CHECK (length(evidence) BETWEEN 10 AND 2000),
  requested_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  decided_by text REFERENCES users(id),
  decided_at timestamptz,
  review_note text,
  resulting_version integer REFERENCES commercial_policy_versions(version),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK ((state='pending' AND decided_by IS NULL AND decided_at IS NULL AND review_note IS NULL AND resulting_version IS NULL)
    OR (state<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(review_note) BETWEEN 10 AND 2000
      AND ((state='approved' AND resulting_version IS NOT NULL) OR (state='rejected' AND resulting_version IS NULL)))),
  CHECK (action='record_review' OR (topic='credit_redemption' AND action IN ('disable_credits','restore_pilot_credits'))
    OR (topic='jurisdiction_age' AND action IN ('pause_sales','resume_pilot_sales')))
);
CREATE INDEX commercial_decisions_created ON commercial_decisions(created_at DESC);
ALTER TABLE quotes ADD COLUMN commercial_policy_version integer REFERENCES commercial_policy_versions(version);
ALTER TABLE quotes ADD COLUMN commercial_snapshot jsonb;
ALTER TABLE orders ADD COLUMN commercial_policy_version integer REFERENCES commercial_policy_versions(version);
ALTER TABLE orders ADD COLUMN commercial_snapshot jsonb;
-- Historical records remain explicitly unknown; never backfill assent or approved policy.
CREATE FUNCTION protect_commercial_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Commercial history cannot be deleted'; END IF;
  IF TG_TABLE_NAME='commercial_policy_versions' THEN RAISE EXCEPTION 'Policy versions are immutable'; END IF;
  IF TG_TABLE_NAME='commercial_decisions' THEN
    IF OLD.state<>'pending' OR
      (to_jsonb(NEW)-ARRAY['state','decided_by','decided_at','review_note','resulting_version']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['state','decided_by','decided_at','review_note','resulting_version'])
    THEN RAISE EXCEPTION 'Decision inputs and completed reviews are immutable'; END IF;
  ELSE
    IF NEW.commercial_policy_version IS DISTINCT FROM OLD.commercial_policy_version OR
       NEW.commercial_snapshot IS DISTINCT FROM OLD.commercial_snapshot
    THEN RAISE EXCEPTION 'Transaction commercial terms are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commercial_versions_immutable BEFORE UPDATE OR DELETE ON commercial_policy_versions FOR EACH ROW EXECUTE FUNCTION protect_commercial_history();
CREATE TRIGGER commercial_decisions_immutable BEFORE UPDATE OR DELETE ON commercial_decisions FOR EACH ROW EXECUTE FUNCTION protect_commercial_history();
CREATE TRIGGER quote_commercial_immutable BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION protect_commercial_history();
CREATE TRIGGER order_commercial_immutable BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION protect_commercial_history();
