import content from "../../../../content/gift-experience.json";
import { z } from "zod";

const copy = z.string().trim().min(1).max(500);
export const giftExperienceSchema = z.object({
  cart: z.object({ removeError: copy }),
  storageUnavailable: z.object({ title: copy, message: copy, retry: copy, browse: copy }),
  metrics: z.object({ title: copy, notice: copy, start: copy, stop: copy, refresh: copy, error: copy, referral: copy, labels: z.object({ product_view: copy, size_select: copy, gift_start: copy, begin_checkout: copy, preview_purchase: copy, recipient_page_view: copy }) }),
  loading: z.object({ title: copy, note: copy, tipLabel: copy, tips: z.array(copy).min(1).max(5), payment: copy, cart: copy }),
  checkoutCleanup: z.object({ pending: copy, retry: copy, error: copy, complete: copy, changed: copy, cart: copy }),
  launch: z.object({ title: copy, lead: copy, notice: copy, sizeLabel: copy, productLabel: copy, shippingLabel: copy, totalLabel: copy, details: copy, quantityNote: copy, action: copy, selected: copy, taxNote: copy, sizeChangeNote: copy }),
  recipient: z.object({ title: copy, lead: copy, notice: copy, action: copy, disabledAction: copy, privacy: copy, label: copy }),
  preview: z.object({ navLabel: copy, title: copy, lead: copy, loadingTitle: copy, loadingNote: copy, benefitLabel: copy, catalogLabel: copy, recipientLabel: copy }),
});
export const giftExperienceContent = Object.freeze(giftExperienceSchema.parse(content));
