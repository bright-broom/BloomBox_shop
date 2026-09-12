-- Retry receipts authorize idempotent recovery and cannot be forged by runtime audit writers.
CREATE FUNCTION bloombox.protect_webhook_retry_audit() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.action = 'payment.webhook.retry_requested' THEN
      RAISE EXCEPTION 'Webhook retry audit is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.action = 'payment.webhook.retry_requested' OR NEW.action = 'payment.webhook.retry_requested' THEN
      RAISE EXCEPTION 'Webhook retry audit is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.action = 'payment.webhook.retry_requested' THEN
    IF NOT pg_catalog.pg_has_role(current_user, (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'bloombox'), 'USAGE') THEN
      RAISE EXCEPTION 'Webhook retry audit requires schema ownership' USING ERRCODE = '42501';
    END IF;
    IF NEW.actor_type <> 'SYSTEM' OR NEW.actor_reference IS DISTINCT FROM 'webhook-retry' OR NEW.resource_type <> 'WebhookInbox' THEN
      RAISE EXCEPTION 'Webhook retry audit attribution is protected' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER webhook_retry_audit_protected BEFORE INSERT OR UPDATE OR DELETE ON bloombox.audit_logs
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_webhook_retry_audit();
REVOKE ALL ON FUNCTION bloombox.protect_webhook_retry_audit() FROM PUBLIC;

-- Workers need ordinary Inbox updates, but cannot bypass owner-reviewed recovery of exhausted work.
CREATE FUNCTION bloombox.protect_failed_webhook_retry() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.status = 'FAILED' AND NEW.status <> 'FAILED' THEN
    IF NOT (SELECT pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE')
        AND pg_catalog.pg_has_role(current_user, n.nspowner, 'USAGE')
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = TG_RELID) THEN
      RAISE EXCEPTION 'Failed webhook recovery requires ownership' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER webhook_failed_retry_protected BEFORE UPDATE ON bloombox.webhook_inbox
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_failed_webhook_retry();
REVOKE ALL ON FUNCTION bloombox.protect_failed_webhook_retry() FROM PUBLIC;
