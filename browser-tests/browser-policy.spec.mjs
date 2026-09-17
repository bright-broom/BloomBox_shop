import { test, expect } from "@playwright/test";
import { verifyBrowserPolicy } from "../scripts/verify-browser-policy.mjs";
import { PUBLIC_PREVIEW_ROUTES, verifyDocument } from "../scripts/verify-public-preview.mjs";

test("every monitored public document satisfies the enforced policy", async ({ request }) => {
  for (const path of PUBLIC_PREVIEW_ROUTES.filter((path) => !/\.(txt|xml|webmanifest)$/.test(path))) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    verifyDocument(path, html);
    verifyBrowserPolicy(html, new Headers(response.headers()), path);
  }
});

test("purchase and login documents hydrate with unique nonce policies", async ({ page, request }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (/violates.*Content Security Policy|Refused to (execute|load|connect)/i.test(message.text())) errors.push(message.text()); });
  const nonces = new Set();
  for (const path of ["/", "/flowers", "/gift/prod_bloombox_m", "/cart", "/checkout/test/payment", "/account/login", "/operations/login"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const { nonce } = verifyBrowserPolicy(await response.text(), new Headers(response.headers()), path);
    expect(nonces.has(nonce)).toBe(false); nonces.add(nonce);
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
  }
  // Escape handling requires hydration; native <details> alone cannot satisfy this.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("メニュー", { exact: true }).click();
  await expect(page.locator("details.mobile-menu")).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(page.locator("details.mobile-menu")).not.toHaveAttribute("open");
  expect(errors).toEqual([]);
});

test("browser blocks injected inline code, external script and foreign fetch", async ({ page }) => {
  let externalScriptRequested = false;
  await page.route("https://unapproved.invalid/**", async (route) => { externalScriptRequested = true; await route.abort(); });
  await page.route("**/cart", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("</head>", '<script>window.__injected=true</script><script src="https://unapproved.invalid/injected.js"></script></head>');
    await route.fulfill({ response, body });
  });
  await page.goto("/cart");
  await expect(page.locator("h1")).toBeVisible();
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  expect(await page.evaluate(async () => {
    try { await fetch("https://unapproved.invalid/collect"); return "allowed"; } catch { return "blocked"; }
  })).toBe("blocked");
  expect(externalScriptRequested).toBe(false);
});

test("gift entry, server action and client navigation remain usable", async ({ page }) => {
  await page.goto("/gift/prod_bloombox_m");
  await page.locator("#recipientName").fill("検証用受取人");
  await page.locator("#giftMessage").fill("セキュリティ検証用の架空データ");
  await page.getByRole("button", { name: "カートに入れる" }).click();
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByText("検証用受取人", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "購入手続きへ" }).click();
  await expect(page).toHaveURL(/\/checkout\/test$/);
  for (const [name, value] of Object.entries({ buyerName: "検証用注文者", email: "security-test@example.invalid", phone: "09000000000", postalCode: "1000001", city: "千代田区", addressLine1: "検証用1-1" })) {
    await page.locator(`#${name}`).fill(value);
  }
  await page.locator("#prefecture").selectOption("東京都");
  await page.getByRole("button", { name: "注文内容を確認する" }).click();
  await expect(page).toHaveURL(/\/checkout\/test\/review$/);
  await page.locator('input[type="checkbox"][required]').check();
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/checkout\/test\/payment$/);
  await page.getByRole("button", { name: "成功シナリオで完了" }).click();
  await expect(page).toHaveURL(/\/checkout\/test\/complete$/);
});
