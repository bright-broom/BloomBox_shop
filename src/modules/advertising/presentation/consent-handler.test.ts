import { describe, expect, it, vi } from "vitest";
import { captureConsentedAttribution, consentInputSchema, consentChoice, saveConsent } from "./consent-handler";
const token = "a".repeat(64);
const store = () => ({ active: vi.fn().mockResolvedValue(true), grant: vi.fn().mockResolvedValue(token), revoke: vi.fn(), captureIfEmpty: vi.fn() });
describe("advertising consent", () => {
  it("rejects arbitrary fields, URLs, oversized clicks and client timestamps", () => {
    for (const body of [{ choice: "granted", email: "private" }, { choice: "granted", gclid: "https://private" }, { choice: "granted", fbclid: "a".repeat(513) }, { choice: "granted", capturedAt: 123 }]) expect(consentInputSchema.safeParse(body).success).toBe(false);
  });
  it("preview and denial never create tracking records", async () => {
    const s = store(); expect(await saveConsent({ choice: "granted", gclid: "click" }, undefined, false, "browser", () => s)).toBe("preview-granted");
    expect(await saveConsent({ choice: "denied" }, undefined, true, "browser", () => s)).toBe("denied"); expect(s.grant).not.toHaveBeenCalled();
  });
  it("revokes before saving denial and cannot treat a preview cookie as live consent", async () => {
    const s = store(); await saveConsent({ choice: "denied" }, token, true, "browser", () => s); expect(s.revoke).toHaveBeenCalledWith(token);
    expect(await consentChoice("preview-granted", true, () => s)).toBe("unknown");
  });
  it("never re-grants consent when a stale background capture races with withdrawal", async () => {
    const s = store(); s.active.mockResolvedValue(false);
    await captureConsentedAttribution({ choice: "capture", gclid: "click" }, token, true, "browser", () => s);
    await captureConsentedAttribution({ choice: "capture", gclid: "click" }, "denied", true, "browser", () => s);
    expect(s.grant).not.toHaveBeenCalled(); expect(s.captureIfEmpty).not.toHaveBeenCalled();
  });
  it("preserves attribution on repeated consent and validates expiration in storage", async () => {
    const s = store(); expect(await saveConsent({ choice: "granted", gclid: "new" }, token, true, "browser", () => s)).toBe(token); expect(s.grant).not.toHaveBeenCalled();
    s.active.mockResolvedValue(false); expect(await consentChoice(token, true, () => s)).toBe("unknown");
  });
});
