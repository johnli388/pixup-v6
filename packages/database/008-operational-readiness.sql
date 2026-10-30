ALTER TABLE users ADD COLUMN closed_at timestamptz;
CREATE TABLE privacy_profiles (
 user_id text PRIMARY KEY REFERENCES users(id), terms_version text, privacy_version text,
 minimum_age integer, age_attested_at timestamptz, marketing_opt_in boolean NOT NULL DEFAULT false,
 restriction text CHECK(restriction IN ('age','privacy','staff')), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE privacy_consents (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), terms_version text NOT NULL,
 privacy_version text NOT NULL, minimum_age integer NOT NULL, adult boolean NOT NULL,
 marketing_opt_in boolean NOT NULL, source text NOT NULL CHECK(source IN ('user','demo_fixture')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_privacy_consent BEFORE UPDATE OR DELETE ON privacy_consents FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TABLE privacy_requests (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),kind text NOT NULL CHECK(kind IN ('restrict','delete','age_review')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','rejected')), note text NOT NULL,
 decision_note text NOT NULL DEFAULT '', assigned_to text REFERENCES users(id), due_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz
);
CREATE UNIQUE INDEX one_open_privacy_request ON privacy_requests(user_id,kind) WHERE status='open';
CREATE TABLE auth_attempts (key text PRIMARY KEY,attempts integer NOT NULL DEFAULT 1,window_started timestamptz NOT NULL DEFAULT now());
CREATE TABLE operational_events (
 id text PRIMARY KEY,correlation_id text NOT NULL,kind text NOT NULL,route text NOT NULL,method text NOT NULL,
 status integer NOT NULL,duration_ms integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_event_time ON operational_events(created_at);
CREATE TABLE operational_alerts (
 code text PRIMARY KEY,severity text NOT NULL CHECK(severity IN ('warning','critical')),summary text NOT NULL,
 status text NOT NULL CHECK(status IN ('active','resolved')),first_seen timestamptz NOT NULL DEFAULT now(),last_seen timestamptz NOT NULL DEFAULT now(),
 acknowledged_by text REFERENCES users(id),acknowledgement text NOT NULL DEFAULT '',acknowledged_at timestamptz,resolved_at timestamptz
);
CREATE TABLE operational_heartbeats (name text PRIMARY KEY,last_success timestamptz,last_failure timestamptz);

ALTER TABLE orders ADD COLUMN policy_snapshot jsonb NOT NULL DEFAULT '{}';
