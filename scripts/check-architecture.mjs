import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const PROJECT_ROOT = process.cwd();
const SOURCE_ROOT = join(PROJECT_ROOT, "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

function importsFrom(source, path) {
  const imports = [];
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) imports.push(node.arguments[0].text);
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        imports.push(node.arguments[0].text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function normalized(path) {
  return relative(PROJECT_ROOT, path).split(sep).join("/");
}

function resolveImport(file, specifier) {
  if (specifier.startsWith("@/")) return join(SOURCE_ROOT, specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
  return null;
}

function describePath(path) {
  const normalizedPath = normalized(path).replace(/\.(?:ts|tsx)$/, "");
  const moduleMatch = normalizedPath.match(
    /^src\/modules\/([^/]+)(?:\/(domain|application|infrastructure|presentation))?(?:\/|$)/,
  );

  if (moduleMatch) {
    return {
      kind: "module",
      module: moduleMatch[1],
      layer: moduleMatch[2] ?? "public",
      publicEntry: normalizedPath === `src/modules/${moduleMatch[1]}/public`,
    };
  }

  const sharedMatch = normalizedPath.match(/^src\/shared\/(domain|application|infrastructure)(?:\/|$)/);
  if (sharedMatch) return { kind: "shared", module: "shared", layer: sharedMatch[1] };
  if (normalizedPath.startsWith("src/app/") || normalizedPath.startsWith("src/ui/")) {
    return { kind: "presentation", module: null, layer: "presentation" };
  }
  return { kind: "other", module: null, layer: null };
}

function isTest(path) {
  return /\.(?:test|spec)\.(?:ts|tsx)$/.test(path);
}

const violations = [];
for (const file of await collectSourceFiles(SOURCE_ROOT)) {
  const sourcePath = normalized(file);
  if (isTest(sourcePath)) continue;

  const sourceBoundary = describePath(file);
  for (const specifier of importsFrom(await readFile(file, "utf8"), file)) {
    const target = resolveImport(file, specifier);
    const targetBoundary = target ? describePath(target) : null;

    if (sourceBoundary.layer === "domain") {
      if (!target) {
        violations.push(`${sourcePath}: domain may not import external package ${specifier}`);
      } else if (
        targetBoundary.layer !== "domain"
        || (targetBoundary.kind === "module" && targetBoundary.module !== sourceBoundary.module)
      ) {
        violations.push(`${sourcePath}: domain may not import ${specifier}`);
      }
    }

    if (
      sourceBoundary.layer === "application"
      && targetBoundary
      && ["infrastructure", "presentation"].includes(targetBoundary.layer)
    ) {
      violations.push(`${sourcePath}: application may not import ${specifier}`);
    }

    if (sourceBoundary.layer === "infrastructure" && targetBoundary?.layer === "presentation") {
      violations.push(`${sourcePath}: infrastructure may not import ${specifier}`);
    }

    if (
      sourceBoundary.kind === "module"
      && targetBoundary?.kind === "module"
      && sourceBoundary.module !== targetBoundary.module
      && (
        !targetBoundary.publicEntry
        || specifier !== `@/modules/${targetBoundary.module}/public`
      )
    ) {
      violations.push(`${sourcePath}: cross-module imports must use @/modules/${targetBoundary.module}/public`);
    }

    if (
      sourceBoundary.kind === "presentation"
      && targetBoundary?.kind === "module"
      && !targetBoundary.publicEntry
      && targetBoundary.layer !== "presentation"
    ) {
      violations.push(`${sourcePath}: presentation must use @/modules/${targetBoundary.module}/public`);
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture boundary violations:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries are valid.");
}
