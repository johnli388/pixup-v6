CREATE TABLE organization_invitations (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id),
  email text NOT NULL, role text NOT NULL CHECK(role IN ('publisher','viewer')),
  invited_by text NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_pending_invitation ON organization_invitations(org_id,email) WHERE status='pending';
CREATE TABLE staff_permissions (
  user_id text NOT NULL REFERENCES users(id),
  permission text NOT NULL CHECK(permission IN ('rights','warehouse','via','finance','support','audit')),
  PRIMARY KEY(user_id,permission)
);
INSERT INTO staff_permissions SELECT id,p FROM users CROSS JOIN
  unnest(ARRAY['rights','warehouse','via','finance','support','audit']) AS p WHERE is_staff;

ALTER TABLE intakes ADD COLUMN offer_version integer NOT NULL DEFAULT 1;
ALTER TABLE intakes ADD COLUMN accepted_offer_version integer;
ALTER TABLE intakes ADD COLUMN offer_expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days';
ALTER TABLE intakes ADD COLUMN offer_status text NOT NULL DEFAULT 'accepted'
  CHECK(offer_status IN ('accepted','awaiting_consent','declined'));
UPDATE intakes SET accepted_offer_version=1 WHERE kind='repool';
CREATE TABLE repool_offer_versions (
  intake_id text NOT NULL REFERENCES intakes(id), version integer NOT NULL CHECK(version>0),
  credit_units integer NOT NULL CHECK(credit_units>0),
  policy_version text NOT NULL DEFAULT 'demo-repool-v1',
  expires_at timestamptz NOT NULL, note text NOT NULL,
  created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(intake_id,version)
);
INSERT INTO repool_offer_versions(intake_id,version,credit_units,expires_at,note,created_by)
  SELECT id,1,offered_credits,offer_expires_at,'Original provisional demo buyback offer',user_id
  FROM intakes WHERE kind='repool';
CREATE TRIGGER immutable_repool_offer BEFORE UPDATE OR DELETE ON repool_offer_versions
  FOR EACH ROW EXECUTE FUNCTION deny_mutation();
