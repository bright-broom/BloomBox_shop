import { ProcessProviderInbox } from "@/modules/payment/application/process-provider-inbox";
import { ShopifyCommerceEventProcessor } from "@/modules/payment/application/shopify-commerce-event-processor";
import { ReconcileShopifyPayment } from "@/modules/payment/application/reconcile-shopify-payment";
import { ReadShopifyReference } from "@/modules/payment/application/read-shopify-reference";
import { PostgresWebhookInbox } from "@/modules/payment/infrastructure/postgres-webhook-inbox";
import { ShopifyAdminOrderReader } from "@/modules/payment/infrastructure/shopify/shopify-admin-order-reader";
import { ShopifyAdminOrderAcceptor } from "@/modules/payment/infrastructure/shopify/shopify-admin-order-acceptor";
import { PostgresShopifyPaymentEvidence } from "@/modules/payment/infrastructure/shopify/postgres-shopify-payment-evidence";
import { PostgresShopifyOrderPaymentProjector } from "@/modules/payment/infrastructure/shopify/postgres-shopify-order-payment-projector";
import { PostgresShopifyOrderAcceptor } from "@/modules/order/infrastructure/postgres-shopify-order-acceptor";
import { PostgresShopifyAcceptedOrderQuery } from "@/modules/order/infrastructure/postgres-shopify-accepted-order-query";
import { PostgresShopifyOrderLinker } from "@/modules/checkout/infrastructure/shopify/postgres-shopify-order-linker";
import { PostgresShopifyDeliveryPlanQuery } from "@/modules/checkout/infrastructure/shopify/postgres-shopify-delivery-plan-query";
import { PostgresShopifyPurchaseConverter } from "@/modules/checkout/infrastructure/shopify/postgres-shopify-purchase-converter";
import { PostgresShopifyFulfillmentIntake } from "@/modules/fulfillment/infrastructure/postgres-shopify-fulfillment-intake";
import { getWorkerDatabaseClient } from "./database/database-connections";
import { loadDataProtectionConfig } from "./config/data-protection-config";
import type { ShopifyInboxConfig } from "./config/shopify-inbox-config";
import { AesGcmDataProtector } from "./security/aes-gcm-data-protector";

/** Called only after the dedicated worker credential is verified. Merchant policies keep their defaults. */
export function createShopifyInboxProcessor(config: ShopifyInboxConfig): ProcessProviderInbox {
  const sql = getWorkerDatabaseClient();
  const protector = new AesGcmDataProtector(loadDataProtectionConfig());
  const reader = new ShopifyAdminOrderReader(config.admin);
  const reconciliation = new ReconcileShopifyPayment(
    new ReadShopifyReference(reader), new PostgresShopifyOrderLinker(sql),
    new PostgresShopifyPaymentEvidence(sql), true, new PostgresShopifyDeliveryPlanQuery(sql), reader, undefined,
    new ShopifyAdminOrderAcceptor(reader, new PostgresShopifyOrderAcceptor(sql, protector)),
    { orders: new PostgresShopifyAcceptedOrderQuery(sql), payments: new PostgresShopifyOrderPaymentProjector(sql, true),
      purchases: new PostgresShopifyPurchaseConverter(sql),
      fulfillment: new PostgresShopifyFulfillmentIntake(sql, true, undefined, undefined, reader, reader) },
  );
  return new ProcessProviderInbox(
    new PostgresWebhookInbox(sql, protector, undefined, undefined, { provider: "SHOPIFY", accountId: config.admin.storeDomain }),
    new ShopifyCommerceEventProcessor(reconciliation, { shop: config.admin.storeDomain, apiVersion: config.admin.apiVersion }),
    undefined, undefined, 1, // Do not lease a large batch while bounded provider reads run sequentially.
  );
}
