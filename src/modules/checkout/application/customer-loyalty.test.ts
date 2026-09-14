import { describe, expect, it, vi } from "vitest";
import { CreatePurchaseIntent } from "./create-purchase-intent";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import { InMemoryPurchaseIntentRepository } from "../infrastructure/in-memory-purchase-intent-repository";
import { purchaseIntentId } from "../domain/purchase-intent";
import { productId } from "@/modules/catalog/public";
const customer = { customerId: "00000000-0000-4000-8000-000000000001", version: 1 };
const input = { requestId: "12345678-abcd-4000-8000-123456789012", productId: "native_fixture", quantity: 1,
  recipientName: "試験", deliveryDate: "2026-09-20", giftMessage: "試験" };
async function setup() {
  const products = new InMemoryProductRepository();
  const original = await products.findById(productId("prod_bloombox_m"));
  if (!original) throw new Error("Missing fixture");
  vi.spyOn(products, "findById").mockImplementation(async (id) => ({ ...original, id, previewOffer: undefined, shippingAmount: 1000 }));
  const intents = new InMemoryPurchaseIntentRepository();
  const performance = { readEligibleSpend: vi.fn(async () => 12000) };
  return { products, intents, performance, create: (actor: typeof customer | null = customer) => new CreatePurchaseIntent(products, intents,
    () => new Date("2026-09-14T00:00:00Z"), () => true, async () => actor, performance) };
}
describe("server-owned purchase loyalty", () => {
  it("ignores untrusted quote fields, fixes first quote and never requeries on retry", async () => {
    const { create, performance } = await setup();
    const intent = await create().execute({ ...input, ...{ discountYen: 3999, basisPoints: 9999 } });
    expect(intent.loyalty).toMatchObject({ tier: "SPROUT", discountYen: 80 });
    expect(performance.readEligibleSpend).toHaveBeenCalledWith(customer.customerId);
    performance.readEligibleSpend.mockRejectedValue(new Error("down"));
    expect((await create().execute(input)).loyalty).toEqual(intent.loyalty);
    expect(performance.readEligibleSpend).toHaveBeenCalledTimes(1);
    await expect(create(null).execute(input)).rejects.toThrow("ログイン状態");
  });
  it("does not fall back to regular price if verification fails or the reader was not composed", async () => {
    const { create, performance, products, intents } = await setup();
    performance.readEligibleSpend.mockRejectedValue(new Error("private"));
    await expect(create().execute(input)).rejects.toThrow("会員特典を確認できませんでした");
    expect(await intents.findById(purchaseIntentId(input.requestId))).toBeNull();
    await expect(new CreatePurchaseIntent(products, intents, () => new Date("2026-09-14T00:00:00Z"), () => true, async () => customer).execute(input)).rejects.toThrow("会員特典");
  });
  it("never applies native rewards to guests or preview products", async () => {
    const { create, performance } = await setup();
    expect((await create(null).execute(input)).loyalty).toBeNull();
    expect((await create().execute({ ...input, requestId: "12345678-abcd-4000-8000-123456789013", productId: "prod_bloombox_m" })).loyalty).toBeNull();
    expect(performance.readEligibleSpend).not.toHaveBeenCalled();
  });
});
