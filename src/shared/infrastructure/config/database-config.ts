import { z } from "zod";

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL_MODE: z.enum(["disable", "require", "verify-full"]).default("verify-full"),
  DATABASE_CONNECTION_TIMEOUTS_ENABLED: z.enum(["true", "false"]).default("false"),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  DATABASE_LOCK_TIMEOUT_MS: z.coerce.number().int().min(50).max(30_000).default(2_000),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(20).default(5),
});

export type DatabaseConfig = Readonly<{
  url: string;
  ssl: false | "require" | "verify-full";
  maxConnections: number;
  connectionTimeouts: Readonly<{ statementMs: number; lockMs: number }> | null;
}>;

export class InvalidDatabaseConfigurationError extends Error {
  constructor() {
    super("Database configuration is invalid");
    this.name = "InvalidDatabaseConfigurationError";
  }
}

export function loadDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DatabaseConfig {
  const parsed = databaseEnvironmentSchema.safeParse(environment);
  if (!parsed.success || !isPostgresUrl(parsed.data.DATABASE_URL)
    || parsed.data.DATABASE_LOCK_TIMEOUT_MS >= parsed.data.DATABASE_STATEMENT_TIMEOUT_MS) {
    throw new InvalidDatabaseConfigurationError();
  }

  return {
    url: parsed.data.DATABASE_URL,
    ssl: parsed.data.DATABASE_SSL_MODE === "disable" ? false : parsed.data.DATABASE_SSL_MODE,
    maxConnections: parsed.data.DATABASE_MAX_CONNECTIONS,
    connectionTimeouts: parsed.data.DATABASE_CONNECTION_TIMEOUTS_ENABLED === "true" ? {
      statementMs: parsed.data.DATABASE_STATEMENT_TIMEOUT_MS,
      lockMs: parsed.data.DATABASE_LOCK_TIMEOUT_MS,
    } : null,
  };
}

export function loadWorkerDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DatabaseConfig {
  return loadDatabaseConfig({
    ...environment,
    DATABASE_URL: environment.DATABASE_WORKER_URL,
  });
}

export function loadOperatorDatabaseConfig(environment: Readonly<Record<string, string | undefined>> = process.env): DatabaseConfig {
  return loadDatabaseConfig({ ...environment, DATABASE_URL: environment.DATABASE_OPERATOR_URL });
}

export function loadPermissionManagerDatabaseConfig(environment: Readonly<Record<string, string | undefined>> = process.env): DatabaseConfig {
  return loadDatabaseConfig({ ...environment, DATABASE_URL: environment.DATABASE_PERMISSION_MANAGER_URL });
}

function isPostgresUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "postgres:" || protocol === "postgresql:";
  } catch {
    return false;
  }
}

export function loadCatalogManagerDatabaseConfig(environment: Readonly<Record<string, string | undefined>> = process.env): DatabaseConfig {
  return loadDatabaseConfig({ ...environment, DATABASE_URL: environment.DATABASE_CATALOG_MANAGER_URL });
}

export function loadCustomerSupportDatabaseConfig(environment: Readonly<Record<string, string | undefined>> = process.env): DatabaseConfig {
  return loadDatabaseConfig({ ...environment, DATABASE_URL: environment.DATABASE_CUSTOMER_SUPPORT_URL });
}

export function loadNativeFulfillmentDatabaseConfig(environment: Readonly<Record<string, string | undefined>> = process.env): DatabaseConfig {
  return loadDatabaseConfig({ ...environment, DATABASE_URL: environment.DATABASE_NATIVE_FULFILLMENT_URL });
}
