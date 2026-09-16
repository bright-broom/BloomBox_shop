import {
  loadCatalogManagerDatabaseConfig,
  loadCustomerSupportDatabaseConfig,
  loadNativeFulfillmentDatabaseConfig,
} from "./database-config";
import { loadRuntimeMode } from "./runtime-config";
import { loadAdvertisingConfig } from "./advertising-config";
export type ConnectionState = "configured" | "notConfigured" | "invalidConfig";
export function operationsConsoleSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const connection = (
    key: string,
    validate: () => unknown,
  ): ConnectionState => {
    if (!env[key]) return "notConfigured";
    try {
      validate();
      return "configured";
    } catch {
      return "invalidConfig";
    }
  };
  let advertising: "adsEnabled" | "adsDisabled" | "invalidConfig";
  try {
    advertising = loadAdvertisingConfig(env).enabled
      ? "adsEnabled"
      : "adsDisabled";
  } catch {
    advertising = "invalidConfig";
  }
  return {
    mode: loadRuntimeMode(env),
    advertising,
    connections: {
      catalog: connection("DATABASE_CATALOG_MANAGER_URL", () =>
        loadCatalogManagerDatabaseConfig(env),
      ),
      support: connection("DATABASE_CUSTOMER_SUPPORT_URL", () =>
        loadCustomerSupportDatabaseConfig(env),
      ),
      fulfillment: connection("DATABASE_NATIVE_FULFILLMENT_URL", () =>
        loadNativeFulfillmentDatabaseConfig(env),
      ),
    },
  };
}
