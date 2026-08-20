import { beforeEach, describe, expect, it, vi } from "vitest";
import { money } from "@/shared/domain/money";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  application: {
    createOrder: { execute },
  },
}));

import { createOrderAction } from "./actions";

describe("createOrderAction", () => {
  beforeEach(() => execute.mockReset());

  it("returns a non-persistent preview summary without recipient PII", async () => {
    execute.mockResolvedValue({
      displayId: "BB-20990101-1234",
      item: {
        productName: "春のひかり",
        subtotal: money(6600),
      },
      recipient: {
        name: "花子",
        deliveryDate: "2099-01-01",
      },
    });

    const state = await createOrderAction({}, formData());

    expect(state).toEqual({
      draft: {
        displayId: "BB-20990101-1234",
        productName: "春のひかり",
        deliveryDate: "2099-01-01",
        formattedTotal: "￥6,600",
      },
    });
    expect(JSON.stringify(state)).not.toContain("花子");
    expect(JSON.stringify(state)).not.toContain("おめでとう");
  });

  it("does not call the application layer when form input is invalid", async () => {
    const invalid = formData();
    invalid.set("recipientName", "");

    const state = await createOrderAction({}, invalid);

    expect(state.fieldErrors?.recipientName).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });
});

function formData(): FormData {
  const data = new FormData();
  data.set("productId", "prod_haru_01");
  data.set("recipientName", "花子");
  data.set("deliveryDate", "2099-01-01");
  data.set("giftMessage", "おめでとう");
  return data;
}
