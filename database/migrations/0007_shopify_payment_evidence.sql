-- Payment-owned reconciliation evidence precedes accepted commerce projections.
ALTER TABLE bloombox.shopify_order_links ADD CONSTRAINT shopify_order_link_reference
  UNIQUE (purchase_intent_id, provider_scope, external_order_id);
CREATE TABLE bloombox.shopify_payment_evidence (
  purchase_intent_id uuid PRIMARY KEY,
  provider_scope text NOT NULL,
  external_order_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING', 'AUTHORIZED', 'PARTIALLY_PAID', 'CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED')),
  captured_minor bigint NOT NULL CHECK (captured_minor >= 0),
  refunded_minor bigint NOT NULL CHECK (refunded_minor >= 0 AND refunded_minor <= captured_minor),
  authorized_minor bigint NOT NULL CHECK (authorized_minor >= 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL,
  UNIQUE (provider_scope, external_order_id),
  FOREIGN KEY (purchase_intent_id, provider_scope, external_order_id)
    REFERENCES bloombox.shopify_order_links(purchase_intent_id, provider_scope, external_order_id) ON DELETE RESTRICT
);
REVOKE ALL ON bloombox.shopify_payment_evidence FROM PUBLIC;
