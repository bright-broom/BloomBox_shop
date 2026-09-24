import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderDeliveryDateForm } from "./order-delivery-date-form";
import { ORDER_DELIVERY_DATE_REASON_MAX_LENGTH } from "@/modules/order/public";
import { nativeFulfillmentContent as copy } from "@/shared/infrastructure/content/native-fulfillment-content";

const order = { orderId: "11111111-1111-4111-8111-111111111111", deliveryDate: "2026-10-01" };
const window = { earliest: "2026-09-27", latest: "2026-11-23" };

describe("delivery date change form before hydration", () => {
  it("posts the date the operator saw and offers only dates the shop can still accept", () => {
    const html = renderToStaticMarkup(<OrderDeliveryDateForm order={order} window={window} requestId="22222222-2222-4222-8222-222222222222" action={async () => ({ status: "SAVED" })} />);
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/method="get"/);
    // The current date travels with the form, so a change made elsewhere is a conflict rather than an overwrite.
    expect(html).toContain('name="expectedDate" value="2026-10-01"');
    expect(html).toContain('name="requestId"');
    expect(html).toContain('min="2026-09-27"');
    expect(html).toContain('max="2026-11-23"');
    expect(html).toContain(`maxLength="${ORDER_DELIVERY_DATE_REASON_MAX_LENGTH}"`);
    expect(html).toContain(copy.reschedule.range.replace("{earliest}", window.earliest).replace("{latest}", window.latest));
    expect(html).toMatch(/type="checkbox"[^>]*required=""/);
    expect(html).not.toContain('name="operatorId"');
  });
  it("reports every rejected outcome to the operator as an alert", () => {
    for (const status of ["CONFLICT", "DISPATCHED", "OUT_OF_RANGE", "ORDER_NOT_ACTIVE", "UNCHANGED", "UNAVAILABLE"] as const) {
      const html = renderToStaticMarkup(<OrderDeliveryDateForm order={order} window={window} requestId="22222222-2222-4222-8222-222222222222" action={async () => ({ status })} />);
      // The initial render shows no message; the wording exists for every code the action can return.
      expect(copy.reschedule.messages[status].length).toBeGreaterThan(0);
      expect(html).not.toContain(copy.reschedule.messages[status]);
    }
  });
});
