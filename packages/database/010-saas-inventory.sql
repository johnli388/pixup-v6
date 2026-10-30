CREATE TABLE plan_versions (
 id text PRIMARY KEY,name text NOT NULL,audience text NOT NULL CHECK(audience IN ('demand','distribution','supply')),
 amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 100 AND 1000000),currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 trial_days integer NOT NULL CHECK(trial_days BETWEEN 0 AND 30),grace_days integer NOT NULL CHECK(grace_days BETWEEN 0 AND 14),
 limits jsonb NOT NULL,state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','active','retired')),
 created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_accounts (
 id text PRIMARY KEY,org_id text UNIQUE NOT NULL REFERENCES organizations(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE subscriptions (
 id text PRIMARY KEY,account_id text NOT NULL REFERENCES billing_accounts(id),plan_id text NOT NULL REFERENCES plan_versions(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','trial','active','past_due','canceled','expired','paused','unpaid')),
 session_id text UNIQUE,provider_id text UNIQUE,customer_id text,checkout_url text,payload jsonb NOT NULL,
 created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 period_end timestamptz,trial_end timestamptz,past_due_since timestamptz,last_paid_at timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false,cancel_requested boolean NOT NULL DEFAULT false,
 sync_version integer NOT NULL DEFAULT 0,last_checked timestamptz,error_code text
);
CREATE UNIQUE INDEX one_current_subscription ON subscriptions(account_id) WHERE state NOT IN ('canceled','expired');
CREATE TABLE subscription_invoices (
 id text PRIMARY KEY,subscription_id text NOT NULL REFERENCES subscriptions(id),status text NOT NULL,
 currency text NOT NULL,amount_due integer NOT NULL,amount_paid integer NOT NULL,period_end timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_events (
 id text PRIMARY KEY,type text NOT NULL,object_id text NOT NULL,subscription_ref text,attempt_ref text,
 content_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz
);
CREATE TABLE usage_events (
 id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),metric text NOT NULL,
 resource_id text NOT NULL,quantity integer NOT NULL CHECK(quantity>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,metric,resource_id)
);
CREATE INDEX usage_period ON usage_events(org_id,metric,created_at);
CREATE TABLE finance_approvals (
 id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('plan_activate','plan_retire','inventory_assign','settlement_release')),
 resource_id text NOT NULL,payload jsonb NOT NULL,requested_by text NOT NULL REFERENCES users(id),reason text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','executed','rejected')),
 version integer NOT NULL DEFAULT 1,decided_by text REFERENCES users(id),decision_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',decided_at timestamptz
);
CREATE UNIQUE INDEX one_pending_finance_action ON finance_approvals(kind,resource_id) WHERE state IN ('pending','approved');
ALTER TABLE assets ADD COLUMN inventory_org_id text REFERENCES organizations(id);
ALTER TABLE assets ADD COLUMN catalog_attributes jsonb NOT NULL DEFAULT '{}';
CREATE TABLE catalog_revisions (
 id text PRIMARY KEY,asset_id text NOT NULL REFERENCES assets(id),attributes jsonb NOT NULL,actor_id text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION clear_inventory_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.owner_id<>OLD.owner_id THEN NEW.inventory_org_id=NULL; END IF; RETURN NEW; END; $$;
CREATE TRIGGER owner_change_clears_inventory BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION clear_inventory_authority();
CREATE TRIGGER immutable_usage_event BEFORE UPDATE OR DELETE ON usage_events FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_catalog_revision BEFORE UPDATE OR DELETE ON catalog_revisions FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION freeze_commercial_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='plan_versions' THEN
   IF (to_jsonb(NEW)-'state')<>(to_jsonb(OLD)-'state') THEN RAISE EXCEPTION 'Plan terms are immutable; create a new version'; END IF;
 ELSE
   IF NEW.kind<>OLD.kind OR NEW.resource_id<>OLD.resource_id OR NEW.payload<>OLD.payload OR NEW.requested_by<>OLD.requested_by OR NEW.reason<>OLD.reason OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Approval scope is immutable'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER frozen_plan BEFORE UPDATE ON plan_versions FOR EACH ROW EXECUTE FUNCTION freeze_commercial_terms();
CREATE TRIGGER no_delete_plan BEFORE DELETE ON plan_versions FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER frozen_approval BEFORE UPDATE ON finance_approvals FOR EACH ROW EXECUTE FUNCTION freeze_commercial_terms();
CREATE TRIGGER no_delete_approval BEFORE DELETE ON finance_approvals FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION freeze_subscription_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.plan_id<>OLD.plan_id OR NEW.account_id<>OLD.account_id OR NEW.payload<>OLD.payload OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR
 (OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id) OR
 (OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id) OR
 (OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id)
 THEN RAISE EXCEPTION 'Subscription terms and provider identities are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER frozen_subscription BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION freeze_subscription_terms();
