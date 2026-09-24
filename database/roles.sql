\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bloombox_migration') THEN
    CREATE ROLE bloombox_migration NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bloombox_application') THEN
    CREATE ROLE bloombox_application NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bloombox_worker') THEN
    CREATE ROLE bloombox_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bloombox_readonly') THEN
    CREATE ROLE bloombox_readonly NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bloombox_fulfillment_approver') THEN
    CREATE ROLE bloombox_fulfillment_approver NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bloombox_permission_manager') THEN
    CREATE ROLE bloombox_permission_manager NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bloombox_catalog_manager') THEN
    CREATE ROLE bloombox_catalog_manager NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bloombox_native_fulfillment') THEN
    CREATE ROLE bloombox_native_fulfillment NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bloombox_customer_support') THEN
    CREATE ROLE bloombox_customer_support NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA bloombox TO bloombox_application, bloombox_worker, bloombox_readonly;

GRANT SELECT, INSERT, UPDATE ON
  bloombox.purchase_intents,
  bloombox.shopify_checkout_attempts,
  bloombox.orders,
  bloombox.payments,
  bloombox.refunds,
  bloombox.disputes,
  bloombox.fulfillments,
  bloombox.shipments,
  bloombox.customer_accounts,
  bloombox.customer_identities,
  bloombox.customer_contacts,
  bloombox.data_subject_requests,
  bloombox.buyers,
  bloombox.recipients,
  bloombox.idempotency_keys
TO bloombox_application;

GRANT SELECT, INSERT ON
  bloombox.purchase_intent_items,
  bloombox.order_items,
  bloombox.order_gift_snapshots,
  bloombox.order_status_transitions,
  bloombox.payment_attempts,
  bloombox.payment_status_transitions,
  bloombox.shipment_events,
  bloombox.fulfillment_status_transitions,
  bloombox.customer_consents,
  bloombox.outbox_events,
  bloombox.audit_logs
TO bloombox_application;

GRANT SELECT, INSERT, UPDATE ON
  bloombox.webhook_inbox,
  bloombox.outbox_events,
  bloombox.reconciliation_runs,
  bloombox.reconciliation_differences
TO bloombox_worker;

GRANT SELECT, UPDATE ON
  bloombox.purchase_intents,
  bloombox.payments,
  bloombox.refunds,
  bloombox.disputes
TO bloombox_worker;

GRANT SELECT ON
  bloombox.purchase_intent_items,
  bloombox.orders,
  bloombox.order_items,
  bloombox.order_gift_snapshots,
  bloombox.fulfillments
TO bloombox_worker;

GRANT INSERT ON
  bloombox.buyers,
  bloombox.recipients,
  bloombox.orders,
  bloombox.order_items,
  bloombox.order_gift_snapshots,
  bloombox.order_status_transitions,
  bloombox.payments,
  bloombox.payment_attempts,
  bloombox.payment_status_transitions,
  bloombox.refunds,
  bloombox.disputes,
  bloombox.fulfillments,
  bloombox.fulfillment_status_transitions
TO bloombox_worker;

-- Scheduled removal of the gift's personal data; the order's amounts and states stay unchanged.
GRANT UPDATE (pii_key_id, recipient_ciphertext, address_ciphertext, gift_message_ciphertext, pii_purged_at)
  ON bloombox.order_gift_snapshots TO bloombox_worker;

GRANT SELECT, INSERT ON
  bloombox.financial_transactions,
  bloombox.ledger_entries,
  bloombox.audit_logs
TO bloombox_worker;

GRANT SELECT ON bloombox.shopify_checkout_attempts TO bloombox_worker;
GRANT SELECT, INSERT ON bloombox.shopify_order_links TO bloombox_worker;
GRANT SELECT, INSERT, UPDATE ON bloombox.shopify_payment_evidence TO bloombox_worker;

GRANT SELECT, INSERT ON bloombox.shopify_order_acceptances TO bloombox_worker;
GRANT SELECT, INSERT, UPDATE ON bloombox.shopify_payment_projections TO bloombox_worker;
GRANT SELECT, INSERT, UPDATE ON bloombox.shopify_fulfillment_intakes TO bloombox_worker;
GRANT UPDATE (status, version, updated_at) ON bloombox.fulfillments TO bloombox_worker;

GRANT USAGE ON SCHEMA bloombox TO bloombox_fulfillment_approver;
GRANT SELECT, INSERT ON bloombox.fulfillment_approval_submission_limits TO bloombox_fulfillment_approver;
GRANT UPDATE (attempts, updated_at) ON bloombox.fulfillment_approval_submission_limits TO bloombox_fulfillment_approver;
GRANT SELECT ON bloombox.fulfillment_operator_permissions, bloombox.fulfillment_operator_approvals,
  bloombox.shopify_fulfillment_intakes, bloombox.fulfillments, bloombox.shopify_payment_evidence,
  bloombox.shopify_payment_projections, bloombox.payments, bloombox.orders, bloombox.order_items,
  bloombox.order_gift_snapshots TO bloombox_fulfillment_approver;
GRANT INSERT ON bloombox.fulfillment_operator_approvals, bloombox.audit_logs, bloombox.outbox_events
  TO bloombox_fulfillment_approver;
GRANT UPDATE (id) ON bloombox.fulfillment_operator_permissions, bloombox.fulfillments,
  bloombox.orders, bloombox.payments TO bloombox_fulfillment_approver;
GRANT UPDATE (order_id) ON bloombox.order_gift_snapshots TO bloombox_fulfillment_approver;
GRANT UPDATE (purchase_intent_id) ON bloombox.shopify_payment_evidence TO bloombox_fulfillment_approver;
GRANT UPDATE (payment_id) ON bloombox.shopify_payment_projections TO bloombox_fulfillment_approver;
GRANT UPDATE (fulfillment_id) ON bloombox.shopify_fulfillment_intakes TO bloombox_fulfillment_approver;

GRANT USAGE ON SCHEMA bloombox TO bloombox_permission_manager;
-- Approval and permission-revocation submissions share the same operator allowance.
GRANT SELECT, INSERT ON bloombox.fulfillment_approval_submission_limits TO bloombox_permission_manager;
GRANT UPDATE (attempts, updated_at) ON bloombox.fulfillment_approval_submission_limits TO bloombox_permission_manager;
GRANT SELECT ON bloombox.fulfillment_permission_managers, bloombox.fulfillment_operator_permissions,
  bloombox.fulfillment_permission_revocations TO bloombox_permission_manager;
GRANT UPDATE (id) ON bloombox.fulfillment_permission_managers, bloombox.fulfillment_operator_permissions TO bloombox_permission_manager;
GRANT INSERT ON bloombox.fulfillment_permission_revocations, bloombox.audit_logs TO bloombox_permission_manager;
GRANT EXECUTE ON FUNCTION bloombox.disable_fulfillment_permission(uuid, bigint) TO bloombox_permission_manager;

GRANT SELECT ON ALL TABLES IN SCHEMA bloombox TO bloombox_readonly;

-- Storefronts and settlement workers cannot change catalog publication or prices.
GRANT SELECT ON bloombox.catalog_products TO bloombox_application, bloombox_worker;

-- The order ownership constraint reads only the buyer key and its customer reference.
GRANT SELECT (id, customer_id) ON bloombox.buyers TO bloombox_worker;
-- The notification consumer confirms an answer still exists before announcing it; it reads no answer text.
GRANT SELECT (id, order_id, status) ON bloombox.customer_requests TO bloombox_worker;

GRANT SELECT ON bloombox.inventory_stock, bloombox.inventory_reservations, bloombox.inventory_movements
  TO bloombox_application, bloombox_worker;
GRANT UPDATE (reserved, version) ON bloombox.inventory_stock TO bloombox_application;
GRANT UPDATE (on_hand, reserved, version) ON bloombox.inventory_stock TO bloombox_worker;
GRANT INSERT ON bloombox.inventory_reservations TO bloombox_application;
GRANT UPDATE (status, updated_at) ON bloombox.inventory_reservations TO bloombox_application, bloombox_worker;
GRANT INSERT ON bloombox.inventory_movements TO bloombox_application, bloombox_worker;

GRANT USAGE ON SCHEMA bloombox TO bloombox_catalog_manager;
GRANT EXECUTE ON FUNCTION bloombox.lock_native_catalog_operator(uuid) TO bloombox_catalog_manager;
GRANT SELECT, INSERT ON bloombox.catalog_products TO bloombox_catalog_manager;
GRANT UPDATE (slug, status, available, name, subtitle, description, price_minor, shipping_minor, image_url, image_alt, palette,
  occasions, flowers, grower, version, updated_at) ON bloombox.catalog_products TO bloombox_catalog_manager;
GRANT SELECT ON bloombox.inventory_stock TO bloombox_catalog_manager;
GRANT INSERT (product_id, on_hand) ON bloombox.inventory_stock TO bloombox_catalog_manager;
GRANT UPDATE (on_hand, version) ON bloombox.inventory_stock TO bloombox_catalog_manager;
GRANT SELECT, INSERT ON bloombox.catalog_changes, bloombox.inventory_adjustments TO bloombox_catalog_manager;

-- Support can inspect customer/account and order summaries, never identity or recipient payloads.
GRANT USAGE ON SCHEMA bloombox TO bloombox_customer_support;
GRANT EXECUTE ON FUNCTION bloombox.lock_customer_support_operator(uuid) TO bloombox_customer_support;
GRANT SELECT (id, status, created_at) ON bloombox.customer_accounts TO bloombox_customer_support;
GRANT SELECT (id, customer_id) ON bloombox.buyers TO bloombox_customer_support;
GRANT SELECT (id, display_id, buyer_id, status, commerce_provider, currency, total_minor, created_at)
  ON bloombox.orders TO bloombox_customer_support;
GRANT SELECT (order_id, status) ON bloombox.payments, bloombox.fulfillments TO bloombox_customer_support;
GRANT INSERT ON bloombox.customer_support_accesses TO bloombox_customer_support;

-- Advertising activation requires these grants; the public customer-only role is unchanged.
GRANT SELECT, INSERT, UPDATE ON bloombox.advertising_consents, bloombox.advertising_deliveries TO bloombox_application;
GRANT SELECT, UPDATE, DELETE ON bloombox.advertising_consents, bloombox.advertising_deliveries TO bloombox_worker;

-- Customer self-service. Preferences are encrypted and cannot be read by support operators.
GRANT SELECT, INSERT, UPDATE, DELETE ON bloombox.customer_portals TO bloombox_application;
GRANT SELECT, INSERT ON bloombox.customer_requests TO bloombox_application;
GRANT SELECT ON bloombox.customer_requests TO bloombox_customer_support;
GRANT UPDATE (status, key_id, ciphertext, revision, updated_at) ON bloombox.customer_requests TO bloombox_customer_support;
GRANT SELECT ON bloombox.data_subject_requests TO bloombox_customer_support;
GRANT INSERT ON bloombox.customer_request_changes TO bloombox_customer_support;
-- A reply notice is queued with the reply in the same transaction; the role cannot read or change other events (ADR 0021).
GRANT INSERT ON bloombox.outbox_events TO bloombox_customer_support;

-- Native fulfillment is a separate least-privilege operator connection.
GRANT USAGE ON SCHEMA bloombox TO bloombox_native_fulfillment;
GRANT EXECUTE ON FUNCTION bloombox.lock_native_fulfillment_operator(uuid) TO bloombox_native_fulfillment;
GRANT SELECT (id, order_id, status, version) ON bloombox.fulfillments TO bloombox_native_fulfillment;
GRANT UPDATE (id, status, version, updated_at) ON bloombox.fulfillments TO bloombox_native_fulfillment;
GRANT SELECT (id, display_id, status, commerce_provider, created_at, confirmed_at) ON bloombox.orders TO bloombox_native_fulfillment;
GRANT UPDATE (id) ON bloombox.orders TO bloombox_native_fulfillment;
GRANT SELECT (id, order_id, status) ON bloombox.payments TO bloombox_native_fulfillment;
GRANT UPDATE (id) ON bloombox.payments TO bloombox_native_fulfillment;
GRANT SELECT (order_id, product_name_snapshot, quantity, position) ON bloombox.order_items TO bloombox_native_fulfillment;
GRANT SELECT (order_id, delivery_date, pii_key_id, address_ciphertext, pii_purged_at, retention_expires_at)
  ON bloombox.order_gift_snapshots TO bloombox_native_fulfillment;
-- A delivery date the operator agreed to change, with the retention deadline that follows it (P1-02).
GRANT UPDATE (delivery_date, retention_expires_at) ON bloombox.order_gift_snapshots TO bloombox_native_fulfillment;
GRANT SELECT, INSERT ON bloombox.order_delivery_date_changes TO bloombox_native_fulfillment;
GRANT SELECT (id, fulfillment_id, carrier_code, tracking_reference, shipped_at, delivered_at)
  ON bloombox.shipments TO bloombox_native_fulfillment;
GRANT INSERT ON bloombox.shipments TO bloombox_native_fulfillment;
GRANT UPDATE (carrier_code, tracking_reference, shipped_at, delivered_at, updated_at)
  ON bloombox.shipments TO bloombox_native_fulfillment;
GRANT INSERT ON bloombox.fulfillment_status_transitions, bloombox.native_fulfillment_accesses
  TO bloombox_native_fulfillment;
GRANT SELECT, INSERT ON bloombox.native_fulfillment_changes TO bloombox_native_fulfillment;
-- Shipping notices are queued with the shipment in the same transaction; the role cannot read or change other events.
GRANT INSERT ON bloombox.outbox_events TO bloombox_native_fulfillment;
