import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsoleState, OrdersTable } from "./operations-console";
import Preview from "@/app/preview/operations/page";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/preview/operations",
  useRouter: () => ({ refresh: vi.fn() }),
}));
afterEach(() => vi.unstubAllEnvs());
describe("operations UI boundary states", () => {
  it("keeps unavailable/permission/invalid states distinct from an empty result", () => {
    for (const status of [
      "unbound",
      "denied",
      "invalid",
      "unavailable",
    ] as const) {
      const html = renderToStaticMarkup(<ConsoleState status={status} />);
      expect(html).not.toContain("該当する注文はありません");
      expect(html).not.toContain("￥0");
    }
    expect(
      renderToStaticMarkup(<OrdersTable page={{ orders: [], next: null }} />),
    ).toContain("該当する注文はありません");
  });
  it("escapes order data and preserves mixed statuses and accessible table headings", () => {
    const html = renderToStaticMarkup(
      <OrdersTable
        page={{
          next: null,
          orders: [
            {
              id: "id",
              name: "<script>unsafe</script>",
              customerId: null,
              orderedAt: "2026-09-17T00:00:00Z",
              totalYen: 5000,
              status: "CONFIRMED",
              payment: ["CAPTURED", "FAILED"],
              fulfillment: ["UNFULFILLED", "SHIPPED"],
            },
          ],
        }}
      />,
    );
    expect(html).not.toContain("<script>unsafe");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('scope="row"');
    expect(html).toContain(" / ");
    expect(html).toContain('tabindex="0"');
  });
  it("never exposes the synthetic preview in production", async () => {
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "production");
    await expect(
      Preview({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "preview");
    const html = renderToStaticMarkup(
      await Preview({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("架空の集計・注文");
    expect(html).toContain("SAMPLE-1002");
  });
});
