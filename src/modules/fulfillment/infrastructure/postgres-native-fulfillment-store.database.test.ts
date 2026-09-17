import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { withNativeFulfillmentOperator } from "@/shared/infrastructure/security/operator-auth/native-fulfillment-transaction";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import { ApplyNativeFulfillmentCommand } from "../application/apply-native-fulfillment-command";
import type { NativeFulfillmentActor } from "../application/manage-native-fulfillment";
import type { NativeFulfillmentCommand } from "../domain/native-fulfillment";
import { PostgresNativeFulfillmentStore } from "./postgres-native-fulfillment-store";

const url = process.env.TEST_DATABASE_URL;
if (url && (!["localhost", "127.0.0.1"].includes(new URL(url).hostname) || !new URL(url).pathname.includes("test"))) {
  throw new Error("Isolated local test database required");
}
const suite = url ? describe : describe.skip;
suite("native fulfillment transactional operations and least privilege", () => {
  const sql = postgres(url ?? "postgres://invalid/test_missing", { max: 5, ssl: false, onnotice: () => {} });
  const roleUrl = new URL(url ?? "postgres://invalid/test_missing");
  roleUrl.username = "test_native_fulfillment";
  roleUrl.password = "test_only";
  const staff = postgres(roleUrl.toString(), { max: 5, ssl: false, onnotice: () => {} });
  const protector = new AesGcmDataProtector({ activeKeyId: "test", keys: new Map([["test", Buffer.alloc(32, 3)]]) });
  const secretAddress = { country: "JP", postal_code: "1000001", state: "東京都", city: "千代田区", line1: "検証専用番地", line2: null };
  const actor: NativeFulfillmentActor = { operatorId: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) };
  const work = <T>(fn: (store: PostgresNativeFulfillmentStore, tx: DatabaseTransaction) => Promise<T>, as = actor) =>
    withNativeFulfillmentOperator(staff, as, (tx) => fn(new PostgresNativeFulfillmentStore(tx, protector), tx));
  const apply = (command: NativeFulfillmentCommand, as = actor) => work((store) => new ApplyNativeFulfillmentCommand(store).execute(command, as), as);
  const command = (id: string, expectedVersion: number, action: "START_PREPARATION" | "MARK_READY" | "MARK_DELIVERED"): NativeFulfillmentCommand =>
    ({ fulfillmentId: id, requestId: randomUUID(), expectedVersion, action });
  const ship = (id: string, expectedVersion = 3): NativeFulfillmentCommand =>
    ({ fulfillmentId: id, requestId: randomUUID(), expectedVersion, action: "SHIP", carrier: "YAMATO", trackingNumber: "1234-5678-9012" });

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let run = 0; run < 2; run++) execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: url, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
    await sql.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_native_fulfillment') THEN CREATE ROLE test_native_fulfillment LOGIN PASSWORD 'test_only'; END IF; END $$`);
    await sql.unsafe("GRANT bloombox_native_fulfillment TO test_native_fulfillment");
    await sql`INSERT INTO bloombox.native_fulfillment_operators (operator_id, enabled, valid_until) VALUES (${actor.operatorId}, true, clock_timestamp() + interval '1 hour')`;
  });
  beforeEach(async () => {
    // A concurrent READY/HOLD test may leave an ON_HOLD order. Keep every test's
    // order graph isolated so pagination is independent of test order and race winners.
    // The guarded localhost test database is disposable; operator grants remain intact.
    await sql`TRUNCATE bloombox.orders CASCADE`;
  });
  afterAll(async () => { await staff.end({ timeout: 5 }); await sql.end({ timeout: 5 }); });

  async function seed(options: { provider?: "STRIPE" | "SHOPIFY"; quantity?: number; status?: string; deliveryDate?: string } = {}) {
    const orderId = randomUUID(), id = randomUUID(), paymentId = randomUUID();
    const provider = options.provider ?? "STRIPE", quantity = options.quantity ?? 1;
    await sql`INSERT INTO bloombox.orders (id, display_id, status, commerce_provider, external_order_id, currency,
      subtotal_minor, tax_minor, shipping_minor, discount_minor, total_minor, created_at, updated_at)
      VALUES (${orderId}, ${`TEST-${orderId}`}, 'CONFIRMED', ${provider}, ${orderId}, 'JPY', 4000, 0, 0, 0, 4000, clock_timestamp(), clock_timestamp())`;
    await sql`INSERT INTO bloombox.order_items (id, order_id, external_product_id, catalog_product_id, product_name_snapshot, quantity, unit_amount_minor,
      tax_minor, discount_minor, line_total_minor, currency, position)
      VALUES (${randomUUID()}, ${orderId}, 'native_fixture', 'native_fixture', '検証用M', ${quantity}, 4000, 0, 0, ${4000 * quantity}, 'JPY', 0)`;
    await sql`INSERT INTO bloombox.payments (id, order_id, commerce_provider, external_payment_id, status,
      amount_requested_minor, amount_authorized_minor, amount_captured_minor, currency, created_at, updated_at)
      VALUES (${paymentId}, ${orderId}, ${provider}, ${paymentId}, 'CAPTURED', 4000, 4000, 4000, 'JPY', clock_timestamp(), clock_timestamp())`;
    const address = protector.protect(JSON.stringify({ customerDetails: { name: "購入者非公開", email: "private@example.test", phone: "09000000000" },
      collectedInformation: { shipping_details: { name: "受取人検証", address: secretAddress } } }), `order:${orderId}:address:v1`);
    await sql`INSERT INTO bloombox.order_gift_snapshots (order_id, delivery_date, pii_key_id, recipient_ciphertext, address_ciphertext, gift_message_ciphertext)
      VALUES (${orderId}, ${options.deliveryDate ?? "2026-10-01"}, 'test', ${Buffer.from("private recipient")}, ${address.ciphertext}, ${Buffer.from("private gift")})`;
    await sql`INSERT INTO bloombox.fulfillments (id, order_id, status, created_at, updated_at)
      VALUES (${id}, ${orderId}, ${options.status ?? "UNFULFILLED"}, clock_timestamp(), clock_timestamp())`;
    return { id, orderId, paymentId };
  }

  it("prepares, ships, corrects tracking and records delivery exactly once with audits", async () => {
    const { id, paymentId } = await seed();
    await apply(command(id, 1, "START_PREPARATION"));
    await apply(command(id, 2, "MARK_READY"));
    const sent = ship(id);
    expect(await apply(sent)).toMatchObject({ status: "SHIPPED", version: 4, replayed: false });
    expect(await apply(sent)).toMatchObject({ status: "SHIPPED", version: 4, replayed: true });
    // Physical delivery/tracking facts remain recordable even after a payment dispute.
    await sql`UPDATE bloombox.payments SET status = 'DISPUTED' WHERE id = ${paymentId}`;
    await apply({ ...ship(id, 4), action: "CORRECT_TRACKING", carrier: "JAPAN_POST", trackingNumber: "ab123456cd" });
    await apply(command(id, 5, "MARK_DELIVERED"));
    const detail = await work((store) => store.read(id, actor));
    expect(detail).toMatchObject({ status: "DELIVERED", version: 6, paymentStatus: "DISPUTED",
      shipment: { carrier: "JAPAN_POST", trackingNumber: "AB123456CD" }, destination: { name: "受取人検証", line1: secretAddress.line1 } });
    expect(detail?.shipment?.shippedAt).toBeTruthy(); expect(detail?.shipment?.deliveredAt).toBeTruthy();
    expect(detail?.history).toHaveLength(5);
    expect(JSON.stringify(detail?.history)).not.toMatch(/trackingNumber|123456789012|AB123456CD/);
    expect(JSON.stringify(detail)).not.toMatch(/購入者非公開|private@example|09000000000|private gift/);
    const [counts] = await sql`SELECT (SELECT count(*) FROM bloombox.shipments WHERE fulfillment_id = ${id})::int AS shipments,
      (SELECT count(*) FROM bloombox.fulfillment_status_transitions WHERE fulfillment_id = ${id})::int AS transitions,
      (SELECT count(*) FROM bloombox.native_fulfillment_accesses WHERE fulfillment_id = ${id})::int AS accesses`;
    expect(counts).toMatchObject({ shipments: 1, transitions: 4, accesses: 1 });
  });

  it("rejects stale versions, changed retry commands and cross-fulfillment request reuse", async () => {
    const first = await seed(), second = await seed();
    const prepared = command(first.id, 1, "START_PREPARATION"); await apply(prepared);
    await expect(apply(command(first.id, 1, "MARK_READY"))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(apply({ ...prepared, action: "HOLD", reason: "OTHER" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(apply({ ...prepared, fulfillmentId: second.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await work((store) => store.read(second.id, actor)))?.version).toBe(1);
  });

  it("serializes duplicate and conflicting concurrent operations", async () => {
    const { id } = await seed(); const input = command(id, 1, "START_PREPARATION");
    const receipts = await Promise.all([apply(input), apply(input)]);
    expect(receipts.filter((receipt) => receipt.replayed)).toHaveLength(1);
    const results = await Promise.allSettled([apply(command(id, 2, "MARK_READY")), apply({ fulfillmentId: id, requestId: randomUUID(), expectedVersion: 2, action: "HOLD", reason: "OTHER" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await work((store) => store.read(id, actor)))?.version).toBe(3);
  });

  it("blocks legacy orders, unpaid preparation and multi-box shipments", async () => {
    const legacy = await seed({ provider: "SHOPIFY" });
    expect(await work((store) => store.read(legacy.id, actor))).toBeNull();
    await expect(apply(command(legacy.id, 1, "START_PREPARATION"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const unpaid = await seed(); await sql`UPDATE bloombox.payments SET status = 'REFUNDED' WHERE id = ${unpaid.paymentId}`;
    await expect(apply(command(unpaid.id, 1, "START_PREPARATION"))).rejects.toMatchObject({ code: "PAYMENT_NOT_SETTLED" });
    const multiple = await seed({ quantity: 2, status: "READY" });
    await expect(apply(ship(multiple.id, 1))).rejects.toMatchObject({ code: "MULTI_BOX_UNSUPPORTED" });
    expect((await work((store) => store.read(multiple.id, actor)))?.shipment).toBeNull();
  });

  it("holds and cancels inactive orders without changing payments or stock", async () => {
    const { id, orderId } = await seed(); await sql`UPDATE bloombox.orders SET status = 'CANCELLED' WHERE id = ${orderId}`;
    await apply({ fulfillmentId: id, requestId: randomUUID(), expectedVersion: 1, action: "HOLD", reason: "PAYMENT_REVIEW" });
    await apply({ fulfillmentId: id, requestId: randomUUID(), expectedVersion: 2, action: "CANCEL", reason: "PAYMENT_ISSUE" });
    expect((await work((store) => store.read(id, actor)))?.status).toBe("CANCELLED");
    const [payment] = await sql`SELECT status FROM bloombox.payments WHERE order_id = ${orderId}`;
    expect(payment.status).toBe("CAPTURED");
  });

  it("returns bounded stable date/UUID pages with no PII and rejects forged cursors", async () => {
    for (let index = 0; index < 32; index++) await seed({ status: "ON_HOLD", deliveryDate: index < 16 ? "2026-09-30" : "2026-10-01" });
    const first = await work((store) => store.list({ status: "ON_HOLD", after: null }));
    expect(first.items).toHaveLength(30); expect(first.next).toBeTruthy();
    const second = await work((store) => store.list({ status: "ON_HOLD", after: first.next }));
    expect(second.items).toHaveLength(2); expect(second.next).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.fulfillmentId)).size).toBe(32);
    expect(JSON.stringify(first)).not.toMatch(/受取人|購入者|ciphertext|line1|private@example/);
    for (const after of ["@@@", Buffer.from(JSON.stringify({ deliveryDate: "2026-02-31", fulfillmentId: randomUUID() })).toString("base64url"), Buffer.from(JSON.stringify({ deliveryDate: "2026-10-01", fulfillmentId: "not-uuid" })).toString("base64url")]) {
      await expect(work((store) => store.list({ status: null, after }))).rejects.toMatchObject({ code: "INVALID" });
    }
  });

  it("does not fall back to billing data or return corrupt ciphertext", async () => {
    const { id, orderId } = await seed();
    const billingOnly = protector.protect(JSON.stringify({ customerDetails: { name: "秘密購入者", address: secretAddress }, collectedInformation: {} }), `order:${orderId}:address:v1`);
    await sql`UPDATE bloombox.order_gift_snapshots SET address_ciphertext = ${billingOnly.ciphertext} WHERE order_id = ${orderId}`;
    expect((await work((store) => store.read(id, actor)))?.destination).toBeNull();
    await sql`UPDATE bloombox.order_gift_snapshots SET address_ciphertext = ${Buffer.from("corrupt")} WHERE order_id = ${orderId}`;
    expect((await work((store) => store.read(id, actor)))?.destination).toBeNull();
  });

  it("denies missing, disabled, expired grants and expired sessions", async () => {
    const { id } = await seed();
    await expect(work((store) => store.read(id, actor), { ...actor, operatorId: randomUUID() })).rejects.toMatchObject({ code: "DENIED" });
    await expect(work((store) => store.read(id, actor), { ...actor, expiresAt: new Date(0) })).rejects.toMatchObject({ code: "DENIED" });
    const disabled = { ...actor, operatorId: randomUUID() };
    await sql`INSERT INTO bloombox.native_fulfillment_operators (operator_id, valid_until) VALUES (${disabled.operatorId}, clock_timestamp() + interval '1 hour')`;
    await expect(work((store) => store.read(id, disabled), disabled)).rejects.toMatchObject({ code: "DENIED" });
    const expired = { ...actor, operatorId: randomUUID() };
    await sql`INSERT INTO bloombox.native_fulfillment_operators (operator_id, enabled, created_at, valid_until)
      VALUES (${expired.operatorId}, true, clock_timestamp() - interval '2 hour', clock_timestamp() - interval '1 hour')`;
    await expect(work((store) => store.read(id, expired), expired)).rejects.toMatchObject({ code: "DENIED" });
  });

  it("rolls back a write when the authenticated session expires during work", async () => {
    const { id } = await seed(); const expiresSoon = { ...actor, expiresAt: new Date(Date.now() + 120) };
    await expect(work(async (store, tx) => {
      await new ApplyNativeFulfillmentCommand(store).execute(command(id, 1, "START_PREPARATION"), expiresSoon);
      await tx`SELECT pg_sleep(0.2)`;
    }, expiresSoon)).rejects.toMatchObject({ code: "DENIED" });
    expect((await work((store) => store.read(id, actor)))?.version).toBe(1);
  });

  it("cannot self-grant, read buyer/contact/gift data or mutate an immutable audit", async () => {
    const forbidden = ["SELECT * FROM bloombox.native_fulfillment_operators", "SELECT * FROM bloombox.buyers",
      "SELECT * FROM bloombox.customer_contacts", "SELECT * FROM bloombox.customer_accounts", "SELECT * FROM bloombox.webhook_inbox",
      "SELECT * FROM bloombox.ledger_entries", "SELECT buyer_id FROM bloombox.orders", "SELECT gift_message_ciphertext FROM bloombox.order_gift_snapshots",
      "SELECT recipient_ciphertext FROM bloombox.order_gift_snapshots", "UPDATE bloombox.payments SET status = 'REFUNDED'", "UPDATE bloombox.orders SET status = 'CANCELLED'",
      "UPDATE bloombox.native_fulfillment_operators SET enabled = true"];
    for (const statement of forbidden) await expect(staff.unsafe(statement)).rejects.toMatchObject({ code: "42501" });
    const { id } = await seed(); await apply(command(id, 1, "START_PREPARATION")); await work((store) => store.read(id, actor));
    await expect(sql`DELETE FROM bloombox.native_fulfillment_changes WHERE fulfillment_id = ${id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE bloombox.native_fulfillment_accesses SET operator_id = ${randomUUID()} WHERE fulfillment_id = ${id}`).rejects.toMatchObject({ code: "23514" });
  });

  it("rechecks payment after a competing refund releases its row lock", async () => {
    const { id, paymentId } = await seed({ status: "READY" });
    let unlock: () => void = () => {};
    const release = new Promise<void>((resolve) => { unlock = resolve; });
    let reportLocked: () => void = () => {};
    const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
    const refund = sql.begin(async (tx) => {
      await tx`SELECT id FROM bloombox.payments WHERE id = ${paymentId} FOR UPDATE`;
      reportLocked(); await release;
      await tx`UPDATE bloombox.payments SET status = 'REFUNDED' WHERE id = ${paymentId}`;
    });
    await locked;
    const shipping = apply(ship(id, 1));
    // Allow the fulfillment transaction to block on the locked payment before the refund commits.
    await new Promise((resolve) => setTimeout(resolve, 30));
    unlock(); await refund;
    await expect(shipping).rejects.toMatchObject({ code: "PAYMENT_NOT_SETTLED" });
    expect((await work((store) => store.read(id, actor)))?.version).toBe(1);
  });

  it("rolls back state and shipment when the immutable change cannot be saved", async () => {
    const { id } = await seed({ status: "READY" });
    await sql.unsafe("REVOKE INSERT ON bloombox.native_fulfillment_changes FROM bloombox_native_fulfillment");
    try { await expect(apply(ship(id, 1))).rejects.toMatchObject({ code: "UNAVAILABLE" }); }
    finally { await sql.unsafe("GRANT INSERT ON bloombox.native_fulfillment_changes TO bloombox_native_fulfillment"); }
    expect((await work((store) => store.read(id, actor)))).toMatchObject({ version: 1, status: "READY", shipment: null });
  });

  it("fails closed when destination access cannot be recorded", async () => {
    const { id } = await seed();
    await sql.unsafe("REVOKE INSERT ON bloombox.native_fulfillment_accesses FROM bloombox_native_fulfillment");
    try { await expect(work((store) => store.read(id, actor))).rejects.toMatchObject({ code: "UNAVAILABLE" }); }
    finally { await sql.unsafe("GRANT INSERT ON bloombox.native_fulfillment_accesses TO bloombox_native_fulfillment"); }
  });
});
