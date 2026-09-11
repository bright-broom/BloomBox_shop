-- An observation is a monotonic witness of activity on any part of an order, not a delivery projection.
ALTER TABLE bloombox.shopify_fulfillment_intakes ADD COLUMN provider_observation jsonb NOT NULL
  DEFAULT '{"activity":"UNVERIFIED","witness":null}'::jsonb;
ALTER TABLE bloombox.shopify_fulfillment_intakes ADD CONSTRAINT shopify_fulfillment_observation_shape CHECK (COALESCE((
  jsonb_typeof(provider_observation) = 'object'
  AND provider_observation ?& ARRAY['activity', 'witness']
  AND provider_observation - ARRAY['activity', 'witness'] = '{}'::jsonb
  AND provider_observation->>'activity' IN ('UNVERIFIED', 'NONE', 'RECORDED', 'IN_TRANSIT', 'DELIVERED')
  AND CASE WHEN provider_observation->>'activity' IN ('UNVERIFIED', 'NONE')
    THEN provider_observation->'witness' = 'null'::jsonb
    ELSE jsonb_typeof(provider_observation->'witness') = 'object'
      AND provider_observation->'witness' ?& ARRAY['id', 'status', 'updatedAt', 'inTransitAt', 'deliveredAt']
      AND (provider_observation->'witness') - ARRAY['id', 'status', 'updatedAt', 'inTransitAt', 'deliveredAt'] = '{}'::jsonb
  END
), false));

CREATE FUNCTION bloombox.protect_shopify_fulfillment_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  activities text[] := ARRAY['UNVERIFIED', 'NONE', 'RECORDED', 'IN_TRANSIT', 'DELIVERED'];
  previous_rank integer := array_position(activities, OLD.provider_observation->>'activity');
  next_rank integer := array_position(activities, NEW.provider_observation->>'activity');
BEGIN
  IF next_rank < previous_rank OR (next_rank = previous_rank AND NEW.provider_observation IS DISTINCT FROM OLD.provider_observation) THEN
    RAISE EXCEPTION 'Observed fulfillment activity and its witness cannot be retracted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shopify_fulfillment_observation_protected BEFORE UPDATE ON bloombox.shopify_fulfillment_intakes
  FOR EACH ROW EXECUTE FUNCTION bloombox.protect_shopify_fulfillment_observation();
REVOKE ALL ON FUNCTION bloombox.protect_shopify_fulfillment_observation() FROM PUBLIC;
