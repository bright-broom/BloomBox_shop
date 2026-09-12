-- Fulfillment-owned local intake. A HELD intake never authorizes preparation or dispatch.
CREATE TABLE bloombox.shopify_fulfillment_intakes (
  fulfillment_id uuid PRIMARY KEY REFERENCES bloombox.fulfillments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL UNIQUE REFERENCES bloombox.orders(id) ON DELETE RESTRICT,
  purchase_intent_id uuid NOT NULL UNIQUE,
  provider_scope text NOT NULL,
  external_order_id text NOT NULL,
  payment_evidence_version integer NOT NULL CHECK (payment_evidence_version > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  decision text NOT NULL CHECK (decision IN ('HELD', 'CANCELLED')),
  observed_status text NOT NULL CHECK (observed_status IN ('UNFULFILLED', 'SCHEDULED', 'PROCESSING', 'READY', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z_]{1,64}$'),
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (purchase_intent_id, provider_scope, external_order_id)
    REFERENCES bloombox.shopify_order_links(purchase_intent_id, provider_scope, external_order_id) ON DELETE RESTRICT,
  UNIQUE (provider_scope, external_order_id)
);
CREATE FUNCTION bloombox.protect_shopify_fulfillment_intake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Fulfillment intake history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.fulfillment_id, NEW.order_id, NEW.purchase_intent_id, NEW.provider_scope, NEW.external_order_id)
    IS DISTINCT FROM ROW(OLD.fulfillment_id, OLD.order_id, OLD.purchase_intent_id, OLD.provider_scope, OLD.external_order_id)
    OR NEW.version <> OLD.version + 1 OR NEW.payment_evidence_version < OLD.payment_evidence_version THEN
    RAISE EXCEPTION 'Fulfillment intake identity and versions are protected' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shopify_fulfillment_intake_protected BEFORE UPDATE OR DELETE ON bloombox.shopify_fulfillment_intakes
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_shopify_fulfillment_intake();
REVOKE ALL ON bloombox.shopify_fulfillment_intakes FROM PUBLIC;
REVOKE ALL ON FUNCTION bloombox.protect_shopify_fulfillment_intake() FROM PUBLIC;
