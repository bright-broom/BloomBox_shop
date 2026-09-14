import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerAccountPanel } from "./customer-account";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import type { CustomerAccount } from "@/modules/customer/public";

const empty: CustomerAccount = { name: copy.sampleName, email: copy.sampleEmail, orders: [], nextCursor: null };

describe("compact customer account navigation", () => {
  it("omits a redundant first-page link for a customer without purchases", () => {
    const html = renderToStaticMarkup(<CustomerAccountPanel state={{ status: "ready", account: empty }} />);
    expect(html).toContain(copy.emptyTitle);
    expect(html).not.toContain(copy.first);
    expect(html).toContain('href="/flowers"');
  });

  it("keeps recovery to the first page when a later page becomes empty", () => {
    const html = renderToStaticMarkup(<CustomerAccountPanel hasPreviousPage state={{ status: "ready", account: empty }} />);
    expect(html).toContain(copy.emptyTitle);
    expect(html).toContain(`href="/account">${copy.first}</a>`);
  });

  it("gives each icon-only order link a distinguishable accessible name", () => {
    const orders: CustomerAccount["orders"] = ["ONE", "TWO"].map((name) => ({
      id: name, name, orderedAt: "2026-09-10T04:00:00Z", totalYen: 5000,
      payment: "PAID", fulfillment: "UNFULFILLED", cancelled: false,
    }));
    const html = renderToStaticMarkup(<CustomerAccountPanel state={{ status: "ready", account: { ...empty, orders } }} />);
    for (const order of orders) {
      expect(html).toContain(`aria-label="${copy.detail.open} ${order.name}"`);
      expect(html).toContain(`href="/account/orders/${order.id}"`);
    }
    expect(html).toContain(copy.payments.PAID);
    expect(html).toContain(copy.fulfillments.UNFULFILLED);
  });
});
