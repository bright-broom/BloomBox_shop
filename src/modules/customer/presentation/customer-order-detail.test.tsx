import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerOrderDetailPanel } from "@/ui/customer-order-detail";
import { customerAccountContent as copy } from "@/shared/infrastructure/content/customer-account-content";
import CustomerOrderPreview from "@/app/preview/account/order/page";
import CustomerOrderPage from "@/app/account/orders/[orderId]/page";
import type { CustomerOrderDetail } from "@/modules/order/public";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/shared/infrastructure/customer-account", () => ({ loadCustomerOrderDetail: mocks.load }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
const order: CustomerOrderDetail = { id: "sample", name: "#100", orderedAt: "2026-09-10T22:00:00Z",
  totalYen: 7500, subtotalYen: 8000, taxYen: 0, shippingYen: 0, discountYen: 500,
  payment: "PARTIALLY_REFUNDED", fulfillment: "UNKNOWN", cancelled: false,
  items: [{ name: "<script>snapshot</script>", quantity: 2, unitYen: 4000, totalYen: 7500 }], shipment: null };
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("customer order detail presentation", () => {
  it("renders escaped purchase snapshots and original totals without treating refunds as the net paid amount", () => {
    const html = renderToStaticMarkup(<CustomerOrderDetailPanel state={{ status: "ready", order }} />);
    for (const expected of ["#100", "2026/09/11", "7,500", "8,000", "4,000", "500", copy.totalNote, copy.payments.PARTIALLY_REFUNDED,
      copy.fulfillments.UNKNOWN, "&lt;script&gt;snapshot&lt;/script&gt;", 'href="/account"']) expect(html).toContain(expected);
    expect(html).not.toContain("<script>snapshot");
  });
  it("shows unavailable states without order information and offers retry only for load failure", () => {
    for (const status of ["disabled", "signed-out", "not-found", "unavailable"] as const) {
      const html = renderToStaticMarkup(<CustomerOrderDetailPanel state={{ status }} retryHref="/account/orders/sample" />);
      expect(html).not.toContain("#100"); expect(html).not.toContain("7,500");
      expect(html.includes('role="alert"')).toBe(status === "unavailable");
      expect(html.includes(copy.retry)).toBe(status === "unavailable");
      if (status === "disabled") expect(html).toContain(copy.disabledNote);
    }
  });
  it("renders unknown states without inherited lookup keys and keeps cancellation separate", () => {
    const html = renderToStaticMarkup(<CustomerOrderDetailPanel state={{ status: "ready", order: { ...order, payment: "__proto__", fulfillment: "constructor", cancelled: true } }} />);
    expect(html).toContain(copy.cancelled); expect(html).toContain(copy.payments.UNKNOWN); expect(html).not.toContain(copy.payments.CAPTURED);
  });
  it("uses the checked loader result and gives inaccessible orders a not-found response", async () => {
    mocks.load.mockResolvedValue({ status: "not-found" });
    await expect(CustomerOrderPage({ params: Promise.resolve({ orderId: "sample" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.load).toHaveBeenCalledWith("sample");
    mocks.load.mockResolvedValue({ status: "ready", order });
    expect(renderToStaticMarkup(await CustomerOrderPage({ params: Promise.resolve({ orderId: "sample" }) }))).toContain("#100");
  });
  it("labels synthetic preview data and disables the preview route in production", async () => {
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "preview");
    const html = renderToStaticMarkup(await CustomerOrderPreview({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(copy.previewNote); expect(html).toContain('href="/preview/account"');
    expect(mocks.load).not.toHaveBeenCalled();
    const large = renderToStaticMarkup(await CustomerOrderPreview({ searchParams: Promise.resolve({ sample: "sample-2" }) }));
    expect(large).toContain("#SAMPLE-1001"); expect(large).toContain(copy.detail.sampleLargeProduct); expect(large).toContain("8,000");
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "production");
    await expect(CustomerOrderPreview({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  });
});
