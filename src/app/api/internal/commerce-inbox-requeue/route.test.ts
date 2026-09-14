import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, reportUnexpectedError } = vi.hoisted(() => ({
  execute: vi.fn(),
  reportUnexpectedError: vi.fn().mockReturnValue("test-error-id"),
}));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  getStripeFailedInboxRequeue: () => ({ execute }),
}));
vi.mock("@/shared/infrastructure/config/worker-config", () => ({
  loadCommerceWorkerSecret: () => "a-secure-worker-secret-with-32-chars",
}));
vi.mock("@/shared/infrastructure/observability/report-unexpected-error", () => ({ reportUnexpectedError }));

import { POST } from "./route";

const validBody = { externalEventIds: ["evt_1234567890abcdef"], incidentIssue: 171, requestedBy: "bright-broom" };

function post(body: unknown, authorization = "Bearer a-secure-worker-secret-with-32-chars") {
  return new Request(new URL("requeue", import.meta.url), {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("commerce inbox requeue route", () => {
  beforeEach(() => {
    execute.mockReset();
    reportUnexpectedError.mockClear();
  });

  it("rejects an unauthenticated invocation before reading the request", async () => {
    const response = await POST(post(validBody, "Bearer wrong-secret"));
    expect(response.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { name: "malformed JSON", body: "{not json" },
    { name: "an invalid request", body: { ...validBody, externalEventIds: ["not-an-event"] } },
    { name: "a free-text reason", body: { ...validBody, reason: "details" } },
  ])("rejects $name without touching the Inbox", async ({ body }) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
    expect(execute).not.toHaveBeenCalled();
    expect(reportUnexpectedError).not.toHaveBeenCalled();
  });

  it("requeues the named events and reports each outcome", async () => {
    execute.mockResolvedValue({ results: [{ externalEventId: "evt_1234567890abcdef", outcome: "REQUEUED" }] });
    const response = await POST(post(validBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, results: [{ externalEventId: "evt_1234567890abcdef", outcome: "REQUEUED" }] });
    expect(execute).toHaveBeenCalledExactlyOnceWith(validBody);
  });

  it("reports an unexpected failure without exposing details", async () => {
    execute.mockRejectedValue(new Error("private database detail"));
    const response = await POST(post(validBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
    expect(reportUnexpectedError).toHaveBeenCalledOnce();
  });
});
