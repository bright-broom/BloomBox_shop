import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getCustomerSupportDatabaseClient } from '../../database/database-connections';
import { openCustomerDirectory, openCustomerHistory } from './customer-management';
import { withCustomerSupport } from './customer-management-transaction';
vi.mock('../../database/database-connections', () => ({ getCustomerSupportDatabaseClient: vi.fn() }));
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('./operator-auth', () => ({ getOperatorAuth: mocks.auth }));
const url = process.env.TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Isolated test database required');
(url ? describe : describe.skip)('customer management with least-privilege database access', () => {
  const owner = postgres(url ?? 'postgres://invalid/test', { ssl: false, max: 5 });
  const support = postgres(url ?? 'postgres://invalid/test', { ssl: false, max: 5, connection: { options: '-c role=bloombox_customer_support' } });
  const actor = { operatorId: randomUUID(), expiresAt: new Date(Date.now() + 3600000) };
  beforeAll(async () => {
    await owner.unsafe('DROP SCHEMA IF EXISTS bloombox CASCADE');
    for (let i = 0; i < 2; i++) execFileSync('node', ['scripts/migrate-database.mjs'], { env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_MODE: 'disable' }, stdio: 'pipe' });
    await owner.unsafe((await readFile('database/roles.sql', 'utf8')).replace(/^\\set ON_ERROR_STOP on$/m, ''));
    await owner`INSERT INTO bloombox.customer_support_operators (operator_id, enabled, valid_until) VALUES (${actor.operatorId}, true, clock_timestamp() + interval '1 hour')`;
    vi.mocked(getCustomerSupportDatabaseClient).mockReturnValue(support);
    // Only the server's verified operator subject binding determines the actor.
    mocks.auth.mockReturnValue({ config: { bindings: [{ subject: 'synthetic-operator', operatorId: actor.operatorId }] },
      auth: { auth: async () => ({ user: { id: 'synthetic-operator' }, expires: actor.expiresAt.toISOString() }) } });
  });
  afterAll(async () => { await support.end(); await owner.end(); vi.restoreAllMocks(); });
  async function customer(status = 'ACTIVE') {
    const id = randomUUID();
    await owner`INSERT INTO bloombox.customer_accounts (id, status) VALUES (${id}, ${status})`;
    return id;
  }
  async function order(customerId: string | null, provider = 'STRIPE') {
    const buyer = randomUUID(), id = randomUUID(), name = 'BB-' + id;
    await owner`INSERT INTO bloombox.buyers (id, customer_id) VALUES (${buyer}, ${customerId})`;
    await owner`INSERT INTO bloombox.orders (id, display_id, buyer_id, status, commerce_provider, external_order_id,
      currency, subtotal_minor, tax_minor, shipping_minor, discount_minor, total_minor, created_at, updated_at)
      VALUES (${id}, ${name}, ${buyer}, 'CONFIRMED', ${provider}, ${id}, 'JPY', 4000, 0, 1000, 0, 5000, '2026-09-14T00:00:00.123456Z', now())`;
    return { id, name };
  }
  it('finds exact customer/order references, filters accounts and audits only opaque returned IDs', async () => {
    const id = await customer(), purchase = await order(id);
    for (const q of [id, purchase.name]) {
      expect((await openCustomerDirectory({ q })).customers.map(c => c.id)).toEqual([id]);
    }
    expect((await openCustomerDirectory({ q: purchase.name, status: 'DISABLED' })).customers).toEqual([]);
    expect((await openCustomerDirectory({ q: 'MISSING-ORDER' })).customers).toEqual([]);
    expect((await openCustomerDirectory({ q: (await order(null)).name })).customers).toEqual([]);
    const audits = await owner`SELECT * FROM bloombox.customer_support_accesses WHERE operator_id = ${actor.operatorId}`;
    expect(audits.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(audits)).not.toContain(purchase.name);
    expect(audits.some(a => a.customer_ids.includes(id))).toBe(true);
  });
  it('reads only buyer-linked native orders, retaining separate mixed payment states and excluding recipient-only/guest/legacy data', async () => {
    const id = await customer(), other = await customer(), own = await order(id), foreign = await order(other);
    await order(id, 'SHOPIFY'); await order(null);
    const recipient = randomUUID();
    await owner`INSERT INTO bloombox.recipients (id, customer_id) VALUES (${recipient}, ${id})`;
    await owner`INSERT INTO bloombox.order_gift_snapshots (order_id, recipient_id, delivery_date, pii_key_id, recipient_ciphertext, gift_message_ciphertext)
      VALUES (${foreign.id}, ${recipient}, '2026-09-20', 'synthetic', ${Buffer.from('PRIVATE ADDRESS')}, ${Buffer.from('PRIVATE MESSAGE')})`;
    for (const state of ['CAPTURED', 'FAILED']) await owner`INSERT INTO bloombox.payments
      (id, order_id, commerce_provider, external_payment_id, status, amount_requested_minor, currency, created_at, updated_at)
      VALUES (${randomUUID()}, ${own.id}, 'STRIPE', ${randomUUID()}, ${state}, 5000, 'JPY', now(), now())`;
    const page = await openCustomerHistory({ id });
    expect(page?.orders).toHaveLength(1);
    expect(page?.orders[0]).toMatchObject({ id: own.id, totalYen: 5000, status: 'CONFIRMED', payment: ['CAPTURED', 'FAILED'], fulfillment: [] });
    expect(JSON.stringify(page)).not.toMatch(/PRIVATE|ciphertext|subject|email/);
    expect((await openCustomerHistory({ id, after: foreign.id }))?.orders).toEqual([]);
    await owner`UPDATE bloombox.customer_accounts SET status = 'DISABLED' WHERE id = ${id}`;
    expect((await openCustomerHistory({ id }))?.orders).toHaveLength(1);
    await owner`UPDATE bloombox.customer_accounts SET status = 'ANONYMIZED' WHERE id = ${id}`;
    expect(await openCustomerHistory({ id })).toBeNull();
    expect(await openCustomerHistory({ id: randomUUID() })).toBeNull();
  });
  it('paginates without duplicates and rejects malformed, duplicate or unexpected input', async () => {
    const ids = await Promise.all(Array.from({ length: 32 }, () => customer('DISABLED')));
    const first = await openCustomerDirectory({ status: 'DISABLED' });
    expect(first.customers).toHaveLength(30); expect(first.next).not.toBeNull();
    const next = await openCustomerDirectory({ status: 'DISABLED', after: first.next });
    expect(next.customers).toHaveLength(2);
    expect(new Set([...first.customers, ...next.customers].map(c => c.id)).size).toBe(ids.length);
    for (const input of [{ q: ['x', 'y'] }, { q: "' OR 1=1" }, { q: 'x'.repeat(101) }, { status: 'ADMIN' }, { after: 'invalid' }, { operatorId: actor.operatorId }]) {
      await expect(openCustomerDirectory(input)).rejects.toMatchObject({ code: 'INVALID' });
    }
    const id = await customer();
    await Promise.all(Array.from({ length: 23 }, () => order(id)));
    const a = await openCustomerHistory({ id });
    const b = await openCustomerHistory({ id, after: a?.next });
    expect(a?.orders).toHaveLength(20); expect(b?.orders).toHaveLength(3);
    expect(new Set([...a!.orders, ...b!.orders].map(o => o.id)).size).toBe(23);
  });
  it('rejects missing, future, disabled and expired grants and expired sessions before disclosure', async () => {
    const work = vi.fn(async () => ({ value: 'private', customerIds: [] }));
    await expect(withCustomerSupport(support, { ...actor, operatorId: randomUUID() }, 'DIRECTORY', work)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(withCustomerSupport(support, { ...actor, expiresAt: new Date(0) }, 'DIRECTORY', work)).rejects.toMatchObject({ code: 'DENIED' });
    for (const setting of ["enabled = false", "created_at = now() + interval '10 minutes'", "created_at = now() - interval '2 hours', valid_until = now() - interval '1 hour'"]) {
      await owner.unsafe(`UPDATE bloombox.customer_support_operators SET ${setting} WHERE operator_id = $1`, [actor.operatorId]);
      try { await expect(openCustomerDirectory({})).rejects.toMatchObject({ code: 'DENIED' }); }
      finally { await owner`UPDATE bloombox.customer_support_operators SET enabled = true, created_at = now(), valid_until = now() + interval '1 hour' WHERE operator_id = ${actor.operatorId}`; }
    }
    expect(work).not.toHaveBeenCalled();
  });
  it('withholds results and rolls back audit when a session expires during a read', async () => {
    const before = await owner`SELECT id FROM bloombox.customer_support_accesses`;
    await expect(withCustomerSupport(support, { ...actor, expiresAt: new Date(Date.now() + 150) }, 'DIRECTORY', async tx => {
      await tx`SELECT pg_sleep(0.2)`; return { value: 'private', customerIds: [] };
    })).rejects.toMatchObject({ code: 'DENIED' });
    expect(await owner`SELECT id FROM bloombox.customer_support_accesses`).toHaveLength(before.length);
  });
  it('fails closed on audit persistence errors and permits retry after recovery', async () => {
    const id = await customer();
    await owner.unsafe('REVOKE INSERT ON bloombox.customer_support_accesses FROM bloombox_customer_support');
    try { await expect(openCustomerHistory({ id })).rejects.toMatchObject({ code: 'UNAVAILABLE' }); }
    finally { await owner.unsafe('GRANT INSERT ON bloombox.customer_support_accesses TO bloombox_customer_support'); }
    expect((await openCustomerHistory({ id }))?.customer.id).toBe(id);
  });
  it('cannot change accounts/grants/orders, read identity/contact/recipient payloads or tamper with audit', async () => {
    for (const statement of ['UPDATE bloombox.customer_accounts SET status = \'ACTIVE\'', 'SELECT * FROM bloombox.customer_identities',
      'SELECT * FROM bloombox.customer_contacts', 'SELECT * FROM bloombox.order_gift_snapshots', 'SELECT external_payment_id FROM bloombox.payments',
      'UPDATE bloombox.customer_support_operators SET enabled = true', 'UPDATE bloombox.orders SET total_minor = 0',
      'DELETE FROM bloombox.customer_support_accesses', 'SELECT * FROM bloombox.customer_support_accesses']) {
      await expect(support.unsafe(statement)).rejects.toMatchObject({ code: '42501' });
    }
    for (const role of ['bloombox_application', 'bloombox_catalog_manager', 'bloombox_fulfillment_approver']) {
      await expect(owner.begin(async tx => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`SELECT * FROM bloombox.lock_customer_support_operator(${actor.operatorId}::uuid)`;
      })).rejects.toMatchObject({ code: '42501' });
    }
  });
});
