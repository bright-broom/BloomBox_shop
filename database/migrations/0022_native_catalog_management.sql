-- Shared security owns the native management grant. No existing operator is auto-enrolled.
CREATE TABLE bloombox.native_catalog_operators (
  operator_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  valid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (valid_until > created_at)
);
-- The caller may lock and inspect its grant, but cannot grant itself access.
CREATE FUNCTION bloombox.lock_native_catalog_operator(actor uuid) RETURNS SETOF bloombox.native_catalog_operators
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, bloombox AS $$
  SELECT * FROM bloombox.native_catalog_operators WHERE operator_id = actor FOR SHARE;
$$;
REVOKE ALL ON FUNCTION bloombox.lock_native_catalog_operator(uuid) FROM PUBLIC;
CREATE TABLE bloombox.catalog_changes (
  operator_id uuid NOT NULL,
  request_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES bloombox.catalog_products(id) ON DELETE RESTRICT,
  previous_version bigint NOT NULL CHECK (previous_version >= 0),
  version bigint NOT NULL CHECK (version = previous_version + 1),
  before_snapshot jsonb,
  command jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operator_id, request_id), UNIQUE (product_id, version)
);
CREATE TABLE bloombox.inventory_adjustments (
  operator_id uuid NOT NULL,
  request_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES bloombox.inventory_stock(product_id) ON DELETE RESTRICT,
  previous_version bigint NOT NULL CHECK (previous_version >= 0),
  version bigint NOT NULL CHECK (version = previous_version + 1),
  before_quantity integer NOT NULL CHECK (before_quantity >= 0),
  after_quantity integer NOT NULL CHECK (after_quantity >= 0),
  delta integer NOT NULL CHECK (delta <> 0 AND after_quantity = before_quantity + delta),
  reason text NOT NULL CHECK (reason IN ('RECEIVED', 'CORRECTION')),
  command jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operator_id, request_id), UNIQUE (product_id, version),
  CHECK (reason <> 'RECEIVED' OR delta > 0)
);
