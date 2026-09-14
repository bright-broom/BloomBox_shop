import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CustomerManagementError } from '@/modules/customer/public';
import type { DatabaseClient, DatabaseTransaction } from '../../database/postgres-client';
export type CustomerSupportActor = Readonly<{ operatorId: string; expiresAt: Date }>;
/** Authorize and audit the disclosure atomically; an audit failure prevents disclosure. */
export async function withCustomerSupport<T>(sql: DatabaseClient, actor: CustomerSupportActor,
  action: 'DIRECTORY' | 'HISTORY', work: (tx: DatabaseTransaction) => Promise<{ value: T; customerIds: readonly string[] }>): Promise<T> {
  if (!z.object({ operatorId: z.uuid(), expiresAt: z.date() }).safeParse(actor).success) throw new CustomerManagementError('DENIED');
  try {
    const result = await sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '2s'`;
      await tx`SET LOCAL statement_timeout = '5s'`;
      const [grant] = await tx`SELECT * FROM bloombox.lock_customer_support_operator(${actor.operatorId}::uuid)`;
      const authorize = async () => {
        const [clock] = await tx`SELECT clock_timestamp() AS now`;
        const now = z.date().parse(clock.now);
        if (!grant || grant.enabled !== true || z.date().parse(grant.created_at) > now
          || z.date().parse(grant.valid_until) <= now || actor.expiresAt <= now) throw new CustomerManagementError('DENIED');
      };
      await authorize();
      const result = await work(tx);
      await tx`INSERT INTO bloombox.customer_support_accesses (id, operator_id, action, customer_ids)
        VALUES (${randomUUID()}, ${actor.operatorId}, ${action}, ${[...result.customerIds]}::uuid[])`;
      await authorize();
      return result;
    });
    return result.value;
  } catch (error) {
    if (error instanceof CustomerManagementError) throw error;
    throw new CustomerManagementError('UNAVAILABLE');
  }
}
