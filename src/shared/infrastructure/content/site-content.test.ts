import { describe, expect, it } from "vitest";
import { siteContent } from "./site-content";

describe("site content", () => {
  it("contains deployment-safe public content", () => {
    expect(siteContent.titleTemplate).toContain("%s");
    expect(siteContent.contactEmail).toMatch(/@/);
    expect(siteContent.hero.imageUrl).toMatch(/^https:\/\//);
  });
});
