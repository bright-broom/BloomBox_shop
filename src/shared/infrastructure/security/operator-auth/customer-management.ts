import { z } from 'zod';
import { CustomerManagementError, CUSTOMER_SUPPORT_SEARCH_MAX_LENGTH } from '@/modules/customer/public';
import { PostgresCustomerDirectory } from '@/modules/customer/infrastructure/postgres-customer-directory';
import { PostgresSupportOrderHistory } from '@/modules/order/infrastructure/postgres-support-order-history';
import { getCustomerSupportDatabaseClient } from '../../database/database-connections';
import { getOperatorAuth } from './operator-auth';
import { GoogleFulfillmentOperatorIdentity } from './google-operator-identity';
import { withCustomerSupport } from './customer-management-transaction';
export const directoryInputSchema = z.object({ q: z.string().trim().max(CUSTOMER_SUPPORT_SEARCH_MAX_LENGTH).regex(/^[A-Za-z0-9_-]*$/).optional(),
  after: z.uuid().optional(), status: z.enum(['', 'ACTIVE', 'DISABLED', 'ANONYMIZED']).optional() }).strict();
export const historyInputSchema = z.object({ id: z.uuid(), after: z.uuid().optional() }).strict();
async function context() {
  const auth = getOperatorAuth();
  if (!auth) throw new CustomerManagementError('DENIED');
  const actor = await new GoogleFulfillmentOperatorIdentity(() => auth.auth.auth(), auth.config.bindings).current();
  if (!actor) throw new CustomerManagementError('DENIED');
  return { actor, sql: getCustomerSupportDatabaseClient() };
}
export async function openCustomerDirectory(input: unknown) {
  const { actor, sql } = await context();
  return withCustomerSupport(sql, actor, 'DIRECTORY', async (tx) => {
    const parsed = directoryInputSchema.safeParse(input);
    if (!parsed.success) throw new CustomerManagementError('INVALID');
    const { q, after, status } = parsed.data;
    const directory = new PostgresCustomerDirectory(tx);
    const customerId = !q ? undefined : z.uuid().safeParse(q).success ? q : await new PostgresSupportOrderHistory(tx).findCustomer(q);
    const value = customerId === null ? { customers: [], next: null }
      : await directory.list({ customerId, after, status: status || undefined });
    return { value, customerIds: value.customers.map((customer) => customer.id) };
  });
}
export async function openCustomerHistory(input: unknown) {
  const { actor, sql } = await context();
  return withCustomerSupport(sql, actor, 'HISTORY', async (tx) => {
    const parsed = historyInputSchema.safeParse(input);
    if (!parsed.success) throw new CustomerManagementError('INVALID');
    const customer = await new PostgresCustomerDirectory(tx).find(parsed.data.id);
    if (!customer || customer.status === 'ANONYMIZED') return { value: null, customerIds: [] };
    const history = await new PostgresSupportOrderHistory(tx).read(customer.id, parsed.data.after);
    return { value: { customer, ...history }, customerIds: [customer.id] };
  });
}
