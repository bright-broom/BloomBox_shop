import { GetProduct } from "@/modules/catalog/application/get-product";
import { ListProducts } from "@/modules/catalog/application/list-products";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import { CreatePurchaseIntent } from "@/modules/checkout/application/create-purchase-intent";
import { InMemoryPurchaseIntentRepository } from "@/modules/checkout/infrastructure/in-memory-purchase-intent-repository";

const productRepository = new InMemoryProductRepository();
const purchaseIntentRepository = new InMemoryPurchaseIntentRepository();

export const application = {
  listProducts: new ListProducts(productRepository),
  getProduct: new GetProduct(productRepository),
  createPurchaseIntent: new CreatePurchaseIntent(productRepository, purchaseIntentRepository),
};
