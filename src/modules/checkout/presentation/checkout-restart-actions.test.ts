import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEarliestDeliveryDate } from "@/modules/fulfillment/public";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";
import {
  CheckoutWindowExpiredError,
  PurchaseCheckoutClosedError,
  PurchaseCheckoutCompletedError,
} from "../application/start-checkout";
import { PurchaseIntentIdempotencyConflictError } from "../application/create-purchase-intent";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  application: {
    preparePurchase: { execute },
    cancelPurchaseIntent: { execute: vi.fn() },
    getProduct: { byId: async () => ({ available: true }) },
  },
}));

import { createPurchaseIntentAction } from "./actions";

function formData() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    requestId: "12345678-abcd-4000-8000-123456789012", productId: "prod_bloombox_m", quantity: "1",
    recipientName: "テスト", deliveryDate: getEarliestDeliveryDate(), giftMessage: "テスト",
  })) data.set(key, value);
  return data;
}

describe("createPurchaseIntentAction for a purchase that already ended", () => {
  let logged: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    execute.mockReset();
    logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([new PurchaseCheckoutClosedError(), new CheckoutWindowExpiredError()])(
    "asks the browser to restart under a new request for $name without reporting a fault",
    async (error) => {
      execute.mockRejectedValue(error);
      await expect(createPurchaseIntentAction({}, formData()))
        .resolves.toEqual({ restart: true, error: giftExperienceContent.cart.checkoutRestartRequired });
      expect(logged).not.toHaveBeenCalled();
    },
  );

  it("asks the browser to clear a cart whose checkout was already completed", async () => {
    execute.mockRejectedValue(new PurchaseCheckoutCompletedError());
    await expect(createPurchaseIntentAction({}, formData())).resolves.toEqual({ completed: true });
    expect(logged).not.toHaveBeenCalled();
  });

  it("explains a reused request with different contents instead of reporting a fault", async () => {
    const error = new PurchaseIntentIdempotencyConflictError();
    execute.mockRejectedValue(error);
    await expect(createPurchaseIntentAction({}, formData())).resolves.toEqual({ error: error.message });
    expect(logged).not.toHaveBeenCalled();
  });

  it("still reports an unexpected failure", async () => {
    execute.mockRejectedValue(new Error("private detail"));
    const result = await createPurchaseIntentAction({}, formData());
    expect(result.error).toContain("エラー ID");
    expect(result.error).not.toContain("private detail");
    expect(logged).toHaveBeenCalledOnce();
  });
});
