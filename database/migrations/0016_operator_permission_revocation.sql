-- Distinct management authority; no seeded managers or automatic grants.
CREATE TABLE bloombox.fulfillment_permission_managers (
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
CREATE FUNCTION bloombox.protect_fulfillment_manager() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Permission manager history must be retained' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.provider_scope IS DISTINCT FROM OLD.provider_scope OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at) THEN
    RAISE EXCEPTION 'Permission manager identity and revision are protected' USING ERRCODE = '23514';
  END IF;
  INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
    VALUES (gen_random_uuid(), 'SYSTEM', 'fulfillment.permission_manager.revised', 'FulfillmentPermissionManager', NEW.id,
      jsonb_build_object('operatorId', NEW.operator_id, 'shop', NEW.provider_scope, 'enabled', NEW.enabled,
        'version', NEW.version, 'validUntil', NEW.valid_until), clock_timestamp());
  RETURN NEW;
END;
$$;
CREATE TRIGGER fulfillment_manager_protected BEFORE INSERT OR UPDATE OR DELETE ON bloombox.fulfillment_permission_managers
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_fulfillment_manager();

CREATE TABLE bloombox.fulfillment_permission_revocations (
  id uuid PRIMARY KEY,
  permission_id uuid NOT NULL REFERENCES bloombox.fulfillment_operator_permissions(id) ON DELETE RESTRICT,
  previous_version bigint NOT NULL CHECK (previous_version > 0),
  version bigint NOT NULL CHECK (version = previous_version + 1),
  manager_id uuid NOT NULL REFERENCES bloombox.fulfillment_permission_managers(id) ON DELETE RESTRICT,
  manager_version bigint NOT NULL CHECK (manager_version > 0),
  operator_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('ACCESS_NO_LONGER_REQUIRED', 'ROLE_CHANGE', 'SECURITY_RESPONSE')),
  revoked_at timestamptz NOT NULL CHECK (isfinite(revoked_at)),
  UNIQUE (permission_id, previous_version),
  UNIQUE (operator_id, idempotency_key)
);
CREATE FUNCTION bloombox.prevent_permission_revocation_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Permission revocation receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER permission_revocation_immutable BEFORE UPDATE OR DELETE ON bloombox.fulfillment_permission_revocations
  FOR EACH ROW EXECUTE FUNCTION bloombox.prevent_permission_revocation_change();

-- The manager credential cannot create/enable permissions or alter their scope/expiry.
-- Application authorization and actor-attributed audit wrap this narrow write in one transaction.
CREATE FUNCTION bloombox.disable_fulfillment_permission(target_id uuid, expected_version bigint)
  RETURNS TABLE (id uuid, version bigint, updated_at timestamptz)
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE bloombox.fulfillment_operator_permissions AS permission
      SET enabled = false, version = permission.version + 1,
          updated_at = greatest(clock_timestamp(), permission.updated_at)
      WHERE permission.id = target_id AND permission.version = expected_version AND permission.enabled
      RETURNING permission.id, permission.version, permission.updated_at;
  $$;
REVOKE ALL ON bloombox.fulfillment_permission_managers, bloombox.fulfillment_permission_revocations FROM PUBLIC;
REVOKE ALL ON FUNCTION bloombox.disable_fulfillment_permission(uuid, bigint),
  bloombox.protect_fulfillment_manager(), bloombox.prevent_permission_revocation_change() FROM PUBLIC;
