CREATE TABLE price_cohorts (
 id text PRIMARY KEY,label text NOT NULL,definition text NOT NULL,grade text NOT NULL,
 created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE asset_price_cohorts (
 asset_id text PRIMARY KEY REFERENCES assets(id),cohort_id text NOT NULL REFERENCES price_cohorts(id),
 assigned_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE price_observations (
 id text PRIMARY KEY,cohort_id text NOT NULL REFERENCES price_cohorts(id),
 lane text NOT NULL CHECK(lane IN ('simulation','external')),order_id text UNIQUE REFERENCES orders(id),
 source text NOT NULL,source_reference text NOT NULL,permission_evidence text NOT NULL,evidence text NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),currency text NOT NULL CHECK(currency='USD'),
 occurred_at timestamptz NOT NULL,final_sale boolean NOT NULL,related_party boolean NOT NULL,
 submitted_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source,source_reference),CHECK((lane='simulation')=(order_id IS NOT NULL))
);
CREATE TABLE price_observation_reviews (
 sequence bigserial PRIMARY KEY,observation_id text NOT NULL REFERENCES price_observations(id),
 decision text NOT NULL CHECK(decision IN ('include','exclude')),reason text NOT NULL,
 reviewer_id text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE price_snapshots (
 id text PRIMARY KEY,cohort_id text NOT NULL REFERENCES price_cohorts(id),lane text NOT NULL CHECK(lane IN ('simulation','external')),
 methodology text NOT NULL,as_of timestamptz NOT NULL,inputs jsonb NOT NULL,result jsonb NOT NULL,
 created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE signing_requests (
 id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('certificate','checkpoint')),resource_id text NOT NULL,
 payload jsonb NOT NULL,entries jsonb NOT NULL,created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days'
);
CREATE TABLE trust_signatures (
 id text PRIMARY KEY,request_id text UNIQUE NOT NULL REFERENCES signing_requests(id),key_id text NOT NULL,
 signature text NOT NULL,imported_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_price_cohort BEFORE UPDATE OR DELETE ON price_cohorts FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_price_assignment BEFORE UPDATE OR DELETE ON asset_price_cohorts FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_price_observation BEFORE UPDATE OR DELETE ON price_observations FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_price_review BEFORE UPDATE OR DELETE ON price_observation_reviews FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_price_snapshot BEFORE UPDATE OR DELETE ON price_snapshots FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_signing_request BEFORE UPDATE OR DELETE ON signing_requests FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_trust_signature BEFORE UPDATE OR DELETE ON trust_signatures FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE INDEX price_cohort_observations ON price_observations(cohort_id,lane,occurred_at);
CREATE INDEX price_review_latest ON price_observation_reviews(observation_id,sequence DESC);
