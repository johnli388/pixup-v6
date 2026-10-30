-- Run after migrations using a trusted database administrator on the selected database.
-- Does not create login credentials or grant login roles automatically.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pixup_runtime') THEN CREATE ROLE pixup_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pixup_worker') THEN CREATE ROLE pixup_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO pixup_runtime,pixup_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO pixup_runtime,pixup_worker;
REVOKE INSERT,UPDATE,DELETE ON migrations FROM pixup_runtime,pixup_worker;
REVOKE UPDATE,DELETE ON journal_entries,journal_lines,provenance_events,assessments,payment_reconciliations FROM pixup_runtime,pixup_worker;
REVOKE UPDATE,DELETE ON commercial_policy_versions FROM pixup_runtime,pixup_worker;
REVOKE DELETE ON commercial_decisions,commercial_policy_current FROM pixup_runtime,pixup_worker;
GRANT EXECUTE ON FUNCTION pixup_member(text,text[]),pixup_staff(),pixup_email(),pixup_worker() TO pixup_runtime,pixup_worker;
-- Triggers retain their migration-owner function permissions. No DDL, TRUNCATE,
-- role administration, BYPASSRLS or schema ownership is granted to these roles.
-- Grant exactly one of these group roles to each separately provisioned LOGIN.
-- Never grant the worker or migration-owner role to the API LOGIN.
