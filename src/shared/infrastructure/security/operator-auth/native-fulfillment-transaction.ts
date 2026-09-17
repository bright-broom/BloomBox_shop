import { z } from "zod";
import { NativeFulfillmentError, type NativeFulfillmentActor } from "@/modules/fulfillment/public";
import type { DatabaseClient, DatabaseTransaction } from "../../database/postgres-client";
export async function withNativeFulfillmentOperator<T>(sql: DatabaseClient, actor: NativeFulfillmentActor, work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  if (!z.object({ operatorId: z.uuid(), expiresAt: z.date() }).safeParse(actor).success) throw new NativeFulfillmentError("DENIED");
  try {
    const result = await sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '2s'`;
      await tx`SET LOCAL statement_timeout = '5s'`;
      const [grant] = await tx`SELECT * FROM bloombox.lock_native_fulfillment_operator(${actor.operatorId}::uuid)`;
      const authorize = async () => {
        const [clock] = await tx`SELECT clock_timestamp() AS now`;
        const now = z.date().parse(clock.now);
        if (!grant || grant.enabled !== true || z.date().parse(grant.created_at) > now
          || z.date().parse(grant.valid_until) <= now || actor.expiresAt <= now) throw new NativeFulfillmentError("DENIED");
      };
      await authorize();
      const result = await work(tx);
      await authorize();
      return { value: result };
    });
    return result.value;
  } catch (error) {
    if (error instanceof NativeFulfillmentError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new NativeFulfillmentError("CONFLICT");
    throw new NativeFulfillmentError("UNAVAILABLE");
  }
}
