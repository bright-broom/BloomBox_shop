import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GiftNextPage from "@/app/gift-next/page";
import { giftExperienceContent } from "@/shared/infrastructure/content/gift-experience-content";

afterEach(() => { vi.unstubAllEnvs(); });

describe("recipient card destination", () => {
  it.each(["preview", "production"] as const)("offers only working paths in %s, never a disabled control", (mode) => {
    vi.stubEnv("BLOOMBOX_RUNTIME_MODE", mode);
    const html = renderToStaticMarkup(<GiftNextPage />);
    const copy = giftExperienceContent.recipient;
    for (const expected of [copy.title, copy.lead, copy.action, copy.support, 'href="/flowers"', 'href="/contact"', copy.privacy]) expect(html).toContain(expected);
    // A printed card is permanent: this page must never ship a control the recipient cannot use.
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("<button");
  });
});
