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
  });
}
