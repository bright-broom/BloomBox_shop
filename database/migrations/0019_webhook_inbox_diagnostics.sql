-- Supports bounded oldest-first metadata diagnostics without scanning completed history.
CREATE INDEX webhook_inbox_diagnostic_scope_idx
  ON bloombox.webhook_inbox (commerce_provider, provider_account_id, received_at, id)
  WHERE status IN ('PENDING', 'PROCESSING', 'FAILED');
