import { describe, expect, it } from "vitest";
import { findStorefrontPage, storefrontContent, storefrontContentSchema } from "./storefront-content";

describe("storefront content", () => {
  it("keeps every required information page validated and addressable", () => {
    expect(storefrontContent.pages).toHaveLength(8);
    expect(findStorefrontPage("commercial-transactions")?.kind).toBe("disclosure");
    expect(findStorefrontPage("missing")).toBeUndefined();
  });

  it("does not mark draft legal content as approved", () => {
    expect(storefrontContent.publicationStatus).toBe("draft");
  });

  it("requires a non-draft membership agreement version before the terms can be approved", () => {
    expect(storefrontContent.agreementVersion).toMatch(/-draft$/);
    const approved = { ...storefrontContent, publicationStatus: "approved" };
    expect(storefrontContentSchema.safeParse(approved).success).toBe(false);
    expect(storefrontContentSchema.safeParse({ ...approved, agreementVersion: "2026-10-01" }).success).toBe(true);
    expect(storefrontContentSchema.safeParse({ ...storefrontContent, agreementVersion: "Terms v1" }).success).toBe(false);
  });
});
