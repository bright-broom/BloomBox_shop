import { z } from "zod";
import content from "../../../../content/fulfillment-review.json";
const text = z.string().trim().min(1).max(600);
export const fulfillmentReviewContentSchema = z.object({
  title: text, lead: text, previewTitle: text, previewNotice: text, scenariosLabel: text,
  scenarios: z.object({ pending: text, expired: text, refund: text, recorded: text }),
  order: text, delivery: text, reference: text, version: text, checks: text, payment: text, stock: text, quantities: text,
  total: text, captured: text, refunded: text, quantityUnit: text, paymentCurrent: text, paymentChanged: text,
  stockCovered: text, stockHeld: text, stockUnknown: text, stockNote: text, checkedAt: text, expiresAt: text, unavailable: text,
  ordered: text, shipped: text, delivered: text, quantityMatched: text, quantityUnknown: text,
  approval: text, pendingTitle: text, reviewTitle: text, recordedTitle: text, pendingNote: text, reviewNote: text, recordedNote: text,
  recordedAt: text, recordedVersion: text, recordExpiresAt: text, viewedAt: text, observedAt: text,
  connectionTitle: text, connectionNote: text, back: text,
  orderState: text, fulfillmentState: text,
  orderStates: z.object({ PENDING_CONFIRMATION: text, CONFIRMED: text, CANCELLED: text, CLOSED: text }),
  fulfillmentStates: z.object({ UNFULFILLED: text, SCHEDULED: text, PROCESSING: text, READY: text, SHIPPED: text,
    DELIVERED: text, CANCELLED: text, RETURNED: text, ON_HOLD: text }),
}).strict();
export const fulfillmentReviewContent = fulfillmentReviewContentSchema.parse(content);
