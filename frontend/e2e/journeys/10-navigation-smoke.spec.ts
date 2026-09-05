import { expect, test, type Page } from "@playwright/test";

import { navigateToPage, provisionUser, uiLogin } from "../helpers";

async function expectFit(page: Page, label: string): Promise<void> {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(sizes.scrollWidth, `${label} must not overflow`).toBeLessThanOrEqual(sizes.viewportWidth);
}

test("the product exposes only home, chat and me as top-level navigation", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "navigation-smoke");
  await uiLogin(page, user);
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
  await expect(page.getByTestId("account-email")).toHaveText(user.email);
  await expect(page.locator(".settings-section__title")).toHaveText(["账号", "安全", "关于"]);
  await expect(page.getByTestId("ai-identity-note")).toContainText("并非真人");
  await expect(page.getByTestId("me-admin")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/Provider|Token|Runtime|记忆中心|数据控制台/);
  await expectFit(page, "account");

  await page.getByTestId("tab-home").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/index/index"));
  await expect(page.getByTestId("home-hero")).toBeVisible();
  await expectFit(page, "home");
});
