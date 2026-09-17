import { z } from "zod";
import { TRACKING_NUMBER_INPUT_MAX_LENGTH, NATIVE_CARRIER_CODES, NATIVE_FULFILLMENT_CANCEL_REASONS, NATIVE_FULFILLMENT_HOLD_REASONS } from "../domain/native-fulfillment";
import { FULFILLMENT_STATUSES } from "../domain/fulfillment-status";
const base = { fulfillmentId: z.uuid(), requestId: z.uuid(), expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) };
export const nativeFulfillmentCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("START_PREPARATION") }).strict(),
  z.object({ ...base, action: z.literal("MARK_READY") }).strict(),
  z.object({ ...base, action: z.literal("RESUME") }).strict(),
  z.object({ ...base, action: z.literal("MARK_DELIVERED") }).strict(),
  z.object({ ...base, action: z.literal("HOLD"), reason: z.enum(NATIVE_FULFILLMENT_HOLD_REASONS) }).strict(),
  z.object({ ...base, action: z.literal("CANCEL"), reason: z.enum(NATIVE_FULFILLMENT_CANCEL_REASONS) }).strict(),
  z.object({ ...base, action: z.literal("SHIP"), carrier: z.enum(NATIVE_CARRIER_CODES), trackingNumber: z.string().max(TRACKING_NUMBER_INPUT_MAX_LENGTH) }).strict(),
  z.object({ ...base, action: z.literal("CORRECT_TRACKING"), carrier: z.enum(NATIVE_CARRIER_CODES), trackingNumber: z.string().max(TRACKING_NUMBER_INPUT_MAX_LENGTH) }).strict(),
]);
export const nativeFulfillmentListSchema = z.object({
  status: z.enum(FULFILLMENT_STATUSES).nullable(), after: z.string().max(200).nullable(),
}).strict();
