import { hkdfSync, randomUUID } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import { FulfillmentApprovalError, type FulfillmentApprovalRequest } from "@/modules/fulfillment/public";

const audience = "bloombox:fulfillment-approval-intent:v1";
const maxAgeSeconds = 300;
const claimsSchema = z.object({
  shop: z.string().max(255).regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  fulfillmentId: z.uuid(), reviewedIntakeVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  operatorId: z.uuid(), sessionExpiresAt: z.iso.datetime(), testMode: z.boolean(), jti: z.uuid(),
  iat: z.number().int(), exp: z.number().int(),
});
type Actor = Readonly<{ operatorId: string; expiresAt: Date }>;
type Target = Omit<FulfillmentApprovalRequest, "idempotencyKey">;

/** Encrypted review context, never authority to approve. The command revalidates current permissions and facts. */
export class OperatorApprovalIntent {
  private readonly key: Uint8Array;
  constructor(secret: string, private readonly origin: string, private readonly now: () => Date = () => new Date()) {
    this.key = new Uint8Array(hkdfSync("sha256", secret, origin, audience, 32));
  }
  async issue(target: Target, actor: Actor, testMode: boolean): Promise<string> {
    const now = this.now();
    const issued = Math.floor(now.getTime() / 1000);
    const expires = Math.min(issued + maxAgeSeconds, Math.floor(actor.expiresAt.getTime() / 1000));
    if (!Number.isFinite(issued) || expires <= issued) throw new FulfillmentApprovalError("NOT_AUTHORIZED");
    const claims = claimsSchema.parse({ ...target, operatorId: actor.operatorId, sessionExpiresAt: actor.expiresAt.toISOString(),
      testMode, jti: randomUUID(), iat: issued, exp: expires });
    return new EncryptJWT(claims).setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
      .setIssuer(this.origin).setAudience(audience).encrypt(this.key);
  }
  async read(token: string, actor: Actor, testMode: boolean): Promise<FulfillmentApprovalRequest> {
    try {
      if (!token || token.length > 2048) throw new Error("Invalid review context");
      const now = this.now();
      const { payload } = await jwtDecrypt(token, this.key, { issuer: this.origin, audience,
        keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"],
        currentDate: now, maxTokenAge: maxAgeSeconds, requiredClaims: ["iat", "exp", "jti"] });
      const claims = claimsSchema.parse(payload);
      if (claims.operatorId !== actor.operatorId || claims.sessionExpiresAt !== actor.expiresAt.toISOString()
        || claims.testMode !== testMode || actor.expiresAt <= now || claims.exp - claims.iat > maxAgeSeconds) {
        throw new Error("Review context mismatch");
      }
      return { shop: claims.shop, fulfillmentId: claims.fulfillmentId,
        reviewedIntakeVersion: claims.reviewedIntakeVersion, idempotencyKey: claims.jti };
    } catch { throw new FulfillmentApprovalError("REVIEW_REQUIRED"); }
  }
}
