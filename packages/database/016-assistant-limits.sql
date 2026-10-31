-- Shared, bounded request budgets. No prompts, answers or search results are stored.
CREATE TABLE assistant_request_limits (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_started timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 12),
  lease_id text,
  lease_until timestamptz,
  CHECK ((lease_id IS NULL) = (lease_until IS NULL))
);
ALTER TABLE assistant_request_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_limit_actor ON assistant_request_limits
  USING (user_id = current_setting('pixup.actor_id', true) OR pixup_worker())
  WITH CHECK (user_id = current_setting('pixup.actor_id', true) OR pixup_worker());
