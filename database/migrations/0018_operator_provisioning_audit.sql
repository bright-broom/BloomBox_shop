-- Provisioning receipts share the audit store but must not be forgeable by runtime audit writers.
CREATE FUNCTION bloombox.protect_operator_provisioning_audit() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.action = 'fulfillment.operator_access.provisioned' THEN
      RAISE EXCEPTION 'Operator provisioning audit is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.action = 'fulfillment.operator_access.provisioned' OR NEW.action = 'fulfillment.operator_access.provisioned' THEN
      RAISE EXCEPTION 'Operator provisioning audit is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.action = 'fulfillment.operator_access.provisioned' THEN
    IF NOT pg_catalog.pg_has_role(current_user, (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'bloombox'), 'USAGE') THEN
      RAISE EXCEPTION 'Operator provisioning audit requires schema ownership' USING ERRCODE = '42501';
    END IF;
    IF NEW.actor_type <> 'SYSTEM' OR NEW.actor_reference IS DISTINCT FROM 'operator-access-provisioning' THEN
      RAISE EXCEPTION 'Operator provisioning audit attribution is protected' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operator_provisioning_audit_protected BEFORE INSERT OR UPDATE OR DELETE ON bloombox.audit_logs
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_operator_provisioning_audit();
REVOKE ALL ON FUNCTION bloombox.protect_operator_provisioning_audit() FROM PUBLIC;
