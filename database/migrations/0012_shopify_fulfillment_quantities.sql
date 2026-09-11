-- Fulfillment-owned quantity evidence; existing records remain unverified until a complete read succeeds.
ALTER TABLE bloombox.shopify_fulfillment_intakes
  ADD COLUMN provider_quantity_source jsonb CHECK (provider_quantity_source IS NULL OR COALESCE(
    jsonb_typeof(provider_quantity_source) = 'object'
    AND provider_quantity_source ?& ARRAY['updatedAt', 'lines', 'fulfillments']
    AND jsonb_typeof(provider_quantity_source->'updatedAt') = 'string'
    AND jsonb_typeof(provider_quantity_source->'lines') = 'array'
    AND jsonb_typeof(provider_quantity_source->'fulfillments') = 'array', false)),
  ADD COLUMN provider_quantity_assessment jsonb CHECK (provider_quantity_assessment IS NULL OR jsonb_typeof(provider_quantity_assessment) = 'object');
CREATE FUNCTION bloombox.protect_shopify_fulfillment_quantities() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_item jsonb;
  next_item jsonb;
BEGIN
  IF OLD.provider_quantity_source IS NULL THEN RETURN NEW; END IF;
  IF NEW.provider_quantity_source IS NULL
    OR (NEW.provider_quantity_source->>'updatedAt')::timestamptz < (OLD.provider_quantity_source->>'updatedAt')::timestamptz
    OR ((NEW.provider_quantity_source->>'updatedAt')::timestamptz = (OLD.provider_quantity_source->>'updatedAt')::timestamptz
      AND NEW.provider_quantity_source->'lines' IS DISTINCT FROM OLD.provider_quantity_source->'lines') THEN
    RAISE EXCEPTION 'Fulfillment quantity source cannot regress' USING ERRCODE = '23514';
  END IF;
  FOR previous_item IN SELECT value FROM jsonb_array_elements(OLD.provider_quantity_source->'fulfillments') LOOP
    SELECT value INTO next_item FROM jsonb_array_elements(NEW.provider_quantity_source->'fulfillments') WHERE value->>'id' = previous_item->>'id';
    IF next_item IS NULL OR (next_item->>'updatedAt')::timestamptz < (previous_item->>'updatedAt')::timestamptz
      OR ((next_item->>'updatedAt')::timestamptz = (previous_item->>'updatedAt')::timestamptz AND next_item IS DISTINCT FROM previous_item)
      OR (previous_item->>'inTransitAt' IS NOT NULL AND next_item->>'inTransitAt' IS NULL)
      OR (previous_item->>'deliveredAt' IS NOT NULL AND next_item->>'deliveredAt' IS NULL) THEN
      RAISE EXCEPTION 'Fulfillment quantity witness cannot regress' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shopify_fulfillment_quantities_protected BEFORE UPDATE ON bloombox.shopify_fulfillment_intakes
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_shopify_fulfillment_quantities();
REVOKE ALL ON FUNCTION bloombox.protect_shopify_fulfillment_quantities() FROM PUBLIC;
