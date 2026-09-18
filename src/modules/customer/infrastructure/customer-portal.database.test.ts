import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PostgresCustomerPortal } from "./postgres-customer-portal";
import { PostgresCustomerRequests } from "./postgres-customer-requests";
import { PostgresCustomerIdentityRepository } from "./postgres-customer-identity-repository";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { withCustomerSupport } from "@/shared/infrastructure/security/operator-auth/customer-management-transaction";
const url = process.env.TEST_DATABASE_URL;
if (
  url &&
  (!["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes("test"))
)
  throw Error("Isolated local test database required");
const suite = url ? describe : describe.skip;
suite("customer portal ownership, persistence and recovery", () => {
  const sql = postgres(url ?? "postgres://invalid/test_missing", {
    max: 5,
    ssl: false,
  });
  const key = new AesGcmDataProtector({
    activeKeyId: "test",
    keys: new Map([["test", Buffer.alloc(32, 7)]]),
  });
  const repo = new PostgresCustomerPortal(sql, key),
    identities = new PostgresCustomerIdentityRepository(sql);
  async function actor() {
    return {
      ...(await identities.registerGoogleSubject(randomUUID())),
      expiresAt: Date.now() + 60000,
    };
  }
  const address = () => ({
    id: randomUUID(),
    label: "秘密の宛先",
    name: "秘密の氏名",
    postalCode: "1000001",
    prefecture: "東京都",
    city: "千代田区",
    line1: "秘密の番地",
    line2: "秘密の部屋",
    phone: "09012345678",
  });
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_MODE: "disable" },
      stdio: "pipe",
    });
    await sql.unsafe(
      (await readFile("database/roles.sql", "utf8")).replace(
        /^\\set ON_ERROR_STOP on$/m,
        "",
      ),
    );
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });
  it("encrypts PII with customer context, persists edits and rejects stale versions", async () => {
    const a = await actor(),
      b = await actor(),
      entry = address();
    await repo.change(a, 0, { kind: "address", address: entry });
    expect((await repo.read(a)).preferences.addresses).toEqual([entry]);
    expect((await repo.read(b)).preferences.addresses).toEqual([]);
    await expect(
      repo.change(a, 0, { kind: "profile", name: "stale", phone: "" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      repo.change(a, 1, { kind: "default-address", id: randomUUID() }),
    ).rejects.toMatchObject({ code: "not-found" });
    const [row] =
      await sql`SELECT * FROM bloombox.customer_portals WHERE customer_id=${a.customerId}`;
    expect(row.ciphertext.toString()).not.toMatch(/秘密|09012345678/);
    expect(() =>
      key.unprotect(
        { keyId: row.key_id, ciphertext: row.ciphertext },
        `customer:${b.customerId}:portal:v1`,
      ),
    ).toThrow();
    expect(
      JSON.stringify(
        await sql`SELECT * FROM bloombox.audit_logs WHERE resource_id=${a.customerId}`,
      ),
    ).not.toMatch(/秘密|09012345678/);
  });
  it("serializes simultaneous updates instead of losing one", async () => {
    const a = await actor();
    const outcomes = await Promise.allSettled([
      repo.change(a, 0, { kind: "profile", name: "A", phone: "" }),
      repo.change(a, 0, { kind: "profile", name: "B", phone: "" }),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await repo.read(a)).revision).toBe(1);
  });
  it("binds requests to the buyer, deduplicates retries and hides foreign requests", async () => {
    const a = await actor(),
      b = await actor(),
      buyer = randomUUID(),
      order = randomUUID();
    await sql`INSERT INTO bloombox.buyers(id,customer_id) VALUES (${buyer},${a.customerId})`;
    await sql`INSERT INTO bloombox.orders(id,display_id,buyer_id,status,commerce_provider,external_order_id,currency,subtotal_minor,tax_minor,shipping_minor,discount_minor,total_minor,created_at,updated_at) VALUES (${order},${order},${buyer},'CONFIRMED','STRIPE',${order},'JPY',4000,0,1000,0,5000,now(),now())`;
    const request = {
      id: randomUUID(),
      kind: "CANCELLATION" as const,
      orderId: order,
      message: "秘密の相談",
    };
    await expect(repo.request(b, request)).rejects.toMatchObject({
      code: "not-found",
    });
    await Promise.all([repo.request(a, request), repo.request(a, request)]);
    expect(await repo.requests(a)).toHaveLength(1);
    expect(await repo.requests(b)).toHaveLength(0);
    await expect(
      repo.request(a, { ...request, message: "different" }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await sql`SELECT status FROM bloombox.orders WHERE id=${order}`)[0]
        .status,
    ).toBe("CONFIRMED");
  });
  it("rejects expired, revoked and disabled actors on both reads and writes", async () => {
    const a = await actor();
    await expect(
      repo.read({ ...a, expiresAt: Date.now() - 1 }),
    ).rejects.toMatchObject({ code: "expired" });
    await repo.revokeSessions(a);
    await expect(
      repo.change(a, 0, { kind: "profile", name: "blocked", phone: "" }),
    ).rejects.toMatchObject({ code: "expired" });
    const b = await actor();
    await sql`UPDATE bloombox.customer_accounts SET status='DISABLED' WHERE id=${b.customerId}`;
    await expect(repo.read(b)).rejects.toMatchObject({ code: "expired" });
  });
  it("records explicit consent and closes access while erasing optional saved data", async () => {
    const subject = randomUUID(),
      a = {
        ...(await identities.registerGoogleSubject(subject)),
        expiresAt: Date.now() + 60000,
      };
    await repo.change(a, 0, {
      kind: "marketing",
      enabled: true,
      verifiedEmail: "fixture@example.test",
    });
    await repo.close(a);
    expect(
      await sql`SELECT * FROM bloombox.customer_portals WHERE customer_id=${a.customerId}`,
    ).toHaveLength(0);
    expect(
      (
        await sql`SELECT status FROM bloombox.customer_accounts WHERE id=${a.customerId}`
      )[0].status,
    ).toBe("DISABLED");
    expect(
      await sql`SELECT * FROM bloombox.data_subject_requests WHERE customer_id=${a.customerId}`,
    ).toHaveLength(1);
    expect(
      (
        await sql`SELECT status FROM bloombox.customer_consents WHERE customer_id=${a.customerId} ORDER BY occurred_at DESC`
      )[0].status,
    ).toBe("WITHDRAWN");
    await expect(identities.registerGoogleSubject(subject)).rejects.toThrow();
  });
  it("records one versioned membership agreement per version under the application role and withdraws it on closure", async () => {
    const a = await actor(), b = await actor();
    const connection = postgres(url!, { max: 1, ssl: false });
    try {
      await connection`SET ROLE bloombox_application`;
      const app = new PostgresCustomerPortal(connection, key);
      expect(await app.membershipAgreement(a)).toBeNull();
      // Concurrent submissions on separate connections serialize on the account row: one grant only.
      await Promise.all([repo.agreeToMembership(a, "2026-09-19-draft"), repo.agreeToMembership(a, "2026-09-19-draft")]);
      await app.agreeToMembership(a, "2026-09-19-draft");
      expect(await app.membershipAgreement(a)).toEqual({ status: "GRANTED", version: "2026-09-19-draft" });
      expect(await app.membershipAgreement(b)).toBeNull();
      await app.agreeToMembership(a, "2026-10-01");
      expect(await app.membershipAgreement(a)).toEqual({ status: "GRANTED", version: "2026-10-01" });
      await expect(app.agreeToMembership(a, "Bad Version")).rejects.toMatchObject({ code: "invalid" });
    } finally {
      await connection`RESET ROLE`;
      await connection.end();
    }
    const rows = await sql`SELECT status, policy_version, source FROM bloombox.customer_consents
      WHERE customer_id = ${a.customerId} AND purpose = 'MEMBERSHIP_TERMS' ORDER BY occurred_at, id`;
    expect(rows.map((row) => [row.status, row.policy_version, row.source])).toEqual([
      ["GRANTED", "2026-09-19-draft", "MEMBERSHIP_REGISTRATION"],
      ["GRANTED", "2026-10-01", "MEMBERSHIP_REGISTRATION"],
    ]);
    expect(await sql`SELECT 1 FROM bloombox.audit_logs WHERE resource_id = ${a.customerId} AND action = 'customer.membership.agreed'`).toHaveLength(2);
    await repo.close(a);
    const [latest] = await sql`SELECT status, policy_version, source FROM bloombox.customer_consents
      WHERE customer_id = ${a.customerId} AND purpose = 'MEMBERSHIP_TERMS' ORDER BY occurred_at DESC, id DESC LIMIT 1`;
    expect([latest.status, latest.policy_version, latest.source]).toEqual(["WITHDRAWN", "2026-10-01", "ACCOUNT_CLOSURE"]);
    await expect(repo.agreeToMembership(a, "2026-10-01")).rejects.toMatchObject({ code: "expired" });
  });
  it("uses application grants and rolls back preferences when audit fails", async () => {
    const connection = postgres(url!, { max: 1, ssl: false }),
      a = await actor();
    try {
      await connection`SET ROLE bloombox_application`;
      const app = new PostgresCustomerPortal(connection, key);
      await app.change(a, 0, { kind: "profile", name: "initial", phone: "" });
      await connection`RESET ROLE`;
      await connection`REVOKE INSERT ON bloombox.audit_logs FROM bloombox_application`;
      await connection`SET ROLE bloombox_application`;
      await expect(
        app.change(a, 1, { kind: "profile", name: "not saved", phone: "" }),
      ).rejects.toMatchObject({ code: "unavailable" });
      expect((await app.read(a)).preferences.name).toBe("initial");
    } finally {
      await connection`RESET ROLE`;
      await connection`GRANT INSERT ON bloombox.audit_logs TO bloombox_application`;
      await connection.end();
    }
  });
  it("allows audited support replies without exposing profiles or mutating orders", async () => {
    const a = await actor(),
      input = {
        id: randomUUID(),
        kind: "OTHER" as const,
        orderId: null,
        message: "相談",
      },
      operator = {
        operatorId: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      };
    await repo.request(a, input);
    await sql`INSERT INTO bloombox.customer_support_operators(operator_id,enabled,valid_until) VALUES (${operator.operatorId},true,clock_timestamp()+interval '1 hour')`;
    const connection = postgres(url!, { max: 1, ssl: false });
    try {
      await connection`SET ROLE bloombox_customer_support`;
      await withCustomerSupport(connection, operator, "HISTORY", async (tx) => {
        const r = new PostgresCustomerRequests(tx, key);
        const customerId = await r.reply(
          { id: input.id, revision: 1, status: "REPLIED", reply: "回答" },
          operator.operatorId,
        );
        return { value: null, customerIds: [customerId] };
      });
      expect((await repo.requests(a))[0]).toMatchObject({
        status: "REPLIED",
        reply: "回答",
      });
      await expect(
        withCustomerSupport(connection, operator, "HISTORY", async (tx) => ({
          value: await new PostgresCustomerRequests(tx, key).reply(
            { id: input.id, revision: 1, status: "CLOSED", reply: "stale" },
            operator.operatorId,
          ),
          customerIds: [a.customerId],
        })),
      ).rejects.toMatchObject({ code: "conflict" });
      await sql`REVOKE INSERT ON bloombox.customer_support_accesses FROM bloombox_customer_support`;
      try {
        await expect(
          withCustomerSupport(connection, operator, "HISTORY", async (tx) => ({
            value: await new PostgresCustomerRequests(tx, key).reply(
              {
                id: input.id,
                revision: 2,
                status: "CLOSED",
                reply: "not committed",
              },
              operator.operatorId,
            ),
            customerIds: [a.customerId],
          })),
        ).rejects.toMatchObject({ code: "UNAVAILABLE" });
        expect((await repo.requests(a))[0]).toMatchObject({
          status: "REPLIED",
          reply: "回答",
          revision: 2,
        });
      } finally {
        await sql`GRANT INSERT ON bloombox.customer_support_accesses TO bloombox_customer_support`;
      }

      await expect(
        connection`SELECT * FROM bloombox.customer_portals`,
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        connection`UPDATE bloombox.orders SET status='CANCELLED' WHERE false`,
      ).rejects.toMatchObject({ code: "42501" });
      await sql`UPDATE bloombox.customer_support_operators SET enabled=false WHERE operator_id=${operator.operatorId}`;
      await expect(
        withCustomerSupport(connection, operator, "HISTORY", async (tx) => ({
          value: await new PostgresCustomerRequests(tx, key).list(),
          customerIds: [],
        })),
      ).rejects.toMatchObject({ code: "DENIED" });
    } finally {
      await connection.end();
    }
  });
});
