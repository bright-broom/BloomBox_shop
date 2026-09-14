-- Customer support access is separate from catalog, fulfillment and customer login.
CREATE TABLE bloombox.customer_support_operators (
  operator_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  valid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (valid_until > created_at)
);
CREATE FUNCTION bloombox.lock_customer_support_operator(actor uuid)
RETURNS SETOF bloombox.customer_support_operators
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, bloombox AS $$
  SELECT * FROM bloombox.customer_support_operators WHERE operator_id = actor FOR SHARE;
$$;
REVOKE ALL ON FUNCTION bloombox.lock_customer_support_operator(uuid) FROM PUBLIC;
-- Audit only opaque customer references; do not retain search input or contact data.
CREATE TABLE bloombox.customer_support_accesses (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('DIRECTORY', 'HISTORY')),
  customer_ids uuid[] NOT NULL CHECK (cardinality(customer_ids) <= 30),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
