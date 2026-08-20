import { describe, expect, it, vi } from "vitest";
import { money } from "@/shared/domain/money";
import {
  catalogProductReference,
  commerceProductReference,
  PurchaseIntent,
  purchaseIntentId,
} from "../../domain/purchase-intent";
import { giftMessage, recipientName } from "../../domain/purchase-intent-policy";
import {
  StripeCheckoutSessionProvider,
  type StripeCheckoutApi,
} from "./stripe-checkout-session-provider";

describe("StripeCheckoutSessionProvider", () => {
  it("sends price snapshots and internal references without recipient PII", async () => {
    const create = vi.fn<StripeCheckoutApi["create"]>().mockResolvedValue({
      id: "cs_test_123",
      purchaseIntentId: "12345678-abcd-4000-8000-123456789012",
      url: "https://checkout.stripe.test/session",
      expiresAt: new Date("2026-08-21T23:00:00.000Z"),
    });
    const api: StripeCheckoutApi = {
      create,
      retrieve: vi.fn<StripeCheckoutApi["retrieve"]>(),
    };
    const provider = new StripeCheckoutSessionProvider(api, "2026-07-29.dahlia");

    await provider.create(createIntent(), "stable-idempotency-key");

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      purchaseIntentId: "12345678-abcd-4000-8000-123456789012",
      productId: "prod_haru_01",
      externalProductReference: "gid://shopify/ProductVariant/123",
      productName: "春のひかり",
      quantity: 1,
      unitAmount: 6600,
      currency: "JPY",
      idempotencyKey: "stable-idempotency-key",
    }));
    const serialized = JSON.stringify(create.mock.calls[0][0]);
    expect(serialized).not.toContain("花子");
    expect(serialized).not.toContain("おめでとう");
  });
});

function createIntent(): PurchaseIntent {
  const intent = PurchaseIntent.create({
    id: purchaseIntentId("12345678-abcd-4000-8000-123456789012"),
    displayId: "BBI-20260821-1234",
    item: {
      productId: catalogProductReference("prod_haru_01"),
      externalProductReference: commerceProductReference("gid://shopify/ProductVariant/123"),
      productName: "春のひかり",
      quantity: 1,
      unitPriceSnapshot: money(6600),
      subtotal: money(6600),
    },
    recipient: { name: recipientName("花子"), deliveryDate: "2026-08-28" },
    giftMessage: giftMessage("おめでとう"),
    createdAt: new Date("2026-08-21T00:00:00.000Z"),
  });
  intent.transitionTo("READY_FOR_CHECKOUT");
  return intent;
}
