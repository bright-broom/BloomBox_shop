import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["src/app", "src/ui"];
const extensions = new Set([".ts", ".tsx"]);
const violations = [];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collect(path);
    return extensions.has(extname(path)) ? [path] : [];
  }));
  return nested.flat();
}

for (const file of (await Promise.all(roots.map(collect))).flat()) {
  const source = await readFile(file, "utf8");
  const checks = [
    { pattern: /https?:\/\//g, reason: "absolute URLs belong in validated content or configuration" },
    { pattern: /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, reason: "contact addresses belong in validated content" },
    { pattern: /maxLength=\{\d+\}/g, reason: "business limits must come from an owning domain policy" },
    { pattern: /©\s*\d{4}/g, reason: "copyright years must not become stale" },
  ];

  for (const check of checks) {
    for (const match of source.matchAll(check.pattern)) {
      violations.push(`${file}: ${match[0]} — ${check.reason}`);
    }
  }
}

const catalogRepository = await readFile(
  "src/modules/catalog/infrastructure/in-memory-product-repository.ts",
  "utf8",
);
if (/const\s+PRODUCTS\b/.test(catalogRepository)) {
  violations.push("catalog repository: product content must not be embedded in repository implementation");
}

if (violations.length) {
  console.error("Hardcoding policy violations:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Hardcoding policy is valid.");
}
