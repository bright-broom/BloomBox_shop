import { readFile } from "node:fs/promises";

const compositionRoot = await readFile("src/shared/infrastructure/composition-root.ts", "utf8");
const activation = JSON.parse(
  await readFile("config/production-commerce-activation.json", "utf8"),
);
const blockers = [];
const requiredEvidence = [
  "activationDecisionAdr",
  "shopifyCatalogContract",
  "stripeTestModeE2e",
  "inventoryReservationStrategy",
  "taxShippingReview",
  "privacySupportReview",
  "backupRollbackIncidentRehearsal",
];

if (!compositionRoot.includes("new PostgresPurchaseIntentRepository")) {
  blockers.push(
    "The production composition does not contain the durable PostgreSQL PurchaseIntent adapter.",
  );
}

if (!compositionRoot.includes("new ShopifyProductRepository")) {
  blockers.push(
    "The production composition does not contain the Shopify Storefront catalog adapter.",
  );
}

if (
  activation.schemaVersion !== 1
  || activation.status !== "approved"
  || activation.checkoutProvider !== "STRIPE"
  || Object.keys(activation.evidence ?? {}).length !== requiredEvidence.length
) {
  blockers.push(
    "Production commerce activation is not approved in config/production-commerce-activation.json.",
  );
} else {
  for (const name of requiredEvidence) {
    const evidence = activation.evidence[name];
    if (
      typeof evidence !== "object"
      || evidence === null
      || evidence.complete !== true
      || typeof evidence.reference !== "string"
      || evidence.reference.trim().length < 8
    ) {
      blockers.push(`Production activation evidence is incomplete: ${name}.`);
    }
  }
}

if (blockers.length) {
  console.error(
    "Production commerce activation is blocked:\n"
      + blockers.map((item) => `- ${item}`).join("\n")
      + "\nSee docs/operations/RELEASE.md for the exit criteria.",
  );
  process.exitCode = 1;
} else {
  console.log("Production adapters and activation evidence are ready.");
}
