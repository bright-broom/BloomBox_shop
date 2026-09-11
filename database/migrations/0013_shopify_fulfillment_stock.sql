-- Fulfillment-owned assessment evidence only; Shopify remains the inventory system of record.
ALTER TABLE bloombox.shopify_fulfillment_intakes
  ADD COLUMN provider_stock_source jsonb CHECK (provider_stock_source IS NULL OR COALESCE(
    jsonb_typeof(provider_stock_source) = 'object' AND provider_stock_source ?& ARRAY['checkedAt', 'allocations', 'stocks']
    AND jsonb_typeof(provider_stock_source->'checkedAt') = 'string'
    AND jsonb_typeof(provider_stock_source->'allocations') = 'array' AND jsonb_typeof(provider_stock_source->'stocks') = 'array', false)),
  ADD COLUMN provider_stock_assessment jsonb CHECK (provider_stock_assessment IS NULL OR jsonb_typeof(provider_stock_assessment) = 'object');
CREATE FUNCTION bloombox.protect_shopify_fulfillment_stock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.provider_stock_source IS NOT NULL AND (NEW.provider_stock_source IS NULL
    OR (NEW.provider_stock_source->>'checkedAt')::timestamptz < (OLD.provider_stock_source->>'checkedAt')::timestamptz
    OR ((NEW.provider_stock_source->>'checkedAt')::timestamptz = (OLD.provider_stock_source->>'checkedAt')::timestamptz
      AND NEW.provider_stock_source IS DISTINCT FROM OLD.provider_stock_source)) THEN
    RAISE EXCEPTION 'Fulfillment stock evidence cannot be erased or reordered' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shopify_fulfillment_stock_protected BEFORE UPDATE ON bloombox.shopify_fulfillment_intakes
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_shopify_fulfillment_stock();
REVOKE ALL ON FUNCTION bloombox.protect_shopify_fulfillment_stock() FROM PUBLIC;
