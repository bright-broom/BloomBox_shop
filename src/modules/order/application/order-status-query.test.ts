import { describe, expect, it } from "vitest";
import { money } from "@/shared/domain/money";
import {
  GetOrderStatus,
  InvalidOrderTrackingReferenceError,
  type OrderStatusQuery,
  type OrderStatusRecord,
} from "./order-status-query";

const purchaseIntentId = "12345678-abcd-4000-8000-123456789012";

describe("GetOrderStatus", () => {
  it("maps payment and fulfillment facts without exposing personal data", async () => {
    const useCase = new GetOrderStatus(query({
      orderDisplayId: "BB-20260821-123456",
      orderStatus: "CONFIRMED",
      paymentStatus: "CAPTURED",
      fulfillmentStatus: "SHIPPED",
      total: money(7700),
      carrierCode: "YAMATO",
      trackingReference: "123456789012",
    }));

    await expect(useCase.execute("cs_test_12345678")).resolves.toEqual({
      progress: "SHIPPED",
      displayId: "BB-20260821-123456",
      purchaseIntentId,
      orderCreated: true,
      productId: "prod_sora_01",
      productName: "空の余白",
      quantity: 1,
      deliveryDate: "2026-08-28",
      total: money(7700),
      carrierCode: "YAMATO",
      trackingReference: "123456789012",
    });
  });

  it("keeps checkout processing while the verified webhook is pending", async () => {
    const useCase = new GetOrderStatus(query());

    await expect(useCase.execute("cs_test_12345678")).resolves.toMatchObject({
      progress: "PROCESSING",
      displayId: "BBI-20260821-1234",
      purchaseIntentId,
      orderCreated: false,
    });
  });

  it.each([
    ["ABANDONED", "PAYMENT_FAILED"],
    ["EXPIRED", "CHECKOUT_EXPIRED"],
  ] as const)("turns terminal checkout status %s into a recoverable customer state", async (
    purchaseIntentStatus,
    progress,
  ) => {
    const useCase = new GetOrderStatus(query({ purchaseIntentStatus }));

    await expect(useCase.execute("cs_test_12345678")).resolves.toMatchObject({ progress, orderCreated: false });
  });

  it.each(["PENDING_CONFIRMATION", "CANCELLED", "CLOSED"])("reports an existing %s order as created", async (orderStatus) => {
    const useCase = new GetOrderStatus(query({ purchaseIntentStatus: "CONVERTED", orderStatus }));

    await expect(useCase.execute("cs_test_12345678")).resolves.toMatchObject({ orderCreated: true });
  });

  it("reports partial refunds independently of order fulfillment", async () => {
    const useCase = new GetOrderStatus(query({
      orderStatus: "CONFIRMED",
      paymentStatus: "PARTIALLY_REFUNDED",
      fulfillmentStatus: "DELIVERED",
    }));

    await expect(useCase.execute("cs_test_12345678")).resolves.toMatchObject({
      progress: "PARTIALLY_REFUNDED",
    });
  });

  it("rejects untrusted checkout references before querying storage", async () => {
    const repository = query();
    const useCase = new GetOrderStatus(repository);

    await expect(useCase.execute("not-a-checkout")).rejects
      .toBeInstanceOf(InvalidOrderTrackingReferenceError);
  });
});

function query(overrides: Partial<OrderStatusRecord> = {}): OrderStatusQuery {
  return {
    findByCheckoutReference: async () => ({
      purchaseIntentId,
      purchaseIntentStatus: "CHECKOUT_CREATED",
      purchaseIntentDisplayId: "BBI-20260821-1234",
      productId: "prod_sora_01",
      productName: "空の余白",
      quantity: 1,
      deliveryDate: "2026-08-28",
      ...overrides,
    }),
  };
}
