vi.mock("@/shared/infrastructure/security/auth-entry", () => ({ requireOperatorLogin: vi.fn(async () => undefined) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerManagementError, type ManagedCustomer } from '../public';
import { CustomerDirectoryPanel, CustomerHistoryPanel } from '@/ui/customer-management';
import Customers from '@/app/operations/customers/page';
import CustomerHistory from '@/app/operations/customers/[customerId]/page';
import { openCustomerDirectory, openCustomerHistory } from '@/shared/infrastructure/security/operator-auth/customer-management';
import { customerManagementContent as copy } from '@/shared/infrastructure/content/customer-management-content';
vi.mock('@/shared/infrastructure/security/operator-auth/customer-management', async original => {
  const real = await original<typeof import('@/shared/infrastructure/security/operator-auth/customer-management')>();
  return { ...real, openCustomerDirectory: vi.fn(), openCustomerHistory: vi.fn() };
});
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
const customer: ManagedCustomer = { id: '10000000-0000-4000-8000-000000000001', status: 'ACTIVE', createdAt: '2026-09-13T22:00:00Z' };
beforeEach(() => vi.resetAllMocks());
describe('customer management presentation', () => {
  it('labels fields and preserves filters in pagination, without prefetching audited customer pages', () => {
    const html = renderToStaticMarkup(<CustomerDirectoryPanel page={{ customers: [customer], next: customer.id }} filters={{ q: 'BB-TEST', status: 'ACTIVE' }} />);
    for (const value of [copy.searchLabel, 'for="customer-query"', 'aria-describedby="customer-search-hint"', 'name="status"',
      'q=BB-TEST&amp;status=ACTIVE&amp;after=', '/operations/customers/' + customer.id, '2026/09/14']) expect(html).toContain(value);
    expect(html).not.toContain('mailto:');
  });
  it('distinguishes unavailable results from an empty list and does not link anonymized accounts', () => {
    expect(renderToStaticMarkup(<CustomerDirectoryPanel filters={{}} error={copy.messages.UNAVAILABLE} />)).not.toContain(copy.empty);
    expect(renderToStaticMarkup(<CustomerDirectoryPanel filters={{}} page={{ customers: [], next: null }} />)).toContain(copy.empty);
    const html = renderToStaticMarkup(<CustomerDirectoryPanel filters={{}} page={{ customers: [{ ...customer, status: 'ANONYMIZED' }], next: null }} />);
    expect(html).toContain(copy.anonymized); expect(html).not.toContain('href="/operations/customers/' + customer.id);
  });
  it('escapes order text and keeps mixed, missing and prototype-like statuses unknown', () => {
    const html = renderToStaticMarkup(<CustomerHistoryPanel page={{ customer, next: null, orders: [{ id: 'order', name: '<script>unsafe</script>',
      orderedAt: customer.createdAt, totalYen: 5000, status: 'constructor', payment: ['CAPTURED', 'FAILED'], fulfillment: [] }] }} />);
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>unsafe');
    expect(html).toContain(copy.multiple); expect(html).toContain(copy.unknown); expect(html).toContain('5,000');
    expect(html).not.toContain(copy.paymentStatuses.CAPTURED);
  });
  it('returns not-found on denied access and unavailable customer, with no private data rendered', async () => {
    vi.mocked(openCustomerDirectory).mockRejectedValue(new CustomerManagementError('DENIED'));
    await expect(Customers({ searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND');
    vi.mocked(openCustomerHistory).mockRejectedValue(new CustomerManagementError('DENIED'));
    const input = { params: Promise.resolve({ customerId: customer.id }), searchParams: Promise.resolve({}) };
    await expect(CustomerHistory(input)).rejects.toThrow('NOT_FOUND');
    vi.mocked(openCustomerHistory).mockResolvedValue(null);
    await expect(CustomerHistory(input)).rejects.toThrow('NOT_FOUND');
  });
  it('uses the path customer ID and displays recoverable errors without exception details', async () => {
    vi.mocked(openCustomerHistory).mockRejectedValue(new CustomerManagementError('INVALID'));
    const html = renderToStaticMarkup(await CustomerHistory({ params: Promise.resolve({ customerId: customer.id }),
      searchParams: Promise.resolve({ id: 'forged' }) }));
    expect(openCustomerHistory).toHaveBeenCalledWith({ id: customer.id });
    expect(html).toContain(copy.messages.INVALID); expect(html).not.toContain('forged');
  });
});
