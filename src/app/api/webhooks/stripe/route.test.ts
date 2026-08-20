import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/shared/infrastructure/composition-root", () => ({
  getStripeWebhookReceiver: () => ({ execute }),
}));

import { POST } from "./route";

describe("Stripe webhook route", () => {
  beforeEach(() => execute.mockReset());

  it("requires a Stripe signature before reading provider data", async () => {
    const response = await POST(new Request(new URL("stripe-webhook", import.meta.url), {
      method: "POST",
      body: "{}",
    }));

    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("acknowledges duplicate verified events without repeating work", async () => {
    execute.mockResolvedValue("DUPLICATE");
    const response = await POST(new Request(new URL("stripe-webhook", import.meta.url), {
      method: "POST",
      headers: { "stripe-signature": "signed" },
      body: "raw-body",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(execute).toHaveBeenCalledWith("raw-body", "signed");
  });

  it("rejects an oversized body before verification", async () => {
    const response = await POST(new Request(new URL("stripe-webhook", import.meta.url), {
      method: "POST",
      headers: {
        "stripe-signature": "signed",
        "content-length": "1000001",
      },
      body: "{}",
    }));

    expect(response.status).toBe(413);
    expect(execute).not.toHaveBeenCalled();
  });
});
