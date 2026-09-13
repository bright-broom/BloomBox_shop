-- Catalog owns the one-box shipping price; Checkout snapshots it at purchase creation.
-- NULL means unconfigured/legacy, never free shipping. No historical amounts are inferred.
ALTER TABLE bloombox.catalog_products ADD COLUMN shipping_minor bigint
  CHECK (shipping_minor BETWEEN 0 AND 9007199254740991);
ALTER TABLE bloombox.purchase_intents ADD COLUMN shipping_minor bigint
  CHECK (shipping_minor BETWEEN 0 AND 9007199254740991);
ALTER TABLE bloombox.purchase_intents ADD CONSTRAINT purchase_shipping_total_safe
  CHECK (shipping_minor IS NULL OR subtotal_minor + shipping_minor <= 9007199254740991);

CREATE FUNCTION bloombox.keep_purchase_shipping_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shipping_minor IS DISTINCT FROM OLD.shipping_minor THEN
    RAISE EXCEPTION 'Purchase shipping snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_shipping_snapshot_immutable BEFORE UPDATE ON bloombox.purchase_intents
FOR EACH ROW EXECUTE FUNCTION bloombox.keep_purchase_shipping_snapshot();
