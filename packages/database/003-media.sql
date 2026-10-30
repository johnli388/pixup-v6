CREATE TABLE media (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id),
  mime text NOT NULL CHECK(mime='image/webp'), data bytea NOT NULL,
  width integer NOT NULL, height integer NOT NULL, hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_owner ON media(owner_id);
