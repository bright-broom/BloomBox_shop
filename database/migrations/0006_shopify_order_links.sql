-- Existing READY attempts deliberately remain unindexed until their encrypted cart is verified again.
ALTER TABLE bloombox.shopify_checkout_attempts
  ADD COLUMN cart_token_digest text,
  ADD CONSTRAINT shopify_cart_digest_valid CHECK (
    cart_token_digest IS NULL OR (status = 'READY' AND cart_token_digest ~ '^[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT shopify_attempt_identity UNIQUE (purchase_intent_id, attempt_id, provider_scope);
CREATE UNIQUE INDEX shopify_attempt_cart_identity
  ON bloombox.shopify_checkout_attempts(provider_scope, cart_token_digest)
  WHERE cart_token_digest IS NOT NULL;

CREATE FUNCTION bloombox.prevent_shopify_cart_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cart_token_digest IS NOT NULL AND NEW.cart_token_digest IS DISTINCT FROM OLD.cart_token_digest THEN
    RAISE EXCEPTION 'Shopify cart identity cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shopify_cart_identity_sticky BEFORE UPDATE ON bloombox.shopify_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION bloombox.prevent_shopify_cart_identity_change();

CREATE TABLE bloombox.shopify_order_links (
  purchase_intent_id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL,
  provider_scope text NOT NULL,
  external_order_id text NOT NULL CHECK (external_order_id ~ '^gid://shopify/Order/[1-9][0-9]*$' AND length(external_order_id) <= 100),
  provider_api_version text NOT NULL CHECK (provider_api_version ~ '^[0-9]{4}-[0-9]{2}$'),
  linked_at timestamptz NOT NULL,
  UNIQUE (provider_scope, external_order_id),
  FOREIGN KEY (purchase_intent_id, attempt_id, provider_scope)
    REFERENCES bloombox.shopify_checkout_attempts(purchase_intent_id, attempt_id, provider_scope) ON DELETE RESTRICT
);
CREATE FUNCTION bloombox.prevent_shopify_order_link_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shopify order links are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER shopify_order_link_immutable BEFORE UPDATE OR DELETE ON bloombox.shopify_order_links
  FOR EACH ROW EXECUTE FUNCTION bloombox.prevent_shopify_order_link_change();
REVOKE ALL ON bloombox.shopify_order_links FROM PUBLIC;
REVOKE ALL ON FUNCTION bloombox.prevent_shopify_cart_identity_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION bloombox.prevent_shopify_order_link_change() FROM PUBLIC;
