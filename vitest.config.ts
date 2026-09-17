import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "browser-tests/**"],
    environment: "node",
    // Auth.js uses Next's bundler-resolved extensionless imports; exercise it through Vite as Next does.
    server: { deps: { inline: ["next-auth"] } },
  },
});
