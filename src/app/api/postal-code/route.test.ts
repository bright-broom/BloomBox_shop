import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, reportUnexpectedError } = vi.hoisted(() => ({
  execute: vi.fn(),
  reportUnexpectedError: vi.fn().mockReturnValue("safe-error-id"),
}));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  application: { lookupPostalCode: { execute } },
}));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({
  reportUnexpectedError,
}));

import { POST } from "./route";

describe("POST /api/postal-code", () => {
  beforeEach(() => {
    execute.mockReset();
    reportUnexpectedError.mockClear();
  });

  it("returns validated address candidates", async () => {
    execute.mockResolvedValue({
      postalCode: "100-0001",
      addresses: [{ prefecture: "東京都", city: "千代田区", town: "千代田" }],
    });

    const response = await POST(request({ postalCode: "100-0001" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      postalCode: "100-0001",
      addresses: [{ prefecture: "東京都", city: "千代田区", town: "千代田" }],
    });
  });

  it("rejects invalid input without calling the provider", async () => {
    const response = await POST(request({ postalCode: "100-001" }));

    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(expect.objectContaining({
      ok: false,
      code: "invalid_postal_code",
    }));
  });

  it("returns a recoverable not-found response", async () => {
    execute.mockResolvedValue({ postalCode: "999-9999", addresses: [] });

    const response = await POST(request({ postalCode: "999-9999" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(expect.objectContaining({ ok: false, code: "not_found" }));
  });

  it("does not expose provider failure details", async () => {
    execute.mockRejectedValue(new Error("provider URL and input"));

    const response = await POST(request({ postalCode: "100-0001" }));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual(expect.objectContaining({
      ok: false,
      code: "temporarily_unavailable",
    }));
    expect(JSON.stringify(payload)).not.toContain("provider URL");
    expect(reportUnexpectedError).toHaveBeenCalledWith(expect.any(Error), {
      operation: "lookup_postal_code",
    });
  });

  it("rejects oversized or non-JSON requests before parsing", async () => {
    const oversized = await POST(new Request(new URL("postal-code", import.meta.url), {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "257" },
      body: JSON.stringify({ postalCode: "100-0001" }),
    }));
    const wrongContentType = await POST(new Request(new URL("postal-code", import.meta.url), {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "100-0001",
    }));

    expect(oversized.status).toBe(413);
    expect(wrongContentType.status).toBe(415);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects cross-site browser requests before calling the provider", async () => {
    const response = await POST(new Request(new URL("postal-code", import.meta.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ postalCode: "100-0001" }),
    }));

    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
});

function request(payload: unknown): Request {
  return new Request(new URL("postal-code", import.meta.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
