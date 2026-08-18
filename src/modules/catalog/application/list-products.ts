import type { ProductRepository } from "../domain/product-repository";

export class ListProducts {
  constructor(private readonly products: ProductRepository) {}

  execute() {
    return this.products.findAvailable();
  }
}
