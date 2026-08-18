import type { ProductRepository } from "../domain/product-repository";
import type { ProductId } from "../domain/product";

export class GetProduct {
  constructor(private readonly products: ProductRepository) {}

  byId(id: ProductId) {
    return this.products.findById(id);
  }

  bySlug(slug: string) {
    return this.products.findBySlug(slug);
  }
}
