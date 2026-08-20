import { GetProduct } from "@/modules/catalog/application/get-product";
import { ListProducts } from "@/modules/catalog/application/list-products";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import { CreatePurchaseIntent } from "@/modules/checkout/application/create-purchase-intent";
import { InMemoryPurchaseIntentRepository } from "@/modules/checkout/infrastructure/in-memory-purchase-intent-repository";
import { PostgresPurchaseIntentRepository } from "@/modules/checkout/infrastructure/postgres-purchase-intent-repository";
import type { PurchaseIntentRepository } from "@/modules/checkout/domain/purchase-intent-repository";
import { loadDataProtectionConfig } from "./config/data-protection-config";
import { loadDatabaseConfig } from "./config/database-config";
import { loadRuntimeMode } from "./config/runtime-config";
import { createPostgresClient } from "./database/postgres-client";
import { AesGcmDataProtector } from "./security/aes-gcm-data-protector";

const productRepository = new InMemoryProductRepository();
const purchaseIntentRepository = createPurchaseIntentRepository();

export const application = {
  listProducts: new ListProducts(productRepository),
  getProduct: new GetProduct(productRepository),
  createPurchaseIntent: new CreatePurchaseIntent(productRepository, purchaseIntentRepository),
};

function createPurchaseIntentRepository(): PurchaseIntentRepository {
  if (loadRuntimeMode() === "preview") return new InMemoryPurchaseIntentRepository();

  const sql = createPostgresClient(loadDatabaseConfig());
  const protector = new AesGcmDataProtector(loadDataProtectionConfig());
  return new PostgresPurchaseIntentRepository(sql, protector);
}
