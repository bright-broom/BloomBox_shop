import { describe, expect, it } from "vitest";
import { metadata } from "./not-found";

describe("not found page", () => {
  it("has its own title instead of the site default", () => {
    expect(metadata.title).toBe("ページが見つかりません");
  });
});
