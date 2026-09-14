import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOperatorAuth } from './operator-auth';
import { getCustomerSupportDatabaseClient } from '../../database/database-connections';
import { directoryInputSchema, historyInputSchema, openCustomerDirectory, openCustomerHistory } from './customer-management';
import { loadCustomerSupportDatabaseConfig } from '../../config/database-config';
vi.mock('./operator-auth', () => ({ getOperatorAuth: vi.fn() }));
vi.mock('../../database/database-connections', () => ({ getCustomerSupportDatabaseClient: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
describe('customer support security boundary', () => {
  it('denies unauthenticated reads before opening a database connection, including malformed inputs', async () => {
    vi.mocked(getOperatorAuth).mockReturnValue(null);
    await expect(openCustomerDirectory({ q: ['invalid'] })).rejects.toMatchObject({ code: 'DENIED' });
    await expect(openCustomerHistory({ id: 'invalid' })).rejects.toMatchObject({ code: 'DENIED' });
    expect(getCustomerSupportDatabaseClient).not.toHaveBeenCalled();
  });
  it('requires dedicated credentials and never falls back to application/catalog connections', () => {
    const other = { DATABASE_URL: 'postgres://localhost/app', DATABASE_CATALOG_MANAGER_URL: 'postgres://localhost/catalog' };
    expect(() => loadCustomerSupportDatabaseConfig(other)).toThrow('Database configuration is invalid');
    expect(loadCustomerSupportDatabaseConfig({ ...other, DATABASE_CUSTOMER_SUPPORT_URL: 'postgres://localhost/support' }).url).toBe('postgres://localhost/support');
  });
  it('accepts only bounded opaque references, valid states and UUID cursors', () => {
    for (const input of [{ q: 'email@example.test' }, { q: 'x'.repeat(101) }, { after: ['a', 'b'] }, { status: 'unknown' }, { operatorId: 'forged' }]) expect(directoryInputSchema.safeParse(input).success).toBe(false);
    expect(directoryInputSchema.safeParse({ q: '  BB-TEST  ', status: '' }).success).toBe(true);
    expect(historyInputSchema.safeParse({ id: 'invalid' }).success).toBe(false);
  });
});
