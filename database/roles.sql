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
END
$$;

GRANT USAGE ON SCHEMA bloombox TO bloombox_application, bloombox_worker, bloombox_readonly;

GRANT SELECT, INSERT, UPDATE ON
  bloombox.purchase_intents,
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

GRANT SELECT ON ALL TABLES IN SCHEMA bloombox TO bloombox_readonly;
