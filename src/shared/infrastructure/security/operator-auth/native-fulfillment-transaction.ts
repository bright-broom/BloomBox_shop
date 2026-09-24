import { z } from "zod";
import { NativeFulfillmentError, type NativeFulfillmentActor } from "@/modules/fulfillment/public";
import type { DatabaseClient, DatabaseTransaction } from "../../database/postgres-client";

type OperatorGrantErrors<E extends Error> = Readonly<{
  /** Builds the calling module's own error, so a rejected grant reads the same as its other outcomes. */
  reject: (code: "DENIED" | "CONFLICT" | "UNAVAILABLE") => E;
  /** Expected errors from the work itself pass through unchanged instead of becoming UNAVAILABLE. */
  expected: (error: unknown) => boolean;
}>;

/**
 * Runs operator work inside one transaction, with the fulfillment operator's grant checked before and after it.
 * Re-checking afterwards means a grant revoked mid-transaction still rolls the work back.
 */
export async function withOperatorGrant<T, E extends Error>(
  sql: DatabaseClient,
  actor: NativeFulfillmentActor,
  work: (tx: DatabaseTransaction) => Promise<T>,
  errors: OperatorGrantErrors<E>,
): Promise<T> {
  if (!z.object({ operatorId: z.uuid(), expiresAt: z.date() }).safeParse(actor).success) throw errors.reject("DENIED");
  try {
    const result = await sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '2s'`;
      await tx`SET LOCAL statement_timeout = '5s'`;
      const [grant] = await tx`SELECT * FROM bloombox.lock_native_fulfillment_operator(${actor.operatorId}::uuid)`;
      const authorize = async () => {
        const [clock] = await tx`SELECT clock_timestamp() AS now`;
        const now = z.date().parse(clock.now);
        if (!grant || grant.enabled !== true || z.date().parse(grant.created_at) > now
          || z.date().parse(grant.valid_until) <= now || actor.expiresAt <= now) throw errors.reject("DENIED");
      };
      await authorize();
      const result = await work(tx);
      await authorize();
      return { value: result };
    });
    return result.value;
  } catch (error) {
    if (errors.expected(error)) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw errors.reject("CONFLICT");
    throw errors.reject("UNAVAILABLE");
  }
}

export async function withNativeFulfillmentOperator<T>(sql: DatabaseClient, actor: NativeFulfillmentActor, work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  return withOperatorGrant(sql, actor, work, {
    reject: (code) => new NativeFulfillmentError(code),
    expected: (error) => error instanceof NativeFulfillmentError,
  });
}
