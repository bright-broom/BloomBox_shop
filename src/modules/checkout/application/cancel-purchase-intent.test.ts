import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CreatePurchaseIntent } from "./create-purchase-intent";
import { CancelPurchaseIntent } from "./cancel-purchase-intent";
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
