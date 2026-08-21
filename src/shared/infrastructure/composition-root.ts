import { isIP } from "node:net";
import { headers } from "next/headers";
import { GetProduct } from "@/modules/catalog/application/get-product";
import { ListProducts } from "@/modules/catalog/application/list-products";
import { SearchProducts } from "@/modules/catalog/application/search-products";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import type { ProductRepository } from "@/modules/catalog/public";
import { ShopifyProductRepository } from "@/modules/catalog/infrastructure/shopify-product-repository";
import { ShopifyStorefrontFetchClient } from "@/modules/catalog/infrastructure/shopify-storefront-client";
import { CreatePurchaseIntent } from "@/modules/checkout/application/create-purchase-intent";
import { PreparePurchase } from "@/modules/checkout/application/prepare-purchase";
import { StartCheckout } from "@/modules/checkout/application/start-checkout";
import { InMemoryPurchaseIntentRepository } from "@/modules/checkout/infrastructure/in-memory-purchase-intent-repository";
import { PostgresPurchaseIntentRepository } from "@/modules/checkout/infrastructure/postgres-purchase-intent-repository";
import {
  StripeCheckoutSessionProvider,
  StripeSdkCheckoutApi,
} from "@/modules/checkout/infrastructure/stripe/stripe-checkout-session-provider";
import type { PurchaseIntentRepository } from "@/modules/checkout/domain/purchase-intent-repository";
import { loadDataProtectionConfig } from "./config/data-protection-config";
import { loadCheckoutProviderMode } from "./config/checkout-provider-config";
import { loadRuntimeMode } from "./config/runtime-config";
import { loadStripeConfig } from "./config/stripe-config";
import { loadShopifyStorefrontConfig } from "./config/shopify-storefront-config";
import {
  getApplicationDatabaseClient,
  getWorkerDatabaseClient,
} from "./database/database-connections";
import { AesGcmDataProtector } from "./security/aes-gcm-data-protector";
import { ReceiveProviderWebhook } from "@/modules/payment/application/receive-provider-webhook";
import { ProcessProviderInbox } from "@/modules/payment/application/process-provider-inbox";
import { PostgresWebhookInbox } from "@/modules/payment/infrastructure/postgres-webhook-inbox";
import { StripeWebhookVerifier } from "@/modules/payment/infrastructure/stripe-webhook-verifier";
import { StripeCommerceEventProcessor } from "@/modules/payment/infrastructure/stripe-commerce-event-processor";
import { StripeEventReconciler } from "@/modules/payment/infrastructure/stripe-event-reconciler";
import { PostgresDataRetentionJob } from "./database/data-retention-job";
import { GetOrderStatus, type OrderStatusQuery } from "@/modules/order/public";
import { PostgresOrderStatusQuery } from "@/modules/order/infrastructure/postgres-order-status-query";

const productRepository = createProductRepository();
const purchaseIntentRepository = createPurchaseIntentRepository();
const createPurchaseIntent = new CreatePurchaseIntent(productRepository, purchaseIntentRepository);
const startCheckout = createStartCheckout(purchaseIntentRepository);

export const application = {
  listProducts: new ListProducts(productRepository),
  searchProducts: new SearchProducts(productRepository),
  getProduct: new GetProduct(productRepository),
  createPurchaseIntent,
  preparePurchase: new PreparePurchase(createPurchaseIntent, startCheckout),
  getOrderStatus: new GetOrderStatus(createOrderStatusQuery()),
};

function createOrderStatusQuery(): OrderStatusQuery {
  if (loadRuntimeMode() === "preview") {
    return { findByCheckoutReference: async () => null };
  }
  return new PostgresOrderStatusQuery(getApplicationDatabaseClient());
}

function createProductRepository(): ProductRepository {
  if (loadRuntimeMode() === "preview") return new InMemoryProductRepository();

  const config = loadShopifyStorefrontConfig();
  return new ShopifyProductRepository(
    new ShopifyStorefrontFetchClient(
      config,
      { buyerIp: getRequestBuyerIp },
    ),
    config.catalogTag,
  );
}

async function getRequestBuyerIp(): Promise<string | undefined> {
  try {
    const requestHeaders = await headers();
    const candidates = [
      requestHeaders.get("x-forwarded-for")?.split(",")[0].trim(),
      requestHeaders.get("x-real-ip")?.trim(),
    ];
    return candidates.find((candidate) => candidate && isIP(candidate));
  } catch {
    return undefined;
  }
}

function createPurchaseIntentRepository(): PurchaseIntentRepository {
  if (loadRuntimeMode() === "preview") return new InMemoryPurchaseIntentRepository();

  const sql = getApplicationDatabaseClient();
  const protector = new AesGcmDataProtector(loadDataProtectionConfig());
  return new PostgresPurchaseIntentRepository(sql, protector);
}

function createStartCheckout(intents: PurchaseIntentRepository): StartCheckout | undefined {
  const providerMode = loadCheckoutProviderMode();
  if (providerMode === "preview") return undefined;
  if (loadRuntimeMode() !== "production") {
    throw new Error("External checkout requires production runtime mode");
  }

  const config = loadStripeConfig();
  const provider = new StripeCheckoutSessionProvider(
    new StripeSdkCheckoutApi(config),
    config.apiVersion,
  );
  return new StartCheckout(intents, provider);
}

let stripeWebhookReceiver: ReceiveProviderWebhook | undefined;

export function getStripeWebhookReceiver(): ReceiveProviderWebhook {
  if (loadCheckoutProviderMode() !== "stripe" || loadRuntimeMode() !== "production") {
    throw new Error("Stripe webhook receiver is disabled");
  }
  if (stripeWebhookReceiver) return stripeWebhookReceiver;

  const config = loadStripeConfig();
  const protector = new AesGcmDataProtector(loadDataProtectionConfig());
  stripeWebhookReceiver = new ReceiveProviderWebhook(
    new StripeWebhookVerifier(config),
    new PostgresWebhookInbox(getWorkerDatabaseClient(), protector),
  );
  return stripeWebhookReceiver;
}

let stripeEventReconciler: StripeEventReconciler | undefined;
let stripeInboxProcessor: ProcessProviderInbox | undefined;
let commerceDataRetentionJob: PostgresDataRetentionJob | undefined;

export function getStripeEventReconciler(): StripeEventReconciler {
  if (loadCheckoutProviderMode() !== "stripe" || loadRuntimeMode() !== "production") {
    throw new Error("Stripe event reconciliation is disabled");
  }
  if (stripeEventReconciler) return stripeEventReconciler;

  const config = loadStripeConfig();
  const protector = new AesGcmDataProtector(loadDataProtectionConfig());
  const sql = getWorkerDatabaseClient();
  const inbox = new PostgresWebhookInbox(sql, protector);
  stripeEventReconciler = new StripeEventReconciler(
    sql,
    new StripeWebhookVerifier(config),
    inbox,
    config,
  );
  return stripeEventReconciler;
}

export function getStripeInboxProcessor(): ProcessProviderInbox {
  if (loadCheckoutProviderMode() !== "stripe" || loadRuntimeMode() !== "production") {
    throw new Error("Stripe inbox processing is disabled");
  }
  if (stripeInboxProcessor) return stripeInboxProcessor;

  const config = loadStripeConfig();
  const protector = new AesGcmDataProtector(loadDataProtectionConfig());
  const sql = getWorkerDatabaseClient();
  stripeInboxProcessor = new ProcessProviderInbox(
    new PostgresWebhookInbox(sql, protector),
    new StripeCommerceEventProcessor(sql, protector, config.taxBehavior),
  );
  return stripeInboxProcessor;
}

export function getCommerceDataRetentionJob(): PostgresDataRetentionJob {
  if (loadRuntimeMode() !== "production") {
    throw new Error("Commerce data retention is disabled");
  }
  commerceDataRetentionJob ??= new PostgresDataRetentionJob(getWorkerDatabaseClient());
  return commerceDataRetentionJob;
}
