import { describe, expect, it, vi } from "vitest";
import { EmailRejectedError } from "../application/deliver-notifications";
import { EmailProviderUnavailableError, ResendEmailSender } from "./resend-email-sender";

const settings = { apiUrl: "https://mail.example/emails", apiKey: "re_test_key_1234567890", from: "BLOOM BOX <orders@shop.example>", replyTo: "support@shop.example" };
const email = { to: "buyer@example.test", subject: "件名", text: "本文", idempotencyKey: "event-1" };

describe("ResendEmailSender", () => {
  it("posts plain text with the idempotency key and returns the provider message ID", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "msg_123" }));
    expect(await new ResendEmailSender(settings, fetcher).send(email)).toBe("msg_123");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(settings.apiUrl);
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test_key_1234567890", "Idempotency-Key": "event-1" });
    expect(JSON.parse(init.body)).toEqual({ from: settings.from, to: ["buyer@example.test"], subject: "件名", text: "本文", reply_to: "support@shop.example" });
  });

  it.each([400, 403, 422])("treats %i as a permanent rejection", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{\"message\":\"secret detail\"}", { status }));
    await expect(new ResendEmailSender(settings, fetcher).send(email)).rejects.toBeInstanceOf(EmailRejectedError);
  });

  it.each([408, 409, 429, 500, 503])("treats %i as temporary", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("busy", { status }));
    await expect(new ResendEmailSender(settings, fetcher).send(email)).rejects.toBeInstanceOf(EmailProviderUnavailableError);
  });

  it("treats a network failure as temporary without exposing the cause", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED re_test_key_1234567890"));
    const error = await new ResendEmailSender(settings, fetcher).send(email).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailProviderUnavailableError);
    expect(String((error as Error).message)).not.toContain("re_test");
  });

  it("does not resend an accepted message whose response cannot be read", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    expect(await new ResendEmailSender(settings, fetcher).send(email)).toBe("accepted");
  });
});
