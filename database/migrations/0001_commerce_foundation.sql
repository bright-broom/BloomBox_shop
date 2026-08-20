CREATE TABLE bloombox.customer_accounts (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED', 'ANONYMIZED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE bloombox.customer_identities (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES bloombox.customer_accounts(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, provider_subject)
);

CREATE INDEX customer_identities_customer_idx
  ON bloombox.customer_identities (customer_id);

CREATE TABLE bloombox.customer_contacts (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES bloombox.customer_accounts(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('EMAIL', 'PHONE')),
  lookup_hash bytea NOT NULL,
  key_id text NOT NULL,
  ciphertext bytea NOT NULL,
  verified_at timestamptz,
  retention_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (kind, lookup_hash)
);

CREATE INDEX customer_contacts_customer_idx
  ON bloombox.customer_contacts (customer_id);

CREATE TABLE bloombox.customer_consents (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES bloombox.customer_accounts(id) ON DELETE RESTRICT,
  purpose text NOT NULL,
  status text NOT NULL CHECK (status IN ('GRANTED', 'WITHDRAWN')),
  policy_version text NOT NULL,
  occurred_at timestamptz NOT NULL,
  source text NOT NULL,
  UNIQUE (customer_id, purpose, occurred_at)
);

CREATE TABLE bloombox.data_subject_requests (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES bloombox.customer_accounts(id) ON DELETE SET NULL,
  request_type text NOT NULL CHECK (request_type IN ('ACCESS', 'CORRECTION', 'DELETION', 'PORTABILITY')),
  status text NOT NULL CHECK (status IN ('RECEIVED', 'VERIFYING', 'PROCESSING', 'COMPLETED', 'REJECTED')),
  safe_reference text NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL,
  CHECK (completed_at IS NULL OR completed_at >= requested_at)
);

CREATE INDEX data_subject_requests_status_due_idx
  ON bloombox.data_subject_requests (status, due_at);

CREATE TABLE bloombox.buyers (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES bloombox.customer_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX buyers_customer_idx ON bloombox.buyers (customer_id);

CREATE TABLE bloombox.recipients (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES bloombox.customer_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX recipients_customer_idx ON bloombox.recipients (customer_id);

CREATE TABLE bloombox.purchase_intents (
  id uuid PRIMARY KEY,
  display_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (
    status IN ('DRAFT', 'READY_FOR_CHECKOUT', 'CHECKOUT_CREATED', 'CONVERTED', 'EXPIRED', 'ABANDONED')
  ),
  commerce_provider text CHECK (commerce_provider IN ('SHOPIFY', 'STRIPE')),
  external_checkout_id text,
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  delivery_date date NOT NULL,
  pii_key_id text NOT NULL,
  recipient_ciphertext bytea NOT NULL,
  gift_message_ciphertext bytea NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  pii_retention_expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (pii_retention_expires_at >= expires_at),
  CHECK (external_checkout_id IS NULL OR commerce_provider IS NOT NULL)
);

CREATE UNIQUE INDEX purchase_intents_provider_checkout_uidx
  ON bloombox.purchase_intents (commerce_provider, external_checkout_id)
  WHERE external_checkout_id IS NOT NULL;

CREATE INDEX purchase_intents_status_updated_idx
  ON bloombox.purchase_intents (status, updated_at);
CREATE INDEX purchase_intents_expiry_idx
  ON bloombox.purchase_intents (expires_at)
  WHERE status IN ('DRAFT', 'READY_FOR_CHECKOUT', 'CHECKOUT_CREATED');
CREATE INDEX purchase_intents_pii_retention_idx
  ON bloombox.purchase_intents (pii_retention_expires_at);

CREATE TABLE bloombox.purchase_intent_items (
  id uuid PRIMARY KEY,
  purchase_intent_id uuid NOT NULL REFERENCES bloombox.purchase_intents(id) ON DELETE CASCADE,
  external_product_id text NOT NULL,
  product_name_snapshot text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_amount_minor bigint NOT NULL CHECK (unit_amount_minor >= 0),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  position integer NOT NULL CHECK (position >= 0),
  UNIQUE (purchase_intent_id, position),
  CHECK (subtotal_minor = unit_amount_minor * quantity)
);

CREATE INDEX purchase_intent_items_intent_idx
  ON bloombox.purchase_intent_items (purchase_intent_id);

CREATE TABLE bloombox.orders (
  id uuid PRIMARY KEY,
  display_id text NOT NULL UNIQUE,
  buyer_id uuid REFERENCES bloombox.buyers(id) ON DELETE SET NULL,
  purchase_intent_id uuid REFERENCES bloombox.purchase_intents(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'CLOSED')),
  commerce_provider text NOT NULL CHECK (commerce_provider IN ('SHOPIFY', 'STRIPE')),
  external_order_id text NOT NULL,
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  shipping_minor bigint NOT NULL CHECK (shipping_minor >= 0),
  discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (commerce_provider, external_order_id),
  CHECK (total_minor = subtotal_minor + tax_minor + shipping_minor - discount_minor)
);

CREATE INDEX orders_buyer_created_idx ON bloombox.orders (buyer_id, created_at DESC);
CREATE INDEX orders_status_updated_idx ON bloombox.orders (status, updated_at);
CREATE UNIQUE INDEX orders_purchase_intent_uidx
  ON bloombox.orders (purchase_intent_id)
  WHERE purchase_intent_id IS NOT NULL;

CREATE TABLE bloombox.order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES bloombox.orders(id) ON DELETE RESTRICT,
  external_product_id text NOT NULL,
  sku_snapshot text,
  product_name_snapshot text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_amount_minor bigint NOT NULL CHECK (unit_amount_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  position integer NOT NULL CHECK (position >= 0),
  UNIQUE (order_id, position),
  CHECK (line_total_minor = unit_amount_minor * quantity + tax_minor - discount_minor)
);

CREATE INDEX order_items_order_idx ON bloombox.order_items (order_id);

CREATE TABLE bloombox.order_gift_snapshots (
  order_id uuid PRIMARY KEY REFERENCES bloombox.orders(id) ON DELETE RESTRICT,
  recipient_id uuid REFERENCES bloombox.recipients(id) ON DELETE SET NULL,
  delivery_date date NOT NULL,
  pii_key_id text NOT NULL,
  recipient_ciphertext bytea NOT NULL,
  address_ciphertext bytea,
  gift_message_ciphertext bytea NOT NULL,
  retention_expires_at timestamptz
);

CREATE TABLE bloombox.order_status_transitions (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES bloombox.orders(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'CLOSED')),
  reason_code text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('SYSTEM', 'PROVIDER', 'CUSTOMER', 'OPERATOR')),
  actor_reference text,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (order_id, idempotency_key),
  CHECK (from_status IS NULL OR from_status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'CLOSED'))
);

CREATE INDEX order_status_transitions_order_idx
  ON bloombox.order_status_transitions (order_id, occurred_at);

CREATE TABLE bloombox.payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES bloombox.orders(id) ON DELETE RESTRICT,
  commerce_provider text NOT NULL CHECK (commerce_provider IN ('SHOPIFY', 'STRIPE')),
  external_payment_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'REQUIRES_PAYMENT_METHOD', 'REQUIRES_ACTION', 'PROCESSING', 'AUTHORIZED', 'CAPTURED',
      'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'CANCELLED', 'DISPUTED'
    )
  ),
  amount_requested_minor bigint NOT NULL CHECK (amount_requested_minor >= 0),
  amount_authorized_minor bigint NOT NULL DEFAULT 0 CHECK (amount_authorized_minor >= 0),
  amount_captured_minor bigint NOT NULL DEFAULT 0 CHECK (amount_captured_minor >= 0),
  amount_refunded_minor bigint NOT NULL DEFAULT 0 CHECK (amount_refunded_minor >= 0),
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (commerce_provider, external_payment_id),
  CHECK (amount_authorized_minor <= amount_requested_minor),
  CHECK (amount_captured_minor <= amount_authorized_minor),
  CHECK (amount_refunded_minor <= amount_captured_minor)
);

CREATE INDEX payments_order_idx ON bloombox.payments (order_id);
CREATE INDEX payments_status_updated_idx ON bloombox.payments (status, updated_at);

CREATE TABLE bloombox.payment_attempts (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES bloombox.payments(id) ON DELETE RESTRICT,
  external_attempt_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED')
  ),
  requested_amount_minor bigint NOT NULL CHECK (requested_amount_minor >= 0),
  authorized_amount_minor bigint NOT NULL DEFAULT 0 CHECK (authorized_amount_minor >= 0),
  captured_amount_minor bigint NOT NULL DEFAULT 0 CHECK (captured_amount_minor >= 0),
  failure_code text,
  occurred_at timestamptz NOT NULL,
  UNIQUE (payment_id, external_attempt_id)
);

CREATE INDEX payment_attempts_payment_idx
  ON bloombox.payment_attempts (payment_id, occurred_at);

CREATE TABLE bloombox.refunds (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES bloombox.payments(id) ON DELETE RESTRICT,
  commerce_provider text NOT NULL CHECK (commerce_provider IN ('SHOPIFY', 'STRIPE')),
  external_refund_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (commerce_provider, external_refund_id)
);

CREATE INDEX refunds_payment_idx ON bloombox.refunds (payment_id, created_at);

CREATE TABLE bloombox.disputes (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES bloombox.payments(id) ON DELETE RESTRICT,
  commerce_provider text NOT NULL CHECK (commerce_provider IN ('SHOPIFY', 'STRIPE')),
  external_dispute_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('NEEDS_RESPONSE', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED')
  ),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason_code text,
  due_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (commerce_provider, external_dispute_id)
);

CREATE INDEX disputes_payment_idx ON bloombox.disputes (payment_id, created_at);

CREATE TABLE bloombox.payment_status_transitions (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES bloombox.payments(id) ON DELETE RESTRICT,
  from_status text CHECK (
    from_status IS NULL OR from_status IN (
      'REQUIRES_PAYMENT_METHOD', 'REQUIRES_ACTION', 'PROCESSING', 'AUTHORIZED', 'CAPTURED',
      'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'CANCELLED', 'DISPUTED'
    )
  ),
  to_status text NOT NULL CHECK (
    to_status IN (
      'REQUIRES_PAYMENT_METHOD', 'REQUIRES_ACTION', 'PROCESSING', 'AUTHORIZED', 'CAPTURED',
      'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'CANCELLED', 'DISPUTED'
    )
  ),
  provider_event_id text,
  reason_code text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX payment_status_transitions_payment_idx
  ON bloombox.payment_status_transitions (payment_id, occurred_at);
CREATE UNIQUE INDEX payment_status_transitions_provider_event_uidx
  ON bloombox.payment_status_transitions (payment_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE TABLE bloombox.fulfillments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES bloombox.orders(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (
    status IN ('UNFULFILLED', 'SCHEDULED', 'PROCESSING', 'READY', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED')
  ),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX fulfillments_order_idx ON bloombox.fulfillments (order_id);
CREATE INDEX fulfillments_status_updated_idx ON bloombox.fulfillments (status, updated_at);

CREATE TABLE bloombox.shipments (
  id uuid PRIMARY KEY,
  fulfillment_id uuid NOT NULL REFERENCES bloombox.fulfillments(id) ON DELETE RESTRICT,
  carrier_code text,
  tracking_reference text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX shipments_fulfillment_idx ON bloombox.shipments (fulfillment_id);

CREATE TABLE bloombox.shipment_events (
  id uuid PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES bloombox.shipments(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  external_event_id text,
  location_code text,
  UNIQUE (shipment_id, external_event_id)
);

CREATE INDEX shipment_events_shipment_idx
  ON bloombox.shipment_events (shipment_id, occurred_at);

CREATE TABLE bloombox.fulfillment_status_transitions (
  id uuid PRIMARY KEY,
  fulfillment_id uuid NOT NULL REFERENCES bloombox.fulfillments(id) ON DELETE RESTRICT,
  from_status text CHECK (
    from_status IS NULL OR from_status IN (
      'UNFULFILLED', 'SCHEDULED', 'PROCESSING', 'READY', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'
    )
  ),
  to_status text NOT NULL CHECK (
    to_status IN (
      'UNFULFILLED', 'SCHEDULED', 'PROCESSING', 'READY', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'
    )
  ),
  reason_code text NOT NULL,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX fulfillment_status_transitions_fulfillment_idx
  ON bloombox.fulfillment_status_transitions (fulfillment_id, occurred_at);
CREATE UNIQUE INDEX fulfillment_status_transitions_idempotency_uidx
  ON bloombox.fulfillment_status_transitions (fulfillment_id, idempotency_key);

CREATE TABLE bloombox.idempotency_keys (
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash character(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  resource_type text,
  resource_id uuid,
  response_code integer,
  locked_until timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope, idempotency_key)
);

CREATE INDEX idempotency_keys_expiry_idx ON bloombox.idempotency_keys (expires_at);

CREATE TABLE bloombox.webhook_inbox (
  id uuid PRIMARY KEY,
  commerce_provider text NOT NULL CHECK (commerce_provider IN ('SHOPIFY', 'STRIPE')),
  provider_account_id text NOT NULL,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  external_object_id text,
  api_version text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')),
  payload_key_id text NOT NULL,
  payload_ciphertext bytea NOT NULL,
  payload_expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  UNIQUE (commerce_provider, provider_account_id, external_event_id)
);

CREATE INDEX webhook_inbox_pending_idx
  ON bloombox.webhook_inbox (available_at, received_at)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE TABLE bloombox.outbox_events (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  event_version smallint NOT NULL CHECK (event_version > 0),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  locked_at timestamptz,
  locked_by text,
  published_at timestamptz,
  last_error_code text,
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX outbox_events_pending_idx
  ON bloombox.outbox_events (available_at, occurred_at)
  WHERE status = 'PENDING';

CREATE TABLE bloombox.reconciliation_runs (
  id uuid PRIMARY KEY,
  commerce_provider text NOT NULL CHECK (commerce_provider IN ('SHOPIFY', 'STRIPE')),
  resource_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  cursor_value text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  checked_count integer NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  difference_count integer NOT NULL DEFAULT 0 CHECK (difference_count >= 0),
  error_code text
);

CREATE INDEX reconciliation_runs_provider_idx
  ON bloombox.reconciliation_runs (commerce_provider, resource_type, started_at DESC);

CREATE TABLE bloombox.reconciliation_differences (
  id uuid PRIMARY KEY,
  reconciliation_run_id uuid NOT NULL REFERENCES bloombox.reconciliation_runs(id) ON DELETE RESTRICT,
  internal_resource_id uuid,
  external_resource_id text NOT NULL,
  difference_type text NOT NULL,
  safe_details jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED')),
  detected_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK (jsonb_typeof(safe_details) = 'object')
);

CREATE INDEX reconciliation_differences_run_idx
  ON bloombox.reconciliation_differences (reconciliation_run_id, status);

CREATE TABLE bloombox.financial_transactions (
  id uuid PRIMARY KEY,
  order_id uuid REFERENCES bloombox.orders(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES bloombox.payments(id) ON DELETE RESTRICT,
  transaction_type text NOT NULL,
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  external_reference text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX financial_transactions_order_idx
  ON bloombox.financial_transactions (order_id, occurred_at);

CREATE TABLE bloombox.ledger_entries (
  id uuid PRIMARY KEY,
  financial_transaction_id uuid NOT NULL REFERENCES bloombox.financial_transactions(id) ON DELETE RESTRICT,
  account_code text NOT NULL,
  signed_amount_minor bigint NOT NULL CHECK (signed_amount_minor <> 0),
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX ledger_entries_transaction_idx
  ON bloombox.ledger_entries (financial_transaction_id);

CREATE OR REPLACE FUNCTION bloombox.assert_balanced_financial_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_id uuid;
  entry_count integer;
  balance numeric;
  currency_count integer;
  entry_currency character(3);
  transaction_currency character(3);
BEGIN
  transaction_id := COALESCE(NEW.financial_transaction_id, OLD.financial_transaction_id);

  SELECT COUNT(*), COALESCE(SUM(signed_amount_minor), 0), COUNT(DISTINCT currency), MIN(currency)
    INTO entry_count, balance, currency_count, entry_currency
    FROM bloombox.ledger_entries
   WHERE financial_transaction_id = transaction_id;

  SELECT currency
    INTO transaction_currency
    FROM bloombox.financial_transactions
   WHERE id = transaction_id;

  IF
    entry_count < 2
    OR balance <> 0
    OR currency_count <> 1
    OR entry_currency <> transaction_currency
  THEN
    RAISE EXCEPTION 'financial transaction % is not balanced', transaction_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
AFTER INSERT OR UPDATE OR DELETE ON bloombox.ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION bloombox.assert_balanced_financial_transaction();

CREATE OR REPLACE FUNCTION bloombox.assert_financial_transaction_has_entries()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entry_count integer;
BEGIN
  SELECT COUNT(*)
    INTO entry_count
    FROM bloombox.ledger_entries
   WHERE financial_transaction_id = NEW.id;

  IF entry_count < 2 THEN
    RAISE EXCEPTION 'financial transaction % has fewer than two entries', NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER financial_transactions_have_entries
AFTER INSERT OR UPDATE ON bloombox.financial_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION bloombox.assert_financial_transaction_has_entries();

CREATE TABLE bloombox.audit_logs (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('SYSTEM', 'PROVIDER', 'CUSTOMER', 'OPERATOR')),
  actor_reference text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  safe_metadata jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  CHECK (jsonb_typeof(safe_metadata) = 'object')
);

CREATE INDEX audit_logs_resource_idx
  ON bloombox.audit_logs (resource_type, resource_id, occurred_at DESC);

REVOKE CREATE ON SCHEMA bloombox FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA bloombox FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bloombox FROM PUBLIC;
