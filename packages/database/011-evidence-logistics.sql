CREATE TABLE stored_files (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id), client_key text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('artwork','intake','rights','shipment','incident')),
  asset_id text REFERENCES assets(id), collection_id text REFERENCES collections(id),
  mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp','application/pdf')),
  size integer NOT NULL CHECK(size BETWEEN 1 AND 10485760), hash text NOT NULL,
  store text NOT NULL CHECK(store IN ('database','s3')), object_key text UNIQUE NOT NULL,
  data bytea, preview_key text, preview_data bytea,
  state text NOT NULL DEFAULT 'awaiting_upload' CHECK(state IN ('awaiting_upload','pending_scan','scan_failed','blocked','pending_review','approved','rejected','purging','purged')),
  scan_version integer NOT NULL DEFAULT 0, scanned_at timestamptz, scan_engine text, error_code text,
  reviewed_by text REFERENCES users(id), review_note text, reviewed_at timestamptz,
  legal_hold boolean NOT NULL DEFAULT false, retain_until timestamptz NOT NULL DEFAULT now()+interval '30 days',
  created_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz,
  UNIQUE(owner_id,client_key), CHECK(NOT (asset_id IS NOT NULL AND collection_id IS NOT NULL)),
  CHECK(purpose='artwork' OR asset_id IS NOT NULL OR collection_id IS NOT NULL)
);
CREATE INDEX stored_files_queue ON stored_files(state,checked_at);
CREATE FUNCTION freeze_file_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.owner_id,NEW.client_key,NEW.purpose,NEW.asset_id,NEW.collection_id,NEW.mime,NEW.size,NEW.hash,NEW.store,NEW.object_key,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.owner_id,OLD.client_key,OLD.purpose,OLD.asset_id,OLD.collection_id,OLD.mime,OLD.size,OLD.hash,OLD.store,OLD.object_key,OLD.created_at)
 THEN RAISE EXCEPTION 'File identity is immutable'; END IF;
 IF NEW.retain_until < OLD.retain_until THEN RAISE EXCEPTION 'Retention cannot be shortened'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER file_identity BEFORE UPDATE ON stored_files FOR EACH ROW EXECUTE FUNCTION freeze_file_identity();
CREATE TRIGGER file_history BEFORE DELETE ON stored_files FOR EACH ROW EXECUTE FUNCTION deny_mutation();
ALTER TABLE media ALTER COLUMN data DROP NOT NULL;
ALTER TABLE media ADD COLUMN file_id text UNIQUE REFERENCES stored_files(id);

CREATE TABLE physical_captures (
  id text PRIMARY KEY, intake_id text UNIQUE NOT NULL REFERENCES intakes(id), asset_id text NOT NULL REFERENCES assets(id),
  captured_by text NOT NULL REFERENCES users(id), expected_serial text NOT NULL,
  observed_serial text NOT NULL, seal text UNIQUE NOT NULL, bin text NOT NULL,
  front_file text NOT NULL REFERENCES stored_files(id), back_file text NOT NULL REFERENCES stored_files(id),
  note text NOT NULL, label_code text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(front_file<>back_file)
);
CREATE TRIGGER immutable_capture BEFORE UPDATE OR DELETE ON physical_captures FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TABLE physical_incidents (
  id text PRIMARY KEY, asset_id text NOT NULL REFERENCES assets(id), order_id text REFERENCES orders(id),
  kind text NOT NULL CHECK(kind IN ('loss','damage','identity_mismatch')), reporter_id text NOT NULL REFERENCES users(id),
  evidence_id text NOT NULL REFERENCES stored_files(id), note text NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')), version integer NOT NULL DEFAULT 1,
  resolution text, resolved_by text REFERENCES users(id), resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shipments (
  id text PRIMARY KEY, order_id text UNIQUE NOT NULL REFERENCES orders(id), asset_id text NOT NULL REFERENCES assets(id),
  created_by text NOT NULL REFERENCES users(id), provider text NOT NULL CHECK(provider='simulator'),
  label_code text UNIQUE NOT NULL, seal text NOT NULL, evidence_id text NOT NULL REFERENCES stored_files(id),
  state text NOT NULL DEFAULT 'label_created' CHECK(state IN ('label_created','in_transit','delivered','exception','returned')),
  sequence integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shipment_events (
  id text PRIMARY KEY, shipment_id text NOT NULL REFERENCES shipments(id), client_key text NOT NULL,
  sequence integer NOT NULL, kind text NOT NULL CHECK(kind IN ('dispatched','delivered','loss','damage','returned')),
  evidence_id text NOT NULL REFERENCES stored_files(id), actor_id text NOT NULL REFERENCES users(id),
  note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shipment_id,client_key), UNIQUE(shipment_id,sequence)
);
CREATE TRIGGER immutable_shipment_event BEFORE UPDATE OR DELETE ON shipment_events FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION freeze_incident_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.asset_id,NEW.order_id,NEW.kind,NEW.reporter_id,NEW.evidence_id,NEW.note,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.asset_id,OLD.order_id,OLD.kind,OLD.reporter_id,OLD.evidence_id,OLD.note,OLD.created_at)
 THEN RAISE EXCEPTION 'Incident report is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER incident_identity BEFORE UPDATE ON physical_incidents FOR EACH ROW EXECUTE FUNCTION freeze_incident_identity();
CREATE TRIGGER incident_history BEFORE DELETE ON physical_incidents FOR EACH ROW EXECUTE FUNCTION deny_mutation();
