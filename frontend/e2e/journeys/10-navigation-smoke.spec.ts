import { expect, test, type Page } from "@playwright/test";

import { navigateToPage, openSharedSession, STACK_KIND } from "../helpers";

async function expectFit(page: Page, label: string): Promise<void> {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(sizes.scrollWidth, `${label} must not overflow`).toBeLessThanOrEqual(sizes.viewportWidth);
}

/** VC-R79（Root 修正）：静态 gzip 与安全头的真实断言对象是 /assets/ 下
 * 的 hashed JS/CSS——真实构建产物在此（uni-app vite build），由 Caddy
 * 的 /assets/* 与 /static/* 静态路由按原路径提供并设置 immutable。
 * /static/ 的 PNG 不在 Caddy 默认压缩范围内，不能拿它代替文本资源。
 * SPA shell（/ 文档）另断言 cache-control: no-cache。 */
async function assertTlsStaticDelivery(page: Page, assetRequests: string[]): Promise<void> {
  expect(
    assetRequests.length,
    "the page loaded no /assets/ JS/CSS asset to assert delivery on",
  ).toBeGreaterThan(0);
  const asset = await page.context().request.get(assetRequests[assetRequests.length - 1], {
    headers: { "Accept-Encoding": "gzip" },
  });
  expect(asset.ok(), `hashed asset fetch failed: HTTP ${asset.status()}`).toBeTruthy();
  const assetHeaders = asset.headers();
  const contentType = assetHeaders["content-type"] ?? "";
  // 防 SPA HTML fallback 假通过：必须真的是 JS/CSS，而不是 index.html。
  expect(
    /javascript|css/i.test(contentType),
    `hashed asset content-type must be JavaScript/CSS (got ${contentType})`,
  ).toBe(true);
  expect(contentType.includes("text/html")).toBe(false);
  expect(assetHeaders["content-encoding"], "hashed asset must be served gzip-compressed")
    .toContain("gzip");
  expect(assetHeaders["strict-transport-security"]).toContain("max-age=31536000");
  expect(assetHeaders["x-content-type-options"]).toBe("nosniff");
  expect(assetHeaders["x-frame-options"]).toBe("DENY");
  expect(assetHeaders["referrer-policy"]).toBe("no-referrer");
  expect(
    assetHeaders["cache-control"],
    "hashed asset must be immutable-cacheable",
  ).toContain("immutable");

  const shell = await page.context().request.get(`${new URL(page.url()).origin}/`);
  expect(shell.ok(), `SPA shell fetch failed: HTTP ${shell.status()}`).toBeTruthy();
  expect(shell.headers()["cache-control"], "SPA shell must be no-cache").toContain("no-cache");
}

test("the product exposes only home, chat and me as top-level navigation", async ({
  page,
}) => {
  // TLS 模式收集页面实际发起的 /assets/ 文本资源请求，供旅程末尾的
  // gzip/安全头真实断言使用；HTTP 模式不收集、不断言（行为不变）。
  const assetRequests: string[] = [];
  if (STACK_KIND === "tls") {
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/assets/")
          && (pathname.endsWith(".js") || pathname.endsWith(".css"))) {
        assetRequests.push(request.url());
      }
    });
  }
  const session = await openSharedSession(page, "chat");
  await navigateToPage(page, "/pages/index/index");

  const navItems = page.getByTestId("consumer-tabbar").getByRole("button");
  await expect(navItems).toHaveCount(3);
  await expect(navItems).toHaveText(["首页", "聊天", "我的"]);

  await page.getByTestId("tab-chats").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/chat/chat"));
  await expect(page.getByTestId("message-input")).toBeVisible();
  await expectFit(page, "chat");

  await page.getByTestId("chat-context-open").click();
  await page.getByTestId("chat-open-all-conversations").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/conversations/conversations"));
  await expect(page.getByRole("heading", { name: "全部会话" })).toBeVisible();
  await expect(page.getByTestId("consumer-tabbar")).toHaveCount(0);
  await expectFit(page, "all conversations");

  await navigateToPage(page, "/pages/account/account");
  await expect(page.getByTestId("account-email")).toHaveText(session.email);
  await expect(page.locator(".settings-section__title")).toHaveText([
    "陪伴",
    "账号",
    "安全",
    "关于",
  ]);
  await expect(page.getByTestId("ai-identity-note")).toContainText("并非真人");
  await expect(page.getByTestId("me-admin")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/Provider|Token|Runtime|记忆中心|数据控制台/);
  await expectFit(page, "account");

  await page.getByTestId("tab-home").click();
  // 首页是入口页：uni-app H5 可能把首页 hash 规范化为 #/ 而不带完整路径，
  // 与 helpers.navigateToPage 的首页判定保持同一语义。
  await page.waitForURL((url) =>
    url.hash.startsWith("#/pages/index/index") || ["", "#", "#/"].includes(url.hash),
  );
  await expect(page.getByTestId("home-hero")).toBeVisible();
  await expectFit(page, "home");

  if (STACK_KIND === "tls") {
    await assertTlsStaticDelivery(page, assetRequests);
  }
});
