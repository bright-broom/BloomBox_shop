import { describe, expect, it } from "vitest";
import { InMemoryProductRepository } from "@/modules/catalog/infrastructure/in-memory-product-repository";
import { InMemoryOrderRepository } from "../infrastructure/in-memory-order-repository";
import { CreateOrder } from "./create-order";

describe("CreateOrder", () => {
  it("uses the server-side catalog price snapshot", async () => {
    const products = new InMemoryProductRepository();
    const orders = new InMemoryOrderRepository();
    const useCase = new CreateOrder(
      products,
      orders,
      () => new Date("2026-08-19T00:00:00.000Z"),
      () => "12345678-abcd-4000-8000-123456789012",
    );

    const order = await useCase.execute({
      productId: "prod_haru_01",
      recipientName: "花子",
      deliveryDate: "2026-08-25",
      giftMessage: "おめでとう",
    });

    expect(order.item.unitPriceSnapshot.amount).toBe(6600);
    expect(order.item.subtotal.amount).toBe(6600);
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.displayId).toBe("BB-20260819-1234");
  });
});
