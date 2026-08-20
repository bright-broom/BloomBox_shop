CREATE UNIQUE INDEX financial_transactions_external_reference_uidx
  ON bloombox.financial_transactions (transaction_type, external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX webhook_inbox_object_idx
  ON bloombox.webhook_inbox (commerce_provider, external_object_id, received_at DESC)
  WHERE external_object_id IS NOT NULL;

ALTER TABLE bloombox.orders
  ADD COLUMN included_tax_minor bigint NOT NULL DEFAULT 0 CHECK (included_tax_minor >= 0);

ALTER TABLE bloombox.audit_logs
  ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX audit_logs_idempotency_uidx
  ON bloombox.audit_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE bloombox.webhook_inbox
  ALTER COLUMN payload_key_id DROP NOT NULL,
  ALTER COLUMN payload_ciphertext DROP NOT NULL,
  ADD COLUMN provider_occurred_at timestamptz,
  ADD COLUMN payload_purged_at timestamptz,
  ADD CONSTRAINT webhook_inbox_payload_retention_consistent CHECK (
    (payload_purged_at IS NULL AND payload_key_id IS NOT NULL AND payload_ciphertext IS NOT NULL)
    OR
    (payload_purged_at IS NOT NULL AND payload_key_id IS NULL AND payload_ciphertext IS NULL)
  );

UPDATE bloombox.webhook_inbox
SET provider_occurred_at = received_at
WHERE provider_occurred_at IS NULL;

ALTER TABLE bloombox.webhook_inbox
  ALTER COLUMN provider_occurred_at SET NOT NULL;

ALTER TABLE bloombox.purchase_intents
  ALTER COLUMN pii_key_id DROP NOT NULL,
  ALTER COLUMN recipient_ciphertext DROP NOT NULL,
  ALTER COLUMN gift_message_ciphertext DROP NOT NULL,
  ADD COLUMN pii_purged_at timestamptz,
  ADD CONSTRAINT purchase_intents_pii_retention_consistent CHECK (
    (
      pii_purged_at IS NULL
      AND pii_key_id IS NOT NULL
      AND recipient_ciphertext IS NOT NULL
      AND gift_message_ciphertext IS NOT NULL
    )
    OR
    (
      pii_purged_at IS NOT NULL
      AND pii_key_id IS NULL
      AND recipient_ciphertext IS NULL
      AND gift_message_ciphertext IS NULL
      AND status IN ('CONVERTED', 'EXPIRED', 'ABANDONED')
    )
  );
