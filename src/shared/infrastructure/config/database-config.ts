import { z } from "zod";

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL_MODE: z.enum(["disable", "require", "verify-full"]).default("verify-full"),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(20).default(5),
});

export type DatabaseConfig = Readonly<{
  url: string;
  ssl: false | "require" | "verify-full";
  maxConnections: number;
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
  if (!parsed.success || !isPostgresUrl(parsed.data.DATABASE_URL)) {
    throw new InvalidDatabaseConfigurationError();
  }

  return {
    url: parsed.data.DATABASE_URL,
    ssl: parsed.data.DATABASE_SSL_MODE === "disable" ? false : parsed.data.DATABASE_SSL_MODE,
    maxConnections: parsed.data.DATABASE_MAX_CONNECTIONS,
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
