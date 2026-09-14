import { z } from 'zod';
import type { DatabaseTransaction } from '@/shared/infrastructure/database/postgres-client';
import { CUSTOMER_DIRECTORY_PAGE_SIZE, type CustomerDirectoryQuery, type CustomerDirectoryFilter } from '../application/customer-management';
const rowSchema = z.object({ id: z.uuid(), status: z.enum(['ACTIVE', 'DISABLED', 'ANONYMIZED']), created_at: z.date() });
function customer(row: unknown) {
  const value = rowSchema.parse(row);
  return { id: value.id, status: value.status, createdAt: value.created_at.toISOString() };
}
export class PostgresCustomerDirectory implements CustomerDirectoryQuery {
  constructor(private readonly sql: DatabaseTransaction) {}
  async list(filter: CustomerDirectoryFilter) {
    const rows = await this.sql`SELECT id, status, created_at FROM bloombox.customer_accounts
      WHERE (${filter.customerId === undefined} OR id = ${filter.customerId ?? null}::uuid)
        AND (${filter.after === undefined} OR id > ${filter.after ?? null}::uuid)
        AND (${filter.status === undefined} OR status = ${filter.status ?? null})
      ORDER BY id LIMIT ${CUSTOMER_DIRECTORY_PAGE_SIZE + 1}`;
    const customers = rows.slice(0, CUSTOMER_DIRECTORY_PAGE_SIZE).map(customer);
    return { customers, next: rows.length > CUSTOMER_DIRECTORY_PAGE_SIZE ? customers.at(-1)!.id : null };
  }
  async find(id: string) {
    const rows = await this.sql`SELECT id, status, created_at FROM bloombox.customer_accounts WHERE id = ${id}::uuid`;
    return rows.length ? customer(rows[0]) : null;
  }
}
