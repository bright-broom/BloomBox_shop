import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicOrderStatus } from "@/modules/order/public";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/shared/infrastructure/composition-root", () => ({ application: { getOrderStatus: { execute } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import CheckoutReturnPage from "./page";
import { CompletedCheckoutCartCleanup } from "@/ui/completed-checkout-cart-cleanup";

const purchaseIntentId = "12345678-abcd-4000-8000-123456789012";

function elements(node: ReactNode): Array<Record<string, unknown>> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [{ ...child.props, elementType: child.type }, ...elements(child.props.children)];
  });
}
function order(overrides: Partial<PublicOrderStatus> = {}): PublicOrderStatus {
  return { progress: "CONFIRMED", displayId: "BB-20260914-123456", purchaseIntentId, orderCreated: true,
    productId: "native_12345678-abcd-4000-8000-123456789012", productName: "BLOOM BOX M", quantity: 1, deliveryDate: "2026-09-20", ...overrides };
}
async function render(status: PublicOrderStatus | null) {
  execute.mockResolvedValue(status);
  return CheckoutReturnPage({ searchParams: Promise.resolve({ session_id: "cs_test_12345678" }) });
}
function cleanup(tree: ReactNode) {
  return elements(tree).filter((item) => item.elementType === CompletedCheckoutCartCleanup);
}

beforeEach(() => execute.mockReset());

describe("checkout return page cart cleanup", () => {
  it.each(["CONFIRMED", "FULFILLING", "SHIPPED", "ATTENTION"] as const)(
    "clears the cart that started the checkout once its %s order exists",
    async (progress) => {
      const found = cleanup(await render(order({ progress })));
      expect(found).toHaveLength(1);
      expect(found[0].purchaseIntentId).toBe(purchaseIntentId);
    },
  );

  it.each([
    { progress: "PROCESSING" as const },
    { progress: "PAYMENT_FAILED" as const },
    { progress: "CHECKOUT_EXPIRED" as const },
  ])("keeps the cart while no order exists: $progress", async ({ progress }) => {
    expect(cleanup(await render(order({ progress, orderCreated: false })))).toHaveLength(0);
  });

  it("keeps the cart when the checkout reference is unknown", async () => {
    expect(cleanup(await render(null))).toHaveLength(0);
  });
});
