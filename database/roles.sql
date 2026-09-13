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
GRANT UPDATE (slug, status, available, name, subtitle, description, price_minor, image_url, image_alt, palette,
  occasions, flowers, grower, version, updated_at) ON bloombox.catalog_products TO bloombox_catalog_manager;
GRANT SELECT ON bloombox.inventory_stock TO bloombox_catalog_manager;
GRANT INSERT (product_id, on_hand) ON bloombox.inventory_stock TO bloombox_catalog_manager;
GRANT UPDATE (on_hand, version) ON bloombox.inventory_stock TO bloombox_catalog_manager;
GRANT SELECT, INSERT ON bloombox.catalog_changes, bloombox.inventory_adjustments TO bloombox_catalog_manager;
