import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { money } from "@/shared/domain/money";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  application: {
    preparePurchase: { execute },
  },
}));

import { createPurchaseIntentAction } from "./actions";

describe("createPurchaseIntentAction", () => {
  beforeEach(() => {
    execute.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T00:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("returns a non-persistent preview summary without recipient PII", async () => {
    execute.mockResolvedValue({
      intent: {
        displayId: "BBI-20990101-1234",
        item: {
          productName: "春のひかり",
          quantity: 1,
          subtotal: money(6600),
        },
        recipient: {
          name: "花子",
          deliveryDate: "2026-08-28",
        },
      },
    });

    const state = await createPurchaseIntentAction({}, formData());

    expect(state).toEqual({
      draft: {
        displayId: "BBI-20990101-1234",
        productName: "春のひかり",
        quantity: 1,
        deliveryDate: "2026-08-28",
        subtotalAmount: 6600,
        formattedTotal: "￥6,600",
      },
    });
    expect(JSON.stringify(state)).not.toContain("花子");
    expect(JSON.stringify(state)).not.toContain("おめでとう");
  });

  it("does not call the application layer when form input is invalid", async () => {
    const invalid = formData();
    invalid.set("recipientName", "");

    const state = await createPurchaseIntentAction({}, invalid);

    expect(state.fieldErrors?.recipientName).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });
});

function formData(): FormData {
  const data = new FormData();
  data.set("requestId", "12345678-abcd-4000-8000-123456789012");
  data.set("productId", "prod_haru_01");
  data.set("quantity", "1");
  data.set("recipientName", "花子");
  data.set("deliveryDate", "2026-08-28");
  data.set("giftMessage", "おめでとう");
  return data;
}
