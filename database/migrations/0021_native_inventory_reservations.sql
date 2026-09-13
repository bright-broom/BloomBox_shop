CREATE TABLE bloombox.inventory_stock (
  product_id uuid PRIMARY KEY REFERENCES bloombox.catalog_products(id) ON DELETE RESTRICT,
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved BETWEEN 0 AND on_hand),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE bloombox.inventory_reservations (
  purchase_intent_id uuid PRIMARY KEY REFERENCES bloombox.purchase_intents(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES bloombox.inventory_stock(product_id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status IN ('HELD', 'COMMITTED', 'RELEASED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE bloombox.inventory_movements (
  id uuid PRIMARY KEY,
  purchase_intent_id uuid NOT NULL REFERENCES bloombox.inventory_reservations(purchase_intent_id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('RESERVED', 'COMMITTED', 'RELEASED')),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (reason IN ('PURCHASE_CREATED', 'PAYMENT_CONFIRMED', 'BEFORE_CHECKOUT_CANCELLED', 'INTENT_EXPIRED', 'CHECKOUT_EXPIRED', 'PAYMENT_FAILED')),
  occurred_at timestamptz NOT NULL,
  UNIQUE (purchase_intent_id, kind)
);
CREATE INDEX inventory_reservations_held_idx ON bloombox.inventory_reservations (product_id)
  WHERE status = 'HELD';

CREATE FUNCTION bloombox.protect_inventory_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, bloombox AS $$
BEGIN
  IF NEW.purchase_intent_id IS DISTINCT FROM OLD.purchase_intent_id
    OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.quantity IS DISTINCT FROM OLD.quantity
    OR (OLD.status <> 'HELD' AND NEW.status <> OLD.status) THEN
    RAISE EXCEPTION 'Inventory reservation identity and terminal state are immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER inventory_reservation_immutable BEFORE UPDATE ON bloombox.inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_inventory_reservation();

-- Legacy/Shopify items never consume native inventory. Native items cannot bypass reservations.
CREATE FUNCTION bloombox.require_native_inventory_state() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, bloombox AS $$
DECLARE
  catalog_id text;
  reservation_state text;
  item_quantity integer;
BEGIN
  SELECT catalog_product_id, quantity INTO catalog_id, item_quantity FROM bloombox.purchase_intent_items
    WHERE purchase_intent_id = NEW.id AND position = 0;
  IF left(catalog_id, 7) = 'native_' THEN
    SELECT status INTO reservation_state FROM bloombox.inventory_reservations WHERE purchase_intent_id = NEW.id
      AND ('native_' || product_id::text) = catalog_id AND quantity = item_quantity;
    IF (NEW.commerce_provider IS DISTINCT FROM OLD.commerce_provider AND NEW.commerce_provider IS NOT NULL
        AND (NEW.commerce_provider <> 'STRIPE' OR reservation_state IS DISTINCT FROM 'HELD'))
      OR (NEW.status = 'CHECKOUT_CREATED' AND reservation_state IS DISTINCT FROM 'HELD')
      OR (NEW.status = 'CONVERTED' AND reservation_state IS DISTINCT FROM 'COMMITTED')
      OR (NEW.status IN ('EXPIRED', 'ABANDONED') AND reservation_state IS DISTINCT FROM 'RELEASED') THEN
      RAISE EXCEPTION 'Native purchase requires consistent inventory reservation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER purchase_native_inventory BEFORE UPDATE OF status, commerce_provider ON bloombox.purchase_intents
  FOR EACH ROW EXECUTE FUNCTION bloombox.require_native_inventory_state();
