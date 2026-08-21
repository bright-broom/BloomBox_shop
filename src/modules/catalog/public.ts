export type { ProductRepository } from "./domain/product-repository";
export { productId, type Product, type ProductId } from "./domain/product";
export {
  PRODUCT_SORT_OPTIONS,
  PRODUCT_SEARCH_QUERY_MAX_LENGTH,
  SearchProducts,
  type ProductSearchCriteria,
  type ProductSearchResult,
  type ProductSort,
} from "./application/search-products";
