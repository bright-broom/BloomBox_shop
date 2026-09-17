import postgres, { type Sql, type TransactionSql } from "postgres";
import type { DatabaseConfig } from "../config/database-config";

export type DatabaseClient = Sql<Record<string, never>>;
export type DatabaseTransaction = TransactionSql<Record<string, never>>;

export function createPostgresClient(config: DatabaseConfig): DatabaseClient {
  return postgres(config.url, {
    max: config.maxConnections,
    prepare: true,
    ssl: config.ssl,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    // Poolers differ in supported startup parameters. Preserve existing connections until verified.
    ...(config.connectionTimeouts ? { connection: {
      statement_timeout: config.connectionTimeouts.statementMs,
      lock_timeout: config.connectionTimeouts.lockMs,
      idle_in_transaction_session_timeout: config.connectionTimeouts.statementMs,
    } } : {}),
  });
}
