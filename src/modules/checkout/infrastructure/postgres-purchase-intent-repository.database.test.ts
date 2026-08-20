import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { money } from "@/shared/domain/money";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import {
  catalogProductReference,
  PurchaseIntent,
  purchaseIntentId,
} from "../domain/purchase-intent";
import { giftMessage, recipientName } from "../domain/purchase-intent-policy";
import {
  PostgresPurchaseIntentRepository,
  PurchaseIntentAlreadyExistsError,
} from "./postgres-purchase-intent-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("PostgreSQL commerce foundation", () => {
  const sql = postgres(assertSafeTestDatabaseUrl(databaseUrl), { max: 2, ssl: false });
  const protector = new AesGcmDataProtector({
    activeKeyId: "integration-key",
    keys: new Map([["integration-key", Buffer.alloc(32, 11)]]),
  });

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    runMigrations();
    runMigrations();
    const rolePolicy = (await readFile("database/roles.sql", "utf8"))
      .replace(/^\\set ON_ERROR_STOP on$/m, "");
    await sql.unsafe(rolePolicy);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("applies each checksummed migration once", async () => {
    const rows = await sql`
      SELECT version, checksum
      FROM bloombox.schema_migrations
      ORDER BY version
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe("0001");
    expect(rows[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("atomically persists an encrypted purchase intent and its outbox event", async () => {
    const intentId = purchaseIntentId(randomUUID());
    const intent = PurchaseIntent.create({
      id: intentId,
      displayId: `BBI-20260821-${intentId.slice(0, 4).toUpperCase()}`,
      item: {
        productId: catalogProductReference("prod_haru_01"),
        productName: "春のひかり",
        quantity: 1,
        unitPriceSnapshot: money(6600),
        subtotal: money(6600),
      },
      recipient: {
        name: recipientName("山田 花子"),
        deliveryDate: "2026-08-28",
      },
      giftMessage: giftMessage("おめでとう"),
      createdAt: new Date("2026-08-21T00:00:00.000Z"),
    });
    intent.transitionTo("READY_FOR_CHECKOUT");
    const repository = new PostgresPurchaseIntentRepository(sql, protector);

    await repository.save(intent);
    const restored = await repository.findById(intentId);
    const rawRows = await sql`
      SELECT recipient_ciphertext, gift_message_ciphertext
      FROM bloombox.purchase_intents
      WHERE id = ${intentId}
    `;
    const outboxRows = await sql`
      SELECT event_type, payload
      FROM bloombox.outbox_events
      WHERE aggregate_id = ${intentId}
    `;

    expect(restored?.status).toBe("READY_FOR_CHECKOUT");
    expect(restored?.recipient.name).toBe("山田 花子");
    expect(restored?.giftMessage).toBe("おめでとう");
    expect(Buffer.concat([
      rawRows[0].recipient_ciphertext,
      rawRows[0].gift_message_ciphertext,
    ]).toString("utf8")).not.toContain("花子");
    expect(outboxRows).toEqual([{
      event_type: "checkout.purchase_intent.ready",
      payload: { purchaseIntentId: intentId, status: "READY_FOR_CHECKOUT" },
    }]);

    await expect(repository.save(intent)).rejects.toBeInstanceOf(PurchaseIntentAlreadyExistsError);
    const counts = await sql`
      SELECT
        (SELECT COUNT(*)::integer FROM bloombox.purchase_intents WHERE id = ${intentId}) AS intents,
        (SELECT COUNT(*)::integer FROM bloombox.outbox_events WHERE aggregate_id = ${intentId}) AS events
    `;
    expect(counts[0]).toEqual({ intents: 1, events: 1 });
  });

  it("enforces balanced append-only financial entries at commit", async () => {
    const transactionId = randomUUID();
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO bloombox.financial_transactions (
          id, transaction_type, currency, occurred_at
        ) VALUES (${transactionId}, 'CAPTURE', 'JPY', clock_timestamp())
      `;
      await transaction`
        INSERT INTO bloombox.ledger_entries (
          id, financial_transaction_id, account_code, signed_amount_minor, currency
        ) VALUES
          (${randomUUID()}, ${transactionId}, 'CASH', 6600, 'JPY'),
          (${randomUUID()}, ${transactionId}, 'CUSTOMER_RECEIVABLE', -6600, 'JPY')
      `;
    });

    const invalidTransactionId = randomUUID();
    await expect(sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO bloombox.financial_transactions (
          id, transaction_type, currency, occurred_at
        ) VALUES (${invalidTransactionId}, 'CAPTURE', 'JPY', clock_timestamp())
      `;
      await transaction`
        INSERT INTO bloombox.ledger_entries (
          id, financial_transaction_id, account_code, signed_amount_minor, currency
        ) VALUES
          (${randomUUID()}, ${invalidTransactionId}, 'CASH', 6600, 'JPY'),
          (${randomUUID()}, ${invalidTransactionId}, 'CUSTOMER_RECEIVABLE', -6500, 'JPY')
      `;
    })).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps runtime roles least-privileged and append-only", async () => {
    const rows = await sql`
      SELECT
        has_table_privilege('bloombox_worker', 'bloombox.ledger_entries', 'INSERT') AS worker_can_insert_ledger,
        has_table_privilege('bloombox_worker', 'bloombox.ledger_entries', 'UPDATE') AS worker_can_update_ledger,
        has_table_privilege('bloombox_application', 'bloombox.outbox_events', 'INSERT') AS app_can_insert_outbox,
        has_table_privilege('bloombox_application', 'bloombox.outbox_events', 'DELETE') AS app_can_delete_outbox
    `;

    expect(rows[0]).toEqual({
      worker_can_insert_ledger: true,
      worker_can_update_ledger: false,
      app_can_insert_outbox: true,
      app_can_delete_outbox: false,
    });
  });
});

function runMigrations(): void {
  execFileSync("node", ["scripts/migrate-database.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL_MODE: "disable",
    },
    stdio: "pipe",
  });
}

function assertSafeTestDatabaseUrl(value: string | undefined): string {
  if (!value) return "postgres://invalid/test_missing";
  const url = new URL(value);
  const databaseName = url.pathname.slice(1);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !databaseName.includes("test")) {
    throw new Error("TEST_DATABASE_URL must target a local database whose name contains test");
  }
  return value;
}
