CREATE INDEX fulfillment_permission_scope_id_idx
  ON bloombox.fulfillment_operator_permissions (provider_scope, id);
CREATE INDEX fulfillment_permission_revocation_latest_idx
  ON bloombox.fulfillment_permission_revocations (permission_id, version DESC);
