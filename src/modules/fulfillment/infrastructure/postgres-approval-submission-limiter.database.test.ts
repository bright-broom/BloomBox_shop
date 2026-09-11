import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FulfillmentApprovalError } from "../application/approve-shopify-fulfillment";
import { PostgresApprovalSubmissionLimiter } from "./postgres-approval-submission-limiter";

const databaseUrl = process.env.TEST_DATABASE_URL;
function safeUrl() {
  if (!databaseUrl) return "postgres://invalid/test_missing";
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) throw new Error("Local test database required");
  return databaseUrl;
}
const describeDatabase = databaseUrl ? describe : describe.skip;
describeDatabase("shared operator submission allowance", () => {
  const sql = postgres(safeUrl(), { max: 3, ssl: false });
  const operator = postgres(safeUrl(), { max: 4, ssl: false, connection: { role: "bloombox_fulfillment_approver" } });
  const otherProcess = postgres(safeUrl(), { max: 4, ssl: false, connection: { role: "bloombox_fulfillment_approver" } });
  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA IF EXISTS bloombox CASCADE");
    for (let i = 0; i < 2; i++) execFileSync("node", ["scripts/migrate-database.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }, stdio: "pipe",
    });
    await sql.unsafe((await readFile("database/roles.sql", "utf8")).replace(/^\\set ON_ERROR_STOP on$/m, ""));
  });
  afterAll(async () => { await Promise.all([sql.end(), operator.end(), otherProcess.end()]); });
  function actor(operatorId = randomUUID(), expiresAt = new Date(Date.now() + 600_000)) {
    return { current: async () => ({ operatorId, expiresAt }) };
  }
  it("admits exactly ten concurrent submissions across independent connections and sessions", async () => {
    const identity = actor(); const { operatorId } = await identity.current();
    const first = new PostgresApprovalSubmissionLimiter(operator, identity);
    const second = new PostgresApprovalSubmissionLimiter(otherProcess, actor(operatorId));
    const results = await Promise.allSettled(Array.from({ length: 24 }, (_, i) => (i % 2 ? first : second).consume()));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toEqual(new FulfillmentApprovalError("RATE_LIMITED"));
    const [row] = await sql`SELECT attempts FROM bloombox.fulfillment_approval_submission_limits WHERE operator_id = ${operatorId}`;
    expect(row.attempts).toHaveLength(10);
    await expect(new PostgresApprovalSubmissionLimiter(otherProcess, actor()).consume()).resolves.toBeUndefined();
    expect(await sql`SELECT id FROM bloombox.fulfillment_operator_approvals`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.audit_logs`).toHaveLength(0);
    expect(await sql`SELECT id FROM bloombox.outbox_events`).toHaveLength(0);
  });
  it("recovers aged allowance using database time and keeps one bounded row", async () => {
    const identity = actor(); const { operatorId } = await identity.current();
    await sql`INSERT INTO bloombox.fulfillment_approval_submission_limits (operator_id, attempts)
      VALUES (${operatorId}, ${sql.json(Array<number>(10).fill(Date.now() - 61_000))})`;
    await new PostgresApprovalSubmissionLimiter(operator, identity).consume();
    const [row] = await sql`SELECT attempts, updated_at FROM bloombox.fulfillment_approval_submission_limits WHERE operator_id = ${operatorId}`;
    expect(row.attempts).toEqual([row.updated_at.getTime()]);
  });
  it("rejects missing or expired identity without leaving new state", async () => {
    await expect(new PostgresApprovalSubmissionLimiter(operator, { current: async () => null }).consume()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    const identity = actor(randomUUID(), new Date(0)); const { operatorId } = await identity.current();
    await expect(new PostgresApprovalSubmissionLimiter(operator, identity).consume()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(await sql`SELECT operator_id FROM bloombox.fulfillment_approval_submission_limits WHERE operator_id = ${operatorId}`).toHaveLength(0);
  });
  it("fails closed on corrupt stored timestamps", async () => {
    const identity = actor(); const { operatorId } = await identity.current();
    await sql`INSERT INTO bloombox.fulfillment_approval_submission_limits (operator_id, attempts) VALUES (${operatorId}, '["invalid"]'::jsonb)`;
    await expect(new PostgresApprovalSubmissionLimiter(operator, identity).consume()).rejects.toEqual(new FulfillmentApprovalError("UNAVAILABLE"));
  });
  it("limits writes to the dedicated role and denies identity changes and deletion", async () => {
    const identity = actor(); const { operatorId } = await identity.current();
    await new PostgresApprovalSubmissionLimiter(operator, identity).consume();
    await expect(operator`UPDATE bloombox.fulfillment_approval_submission_limits SET operator_id = ${randomUUID()} WHERE operator_id = ${operatorId}`).rejects.toMatchObject({ code: "42501" });
    await expect(operator`DELETE FROM bloombox.fulfillment_approval_submission_limits WHERE operator_id = ${operatorId}`).rejects.toMatchObject({ code: "42501" });
    for (const role of ["bloombox_application", "bloombox_worker", "bloombox_readonly"]) {
      const restricted = postgres(safeUrl(), { max: 1, ssl: false, connection: { role } });
      try {
        await expect(new PostgresApprovalSubmissionLimiter(restricted, identity).consume()).rejects.toEqual(new FulfillmentApprovalError("UNAVAILABLE"));
      } finally { await restricted.end(); }
    }
    await expect(sql`INSERT INTO bloombox.fulfillment_approval_submission_limits (operator_id, attempts)
      VALUES (${randomUUID()}, ${sql.json(Array<number>(11).fill(1))})`).rejects.toMatchObject({ code: "23514" });
  });
  it("bounds lock waits and does not silently allow through contention", async () => {
    const identity = actor(); const { operatorId } = await identity.current();
    await new PostgresApprovalSubmissionLimiter(operator, identity).consume();
    await sql.begin(async (tx) => {
      await tx`SELECT operator_id FROM bloombox.fulfillment_approval_submission_limits WHERE operator_id = ${operatorId} FOR UPDATE`;
      await expect(new PostgresApprovalSubmissionLimiter(otherProcess, identity).consume()).rejects.toEqual(new FulfillmentApprovalError("UNAVAILABLE"));
    });
    const [row] = await sql`SELECT attempts FROM bloombox.fulfillment_approval_submission_limits WHERE operator_id = ${operatorId}`;
    expect(row.attempts).toHaveLength(1);
    await expect(new PostgresApprovalSubmissionLimiter(operator, identity).consume()).resolves.toBeUndefined();
  });
  it("rechecks session expiry using database time after an actual row-lock wait", async () => {
    const operatorId = randomUUID();
    await new PostgresApprovalSubmissionLimiter(operator, actor(operatorId)).consume();
    const waiting = postgres(safeUrl(), { max: 1, ssl: false, connection: { role: "bloombox_fulfillment_approver" } });
    let result: Promise<unknown> = Promise.resolve();
    try {
      const [{ pid }] = await waiting`SELECT pg_backend_pid() AS pid`;
      await sql.begin(async (tx) => {
        await tx`SELECT operator_id FROM bloombox.fulfillment_approval_submission_limits WHERE operator_id = ${operatorId} FOR UPDATE`;
        const identity = actor(operatorId, new Date(Date.now() + 300));
        result = new PostgresApprovalSubmissionLimiter(waiting, identity).consume().then(() => "allowed", (error: unknown) => error);
        await vi.waitFor(async () => {
          const [state] = await tx`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
          expect(state.wait_event_type).toBe("Lock");
        }, { timeout: 500, interval: 10 });
        await tx`SELECT pg_sleep(0.35)`;
      });
      expect(await result).toEqual(new FulfillmentApprovalError("NOT_AUTHORIZED"));
      const [row] = await sql`SELECT attempts FROM bloombox.fulfillment_approval_submission_limits WHERE operator_id = ${operatorId}`;
      expect(row.attempts).toHaveLength(1);
    } finally { await waiting.end(); }
  });
});
