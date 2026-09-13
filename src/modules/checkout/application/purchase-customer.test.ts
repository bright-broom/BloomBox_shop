import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import { InMemoryPurchaseIntentRepository } from "../infrastructure/in-memory-purchase-intent-repository";
import { CreatePurchaseIntent } from "./create-purchase-intent";
import { StartCheckout } from "./start-checkout";
import { PurchaseCustomerMismatchError, type PurchaseCustomer } from "../domain/purchase-customer";
import type { CheckoutSession } from "./checkout-session-provider";

const now = () => new Date("2026-09-13T00:00:00Z");
const input = () => ({ requestId: randomUUID(), productId: "prod_bloombox_m", quantity: 1, recipientName: "試験", giftMessage: "試験", deliveryDate: "2026-09-20" });
function setup() {
  const repository = new InMemoryPurchaseIntentRepository();
  let customer: PurchaseCustomer | null = { customerId: randomUUID(), version: 1 };
  const current = vi.fn(async () => customer);
  const create = new CreatePurchaseIntent(new InMemoryProductRepository(), repository, now, () => true, current);
  return { repository, current, create, setCustomer: (value: PurchaseCustomer | null) => { customer = value; } };
}

describe("purchase customer ownership", () => {
  it("takes identity only from the server reader and refuses a different account or guest on repeat", async () => {
    const state = setup();
    const request = { ...input(), customerId: randomUUID(), email: "attacker@example.test" };
    const first = await state.create.execute(request);
    expect(first.customer?.customerId).not.toBe(request.customerId);
    state.setCustomer({ customerId: first.customer!.customerId, version: 2 });
    expect(await state.create.execute(request)).toBe(first);
    for (const other of [{ customerId: randomUUID(), version: 1 }, null]) {
      state.setCustomer(other);
      await expect(state.create.execute(request)).rejects.toThrow(PurchaseCustomerMismatchError);
    }
    expect((await state.repository.findById(first.id))?.customer).toEqual(first.customer);
  });

  it("never claims a guest intent retroactively after login", async () => {
    const state = setup(), request = input();
    state.setCustomer(null);
    const first = await state.create.execute(request);
    expect(first.customer).toBeNull();
    state.setCustomer({ customerId: randomUUID(), version: 1 });
    await expect(state.create.execute(request)).rejects.toThrow(PurchaseCustomerMismatchError);
    expect(first.customer).toBeNull();
  });

  it("resolves concurrent submissions to one immutable owner", async () => {
    const repository = new InMemoryPurchaseIntentRepository(), products = new InMemoryProductRepository();
    const a = { customerId: randomUUID(), version: 1 }, b = { customerId: randomUUID(), version: 1 };
    const first = new CreatePurchaseIntent(products, repository, now, () => true, async () => a);
    const second = new CreatePurchaseIntent(products, repository, now, () => true, async () => b);
    const results = await Promise.allSettled([first.execute(inputWithId), second.execute(inputWithId)]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.find((row) => row.status === "rejected")).toMatchObject({ reason: new PurchaseCustomerMismatchError() });
  });

  it("stops before storage on identity-reader failure or malformed identity", async () => {
    const state = setup(), save = vi.spyOn(state.repository, "save");
    state.current.mockRejectedValueOnce(new Error("Identity unavailable"));
    await expect(state.create.execute(input())).rejects.toThrow("Identity unavailable");
    state.setCustomer({ customerId: "browser-input", version: 1 });
    await expect(state.create.execute(input())).rejects.toThrow(PurchaseCustomerMismatchError);
    expect(save).not.toHaveBeenCalled();
  });

  it("authorizes both checkout creation and existing session retrieval, including a logout immediately before handoff", async () => {
    const state = setup(), first = await state.create.execute(input());
    const owner = first.customer;
    const session: CheckoutSession = { id: "cs_test_owner", provider: "STRIPE", purchaseIntentId: first.id,
      url: "https://checkout.stripe.com/test", apiVersion: "test", expiresAt: new Date("2026-09-13T01:00:00Z") };
    const provider = { provider: "STRIPE" as const, create: vi.fn(async () => session), retrieve: vi.fn(async () => session) };
    const start = new StartCheckout(state.repository, provider, now, () => true, state.current);
    state.setCustomer(null);
    await expect(start.execute(first.id)).rejects.toThrow(PurchaseCustomerMismatchError);
    state.setCustomer(owner);
    state.current.mockResolvedValueOnce(owner).mockResolvedValueOnce(null);
    await expect(start.execute(first.id)).rejects.toThrow(PurchaseCustomerMismatchError);
    expect(provider.create).not.toHaveBeenCalled();
    await start.execute(first.id);
    state.setCustomer({ customerId: randomUUID(), version: 1 });
    await expect(start.execute(first.id)).rejects.toThrow(PurchaseCustomerMismatchError);
    expect(provider.retrieve).not.toHaveBeenCalled();
    state.setCustomer(owner);
    await start.execute(first.id);
    expect(provider.create).toHaveBeenCalledOnce();
    expect(provider.retrieve).toHaveBeenCalledOnce();
  });
});
const inputWithId = input();
