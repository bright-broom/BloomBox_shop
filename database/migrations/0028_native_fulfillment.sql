-- Shared security grants are explicitly provisioned; no existing operator is enrolled.
CREATE TABLE bloombox.native_fulfillment_operators (
  operator_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  valid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (valid_until > created_at)
);
CREATE FUNCTION bloombox.lock_native_fulfillment_operator(actor uuid)
RETURNS SETOF bloombox.native_fulfillment_operators
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, bloombox AS $$
  SELECT * FROM bloombox.native_fulfillment_operators WHERE operator_id = actor FOR SHARE;
$$;
REVOKE ALL ON FUNCTION bloombox.lock_native_fulfillment_operator(uuid) FROM PUBLIC;

ALTER TABLE bloombox.fulfillments DROP CONSTRAINT fulfillments_status_check;
ALTER TABLE bloombox.fulfillments ADD CONSTRAINT fulfillments_status_check
  CHECK (status IN ('UNFULFILLED','SCHEDULED','PROCESSING','READY','ON_HOLD','SHIPPED','DELIVERED','CANCELLED','RETURNED'));
ALTER TABLE bloombox.fulfillment_status_transitions DROP CONSTRAINT fulfillment_status_transitions_from_status_check;
ALTER TABLE bloombox.fulfillment_status_transitions ADD CONSTRAINT fulfillment_status_transitions_from_status_check
  CHECK (from_status IS NULL OR from_status IN ('UNFULFILLED','SCHEDULED','PROCESSING','READY','ON_HOLD','SHIPPED','DELIVERED','CANCELLED','RETURNED'));
ALTER TABLE bloombox.fulfillment_status_transitions DROP CONSTRAINT fulfillment_status_transitions_to_status_check;
ALTER TABLE bloombox.fulfillment_status_transitions ADD CONSTRAINT fulfillment_status_transitions_to_status_check
  CHECK (to_status IN ('UNFULFILLED','SCHEDULED','PROCESSING','READY','ON_HOLD','SHIPPED','DELIVERED','CANCELLED','RETURNED'));

-- Stop safely if legacy duplicate shipments exist. Never delete accepted shipment facts to migrate.
ALTER TABLE bloombox.shipments ADD CONSTRAINT shipments_one_per_fulfillment UNIQUE (fulfillment_id);
-- Preserve historical carrier formats, while rejecting invalid new/changed shipment records.
ALTER TABLE bloombox.shipments ADD CONSTRAINT shipments_native_carrier_check
  CHECK (carrier_code IN ('YAMATO','SAGAWA','JAPAN_POST')) NOT VALID;
ALTER TABLE bloombox.shipments ADD CONSTRAINT shipments_tracking_reference_check
  CHECK (tracking_reference ~ '^[A-Z0-9]{8,32}$') NOT VALID;

CREATE TABLE bloombox.native_fulfillment_changes (
  operator_id uuid NOT NULL,
  request_id uuid NOT NULL,
  fulfillment_id uuid NOT NULL REFERENCES bloombox.fulfillments(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('START_PREPARATION','MARK_READY','HOLD','RESUME','CANCEL','SHIP','CORRECT_TRACKING','MARK_DELIVERED')),
  from_status text NOT NULL CHECK (from_status IN ('UNFULFILLED','SCHEDULED','PROCESSING','READY','ON_HOLD','SHIPPED','DELIVERED','CANCELLED','RETURNED')),
  to_status text NOT NULL CHECK (to_status IN ('UNFULFILLED','SCHEDULED','PROCESSING','READY','ON_HOLD','SHIPPED','DELIVERED','CANCELLED','RETURNED')),
  previous_version bigint NOT NULL CHECK (previous_version > 0),
  version bigint NOT NULL CHECK (version = previous_version + 1),
  command jsonb NOT NULL CHECK (jsonb_typeof(command) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operator_id, request_id),
  UNIQUE (fulfillment_id, version)
);
CREATE TABLE bloombox.native_fulfillment_accesses (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL,
  fulfillment_id uuid NOT NULL REFERENCES bloombox.fulfillments(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX native_fulfillment_accesses_subject_idx
  ON bloombox.native_fulfillment_accesses (fulfillment_id, occurred_at DESC);
CREATE FUNCTION bloombox.reject_native_fulfillment_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, bloombox AS $$
BEGIN
  RAISE EXCEPTION 'Native fulfillment audit is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER native_fulfillment_changes_immutable BEFORE UPDATE OR DELETE
  ON bloombox.native_fulfillment_changes FOR EACH ROW EXECUTE FUNCTION bloombox.reject_native_fulfillment_audit_mutation();
CREATE TRIGGER native_fulfillment_accesses_immutable BEFORE UPDATE OR DELETE
  ON bloombox.native_fulfillment_accesses FOR EACH ROW EXECUTE FUNCTION bloombox.reject_native_fulfillment_audit_mutation();
