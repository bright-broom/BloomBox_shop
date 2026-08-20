import { readFile } from "node:fs/promises";

const compositionRoot = await readFile("src/shared/infrastructure/composition-root.ts", "utf8");
const blockers = [];

if (compositionRoot.includes("InMemoryOrderRepository")) {
  blockers.push(
    "Order persistence is in memory. A production request can lose the order between the Server Action and confirmation page.",
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
