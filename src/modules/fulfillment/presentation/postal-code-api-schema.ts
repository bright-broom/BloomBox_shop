import { z } from "zod";
import { isValidPostalCode, JAPAN_PREFECTURES } from "../domain/postal-address";

export const postalCodeLookupRequestSchema = z.object({
  postalCode: z.string().max(32).refine(isValidPostalCode),
}).strict();

const postalAddressSchema = z.object({
  prefecture: z.enum(JAPAN_PREFECTURES),
  city: z.string().min(1).max(100),
  town: z.string().max(120),
});

export const postalCodeLookupResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    postalCode: z.string().regex(/^\d{3}-\d{4}$/),
    addresses: z.array(postalAddressSchema).min(1).max(20),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["invalid_postal_code", "not_found", "temporarily_unavailable"]),
    message: z.string().min(1).max(160),
  }),
]);

export type PostalCodeLookupApiResponse = z.infer<typeof postalCodeLookupResponseSchema>;
