-- Legacy rows retain NULL: absence of item-level tax evidence is not proof of zero tax.
ALTER TABLE bloombox.order_items ADD COLUMN included_tax_minor bigint
  CHECK (included_tax_minor IS NULL OR (included_tax_minor >= 0 AND included_tax_minor <= line_total_minor
    AND (included_tax_minor = 0 OR tax_minor = 0)));

CREATE TABLE bloombox.shopify_order_acceptances (
  order_id uuid PRIMARY KEY REFERENCES bloombox.orders(id) ON DELETE RESTRICT,
  purchase_intent_id uuid NOT NULL UNIQUE,
  provider_scope text NOT NULL,
  external_order_id text NOT NULL,
  payment_evidence_version integer NOT NULL CHECK (payment_evidence_version > 0),
  source_updated_at timestamptz NOT NULL,
  price_snapshot jsonb NOT NULL CHECK (jsonb_typeof(price_snapshot) = 'object'),
  accepted_at timestamptz NOT NULL,
  FOREIGN KEY (purchase_intent_id, provider_scope, external_order_id)
    REFERENCES bloombox.shopify_order_links(purchase_intent_id, provider_scope, external_order_id) ON DELETE RESTRICT,
  UNIQUE (provider_scope, external_order_id)
);
CREATE FUNCTION bloombox.prevent_shopify_acceptance_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shopify acceptance receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER shopify_acceptance_immutable BEFORE UPDATE OR DELETE ON bloombox.shopify_order_acceptances
  FOR EACH ROW EXECUTE FUNCTION bloombox.prevent_shopify_acceptance_change();
REVOKE ALL ON bloombox.shopify_order_acceptances FROM PUBLIC;
REVOKE ALL ON FUNCTION bloombox.prevent_shopify_acceptance_change() FROM PUBLIC;
