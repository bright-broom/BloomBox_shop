import { InsufficientInventoryError } from "@/modules/inventory/public";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { money } from "@/shared/domain/money";
import { PurchaseCustomerMismatchError } from "../domain/purchase-customer";
import { CheckoutPreparationUnavailableError } from "../application/checkout-session-provider";
import { CheckoutPausedError } from "../application/checkout-paused-error";
import {
  PurchaseCancellationUnavailableError,
  PurchaseCancellationUnconfirmedError,
} from "../application/cancel-purchase-intent";
import { PurchaseIntentNotFoundError } from "../application/start-checkout";

const { execute, cancel } = vi.hoisted(() => ({ execute: vi.fn(), cancel: vi.fn() }));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  application: {
    preparePurchase: { execute },
    cancelPurchaseIntent: { execute: cancel },
    getProduct: { byId: async () => ({ available: true }) },
  },
}));

import { cancelPurchaseIntentAction, createPurchaseIntentAction } from "./actions";

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
        requestId: "12345678-abcd-4000-8000-123456789012",
        displayId: "BBI-20990101-1234",
        productName: "春のひかり",
        quantity: 1,
        deliveryDate: "2026-08-28",
        subtotalAmount: 6600,
        shippingAmount: 1100,
        formattedTotal: "￥6,600",
      },
    });
    expect(JSON.stringify(state)).not.toContain("花子");
    expect(JSON.stringify(state)).not.toContain("おめでとう");
  });

  it("ignores forged customer fields and returns no order data on ownership mismatch", async () => {
    const forged = formData();
    forged.set("customerId", "forged-customer"); forged.set("customerVersion", "1");
    execute.mockRejectedValue(new PurchaseCustomerMismatchError());
    const result = await createPurchaseIntentAction({}, forged);
    expect(execute.mock.calls[0][0]).not.toHaveProperty("customerId");
    expect(execute.mock.calls[0][0]).not.toHaveProperty("customerVersion");
    expect(result).toEqual({ error: new PurchaseCustomerMismatchError().message });
  });

  it("returns stock shortage guidance without a draft or payment redirect", async () => {
    execute.mockRejectedValue(new InsufficientInventoryError());
    expect(await createPurchaseIntentAction({}, formData())).toEqual({ error: new InsufficientInventoryError().message });
  });

  it("returns retry guidance for local preparation failure without a draft or redirect", async () => {
    execute.mockRejectedValue(new CheckoutPreparationUnavailableError());
    expect(await createPurchaseIntentAction({}, formData())).toEqual({ error: new CheckoutPreparationUnavailableError().message });
  });

  it("does not call the application layer when form input is invalid", async () => {
    const invalid = formData();
    invalid.set("recipientName", "");

    const state = await createPurchaseIntentAction({}, invalid);

    expect(state.fieldErrors?.recipientName).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns an expected pause message without a checkout redirect or draft", async () => {
    execute.mockRejectedValue(new CheckoutPausedError());
    const state = await createPurchaseIntentAction({}, formData());
    expect(state).toEqual({ error: new CheckoutPausedError().message });
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

describe("cancelPurchaseIntentAction", () => {
  const requestId = "12345678-abcd-4000-8000-123456789012";
  beforeEach(() => { cancel.mockReset(); });
  afterEach(() => vi.restoreAllMocks());

  it.each(["not-a-uuid", "", { requestId }, null])("rejects a malformed request before reaching the use case: %j", async (value) => {
    const result = await cancelPurchaseIntentAction(value);
    expect(result).toHaveProperty("error");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("lets the browser remove its cart only after the server-side cancellation succeeds", async () => {
    cancel.mockResolvedValue("EXPIRY_CONFIRMED");
    await expect(cancelPurchaseIntentAction(requestId)).resolves.toEqual({ status: "cancelled" });
    expect(cancel).toHaveBeenCalledExactlyOnceWith(requestId);
  });

  it("treats a cart that never prepared a purchase as having nothing reserved", async () => {
    cancel.mockRejectedValue(new PurchaseIntentNotFoundError());
    await expect(cancelPurchaseIntentAction(requestId)).resolves.toEqual({ status: "not_prepared" });
  });

  it("lets the browser clear a stale cart for a checkout that was already completed", async () => {
    cancel.mockResolvedValue("CHECKOUT_COMPLETED");
    await expect(cancelPurchaseIntentAction(requestId)).resolves.toEqual({ status: "completed" });
  });

  it("keeps an unconfirmed provider result observable while showing its retry message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new PurchaseCancellationUnconfirmedError({ cause: new Error("private provider detail") });
    cancel.mockRejectedValue(error);
    const result = await cancelPurchaseIntentAction(requestId);
    if (!("error" in result)) throw new Error("Expected an error result");
    expect(result.error).toContain(error.message);
    expect(result.error).toContain("エラー ID");
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.stringify(logged.mock.calls)).not.toContain("private provider detail");
  });

  it.each([
    new PurchaseCustomerMismatchError(),
    new PurchaseCancellationUnavailableError(),
  ])("returns the customer-safe business message for $name", async (error) => {
    cancel.mockRejectedValue(error);
    await expect(cancelPurchaseIntentAction(requestId)).resolves.toEqual({ error: error.message });
  });

  it("reports an unexpected failure without exposing its detail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    cancel.mockRejectedValue(new Error("private provider detail"));
    const result = await cancelPurchaseIntentAction(requestId);
    if (!("error" in result)) throw new Error("Expected an error result");
    expect(result.error).toContain("エラー ID");
    expect(result.error).not.toContain("private provider detail");
  });
});
