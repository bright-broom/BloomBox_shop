import type { ProductRepository } from "../domain/product-repository";
import type { Product } from "../domain/product";

export const PRODUCT_SORT_OPTIONS = ["featured", "price-asc", "price-desc", "name"] as const;
export const PRODUCT_SEARCH_QUERY_MAX_LENGTH = 80;
export type ProductSort = (typeof PRODUCT_SORT_OPTIONS)[number];

export type ProductSearchCriteria = Readonly<{
  query?: string;
  occasion?: string;
  sort?: ProductSort;
}>;

export type ProductSearchResult = Readonly<{
  products: readonly Product[];
  occasions: readonly string[];
  total: number;
}>;

export class SearchProducts {
  constructor(private readonly products: ProductRepository) {}

  async execute(criteria: ProductSearchCriteria = {}): Promise<ProductSearchResult> {
    const available = await this.products.findAvailable();
    const query = normalizeSearchText(criteria.query ?? "");
    const occasion = criteria.occasion?.trim() ?? "";
    const filtered = available.filter((product) => {
      if (occasion && !product.occasion.includes(occasion)) return false;
      if (!query) return true;
      return searchableText(product).includes(query);
    });

    return {
      products: sortProducts(filtered, criteria.sort ?? "featured"),
      occasions: [...new Set(available.flatMap((product) => product.occasion))]
        .sort((left, right) => left.localeCompare(right, "ja")),
      total: available.length,
    };
  }
}

function searchableText(product: Product): string {
  return normalizeSearchText([
    product.name,
    product.subtitle,
    product.description,
    product.grower,
    ...product.occasion,
    ...product.flowers,
  ].join(" "));
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja");
}

function sortProducts(products: readonly Product[], sort: ProductSort): readonly Product[] {
  const sorted = [...products];
  if (sort === "price-asc") {
    return sorted.sort((left, right) => left.price.amount - right.price.amount);
  }
  if (sort === "price-desc") {
    return sorted.sort((left, right) => right.price.amount - left.price.amount);
  }
  if (sort === "name") {
    return sorted.sort((left, right) => left.name.localeCompare(right.name, "ja"));
  }
  return sorted;
}
