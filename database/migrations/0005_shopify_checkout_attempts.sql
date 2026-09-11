-- No Shopify cart capability may be written to the legacy plaintext reference.
-- This intentionally refuses legacy Shopify references instead of silently discarding them.
ALTER TABLE bloombox.purchase_intents ADD CONSTRAINT shopify_checkout_reference_private
  CHECK (commerce_provider IS DISTINCT FROM 'SHOPIFY' OR external_checkout_id IS NULL);

ALTER TABLE bloombox.purchase_intents DROP CONSTRAINT purchase_intents_checkout_fields_consistent;
ALTER TABLE bloombox.purchase_intents ADD CONSTRAINT purchase_intents_checkout_fields_consistent CHECK (
  (status IN ('DRAFT', 'READY_FOR_CHECKOUT') AND external_checkout_id IS NULL
    AND provider_api_version IS NULL AND checkout_created_at IS NULL)
  OR
  (status IN ('CHECKOUT_CREATED', 'CONVERTED', 'EXPIRED', 'ABANDONED')
    AND commerce_provider IS NOT NULL AND provider_api_version IS NOT NULL AND checkout_created_at IS NOT NULL
    AND (external_checkout_id IS NOT NULL OR commerce_provider = 'SHOPIFY'))
  OR
  (status IN ('EXPIRED', 'ABANDONED') AND external_checkout_id IS NULL
    AND provider_api_version IS NULL AND checkout_created_at IS NULL)
);

CREATE FUNCTION bloombox.prevent_commerce_provider_switch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.commerce_provider IS NOT NULL AND NEW.commerce_provider IS DISTINCT FROM OLD.commerce_provider THEN
    RAISE EXCEPTION 'Commerce provider is already selected' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_intent_provider_sticky BEFORE UPDATE ON bloombox.purchase_intents
  FOR EACH ROW EXECUTE FUNCTION bloombox.prevent_commerce_provider_switch();

CREATE TABLE bloombox.shopify_checkout_attempts (
  purchase_intent_id uuid PRIMARY KEY REFERENCES bloombox.purchase_intents(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL UNIQUE,
  provider_scope text NOT NULL CHECK (length(provider_scope) BETWEEN 1 AND 255),
  status text NOT NULL CHECK (status IN ('CREATING', 'UNKNOWN', 'READY')),
  credential_key_id text,
  credential_ciphertext bytea,
  api_version text,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= started_at),
  CHECK (
    (status IN ('CREATING', 'UNKNOWN') AND credential_key_id IS NULL AND credential_ciphertext IS NULL AND api_version IS NULL)
    OR (status = 'READY' AND length(credential_key_id) > 0 AND credential_key_id IS NOT NULL
      AND credential_ciphertext IS NOT NULL AND octet_length(credential_ciphertext) BETWEEN 30 AND 200000
      AND api_version IS NOT NULL AND length(api_version) > 0)
  )
);
CREATE INDEX shopify_checkout_attempts_unresolved_idx
  ON bloombox.shopify_checkout_attempts(status, started_at) WHERE status IN ('CREATING', 'UNKNOWN');
REVOKE ALL ON bloombox.shopify_checkout_attempts FROM PUBLIC;
