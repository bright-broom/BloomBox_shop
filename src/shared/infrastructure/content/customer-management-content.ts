import { z } from 'zod';
import source from '../../../../content/customer-management.json';
const text = z.string().trim().min(1).max(600);
export const customerManagementContent = z.object({
  title: text, lead: text, searchLabel: text, searchHint: text, search: text, reset: text, statusLabel: text, all: text,
  empty: text, registeredAt: text, customerId: text, history: text, historyTitle: text, historyLead: text, ordersEmpty: text,
  orderNumber: text, orderedAt: text, total: text, orderStatus: text, payment: text, fulfillment: text, unknown: text,
  multiple: text, next: text, first: text, back: text, login: text, anonymized: text, scope: text,
  statuses: z.object({ ACTIVE: text, DISABLED: text, ANONYMIZED: text }).strict(),
  orderStatuses: z.record(z.string(), text), paymentStatuses: z.record(z.string(), text), fulfillmentStatuses: z.record(z.string(), text),
  messages: z.object({ INVALID: text, UNAVAILABLE: text }).strict(),
}).strict().parse(source);
