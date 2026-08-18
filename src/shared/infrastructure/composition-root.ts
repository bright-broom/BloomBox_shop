import { GetProduct } from "@/modules/catalog/application/get-product";
import { ListProducts } from "@/modules/catalog/application/list-products";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import { CreateOrder } from "@/modules/order/application/create-order";
import { GetOrder } from "@/modules/order/application/get-order";
import { InMemoryOrderRepository } from "@/modules/order/infrastructure/in-memory-order-repository";

const productRepository = new InMemoryProductRepository();
const orderRepository = new InMemoryOrderRepository();

export const application = {
  listProducts: new ListProducts(productRepository),
  getProduct: new GetProduct(productRepository),
  createOrder: new CreateOrder(productRepository, orderRepository),
  getOrder: new GetOrder(orderRepository),
};
