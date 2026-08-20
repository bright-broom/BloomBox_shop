ALTER TABLE bloombox.purchase_intent_items
  ADD COLUMN catalog_product_id text;

UPDATE bloombox.purchase_intent_items
SET catalog_product_id = external_product_id
WHERE catalog_product_id IS NULL;

ALTER TABLE bloombox.purchase_intent_items
  ALTER COLUMN catalog_product_id SET NOT NULL;

CREATE INDEX purchase_intent_items_external_product_idx
  ON bloombox.purchase_intent_items (external_product_id);

ALTER TABLE bloombox.order_items
  ADD COLUMN catalog_product_id text;

UPDATE bloombox.order_items
SET catalog_product_id = external_product_id
WHERE catalog_product_id IS NULL;

ALTER TABLE bloombox.order_items
  ALTER COLUMN catalog_product_id SET NOT NULL;

CREATE INDEX order_items_external_product_idx
  ON bloombox.order_items (external_product_id);
