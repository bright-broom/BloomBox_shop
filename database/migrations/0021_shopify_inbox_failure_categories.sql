-- Declassify only a fixed allowlist. Unknown/legacy values cannot leak raw error text.
-- The owner-backed view does not expose external references, payloads or commerce tables.
CREATE VIEW bloombox.shopify_inbox_diagnostic_metadata WITH (security_barrier = true) AS
SELECT id, provider_account_id, status, received_at, available_at, locked_at, attempts, payload_expires_at, payload_purged_at,
  CASE last_error_code
    WHEN 'ShopifyCommerceConfigurationHoldError' THEN 'CONFIGURATION'
    WHEN 'ShopifyCommerceTermsHoldError' THEN 'TERMS'
    WHEN 'ShopifyCommercePaymentHoldError' THEN 'PAYMENT'
    WHEN 'ShopifyCommercePricingHoldError' THEN 'PRICING'
    WHEN 'ShopifyCommerceDeliveryHoldError' THEN 'DELIVERY'
    WHEN 'ShopifyCommerceOrderHoldError' THEN 'ORDER'
    WHEN 'ShopifyCommerceIncompleteError' THEN 'INCOMPLETE'
    ELSE CASE WHEN last_error_code IS NULL THEN 'NONE' ELSE 'UNKNOWN' END
  END AS category
FROM bloombox.webhook_inbox
WHERE commerce_provider = 'SHOPIFY' AND status IN ('PENDING', 'PROCESSING', 'FAILED');

REVOKE ALL ON bloombox.shopify_inbox_diagnostic_metadata FROM PUBLIC;
