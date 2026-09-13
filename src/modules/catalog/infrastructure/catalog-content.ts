import catalog from "../../../../content/catalog.json";
import { z } from "zod";
import { money } from "@/shared/domain/money";
import { productId, type Product } from "../domain/product";

const catalogItemSchema = z.object({
  id: z.string().regex(/^prod_[a-z0-9_]+$/),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  priceAmount: z.number().int().nonnegative(),
  imageUrl: z.union([z.url(), z.string().regex(/^\/images\/products\/[a-z0-9-]+\.(?:png|webp|jpg)$/)]),
  imageAlt: z.string().trim().min(1).max(160),
  palette: z.string().trim().min(1).max(100),
  occasion: z.array(z.string().trim().min(1)).min(1),
  flowers: z.array(z.string().trim().min(1)).min(1),
  grower: z.string().trim().min(1).max(120),
  available: z.boolean(),
  previewOffer: z.object({ family: z.string().regex(/^[a-z-]+$/), size: z.enum(["M", "L"]), shippingAmount: z.number().int().nonnegative() }).optional(),
});

const catalogSchema = z.array(catalogItemSchema).min(1).superRefine((items, context) => {
  for (const key of ["id", "slug"] as const) {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item[key])) {
        context.addIssue({
          code: "custom",
          message: `Duplicate catalog ${key}: ${item[key]}`,
          path: [index, key],
        });
      }
      seen.add(item[key]);
    });
  }
});

export function loadCatalog(input: unknown = catalog): readonly Product[] {
  return catalogSchema.parse(input).map((item) => ({
    id: productId(item.id),
    externalReference: item.id,
    slug: item.slug,
    name: item.name,
    subtitle: item.subtitle,
    description: item.description,
    price: money(item.priceAmount),
    imageUrl: item.imageUrl,
    imageAlt: item.imageAlt,
    palette: item.palette,
    occasion: item.occasion,
    flowers: item.flowers,
    grower: item.grower,
    available: item.available,
    previewOffer: item.previewOffer,
  }));
}
