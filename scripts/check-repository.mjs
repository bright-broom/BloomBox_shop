import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const violations = [];
const requiredFiles = [
  "AGENTS.md",
  "SECURITY.md",
  "docs/architecture/ARCHITECTURE.md",
  "docs/architecture/adr/0000-template.md",
  "docs/architecture/adr/0001-shopify-first-commerce-boundary.md",
  "docs/design/DESIGN_SYSTEM.md",
  "docs/engineering/DEVELOPMENT.md",
  "docs/operations/GOVERNANCE.md",
  "docs/operations/RELEASE.md",
  ".semgrep.yml",
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/production-release.yml",
  ".github/workflows/pr-governance.yml",
];

const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n");
const forbiddenTrackedPatterns = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.next\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.env(?:\.|$)/,
  /\.tsbuildinfo$/,
];
for (const file of trackedFiles) {
  if (forbiddenTrackedPatterns.some((pattern) => pattern.test(file))) {
    violations.push(`generated or sensitive file is tracked: ${file}`);
  }
}

for (const file of requiredFiles) {
  if (!trackedFiles.includes(file) && !await fileExists(file)) violations.push(`required governance file is missing: ${file}`);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (!/^pnpm@\d+\.\d+\.\d+$/.test(packageJson.packageManager ?? "")) {
  violations.push("package.json: packageManager must pin an exact pnpm version");
}
for (const script of [
  "check:architecture",
  "check:content",
  "check:design",
  "check:hardcoding",
  "check:repository",
  "check:ci",
  "check:production",
  "check:release",
]) {
  if (!packageJson.scripts?.[script]) violations.push(`package.json: missing ${script} script`);
}

const workflowDirectory = ".github/workflows";
for (const name of await readdir(workflowDirectory)) {
  if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
  const path = join(workflowDirectory, name);
  const source = await readFile(path, "utf8");

  if (!/^permissions:/m.test(source)) violations.push(`${path}: explicit top-level permissions are required`);
  if (/pull_request_target\s*:/.test(source)) violations.push(`${path}: pull_request_target is prohibited`);
  if (/--config\s+auto\b/.test(source)) {
    violations.push(`${path}: remote auto-configured security rules are not deterministic`);
  }
  for (const match of source.matchAll(/^\s*image:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    if (!/@sha256:[0-9a-f]{64}$/.test(match[1])) {
      violations.push(`${path}: container image must be pinned by digest: ${match[1]}`);
    }
  }

  for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    if (!/@[0-9a-f]{40}$/.test(reference)) {
      violations.push(`${path}: action must be pinned to a full commit SHA: ${reference}`);
    }
  }

  const jobs = source.split(/^\s{2}(?=[a-zA-Z0-9_-]+:\s*$)/m).slice(1);
  for (const job of jobs) {
    const jobName = job.match(/^([a-zA-Z0-9_-]+):/)?.[1] ?? basename(path);
    if (/\bruns-on:/.test(job) && !/\btimeout-minutes:/.test(job)) {
      violations.push(`${path}: job ${jobName} requires timeout-minutes`);
    }
  }
}

const productionWorkflow = await readFile(".github/workflows/production-release.yml", "utf8");
if (!productionWorkflow.includes("if: github.ref == 'refs/heads/main'")) {
  violations.push("production release workflow must reject dispatches from non-main branches");
}
if (!productionWorkflow.includes("release_sha:") || !productionWorkflow.includes("inputs.confirm == true")) {
  violations.push("production release workflow requires explicit revision and operator confirmation");
}

const codeowners = await readFile(".github/CODEOWNERS", "utf8");
if (!codeowners.includes("@bright-broom") || codeowners.includes("@KoenigWolf")) {
  violations.push("CODEOWNERS must use the verified repository administrator account @bright-broom");
}

if (violations.length) {
  console.error("Repository policy violations:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Repository governance is valid.");
}

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
