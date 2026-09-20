-- Orders keep amounts, identifiers and states for accounting; the gift's personal data is removed on a schedule (P0-17).
ALTER TABLE bloombox.order_gift_snapshots
  ALTER COLUMN pii_key_id DROP NOT NULL,
  ALTER COLUMN recipient_ciphertext DROP NOT NULL,
  ALTER COLUMN gift_message_ciphertext DROP NOT NULL,
  ADD COLUMN pii_purged_at timestamptz,
  ADD CONSTRAINT order_gift_pii_retention_consistent CHECK (
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
      AND address_ciphertext IS NULL
      AND gift_message_ciphertext IS NULL
    )
  );

-- Native orders were stored without a retention date. Derive it from the delivery date they already carry.
UPDATE bloombox.order_gift_snapshots
SET retention_expires_at = (delivery_date + 180)::timestamptz
WHERE retention_expires_at IS NULL;

CREATE INDEX order_gift_snapshots_retention_idx
  ON bloombox.order_gift_snapshots (retention_expires_at)
  WHERE pii_purged_at IS NULL;
