import { readFile } from "node:fs/promises";

const compositionRoot = await readFile("src/shared/infrastructure/composition-root.ts", "utf8");
const blockers = [];

if (compositionRoot.includes("InMemoryPurchaseIntentRepository")) {
  blockers.push(
    "Checkout preparation is using an in-memory preview adapter. Replace it with the approved durable checkout and provider handoff before production.",
  );
}

if (compositionRoot.includes("InMemoryProductRepository")) {
  blockers.push(
    "Catalog is using prototype content. Replace it with the approved Shopify catalog adapter before production.",
  );
}

if (blockers.length) {
  console.error(
    "Production commerce activation is blocked:\n"
      + blockers.map((item) => `- ${item}`).join("\n")
      + "\nSee docs/operations/RELEASE.md for the exit criteria.",
  );
  process.exitCode = 1;
} else {
  console.log("Production adapters are ready.");
}
