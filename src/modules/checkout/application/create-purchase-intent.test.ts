import legacyCatalog from "@/modules/catalog/infrastructure/fixtures/legacy-catalog.json";
import { loadCatalog } from "@/modules/catalog/infrastructure/catalog-content";
import { describe, expect, it, vi } from "vitest";
import { CheckoutPausedError } from "./checkout-paused-error";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import { DeliveryDateUnavailableError } from "@/modules/fulfillment/public";
import { InMemoryPurchaseIntentRepository } from "../infrastructure/in-memory-purchase-intent-repository";
import {
  GIFT_MESSAGE_MAX_LENGTH,
  InvalidPurchaseIntentInputError,
} from "../domain/purchase-intent-policy";
import { CreatePurchaseIntent } from "./create-purchase-intent";
import { PurchaseIntentIdempotencyConflictError } from "./create-purchase-intent";

describe("CreatePurchaseIntent", () => {
  it("snapshots the selected launch size and refuses an unpriced multiple-box shipment", async () => {
    const useCase = new CreatePurchaseIntent(new InMemoryProductRepository(), new InMemoryPurchaseIntentRepository(), () => new Date("2026-08-19T00:00:00.000Z"));
    const input = validInput({ productId: "prod_bloombox_l" });
    const intent = await useCase.execute(input);
    expect(intent.item).toMatchObject({ productName: "BLOOM BOX L", unitPriceSnapshot: { amount: 8000 }, productId: "prod_bloombox_l" });
    await expect(useCase.execute({ ...input, productId: "prod_bloombox_m" })).rejects.toBeInstanceOf(PurchaseIntentIdempotencyConflictError);
    await expect(useCase.execute({ ...input, requestId: "12345678-abcd-4000-8000-123456789013", quantity: 2 })).rejects.toBeInstanceOf(InvalidPurchaseIntentInputError);
  });
  it("rejects repeated submissions without reading or writing, and resumes with the same request", async () => {
    const products = new InMemoryProductRepository(loadCatalog(legacyCatalog));
    const intents = new InMemoryPurchaseIntentRepository();
    const find = vi.spyOn(intents, "findById");
    const save = vi.spyOn(intents, "save");
    let enabled = false;
    const useCase = new CreatePurchaseIntent(
      products, intents, () => new Date("2026-08-19T00:00:00.000Z"), () => enabled,
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(useCase.execute(validInput())).rejects.toBeInstanceOf(CheckoutPausedError);
    }
    expect(find).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    enabled = true;
    const intent = await useCase.execute(validInput());
    await expect(useCase.execute(validInput())).resolves.toBe(intent);
    expect(save).toHaveBeenCalledOnce();
  });

  it("uses the server-side catalog price snapshot without creating an order", async () => {
    const products = new InMemoryProductRepository(loadCatalog(legacyCatalog));
    const intents = new InMemoryPurchaseIntentRepository();
    const useCase = new CreatePurchaseIntent(
      products,
      intents,
      () => new Date("2026-08-19T00:00:00.000Z"),
    );

    const intent = await useCase.execute({
      requestId: "12345678-abcd-4000-8000-123456789012",
      productId: "prod_haru_01",
      quantity: 2,
      recipientName: "花子",
      deliveryDate: "2026-08-25",
      giftMessage: "おめでとう",
    });

    expect(intent.item.unitPriceSnapshot.amount).toBe(6600);
    expect(intent.item.quantity).toBe(2);
    expect(intent.item.subtotal.amount).toBe(13200);
    expect(intent.item.externalProductReference).toBe("prod_haru_01");
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

  it("enforces quantity policy outside the presentation layer", async () => {
    const useCase = createUseCase();

    await expect(useCase.execute(validInput({ quantity: 0 })))
      .rejects.toBeInstanceOf(InvalidPurchaseIntentInputError);
  });

  it("returns the original intent for a repeated request and rejects key reuse", async () => {
    const useCase = createUseCase();
    const first = await useCase.execute(validInput());

    await expect(useCase.execute(validInput())).resolves.toBe(first);
    await expect(useCase.execute(validInput({ giftMessage: "別の内容" })))
      .rejects.toBeInstanceOf(PurchaseIntentIdempotencyConflictError);
  });
});

function createUseCase(): CreatePurchaseIntent {
  return new CreatePurchaseIntent(
    new InMemoryProductRepository(loadCatalog(legacyCatalog)),
    new InMemoryPurchaseIntentRepository(),
    () => new Date("2026-08-19T00:00:00.000Z"),
  );
}

function validInput(overrides: Partial<Parameters<CreatePurchaseIntent["execute"]>[0]> = {}) {
  return {
    requestId: "12345678-abcd-4000-8000-123456789012",
    productId: "prod_haru_01",
    quantity: 1,
    recipientName: "花子",
    deliveryDate: "2026-08-25",
    giftMessage: "おめでとう",
    ...overrides,
  };
}
