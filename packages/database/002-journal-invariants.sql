CREATE FUNCTION check_line_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint;
BEGIN SELECT COALESCE(SUM(amount),0) INTO total FROM journal_lines WHERE entry_id=NEW.entry_id;
IF total<>0 THEN RAISE EXCEPTION 'Journal lines must balance'; END IF;
RETURN NEW; END; $$;
CREATE CONSTRAINT TRIGGER balanced_lines AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_line_balance();
CREATE UNIQUE INDEX one_active_certificate ON certificates(asset_id) WHERE status='active';
