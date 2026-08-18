import type { Product, ProductId } from "./product";

export interface ProductRepository {
  findAvailable(): Promise<readonly Product[]>;
  findById(id: ProductId): Promise<Product | null>;
  findBySlug(slug: string): Promise<Product | null>;
}
