import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const SOURCE_ROOT = join(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
const FORBIDDEN_DOMAIN_PACKAGES = [
  "next",
  "react",
  "stripe",
  "@supabase/",
  "resend",
  "@vercel/",
  "openai",
  "node:fs",
  "node:http",
  "node:https",
  "axios",
];

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

function importsFrom(source) {
  return [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
}

function normalized(path) {
  return relative(process.cwd(), path).split(sep).join("/");
}

function isForbiddenDomainImport(specifier) {
  return FORBIDDEN_DOMAIN_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`))
    || specifier.includes("/application/")
    || specifier.includes("/infrastructure/")
    || specifier.includes("/presentation/")
    || specifier.startsWith("@/app/")
    || specifier.startsWith("@/ui/");
}

function isForbiddenApplicationImport(specifier) {
  return specifier.includes("/infrastructure/")
    || specifier.includes("/presentation/")
    || specifier.startsWith("@/app/")
    || specifier.startsWith("@/ui/");
}

const violations = [];
for (const file of await collectSourceFiles(SOURCE_ROOT)) {
  if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
  const path = normalized(file);
  const imports = importsFrom(await readFile(file, "utf8"));

  if (path.includes("/domain/")) {
    for (const specifier of imports.filter(isForbiddenDomainImport)) {
      violations.push(`${path}: domain may not import ${specifier}`);
    }
  }

  if (path.includes("/application/")) {
    for (const specifier of imports.filter(isForbiddenApplicationImport)) {
      violations.push(`${path}: application may not import ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture boundary violations:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries are valid.");
}
