import { z } from "zod";
import source from "../../../../content/customer-account.json";
const text = z.string().trim().min(1).max(600);
export const customerAccountContent = z.object({
  title: text, eyebrow: text, lead: text, loading: text, signIn: text, signOut: text, loginTitle: text, loginNote: text,
  disabledTitle: text, disabledNote: text, error: text, expired: text, loginError: text, retry: text,
  ordersTitle: text, ordersNote: text, emptyTitle: text, emptyNote: text, profileTitle: text, name: text, email: text,
  notRegistered: text, profileNote: text, orderNumber: text, orderDate: text, total: text, totalNote: text,
  payment: text, fulfillment: text, cancelled: text, next: text, first: text, browse: text,
  support: text, supportNote: text, contact: text, previewTitle: text, previewNote: text, previewLink: text,
  scenariosLabel: text, sessionNote: text, sampleName: text, sampleEmail: z.email(),
  scenarios: z.object({ orders: text, empty: text, "signed-out": text, expired: text, unavailable: text }).strict(),
  payments: z.record(z.string(), text).refine((value) => Boolean(value.UNKNOWN)),
  fulfillments: z.record(z.string(), text).refine((value) => Boolean(value.UNKNOWN)),
}).strict().parse(source);
