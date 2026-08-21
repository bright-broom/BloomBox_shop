import { describe, expect, it } from "vitest";
import { findStorefrontPage, storefrontContent } from "./storefront-content";

describe("storefront content", () => {
  it("keeps every required information page validated and addressable", () => {
    expect(storefrontContent.pages).toHaveLength(8);
    expect(findStorefrontPage("commercial-transactions")?.kind).toBe("disclosure");
    expect(findStorefrontPage("missing")).toBeUndefined();
  });

  it("does not mark draft legal content as approved", () => {
    expect(storefrontContent.publicationStatus).toBe("draft");
  });
});
