ALTER TABLE bloombox.purchase_intents
  ADD COLUMN customer_id uuid REFERENCES bloombox.customer_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN customer_version bigint,
  ADD CONSTRAINT purchase_customer_pair CHECK (
    (customer_id IS NULL AND customer_version IS NULL)
    OR (customer_id IS NOT NULL AND customer_version IS NOT NULL AND customer_version BETWEEN 1 AND 9007199254740991)
  );

-- Historical intents remain anonymous. Never infer ownership from an email or recipient.
CREATE FUNCTION bloombox.prevent_purchase_customer_reassignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, bloombox AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.customer_version IS DISTINCT FROM OLD.customer_version THEN
    RAISE EXCEPTION 'Purchase customer binding is immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER purchase_customer_immutable BEFORE UPDATE ON bloombox.purchase_intents
  FOR EACH ROW EXECUTE FUNCTION bloombox.prevent_purchase_customer_reassignment();

CREATE FUNCTION bloombox.prevent_buyer_customer_reassignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, bloombox AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Buyer customer binding is immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER buyer_customer_immutable BEFORE UPDATE ON bloombox.buyers
  FOR EACH ROW EXECUTE FUNCTION bloombox.prevent_buyer_customer_reassignment();

CREATE FUNCTION bloombox.prevent_order_buyer_reassignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, bloombox AS $$
BEGIN
  IF NEW.buyer_id IS DISTINCT FROM OLD.buyer_id THEN
    RAISE EXCEPTION 'Order buyer binding is immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER order_buyer_immutable BEFORE UPDATE ON bloombox.orders
  FOR EACH ROW EXECUTE FUNCTION bloombox.prevent_order_buyer_reassignment();

-- Older workers must fail closed instead of turning customer-bound intents into guest orders.
CREATE FUNCTION bloombox.enforce_order_purchase_customer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, bloombox AS $$
DECLARE
  expected_customer uuid;
  actual_customer uuid;
BEGIN
  IF NEW.commerce_provider = 'STRIPE' AND NEW.purchase_intent_id IS NOT NULL THEN
    SELECT customer_id INTO expected_customer FROM bloombox.purchase_intents WHERE id = NEW.purchase_intent_id;
    SELECT customer_id INTO actual_customer FROM bloombox.buyers WHERE id = NEW.buyer_id;
    IF expected_customer IS DISTINCT FROM actual_customer THEN
      RAISE EXCEPTION 'Order buyer must match purchase customer';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER order_purchase_customer_consistent
  BEFORE INSERT OR UPDATE OF purchase_intent_id, commerce_provider, buyer_id ON bloombox.orders
  FOR EACH ROW EXECUTE FUNCTION bloombox.enforce_order_purchase_customer();
