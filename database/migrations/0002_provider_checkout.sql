ALTER TABLE bloombox.purchase_intents
  ADD COLUMN provider_api_version text,
  ADD COLUMN checkout_created_at timestamptz;

ALTER TABLE bloombox.purchase_intents
  ADD CONSTRAINT purchase_intents_checkout_fields_consistent CHECK (
    (
      status IN ('DRAFT', 'READY_FOR_CHECKOUT')
      AND external_checkout_id IS NULL
      AND provider_api_version IS NULL
      AND checkout_created_at IS NULL
    )
    OR
    (
      status IN ('CHECKOUT_CREATED', 'CONVERTED')
      AND commerce_provider IS NOT NULL
      AND external_checkout_id IS NOT NULL
      AND provider_api_version IS NOT NULL
      AND checkout_created_at IS NOT NULL
    )
    OR
    (
      status IN ('EXPIRED', 'ABANDONED')
      AND (
        (
          external_checkout_id IS NULL
          AND provider_api_version IS NULL
          AND checkout_created_at IS NULL
        )
        OR
        (
          commerce_provider IS NOT NULL
          AND external_checkout_id IS NOT NULL
          AND provider_api_version IS NOT NULL
          AND checkout_created_at IS NOT NULL
        )
      )
    )
  );

CREATE INDEX purchase_intents_provider_status_idx
  ON bloombox.purchase_intents (commerce_provider, status, checkout_created_at)
  WHERE commerce_provider IS NOT NULL;
