import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_ACTIVATION_EVIDENCE, isCommerceActivationApproved } from "../src/shared/domain/commerce-activation.ts";

const script = resolve("scripts/check-production-readiness.mjs");
const composition = readFileSync("src/shared/infrastructure/composition-root.ts", "utf8");
const storefront = JSON.parse(readFileSync("content/storefront.json", "utf8"));

function approved() {
  return {
    schemaVersion: 1, status: "approved", checkoutProvider: "STRIPE",
    evidence: Object.fromEntries(REQUIRED_ACTIVATION_EVIDENCE.map((name) => [name, { complete: true, reference: `docs/evidence/${name}.md` }])),
  };
}

/** Runs the release gate in an isolated directory, as the Production Release workflow does. */
function gate(activation, publicationStatus = "approved") {
  const root = mkdtempSync(join(tmpdir(), "bloombox-readiness-"));
  for (const directory of ["config", "content", "src/shared/infrastructure"]) mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, "config/production-commerce-activation.json"), JSON.stringify(activation));
  writeFileSync(join(root, "content/storefront.json"), JSON.stringify({ ...storefront, publicationStatus }));
  writeFileSync(join(root, "src/shared/infrastructure/composition-root.ts"), composition);
  try {
    execFileSync(process.execPath, [script], { cwd: root, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

describe("release gate and runtime intake agree on activation evidence", () => {
  const cases = [
    ["complete", approved()],
    ["blocked", { ...approved(), status: "blocked" }],
    ["incomplete", { ...approved(), evidence: { ...approved().evidence, stripeTestModeE2e: { complete: false, reference: "docs/evidence/x.md" } } }],
    ["unreferenced", { ...approved(), evidence: { ...approved().evidence, taxShippingReview: { complete: true, reference: "todo" } } }],
    ["wrong provider", { ...approved(), checkoutProvider: "SHOPIFY" }],
  ];
  it.each(cases)("%s", (_name, activation) => {
    expect(gate(activation)).toBe(isCommerceActivationApproved(activation));
  });

  it("also requires approved customer-facing terms", () => {
    expect(gate(approved(), "draft")).toBe(false);
  });
});
