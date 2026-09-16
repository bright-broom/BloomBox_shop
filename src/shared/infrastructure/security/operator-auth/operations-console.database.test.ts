import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { getCustomerSupportDatabaseClient } from "../../database/database-connections";
import { openOperatorOrders, openOperatorReport } from "./operations-console";
vi.mock("../../database/database-connections", () => ({
  getCustomerSupportDatabaseClient: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("./operator-auth", () => ({ getOperatorAuth: mocks.auth }));
const url = process.env.TEST_DATABASE_URL;
if (
  url &&
  (!["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes("test"))
)
  throw new Error("Isolated test database required");
(url ? describe : describe.skip)(
  "operations console least privilege queries",
  () => {
    const owner = postgres(url ?? "postgres://invalid/test", {
      ssl: false,
      max: 3,
    });
    const support = postgres(url ?? "postgres://invalid/test", {
      ssl: false,
      max: 3,
      connection: { options: "-c role=bloombox_customer_support" },
    });
    const actor = randomUUID(),
      customer = randomUUID();
    let firstId = "",
      firstName = "";
    beforeAll(async () => {
      await owner.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
      execFileSync("node", ["scripts/migrate-database.mjs"], {
        env: {
          ...process.env,
          DATABASE_URL: url,
          DATABASE_SSL_MODE: "disable",
        },
        stdio: "pipe",
      });
      await owner.unsafe(
        (await readFile("database/roles.sql", "utf8")).replace(
          /^\\set ON_ERROR_STOP on$/m,
          "",
        ),
      );
      await owner`INSERT INTO bloombox.customer_support_operators(operator_id,enabled,valid_until) VALUES(${actor},true,clock_timestamp()+interval '1 hour')`;
      await owner`INSERT INTO bloombox.customer_accounts(id,status) VALUES(${customer},'ACTIVE')`;
      vi.mocked(getCustomerSupportDatabaseClient).mockReturnValue(support);
      mocks.auth.mockReturnValue({
        config: { bindings: [{ subject: "synthetic-ops", operatorId: actor }] },
        auth: {
          auth: async () => ({
            user: { id: "synthetic-ops" },
            expires: new Date(Date.now() + 3600000).toISOString(),
          }),
        },
      });
    });
    afterAll(async () => {
      await support.end();
      await owner.end();
      vi.restoreAllMocks();
    });
    async function order({
      provider = "STRIPE",
      status = "CONFIRMED",
      age = 0,
      customerId = customer,
      payments = ["CAPTURED"],
      fulfillment = ["UNFULFILLED"],
    }: {
      provider?: string;
      status?: string;
      age?: number;
      customerId?: string | null;
      payments?: string[];
      fulfillment?: string[];
    } = {}) {
      const buyer = randomUUID(),
        id = randomUUID(),
        name = "BB-" + id;
      await owner`INSERT INTO bloombox.buyers(id,customer_id) VALUES(${buyer},${customerId})`;
      await owner`INSERT INTO bloombox.orders(id,display_id,buyer_id,status,commerce_provider,external_order_id,currency,subtotal_minor,tax_minor,shipping_minor,discount_minor,total_minor,created_at,updated_at)
   VALUES(${id},${name},${buyer},${status},${provider},${id},'JPY',4000,0,1000,0,5000,date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo'-${age}*interval '1 day',now())`;
      for (const p of payments)
        await owner`INSERT INTO bloombox.payments(id,order_id,commerce_provider,external_payment_id,status,amount_requested_minor,currency,created_at,updated_at) VALUES(${randomUUID()},${id},${provider},${randomUUID()},${p},5000,'JPY',now(),now())`;
      for (const f of fulfillment)
        await owner`INSERT INTO bloombox.fulfillments(id,order_id,status,created_at,updated_at) VALUES(${randomUUID()},${id},${f},now(),now())`;
      return { id, name };
    }
    it("excludes legacy orders, preserves separate states and audits references without PII", async () => {
      const first = await order({
        payments: ["CAPTURED", "FAILED"],
        fulfillment: ["UNFULFILLED", "SHIPPED"],
      });
      firstId = first.id;
      firstName = first.name;
      await order({ provider: "SHOPIFY" });
      const page = await openOperatorOrders({ q: first.name });
      expect(page.orders).toHaveLength(1);
      expect(page.orders[0]).toMatchObject({
        id: first.id,
        customerId: customer,
        payment: ["CAPTURED", "FAILED"],
        fulfillment: ["SHIPPED", "UNFULFILLED"],
      });
      expect((await openOperatorOrders({ q: first.id })).orders).toHaveLength(
        1,
      );
      expect(
        (
          await openOperatorOrders({
            payment: "FAILED",
            fulfillment: "SHIPPED",
          })
        ).orders,
      ).toHaveLength(1);
      const audit =
        await owner`SELECT * FROM bloombox.customer_support_accesses WHERE operator_id=${actor}`;
      expect(audit.length).toBe(3);
      expect(audit[0].customer_ids).toContain(customer);
      expect(JSON.stringify(audit)).not.toContain(first.name);
      expect(JSON.stringify(page)).not.toMatch(
        /ciphertext|email|subject|address/,
      );
    });
    it("aggregates once per order, excludes cancellation value, and uses Japan date boundaries", async () => {
      await order({ customerId: null });
      await order({ status: "CANCELLED", payments: ["REFUNDED"] });
      await order({ age: 6 });
      await order({ age: 7 });
      const report = await openOperatorReport({ days: "7" });
      expect(report).toMatchObject({
        orders: 4,
        orderValueYen: 15000,
        captured: 2,
        refunds: 1,
        cancelled: 1,
        awaitingShipment: 2,
      });
      expect(report.daily).toHaveLength(7);
      expect(report.daily.reduce((n, d) => n + d.orders, 0)).toBe(
        report.orders,
      );
      expect(new Date(report.since).getUTCHours()).toBe(15);
    });
    it("does not expose anonymized customer links or accept foreign cursors and pages deterministically", async () => {
      await owner`UPDATE bloombox.customer_accounts SET status='ANONYMIZED' WHERE id=${customer}`;
      expect(
        (await openOperatorOrders({ q: firstName })).orders[0].customerId,
      ).toBeNull();
      expect(
        (await openOperatorOrders({ q: firstName, after: randomUUID() }))
          .orders,
      ).toHaveLength(0);
      for (let i = 0; i < 21; i++) await order();
      const first = await openOperatorOrders({});
      const second = await openOperatorOrders({ after: first.next });
      expect(first.orders).toHaveLength(20);
      expect(second.orders).toHaveLength(6);
      expect(
        new Set([...first.orders, ...second.orders].map((o) => o.id)).size,
      ).toBe(26);
      expect(
        (await openOperatorOrders({ status: "CANCELLED", after: firstId }))
          .orders,
      ).toHaveLength(0);
    });
    it("denies expired/revoked grants and fails closed if audit cannot commit", async () => {
      await owner`UPDATE bloombox.customer_support_operators SET enabled=false WHERE operator_id=${actor}`;
      await expect(openOperatorOrders({})).rejects.toMatchObject({
        code: "DENIED",
      });
      await expect(openOperatorReport({})).rejects.toMatchObject({
        code: "DENIED",
      });
      await owner`UPDATE bloombox.customer_support_operators SET enabled=true WHERE operator_id=${actor}`;
      await owner.unsafe(
        "REVOKE INSERT ON bloombox.customer_support_accesses FROM bloombox_customer_support",
      );
      try {
        await expect(openOperatorOrders({})).rejects.toMatchObject({
          code: "UNAVAILABLE",
        });
        await expect(openOperatorReport({})).rejects.toMatchObject({
          code: "UNAVAILABLE",
        });
      } finally {
        await owner.unsafe(
          "GRANT INSERT ON bloombox.customer_support_accesses TO bloombox_customer_support",
        );
      }
    });
    it("cannot read identity, address, or mutate orders using the support connection", async () => {
      for (const query of [
        "SELECT * FROM bloombox.customer_identities",
        "SELECT recipient_ciphertext FROM bloombox.order_gift_snapshots",
        "UPDATE bloombox.orders SET status='CANCELLED'",
      ])
        await expect(support.unsafe(query)).rejects.toMatchObject({code: "42501"});
    });
  },
);
