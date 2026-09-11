import { z } from "zod";
import source from "../../../../content/operator-permissions.json";
const text = z.string().trim().min(1).max(600);
export const operatorPermissionsContent = z.object({ title: text, deniedTitle: text, lead: text, shopLabel: text, shopHint: text, search: text, empty: text,
  registration: text, registrationHint: text, status: text, active: text, expired: text, disabled: text, validUntil: text, version: text,
  history: text, revokedBy: text, reason: text, selectReason: text, acknowledgement: text, effect: text, submit: text, submitting: text,
  refresh: text, next: text, first: text, login: text, invalid: text, unavailable: text,
  reasons: z.object({ ACCESS_NO_LONGER_REQUIRED: text, ROLE_CHANGE: text, SECURITY_RESPONSE: text }).strict(),
  messages: z.object({ IDLE: z.literal(""), REVOKED: text, DUPLICATE: text, INVALID_REQUEST: text, NOT_AUTHORIZED: text,
    REVIEW_REQUIRED: text, CONFLICT: text, UNAVAILABLE: text, RATE_LIMITED: text }).strict(),
}).strict().parse(source);
