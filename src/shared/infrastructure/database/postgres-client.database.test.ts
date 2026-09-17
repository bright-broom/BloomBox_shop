import { afterAll, describe, expect, it } from "vitest";
import { createPostgresClient } from "./postgres-client";
import { loadDatabaseConfig } from "../config/database-config";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Only an isolated local test database is allowed");
  }
}
const config = loadDatabaseConfig({
  DATABASE_URL: databaseUrl ?? "postgres://invalid/test_missing", DATABASE_SSL_MODE: "disable",
  DATABASE_MAX_CONNECTIONS: "1", DATABASE_CONNECTION_TIMEOUTS_ENABLED: "true",
  DATABASE_STATEMENT_TIMEOUT_MS: "500", DATABASE_LOCK_TIMEOUT_MS: "100",
});
const sql = createPostgresClient(config);
const blocker = createPostgresClient({ ...config, connectionTimeouts: null });
afterAll(async () => { await Promise.all([sql.end({ timeout: 1 }), blocker.end({ timeout: 1 })]); });

(databaseUrl ? describe : describe.skip)("database execution bounds", () => {
  it("applies bounded settings to actual server sessions", async () => {
    const [row] = await sql`SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock`;
    expect(row).toEqual({ statement: "500ms", lock: "100ms" });
  });

  it("cancels expensive work, rolls back the whole transaction and reuses the pool", async () => {
    await sql`CREATE TEMP TABLE load_timeout_rollback (value integer)`;
    await expect(sql.begin(async (tx) => {
      await tx`INSERT INTO load_timeout_rollback VALUES (1)`;
      await tx`SELECT pg_sleep(2)`;
    })).rejects.toMatchObject({ code: "57014" });
    expect(await sql`SELECT * FROM load_timeout_rollback`).toHaveLength(0);
    expect(await sql`SELECT 1 AS healthy`).toEqual([{ healthy: 1 }]);
  });

  it("fails bounded lock contention without abandoning a blocked waiter", async () => {
    await blocker`SELECT pg_advisory_lock(13920260917)`;
    try {
      await expect(sql.begin(async (tx) => { await tx`SELECT pg_advisory_xact_lock(13920260917)`; }))
        .rejects.toMatchObject({ code: "55P03" });
    } finally { await blocker`SELECT pg_advisory_unlock(13920260917)`; }
    await sql.begin(async (tx) => { await tx`SELECT pg_advisory_xact_lock(13920260917)`; });
  });
});
