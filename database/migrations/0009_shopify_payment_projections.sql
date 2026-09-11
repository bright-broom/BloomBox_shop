-- Payment owns this mapping and the version of settlement evidence mirrored into an accepted order.
CREATE TABLE bloombox.shopify_payment_projections (
  payment_id uuid PRIMARY KEY REFERENCES bloombox.payments(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL UNIQUE REFERENCES bloombox.orders(id) ON DELETE RESTRICT,
  purchase_intent_id uuid NOT NULL UNIQUE,
  provider_scope text NOT NULL,
  external_order_id text NOT NULL,
  evidence_version integer NOT NULL CHECK (evidence_version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (purchase_intent_id, provider_scope, external_order_id)
    REFERENCES bloombox.shopify_order_links(purchase_intent_id, provider_scope, external_order_id) ON DELETE RESTRICT,
  UNIQUE (provider_scope, external_order_id)
);
CREATE FUNCTION bloombox.protect_shopify_payment_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment projections cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.payment_id, NEW.order_id, NEW.purchase_intent_id, NEW.provider_scope, NEW.external_order_id)
    IS DISTINCT FROM ROW(OLD.payment_id, OLD.order_id, OLD.purchase_intent_id, OLD.provider_scope, OLD.external_order_id)
    OR NEW.evidence_version <= OLD.evidence_version THEN
    RAISE EXCEPTION 'Payment projection identity and versions are protected' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shopify_payment_projection_protected BEFORE UPDATE OR DELETE ON bloombox.shopify_payment_projections
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_shopify_payment_projection();
CREATE UNIQUE INDEX shopify_financial_transaction_reference ON bloombox.financial_transactions (payment_id, external_reference)
  WHERE transaction_type IN ('SHOPIFY_CAPTURE', 'SHOPIFY_REFUND');
REVOKE ALL ON bloombox.shopify_payment_projections FROM PUBLIC;
REVOKE ALL ON FUNCTION bloombox.protect_shopify_payment_projection() FROM PUBLIC;
