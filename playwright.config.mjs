import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3187", headless: true },
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3187",
    url: "http://127.0.0.1:3187/cart",
    reuseExistingServer: false,
    timeout: 60_000,
    // Isolated in-memory dummy checkout only; no provider credentials or production DB.
    env: { BLOOMBOX_RUNTIME_MODE: "preview", BLOOMBOX_CHECKOUT_PROVIDER: "preview", BLOOMBOX_CHECKOUT_INTAKE_ENABLED: "true" },
  },
});
