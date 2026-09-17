import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NativeFulfillmentForm } from "./native-fulfillment-form";
const detail = { fulfillmentId: "11111111-1111-4111-8111-111111111111", version: 3, shipment: null };
describe("fulfillment form before hydration", () => {
  it("uses POST fallback so operations and tracking data never become a GET query string", () => {
    const html = renderToStaticMarkup(<NativeFulfillmentForm detail={detail} requestId="22222222-2222-4222-8222-222222222222" action={async () => ({ status: "SAVED" })} />);
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/method="get"/);
    expect(html).toContain('name="confirmed"');
    expect(html).toMatch(/type="checkbox"[^>]*required=""/);
    expect(html).toContain('name="requestId"');
    expect(html).not.toContain('name="operatorId"');
  });
});
