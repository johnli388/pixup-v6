ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN local_login_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
ALTER TABLE sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'password';
ALTER TABLE sessions ADD COLUMN reauthenticated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE managed_identities (
 issuer text NOT NULL, subject text NOT NULL, user_id text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(issuer,subject), UNIQUE(issuer,user_id)
);
CREATE TABLE identity_challenges (
 token_hash text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('verify','reset','invite','oidc')),
 user_id text REFERENCES users(id), resource_id text, email text, secret text, browser_hash text,
 expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity_mail (
 id text PRIMARY KEY, token_hash text NOT NULL REFERENCES identity_challenges(token_hash), payload text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','expired','requires_review')),
 provider_id text, error_code text, checked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE authenticators (
 user_id text PRIMARY KEY REFERENCES users(id), secret text NOT NULL, enabled_at timestamptz,
 last_step bigint NOT NULL DEFAULT -1, pending_secret text, pending_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mfa_recovery_codes (
 user_id text NOT NULL REFERENCES users(id), code_hash text NOT NULL, used_at timestamptz, PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE owner_transfers (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id), from_user text NOT NULL REFERENCES users(id), to_user text NOT NULL REFERENCES users(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','canceled')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
CREATE UNIQUE INDEX one_owner_transfer ON owner_transfers(org_id) WHERE state='pending';
ALTER TABLE staff_permissions DROP CONSTRAINT staff_permissions_permission_check;
ALTER TABLE staff_permissions ADD CHECK(permission IN ('rights','warehouse','via','finance','support','audit','identity_admin'));
CREATE TABLE staff_access_reviews (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), requested_by text NOT NULL REFERENCES users(id), permissions jsonb NOT NULL,
 previous_permissions jsonb NOT NULL, reason text NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
 decided_by text REFERENCES users(id), decision_note text, expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
CREATE UNIQUE INDEX one_staff_review ON staff_access_reviews(user_id) WHERE state='pending';
CREATE INDEX identity_expiry ON identity_challenges(expires_at) WHERE used_at IS NULL;
-- API context is transaction-local and supplied by authenticated server code, never a request tenant ID.
CREATE FUNCTION pixup_member(org text, roles text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.memberships WHERE org_id=org AND user_id=nullif(current_setting('pixup.actor_id',true),'') AND role=ANY(roles));
$$;
CREATE FUNCTION pixup_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.users WHERE id=nullif(current_setting('pixup.actor_id',true),'') AND is_staff AND closed_at IS NULL);
$$;
CREATE FUNCTION pixup_email() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT email FROM public.users WHERE id=nullif(current_setting('pixup.actor_id',true),'') AND closed_at IS NULL;
$$;
-- A worker role is provisioned separately; no runtime role is given membership in it.
CREATE FUNCTION pixup_worker() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pixup_worker' AND pg_has_role(current_user,oid,'member'));
$$;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_read ON collections FOR SELECT USING(status='published' OR pixup_member(org_id,ARRAY['owner','publisher','viewer','operator']) OR pixup_staff() OR pixup_worker());
CREATE POLICY collection_write ON collections FOR ALL USING(pixup_member(org_id,ARRAY['owner','publisher']) OR pixup_staff() OR pixup_worker()) WITH CHECK(pixup_member(org_id,ARRAY['owner','publisher']) OR pixup_staff() OR pixup_worker());
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitation_read ON organization_invitations FOR SELECT USING(email=pixup_email() OR pixup_member(org_id,ARRAY['owner']) OR pixup_staff() OR pixup_worker());
CREATE POLICY invitation_insert ON organization_invitations FOR INSERT WITH CHECK(pixup_member(org_id,ARRAY['owner']) OR pixup_worker());
CREATE POLICY invitation_update ON organization_invitations FOR UPDATE USING(email=pixup_email() OR pixup_member(org_id,ARRAY['owner']) OR pixup_staff() OR pixup_worker()) WITH CHECK(email=pixup_email() OR pixup_member(org_id,ARRAY['owner']) OR pixup_staff() OR pixup_worker());
CREATE POLICY invitation_delete ON organization_invitations FOR DELETE USING(pixup_member(org_id,ARRAY['owner']) OR pixup_worker());
ALTER TABLE owner_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_transfer_scope ON owner_transfers USING(from_user=nullif(current_setting('pixup.actor_id',true),'') OR to_user=nullif(current_setting('pixup.actor_id',true),'') OR pixup_worker()) WITH CHECK(from_user=nullif(current_setting('pixup.actor_id',true),'') OR to_user=nullif(current_setting('pixup.actor_id',true),'') OR pixup_worker());
CREATE TRIGGER retain_managed_identity BEFORE UPDATE OR DELETE ON managed_identities FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION freeze_access_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['state','decided_at','decided_by','decision_note']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','decided_at','decided_by','decision_note']) OR OLD.state<>'pending'
 THEN RAISE EXCEPTION 'Access request identity, terms and terminal decisions are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER frozen_staff_request BEFORE UPDATE ON staff_access_reviews FOR EACH ROW EXECUTE FUNCTION freeze_access_request();
CREATE TRIGGER retain_staff_request BEFORE DELETE ON staff_access_reviews FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER frozen_owner_transfer BEFORE UPDATE ON owner_transfers FOR EACH ROW EXECUTE FUNCTION freeze_access_request();
CREATE TRIGGER retain_owner_transfer BEFORE DELETE ON owner_transfers FOR EACH ROW EXECUTE FUNCTION deny_mutation();
