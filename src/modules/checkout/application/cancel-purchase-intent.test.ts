import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CreatePurchaseIntent } from "./create-purchase-intent";
import { CancelPurchaseIntent, PurchaseCancellationUnavailableError, PurchaseCancellationUnconfirmedError, type CheckoutSessionCanceller } from "./cancel-purchase-intent";
import { InMemoryPurchaseIntentRepository } from "../infrastructure/in-memory-purchase-intent-repository";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";

describe("purchase cancellation ownership", () => {
  it("rejects another account and a signed-out caller without modifying the purchase", async () => {
    const repo = new InMemoryPurchaseIntentRepository();
    const owner = { customerId: randomUUID(), version: 1 };
    const create = new CreatePurchaseIntent(new InMemoryProductRepository(), repo, () => new Date("2026-09-13T00:00:00Z"), () => true, async () => owner);
    const intent = await create.execute({ requestId: randomUUID(), productId: "prod_bloombox_m", quantity: 1,
      recipientName: "試験", giftMessage: "試験", deliveryDate: "2026-09-20" });
    for (const other of [null, { customerId: randomUUID(), version: 1 }]) {
      await expect(new CancelPurchaseIntent(repo, async () => other).execute(intent.id)).rejects.toThrow("ログイン状態");
      expect(intent.status).toBe("READY_FOR_CHECKOUT");
    }
    const cancel = new CancelPurchaseIntent(repo, async () => owner);
    await cancel.execute(intent.id); await cancel.execute(intent.id);
    expect(intent.status).toBe("ABANDONED");
  });
});

describe("hosted checkout cancellation", () => {
  const owner = { customerId: randomUUID(), version: 1 };
  async function prepared(stage: "CHECKOUT_CREATED" | "PROVIDER_CLAIMED") {
    const repo = new InMemoryPurchaseIntentRepository();
    const create = new CreatePurchaseIntent(new InMemoryProductRepository(), repo, () => new Date("2026-09-13T00:00:00Z"), () => true, async () => owner);
    const intent = await create.execute({ requestId: randomUUID(), productId: "prod_bloombox_m", quantity: 1,
      recipientName: "試験", giftMessage: "試験", deliveryDate: "2026-09-20" });
    await repo.claimCommerceProvider(intent.id, "STRIPE");
    if (stage === "CHECKOUT_CREATED") {
      intent.recordCheckoutCreated({ provider: "STRIPE", externalCheckoutId: "cs_test_cancel", providerApiVersion: "test",
        occurredAt: new Date("2026-09-13T00:01:00Z") });
    }
    return { repo, intent };
  }
  function canceller(expire = vi.fn<CheckoutSessionCanceller["expire"]>().mockResolvedValue("EXPIRED")) {
    return { sessions: { provider: "STRIPE" as const, expire }, expire };
  }

  it("asks the provider to close the stored session and leaves release to the verified event", async () => {
    const { repo, intent } = await prepared("CHECKOUT_CREATED");
    const { sessions, expire } = canceller();
    await expect(new CancelPurchaseIntent(repo, async () => owner, sessions).execute(intent.id)).resolves.toBe("EXPIRY_CONFIRMED");
    expect(expire).toHaveBeenCalledExactlyOnceWith("cs_test_cancel", intent.id);
    expect(intent.status).toBe("CHECKOUT_CREATED");
  });

  it("never contacts the provider for another account or a signed-out caller", async () => {
    const { repo, intent } = await prepared("CHECKOUT_CREATED");
    const { sessions, expire } = canceller();
    for (const other of [null, { customerId: randomUUID(), version: 1 }]) {
      await expect(new CancelPurchaseIntent(repo, async () => other, sessions).execute(intent.id)).rejects.toThrow("ログイン状態");
    }
    expect(expire).not.toHaveBeenCalled();
  });

  it("keeps the reservation when checkout creation may have reached the provider", async () => {
    const { repo, intent } = await prepared("PROVIDER_CLAIMED");
    const { sessions, expire } = canceller();
    await expect(new CancelPurchaseIntent(repo, async () => owner, sessions).execute(intent.id))
      .rejects.toBeInstanceOf(PurchaseCancellationUnavailableError);
    expect(expire).not.toHaveBeenCalled();
    expect(intent.status).toBe("READY_FOR_CHECKOUT");
  });

  it("refuses an issued session when no provider canceller is configured", async () => {
    const { repo, intent } = await prepared("CHECKOUT_CREATED");
    await expect(new CancelPurchaseIntent(repo, async () => owner).execute(intent.id))
      .rejects.toBeInstanceOf(PurchaseCancellationUnavailableError);
  });

  it("reports a checkout the customer already completed without cancelling it", async () => {
    const { repo, intent } = await prepared("CHECKOUT_CREATED");
    const { sessions } = canceller(vi.fn<CheckoutSessionCanceller["expire"]>().mockResolvedValue("COMPLETED"));
    await expect(new CancelPurchaseIntent(repo, async () => owner, sessions).execute(intent.id)).resolves.toBe("CHECKOUT_COMPLETED");
    expect(intent.status).toBe("CHECKOUT_CREATED");
  });

  it("propagates an unconfirmed provider result so the cart is kept", async () => {
    const { repo, intent } = await prepared("CHECKOUT_CREATED");
    const { sessions } = canceller(vi.fn<CheckoutSessionCanceller["expire"]>().mockRejectedValue(new PurchaseCancellationUnconfirmedError()));
    await expect(new CancelPurchaseIntent(repo, async () => owner, sessions).execute(intent.id))
      .rejects.toBeInstanceOf(PurchaseCancellationUnconfirmedError);
    expect(intent.status).toBe("CHECKOUT_CREATED");
  });

  it.each(["EXPIRED", "ABANDONED"] as const)("treats a retry after the verified %s transition as already closed", async (status) => {
    const { repo, intent } = await prepared("CHECKOUT_CREATED");
    intent.transitionTo(status);
    const { sessions, expire } = canceller();
    await expect(new CancelPurchaseIntent(repo, async () => owner, sessions).execute(intent.id)).resolves.toBe("ALREADY_CLOSED");
    expect(expire).not.toHaveBeenCalled();
  });

  it("does not cancel or contact the provider for a purchase that already became an order", async () => {
    const { repo, intent } = await prepared("CHECKOUT_CREATED");
    intent.transitionTo("CONVERTED");
    const { sessions, expire } = canceller();
    await expect(new CancelPurchaseIntent(repo, async () => owner, sessions).execute(intent.id)).resolves.toBe("CHECKOUT_COMPLETED");
    await expect(new CancelPurchaseIntent(repo, async () => ({ customerId: randomUUID(), version: 1 }), sessions).execute(intent.id))
      .rejects.toThrow("ログイン状態");
    expect(expire).not.toHaveBeenCalled();
    expect(intent.status).toBe("CONVERTED");
  });
});
