import type { ProductRepository } from "../domain/product-repository";
import type { Product, ProductId } from "../domain/product";
import { loadCatalog } from "./catalog-content";

export class InMemoryProductRepository implements ProductRepository {
  constructor(private readonly products: readonly Product[] = loadCatalog()) {}

  async findAvailable(): Promise<readonly Product[]> {
    return this.products.filter((product) => product.available);
  }

  async findById(id: ProductId): Promise<Product | null> {
    return this.products.find((product) => product.id === id) ?? null;
  }

  async findBySlug(slug: string): Promise<Product | null> {
    return this.products.find((product) => product.slug === slug) ?? null;
  }
}
