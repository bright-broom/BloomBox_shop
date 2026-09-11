import { describe, expect, it } from "vitest";
import { OperatorApprovalIntent } from "./approval-intent";
import { FulfillmentApprovalError } from "@/modules/fulfillment/public";
const now = new Date("2026-09-12T00:00:00Z");
const secret = "synthetic-intent-encryption-secret-only";
const origin = "https://operators.example";
const actor = { operatorId: "00000000-0000-4000-8000-000000000001", expiresAt: new Date(now.getTime() + 900000) };
const target = { shop: "example.myshopify.com", fulfillmentId: "00000000-0000-4000-8000-000000000002", reviewedIntakeVersion: 3 };
const service = () => new OperatorApprovalIntent(secret, origin, () => now);
describe("encrypted operator review context", () => {
  it("binds the displayed target and version while retaining one server-created idempotency key on retries", async () => {
    const token = await service().issue(target, actor, true);
    expect(token.split(".")).toHaveLength(5);
    expect(token).not.toContain(actor.operatorId); expect(token).not.toContain(target.shop);
    const request = await service().read(token, actor, true);
    expect(request).toMatchObject(target); expect(request.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(await service().read(token, actor, true)).toEqual(request);
    expect((await service().read(await service().issue(target, actor, true), actor, true)).idempotencyKey).not.toBe(request.idempotencyKey);
  });
  it("rejects tampering, other actors/logins, mode, origin, secret and oversized input", async () => {
    const token = await service().issue(target, actor, true);
    const parts = token.split("."); parts[3] = (parts[3][0] === "a" ? "b" : "a") + parts[3].slice(1);
    const calls = [service().read(parts.join("."), actor, true), service().read("x".repeat(2049), actor, true),
      service().read(token, { ...actor, operatorId: target.fulfillmentId }, true),
      service().read(token, { ...actor, expiresAt: new Date(actor.expiresAt.getTime() + 1000) }, true),
      service().read(token, actor, false),
      new OperatorApprovalIntent("another-synthetic-secret", origin, () => now).read(token, actor, true),
      new OperatorApprovalIntent(secret, "https://another.example", () => now).read(token, actor, true)];
    for (const result of await Promise.allSettled(calls)) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toEqual(new FulfillmentApprovalError("REVIEW_REQUIRED"));
    }
  });
  it("expires after five minutes or the original session, whichever is earlier", async () => {
    const token = await service().issue(target, actor, true);
    await expect(new OperatorApprovalIntent(secret, origin, () => new Date(now.getTime() + 300000)).read(token, actor, true))
      .rejects.toEqual(new FulfillmentApprovalError("REVIEW_REQUIRED"));
    const shortActor = { ...actor, expiresAt: new Date(now.getTime() + 10000) };
    const shortToken = await service().issue(target, shortActor, true);
    await expect(new OperatorApprovalIntent(secret, origin, () => shortActor.expiresAt).read(shortToken, shortActor, true))
      .rejects.toEqual(new FulfillmentApprovalError("REVIEW_REQUIRED"));
    await expect(service().issue(target, { ...actor, expiresAt: now }, true)).rejects.toEqual(new FulfillmentApprovalError("NOT_AUTHORIZED"));
  });
});
