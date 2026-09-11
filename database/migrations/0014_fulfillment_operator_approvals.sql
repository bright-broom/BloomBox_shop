-- Fulfillment owns the permission and decision. Neither is a shipment instruction.
CREATE TABLE bloombox.fulfillment_operator_permissions (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL,
  provider_scope text NOT NULL CHECK (provider_scope ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  enabled boolean NOT NULL,
  valid_until timestamptz NOT NULL CHECK (isfinite(valid_until)),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (operator_id, provider_scope),
  CHECK (valid_until > created_at)
);
CREATE FUNCTION bloombox.protect_fulfillment_permission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Operator permission history must be retained' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.provider_scope IS DISTINCT FROM OLD.provider_scope OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at) THEN
    RAISE EXCEPTION 'Operator permission identity and revision are protected' USING ERRCODE = '23514';
  END IF;
  INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
    VALUES (gen_random_uuid(), 'SYSTEM', 'fulfillment.operator_permission.revised', 'FulfillmentPermission', NEW.id,
      jsonb_build_object('operatorId', NEW.operator_id, 'shop', NEW.provider_scope, 'enabled', NEW.enabled,
        'version', NEW.version, 'validUntil', NEW.valid_until), clock_timestamp());
  RETURN NEW;
END;
$$;
CREATE TRIGGER fulfillment_permission_protected BEFORE INSERT OR UPDATE OR DELETE ON bloombox.fulfillment_operator_permissions
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_fulfillment_permission();

CREATE TABLE bloombox.fulfillment_operator_approvals (
  id uuid PRIMARY KEY,
  fulfillment_id uuid NOT NULL REFERENCES bloombox.shopify_fulfillment_intakes(fulfillment_id) ON DELETE RESTRICT,
  intake_version bigint NOT NULL CHECK (intake_version > 0),
  payment_evidence_version integer NOT NULL CHECK (payment_evidence_version > 0),
  permission_id uuid NOT NULL REFERENCES bloombox.fulfillment_operator_permissions(id) ON DELETE RESTRICT,
  permission_version bigint NOT NULL CHECK (permission_version > 0),
  operator_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  CHECK (expires_at > approved_at),
  UNIQUE (operator_id, idempotency_key),
  UNIQUE (fulfillment_id, intake_version)
);
CREATE FUNCTION bloombox.prevent_fulfillment_approval_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Operator approval receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER fulfillment_approval_immutable BEFORE UPDATE OR DELETE ON bloombox.fulfillment_operator_approvals
  FOR EACH ROW EXECUTE FUNCTION bloombox.prevent_fulfillment_approval_change();

-- PostgreSQL row locks require an UPDATE privilege. Grant only immutable keys,
-- never business columns, to the approval connection (see roles.sql).
CREATE FUNCTION bloombox.protect_approval_lock_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF to_jsonb(NEW)->TG_ARGV[0] IS DISTINCT FROM to_jsonb(OLD)->TG_ARGV[0] THEN
    RAISE EXCEPTION 'Commerce identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_approval_lock_key BEFORE UPDATE OF id ON bloombox.orders
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_approval_lock_key('id');
CREATE TRIGGER gift_approval_lock_key BEFORE UPDATE OF order_id ON bloombox.order_gift_snapshots
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_approval_lock_key('order_id');
CREATE TRIGGER payment_approval_lock_key BEFORE UPDATE OF id ON bloombox.payments
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_approval_lock_key('id');
CREATE TRIGGER fulfillment_approval_lock_key BEFORE UPDATE OF id ON bloombox.fulfillments
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_approval_lock_key('id');
REVOKE ALL ON bloombox.fulfillment_operator_permissions, bloombox.fulfillment_operator_approvals FROM PUBLIC;
REVOKE ALL ON FUNCTION bloombox.protect_fulfillment_permission(), bloombox.prevent_fulfillment_approval_change(), bloombox.protect_approval_lock_key() FROM PUBLIC;
