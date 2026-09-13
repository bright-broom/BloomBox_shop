import { z } from "zod";
import { CatalogManagementError, type ManagementActor } from "@/modules/catalog/public";
import { StockManagementError } from "@/modules/inventory/public";
import type { DatabaseClient, DatabaseTransaction } from "../../database/postgres-client";
export async function withCatalogManager<T>(sql: DatabaseClient, actor: ManagementActor, work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  if (!z.object({ operatorId: z.uuid(), expiresAt: z.date() }).safeParse(actor).success) throw new CatalogManagementError("DENIED");
  try {
    const result = await sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '2s'`;
      await tx`SET LOCAL statement_timeout = '5s'`;
      const [grant] = await tx`SELECT * FROM bloombox.lock_native_catalog_operator(${actor.operatorId}::uuid)`;
      const authorize = async () => {
        const [clock] = await tx`SELECT clock_timestamp() AS now`;
        const now = z.date().parse(clock.now);
        if (!grant || grant.enabled !== true || z.date().parse(grant.created_at) > now
          || z.date().parse(grant.valid_until) <= now || actor.expiresAt <= now) throw new CatalogManagementError("DENIED");
      };
      await authorize();
      const result = await work(tx);
      await authorize();
      return { value: result };
    });
    return result.value;
  } catch (error) {
    if (error instanceof CatalogManagementError || error instanceof StockManagementError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new CatalogManagementError("CONFLICT");
    throw new CatalogManagementError("UNAVAILABLE");
  }
}
