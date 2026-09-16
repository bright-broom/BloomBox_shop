import { JAPAN_PREFECTURES } from "@/modules/fulfillment/public";
import { z } from "zod";
import { ACCOUNT_LIMITS } from "../domain/customer-portal";
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
export const phoneSchema = z
  .string()
  .trim()
  .max(ACCOUNT_LIMITS.phone)
  .refine(
    (v) =>
      v === "" ||
      (/^\+?[0-9 ()-]{10,20}$/.test(v) &&
        v.replace(/\D/g, "").length >= 10 &&
        v.replace(/\D/g, "").length <= 15),
  );
export const addressSchema = z
  .object({
    id: z.uuid(),
    label: text(ACCOUNT_LIMITS.label).min(1),
    name: text(ACCOUNT_LIMITS.name).min(1),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{3}-?\d{4}$/),
    prefecture: z.enum(JAPAN_PREFECTURES),
    city: text(ACCOUNT_LIMITS.city).min(1),
    line1: text(ACCOUNT_LIMITS.addressLine).min(1),
    line2: text(ACCOUNT_LIMITS.addressLine),
    phone: phoneSchema.refine((v) => v.length > 0),
  })
  .strict();
export const productReferenceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,100}$/);
export const preferencesSchema = z
  .object({
    name: text(ACCOUNT_LIMITS.name),
    phone: phoneSchema,
    marketing: z.boolean(),
    marketingEmail: z.email().max(254).nullable(),
    addresses: z.array(addressSchema).max(ACCOUNT_LIMITS.addresses),
    defaultAddressId: z.uuid().nullable(),
    favorites: z.array(productReferenceSchema).max(ACCOUNT_LIMITS.favorites),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.addresses.map((a) => a.id)).size === v.addresses.length &&
      new Set(v.favorites).size === v.favorites.length &&
      (v.defaultAddressId === null ||
        v.addresses.some((a) => a.id === v.defaultAddressId)),
  );
export const actorSchema = z.object({
  customerId: z.uuid(),
  version: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});
export const revisionSchema = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const requestInputSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["ORDER", "CANCELLATION", "RETURN", "DELIVERY", "OTHER"]),
    orderId: z.uuid().nullable(),
    message: z
      .string()
      .trim()
      .min(1)
      .max(ACCOUNT_LIMITS.message)
      .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)),
  })
  .strict();
export const requestBodySchema = z
  .object({
    message: requestInputSchema.shape.message,
    reply: z.string().max(ACCOUNT_LIMITS.message),
  })
  .strict();
export const changeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("profile"),
      name: text(ACCOUNT_LIMITS.name).min(1),
      phone: phoneSchema,
    })
    .strict(),
  z.object({ kind: z.literal("address"), address: addressSchema }).strict(),
  z
    .object({
      kind: z.enum(["remove-address", "default-address"]),
      id: z.uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.enum(["favorite", "unfavorite"]),
      productId: productReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("marketing"),
      enabled: z.boolean(),
      verifiedEmail: z.email().max(254),
    })
    .strict(),
]);
