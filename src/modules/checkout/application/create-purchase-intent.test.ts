import { describe, expect, it } from "vitest";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import { DeliveryDateUnavailableError } from "@/modules/fulfillment/public";
import { InMemoryPurchaseIntentRepository } from "../infrastructure/in-memory-purchase-intent-repository";
import {
  GIFT_MESSAGE_MAX_LENGTH,
  InvalidPurchaseIntentInputError,
} from "../domain/purchase-intent-policy";
import { CreatePurchaseIntent } from "./create-purchase-intent";

describe("CreatePurchaseIntent", () => {
  it("uses the server-side catalog price snapshot without creating an order", async () => {
    const products = new InMemoryProductRepository();
    const intents = new InMemoryPurchaseIntentRepository();
    const useCase = new CreatePurchaseIntent(
      products,
      intents,
      () => new Date("2026-08-19T00:00:00.000Z"),
      () => "12345678-abcd-4000-8000-123456789012",
    );

    const intent = await useCase.execute({
      productId: "prod_haru_01",
      recipientName: "花子",
      deliveryDate: "2026-08-25",
      giftMessage: "おめでとう",
    });

    expect(intent.item.unitPriceSnapshot.amount).toBe(6600);
    expect(intent.item.subtotal.amount).toBe(6600);
    expect(intent.status).toBe("READY_FOR_CHECKOUT");
    expect(intent.displayId).toBe("BBI-20260819-1234");
    expect(intent.expiresAt.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(intent.piiRetentionExpiresAt.toISOString()).toBe("2026-09-18T00:00:00.000Z");
  });

  it("enforces fulfillment policy outside the presentation layer", async () => {
    const useCase = createUseCase();

    await expect(useCase.execute(validInput({ deliveryDate: "2026-08-21" })))
      .rejects.toBeInstanceOf(DeliveryDateUnavailableError);
  });

  it("enforces gift policy outside the presentation layer", async () => {
    const useCase = createUseCase();

    await expect(useCase.execute(validInput({ giftMessage: "花".repeat(GIFT_MESSAGE_MAX_LENGTH + 1) })))
      .rejects.toBeInstanceOf(InvalidPurchaseIntentInputError);
  });
});

function createUseCase(): CreatePurchaseIntent {
  return new CreatePurchaseIntent(
    new InMemoryProductRepository(),
    new InMemoryPurchaseIntentRepository(),
    () => new Date("2026-08-19T00:00:00.000Z"),
    () => "12345678-abcd-4000-8000-123456789012",
  );
}

function validInput(overrides: Partial<Parameters<CreatePurchaseIntent["execute"]>[0]> = {}) {
  return {
    productId: "prod_haru_01",
    recipientName: "花子",
    deliveryDate: "2026-08-25",
    giftMessage: "おめでとう",
    ...overrides,
  };
}
