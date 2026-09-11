import { z } from "zod";
import source from "../../../../content/fulfillment-approval.json";
const text = z.string().trim().min(1).max(600);
export const fulfillmentApprovalContent = z.object({
  title: text, note: text, acknowledgement: text, submit: text, submitting: text, refresh: text, deadline: text, expired: text,
  POLICY_PENDING: text, REVIEW_REQUIRED: text, RECORDED: text,
  messages: z.object({ IDLE: z.literal(""), RECORDED: text, DUPLICATE: text, INVALID_REQUEST: text,
    NOT_AUTHORIZED: text, REVIEW_REQUIRED: text, CONFLICT: text, UNAVAILABLE: text, RATE_LIMITED: text }).strict(),
}).strict().parse(source);
