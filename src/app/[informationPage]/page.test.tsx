import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { findStorefrontPage } from "@/shared/infrastructure/content/storefront-content";
import InformationPage from "./page";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

async function render(slug: string) {
  return renderToStaticMarkup(await InformationPage({ params: Promise.resolve({ informationPage: slug }) }));
}

describe("information page template", () => {
  it("opens a long page with a table of contents whose links reach every section", async () => {
    const page = findStorefrontPage("privacy")!;
    const html = await render("privacy");
    expect(html).toContain('aria-label="このページの内容"');
    page.sections.forEach((section, index) => {
      const anchor = section.id ?? `section-${index + 1}`;
      expect(html).toContain(`href="#${anchor}"`);
      expect(html).toContain(`id="${anchor}"`);
    });
  });
  it("keeps editorial section IDs that other pages link to", async () => {
    const contact = findStorefrontPage("contact")!;
    const html = await render("contact");
    for (const section of contact.sections.filter((item) => item.id)) expect(html).toContain(`id="${section.id}"`);
  });
  it("numbers sections only when there is more than one, and gives FAQ no table of contents", async () => {
    expect(await render("commercial-transactions")).not.toContain("content-section-index");
    expect(await render("about")).toContain('<span class="content-section-index" aria-hidden="true">01</span>');
    expect(await render("faq")).not.toContain("content-toc");
  });
});
