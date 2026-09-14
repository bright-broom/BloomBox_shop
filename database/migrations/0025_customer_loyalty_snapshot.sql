-- NULL preserves historical transactions. Never infer an old customer's discount.
ALTER TABLE bloombox.purchase_intents ADD COLUMN loyalty_snapshot jsonb;
ALTER TABLE bloombox.purchase_intents ADD COLUMN loyalty_discount_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE bloombox.purchase_intents ADD CONSTRAINT purchase_loyalty_valid CHECK ((
  (loyalty_snapshot IS NULL AND loyalty_discount_minor = 0) OR
  (loyalty_snapshot IS NOT NULL AND customer_id IS NOT NULL AND shipping_minor IS NOT NULL
    AND jsonb_typeof(loyalty_snapshot) = 'object'
    AND loyalty_snapshot ?& ARRAY['version', 'tier', 'eligibleSpendYen', 'basisPoints', 'discountYen']
    AND loyalty_snapshot->>'version' = 'rank-v1'
    AND (loyalty_snapshot->>'eligibleSpendYen')::numeric BETWEEN 0 AND 9007199254740991
    AND (loyalty_snapshot->>'eligibleSpendYen')::numeric = trunc((loyalty_snapshot->>'eligibleSpendYen')::numeric)
    AND CASE
      WHEN (loyalty_snapshot->>'eligibleSpendYen')::numeric >= 60000 THEN loyalty_snapshot->>'tier' = 'BOUQUET' AND (loyalty_snapshot->>'basisPoints')::numeric = 500
      WHEN (loyalty_snapshot->>'eligibleSpendYen')::numeric >= 30000 THEN loyalty_snapshot->>'tier' = 'BLOOM' AND (loyalty_snapshot->>'basisPoints')::numeric = 300
      WHEN (loyalty_snapshot->>'eligibleSpendYen')::numeric >= 12000 THEN loyalty_snapshot->>'tier' = 'SPROUT' AND (loyalty_snapshot->>'basisPoints')::numeric = 200
      ELSE loyalty_snapshot->>'tier' = 'SEED' AND (loyalty_snapshot->>'basisPoints')::numeric = 0 END
    AND loyalty_discount_minor = (loyalty_snapshot->>'discountYen')::numeric
    AND loyalty_discount_minor = floor(subtotal_minor::numeric * (loyalty_snapshot->>'basisPoints')::numeric / 10000)
    AND loyalty_discount_minor BETWEEN 0 AND subtotal_minor)
) IS TRUE);
CREATE FUNCTION bloombox.keep_purchase_loyalty_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.loyalty_snapshot IS DISTINCT FROM OLD.loyalty_snapshot
    OR NEW.loyalty_discount_minor IS DISTINCT FROM OLD.loyalty_discount_minor THEN
    RAISE EXCEPTION 'Purchase loyalty snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_loyalty_snapshot_immutable BEFORE UPDATE ON bloombox.purchase_intents
FOR EACH ROW EXECUTE FUNCTION bloombox.keep_purchase_loyalty_snapshot();
