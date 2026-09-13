import { ReadShopifyReference } from "@/modules/payment/application/read-shopify-reference";
import { ShopifyAdminOrderReader } from "@/modules/payment/infrastructure/shopify/shopify-admin-order-reader";
import { loadShopifyAdminConfig } from "./config/shopify-admin-config";
import { loadShopifyWebhookConfig } from "./config/shopify-webhook-config";
import {
  ShopifyWebhookVerifier,
  type ShopifyWebhookHeaders,
} from "@/modules/payment/infrastructure/shopify-webhook-verifier";
import { GetProduct } from "@/modules/catalog/application/get-product";
import { ListProducts } from "@/modules/catalog/application/list-products";
import { SearchProducts } from "@/modules/catalog/application/search-products";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import type { ProductRepository } from "@/modules/catalog/public";
import { PostgresProductRepository } from "@/modules/catalog/infrastructure/postgres-product-repository";
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
import { loadCheckoutIntakeEnabled, loadCheckoutProviderMode } from "./config/checkout-provider-config";
import { loadRuntimeMode } from "./config/runtime-config";
import { loadStripeConfig } from "./config/stripe-config";
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
import { LookupPostalCode } from "@/modules/fulfillment/public";
import { ZipcloudPostalAddressRepository } from "@/modules/fulfillment/infrastructure/zipcloud-postal-address-repository";

const productRepository = createProductRepository();
const purchaseIntentRepository = createPurchaseIntentRepository();
const createPurchaseIntent = new CreatePurchaseIntent(
  productRepository,
  purchaseIntentRepository,
  undefined,
  acceptsNewCheckout,
);
const startCheckout = createStartCheckout(purchaseIntentRepository);

export const application = {
  listProducts: new ListProducts(productRepository),
  searchProducts: new SearchProducts(productRepository),
  getProduct: new GetProduct(productRepository),
  createPurchaseIntent,
  preparePurchase: new PreparePurchase(createPurchaseIntent, startCheckout),
  getOrderStatus: new GetOrderStatus(createOrderStatusQuery()),
  lookupPostalCode: new LookupPostalCode(new ZipcloudPostalAddressRepository()),
};

function createOrderStatusQuery(): OrderStatusQuery {
  if (loadRuntimeMode() === "preview") {
    return { findByCheckoutReference: async () => null };
  }
  return new PostgresOrderStatusQuery(getApplicationDatabaseClient());
}

function createProductRepository(): ProductRepository {
  if (loadRuntimeMode() === "preview") return new InMemoryProductRepository();

  return new PostgresProductRepository(getApplicationDatabaseClient());
}

function acceptsNewCheckout(): boolean {
  const enabled = loadCheckoutIntakeEnabled();
  // ADR 0009: native inventory reservation and buyer binding are still incomplete.
  // Settlement/reconciliation must remain available for existing transactions.
  return loadRuntimeMode() === "preview" && enabled;
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
  return new StartCheckout(intents, provider, undefined, acceptsNewCheckout);
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
    new PostgresWebhookInbox(getWorkerDatabaseClient(), protector, undefined, undefined, {
      provider: "STRIPE", accountId: config.accountId,
    }),
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
  const inbox = new PostgresWebhookInbox(sql, protector, undefined, undefined, {
    provider: "STRIPE", accountId: config.accountId,
  });
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
    new PostgresWebhookInbox(sql, protector, undefined, undefined, {
      provider: "STRIPE", accountId: config.accountId,
    }),
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

/** Capture-only receiver; deliberately no Shopify processor is composed into the worker. */
export function getShopifyWebhookReceiver(): ReceiveProviderWebhook<Uint8Array, ShopifyWebhookHeaders> | null {
  const config = loadShopifyWebhookConfig();
  if (!config) return null;
  const protector = new AesGcmDataProtector(loadDataProtectionConfig());
  return new ReceiveProviderWebhook(
    new ShopifyWebhookVerifier(config),
    new PostgresWebhookInbox(getWorkerDatabaseClient(), protector, undefined, undefined, {
      provider: "SHOPIFY", accountId: config.storeDomain,
    }),
  );
}

/** Read-only integration boundary; no Inbox worker or commerce writes are activated. */
export function getShopifyReferenceReader(): ReadShopifyReference | null {
  const config = loadShopifyAdminConfig();
  return config ? new ReadShopifyReference(new ShopifyAdminOrderReader(config)) : null;
}
