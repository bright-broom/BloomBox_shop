import { describe, expect, it } from "vitest";
import {
  InvalidDatabaseConfigurationError,
  loadDatabaseConfig,
  loadOperatorDatabaseConfig,
  loadPermissionManagerDatabaseConfig,
} from "./database-config";
import {
  InvalidDataProtectionConfigurationError,
  loadDataProtectionConfig,
} from "./data-protection-config";
import { InvalidRuntimeConfigurationError, loadRuntimeMode } from "./runtime-config";

describe("runtime configuration", () => {
  it("uses preview unless production is explicitly selected", () => {
    expect(loadRuntimeMode({})).toBe("preview");
    expect(loadRuntimeMode({ BLOOMBOX_RUNTIME_MODE: "production" })).toBe("production");
  });

  it("fails closed for an unknown runtime mode", () => {
    expect(() => loadRuntimeMode({ BLOOMBOX_RUNTIME_MODE: "staging" }))
      .toThrow(InvalidRuntimeConfigurationError);
  });
});

describe("database configuration", () => {
  it("requires a separate permission-manager connection without reusing other database credentials", () => {
    const other = { DATABASE_URL: "postgres://localhost/app", DATABASE_OPERATOR_URL: "postgres://localhost/operator", DATABASE_WORKER_URL: "postgres://localhost/worker" };
    expect(() => loadPermissionManagerDatabaseConfig(other)).toThrow(InvalidDatabaseConfigurationError);
    expect(loadPermissionManagerDatabaseConfig({ ...other, DATABASE_PERMISSION_MANAGER_URL: "postgres://localhost/manager" }).url).toBe("postgres://localhost/manager");
  });
  it("requires a dedicated operator connection without falling back to application credentials", () => {
    expect(() => loadOperatorDatabaseConfig({ DATABASE_URL: "postgres://localhost/app" })).toThrow(InvalidDatabaseConfigurationError);
    expect(loadOperatorDatabaseConfig({ DATABASE_URL: "postgres://localhost/app", DATABASE_OPERATOR_URL: "postgres://localhost/operator" }).url)
      .toBe("postgres://localhost/operator");
  });
  it("requires a PostgreSQL URL and bounded pool size", () => {
    expect(loadDatabaseConfig({
      DATABASE_URL: "postgres://localhost:5432/bloombox",
      DATABASE_SSL_MODE: "disable",
      DATABASE_MAX_CONNECTIONS: "3",
    })).toEqual({
      url: "postgres://localhost:5432/bloombox",
      ssl: false,
      maxConnections: 3,
    });
  });

  it("does not expose invalid database input in its error", () => {
    expect(() => loadDatabaseConfig({ DATABASE_URL: "secret-invalid-value" }))
      .toThrow(InvalidDatabaseConfigurationError);
  });
});

describe("data protection configuration", () => {
  it("loads an active AES-256 key and retained rotation keys", () => {
    const current = Buffer.alloc(32, 1).toString("base64");
    const previous = Buffer.alloc(32, 2).toString("base64");
    const config = loadDataProtectionConfig({
      BLOOMBOX_PII_KEYRING: JSON.stringify({
        activeKeyId: "current",
        keys: { current, previous },
      }),
    });

    expect(config.activeKeyId).toBe("current");
    expect(config.keys.get("previous")).toEqual(Buffer.alloc(32, 2));
  });

  it("rejects missing active and incorrectly sized keys", () => {
    expect(() => loadDataProtectionConfig({
      BLOOMBOX_PII_KEYRING: JSON.stringify({
        activeKeyId: "missing",
        keys: { current: Buffer.alloc(8).toString("base64") },
      }),
    })).toThrow(InvalidDataProtectionConfigurationError);
  });
});
