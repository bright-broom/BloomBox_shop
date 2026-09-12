import { z } from "zod";
import type { FulfillmentOperatorIdentity } from "@/modules/fulfillment/public";
import type { OperatorAuthConfig } from "../../config/operator-auth-config";

export class GoogleFulfillmentOperatorIdentity implements FulfillmentOperatorIdentity {
  constructor(private readonly readSession: () => Promise<unknown>, private readonly bindings: OperatorAuthConfig["bindings"],
    private readonly now: () => Date = () => new Date()) {}
  async current() {
    const parsed = z.object({ user: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/) }), expires: z.iso.datetime() }).safeParse(await this.readSession());
    if (!parsed.success) return null;
    const now = this.now();
    if (!Number.isFinite(now.getTime())) return null;
    const expiresAt = new Date(parsed.data.expires);
    if (expiresAt <= now) return null;
    const binding = this.bindings.find((item) => item.subject === parsed.data.user.id);
    if (!binding) return null;
    return { operatorId: binding.operatorId, expiresAt };
  }
}
