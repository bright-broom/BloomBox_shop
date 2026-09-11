import { describe, expect, it, vi } from "vitest";
import { money } from "@/shared/domain/money";
import {
  catalogProductReference,
  commerceProductReference,
  PurchaseIntent,
  purchaseIntentId,
} from "../domain/purchase-intent";
import { giftMessage, recipientName } from "../domain/purchase-intent-policy";
import { InMemoryPurchaseIntentRepository } from "../infrastructure/in-memory-purchase-intent-repository";
import type { CheckoutSessionProvider } from "./checkout-session-provider";
import { CheckoutProviderMismatchError, StartCheckout } from "./start-checkout";

describe("StartCheckout", () => {
  it("creates one provider checkout and persists its reference", async () => {
    const repository = new InMemoryPurchaseIntentRepository();
    const intent = createIntent();
    await repository.save(intent);
    const provider = createProvider(intent.id);
    const useCase = new StartCheckout(
      repository,
      provider,
      () => new Date("2026-08-21T00:05:00.000Z"),
    );

    const session = await useCase.execute(intent.id);
    const saved = await repository.findById(intent.id);

    expect(session.id).toBe("cs_test_123");
    expect(saved?.status).toBe("CHECKOUT_CREATED");
    expect(saved?.externalCheckoutId).toBe("cs_test_123");
    expect(provider.create).toHaveBeenCalledWith(
      intent,
      `purchase-intent:${intent.id}:checkout:v1`,
    );
  });

  it("retrieves an existing checkout rather than creating a second one", async () => {
    const repository = new InMemoryPurchaseIntentRepository();
    const intent = createIntent();
    await repository.save(intent);
    intent.recordCheckoutCreated({
      provider: "STRIPE",
      externalCheckoutId: "cs_test_123",
      providerApiVersion: "2026-07-29.dahlia",
      occurredAt: new Date("2026-08-21T00:05:00.000Z"),
    });
    await repository.saveCheckoutCreated(intent);
    const provider = createProvider(intent.id);

    await new StartCheckout(repository, provider).execute(intent.id);

    expect(provider.retrieve).toHaveBeenCalledWith("cs_test_123");
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("rejects a provider response for a different intent", async () => {
    const repository = new InMemoryPurchaseIntentRepository();
    const intent = createIntent();
    await repository.save(intent);
    const provider = createProvider(purchaseIntentId("87654321-abcd-4000-8000-123456789012"));

    const useCase = new StartCheckout(
      repository,
      provider,
      () => new Date("2026-08-21T00:05:00.000Z"),
    );

    await expect(useCase.execute(intent.id))
      .rejects.toBeInstanceOf(CheckoutProviderMismatchError);
    expect(provider.create).toHaveBeenCalledOnce();
    expect((await repository.findById(intent.id))?.status).toBe("READY_FOR_CHECKOUT");
  });
});

function createIntent(): PurchaseIntent {
  const intent = PurchaseIntent.create({
    id: purchaseIntentId("12345678-abcd-4000-8000-123456789012"),
    displayId: "BBI-20260821-1234",
    item: {
      productId: catalogProductReference("prod_haru_01"),
      externalProductReference: commerceProductReference("prod_haru_01"),
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

function createProvider(purchaseIntentIdValue: string): CheckoutSessionProvider & {
  create: ReturnType<typeof vi.fn>;
  retrieve: ReturnType<typeof vi.fn>;
} {
  const session = {
    provider: "STRIPE" as const,
    id: "cs_test_123",
    purchaseIntentId: purchaseIntentIdValue,
    url: "https://checkout.stripe.test/session",
    expiresAt: new Date("2026-08-21T23:00:00.000Z"),
    apiVersion: "2026-07-29.dahlia",
  };
  return {
    provider: "STRIPE",
    create: vi.fn().mockResolvedValue(session),
    retrieve: vi.fn().mockResolvedValue(session),
  };
}
