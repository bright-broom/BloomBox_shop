import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AccountSettings,
  AddressEditor,
  AccountSupport,
  ProfileEditor,
} from "./account-portal";
import { emptyAccountPreferences } from "@/modules/customer/public";
vi.mock("./account-portal-form", () => ({
  PortalForm: ({ children }: { children: React.ReactNode }) => (
    <form>{children}</form>
  ),
  CopyAddress: () => null,
}));
const snapshot = { revision: 0, preferences: emptyAccountPreferences() };
describe("account self-service presentation", () => {
  it("shows no opt-in default and requires explicit closure confirmation", () => {
    const html = renderToStaticMarkup(<AccountSettings snapshot={snapshot} />);
    expect(html).not.toContain('checked=""');
    expect(html).toContain('name="confirm"');
    expect(html).toContain('required=""');
    expect(html).toContain("/account/export");
    expect(html).toContain("注文は取り消されません");
  });
  it("escapes stored customer input and never renders arbitrary markup", () => {
    const html = renderToStaticMarkup(
      <ProfileEditor
        snapshot={{
          revision: 1,
          preferences: {
            ...snapshot.preferences,
            name: "<script>alert(1)</script>",
          },
        }}
        email=""
        googleName=""
      />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("distinguishes an empty address book and labels required address fields", () => {
    const html = renderToStaticMarkup(<AddressEditor snapshot={snapshot} />);
    expect(html).toContain("保存したお届け先はありません");
    expect(html).toContain("shipping postal-code");
    expect(html).toContain('name="prefecture"');
    expect(html).toContain("北海道");
  });
  it("renders request replies as text and does not claim cancellation succeeded", () => {
    const html = renderToStaticMarkup(
      <AccountSupport
        requests={[
          {
            id: "sample",
            kind: "CANCELLATION",
            orderId: null,
            status: "REPLIED",
            createdAt: "2026-09-17T00:00:00Z",
            message: "<script>bad</script>",
            reply: "<img src=x onerror=bad>",
            revision: 2,
          },
        ]}
        orders={[]}
      />,
    );
    expect(html).toContain("回答あり");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("送信だけでは注文やお支払いは変わりません");
  });
});
