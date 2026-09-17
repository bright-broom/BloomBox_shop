import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  // Preserve Next's rules while its React plugins still use pre-ESLint-10 APIs (#142).
  ...fixupConfigRules([...nextVitals, ...nextTypescript]),
  globalIgnores([".next/**", "coverage/**", "next-env.d.ts"]),
]);
