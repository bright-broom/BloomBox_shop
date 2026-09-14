import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: undefined as string | undefined, store: { active: vi.fn(), grant: vi.fn(), revoke: vi.fn(), captureIfEmpty: vi.fn() }, report: vi.fn(), deliver: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.token ? { value: mocks.token } : undefined }) }));
vi.mock("@/shared/infrastructure/advertising-runtime", () => ({ advertisingCookieName: () => "__Host-bloombox.ad-consent", advertisingStore: () => mocks.store, deliverAdvertising: mocks.deliver, cleanAdvertising: vi.fn() }));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({ reportUnexpectedError: mocks.report }));
import { GET, POST } from "@/app/api/advertising/consent/route";
import { POST as deliver } from "@/app/api/internal/advertising-delivery/route";
const origin = "https://shop.example";
const request = (body: string, requestOrigin = origin) => new Request(`${origin}/api/advertising/consent`, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body });
beforeEach(() => { vi.stubEnv("BLOOMBOX_ADVERTISING_ENABLED", "true"); vi.stubEnv("BLOOMBOX_RUNTIME_MODE", "preview"); vi.stubEnv("BLOOMBOX_PUBLIC_ORIGIN", origin); vi.stubEnv("COMMERCE_WORKER_SECRET", "a".repeat(32)); mocks.token = undefined; vi.clearAllMocks(); });
afterEach(() => vi.unstubAllEnvs());
describe("advertising HTTP boundaries", () => {
  it("requires an exact origin, JSON body and a bounded input", async () => {
    expect((await POST(request('{"choice":"granted"}', "https://other.example"))).status).toBe(403);
    expect((await POST(request('x'.repeat(4097)))).status).toBe(413);
    expect((await POST(request('{"choice":"granted","price":1}'))).status).toBe(400);
    expect(mocks.store.grant).not.toHaveBeenCalled();
  });
  it("preview sets only a preference cookie and does not persist clicks", async () => {
    const response = await POST(request('{"choice":"granted","gclid":"click"}'));
    expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure"); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.store.grant).not.toHaveBeenCalled();
    mocks.token = "preview-granted"; expect(await (await GET()).json()).toMatchObject({ choice: "granted" });
  });
  it("background capture never sets a consent cookie", async () => {
    const result = await POST(request('{"choice":"capture","gclid":"click"}'));
    expect(result.status).toBe(200); expect(result.headers.get("set-cookie")).toBeNull(); expect(mocks.store.grant).not.toHaveBeenCalled();
  });
  it("disabled mode does not read cookies or contact storage", async () => {
    vi.stubEnv("BLOOMBOX_ADVERTISING_ENABLED", "false");
    expect(await (await GET()).json()).toMatchObject({ enabled: false }); expect((await POST(request('{"choice":"granted"}'))).status).toBe(404);
    expect(mocks.store.active).not.toHaveBeenCalled();
  });
  it("rejects worker calls without the configured credential", async () => {
    expect((await deliver(new Request(`${origin}/api/internal/advertising-delivery`, { method: "POST" }))).status).toBe(401);
    expect(mocks.deliver).not.toHaveBeenCalled();
    mocks.deliver.mockResolvedValue({ disabled: true });
    expect((await deliver(new Request(`${origin}/api/internal/advertising-delivery`, { method: "POST", headers: { authorization: `Bearer ${'a'.repeat(32)}` } }))).status).toBe(200);
  });
});
