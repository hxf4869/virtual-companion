import { expect, test } from "@playwright/test";

import {
  navigateToPage,
  prepareGenerationAccess,
  PROVIDER_REPLY,
  provisionUser,
  uiLogin,
} from "../helpers";

test("home starts the first conversation and later resumes it", async ({ page, request }) => {
  const user = await provisionUser(request, "relationship-chat");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.page);

  await navigateToPage(page, "/pages/index/index");
  await expect(page.getByTestId("current-relationship")).toBeVisible();
  await expect(page.getByTestId("home-start-chat")).toHaveText("开始第一次对话");
  await page.getByTestId("home-start-chat").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/chat/chat"));
  await expect(page.getByTestId("empty-history")).toContainText("从这里开始");
  await expect(page.getByTestId("chat-ai-label")).toContainText("非真人");

  const prompt = "今天有点忙，想慢慢聊一会儿。";
  const accepted = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && /\/api\/v1\/conversations\/\d+\/generations$/.test(new URL(response.url()).pathname),
  );
  await page.locator('[data-testid="message-input"] textarea').fill(prompt);
  await page.getByTestId("send").click();
  expect((await accepted).ok()).toBeTruthy();

  await expect(page.getByTestId("user-message").filter({ hasText: prompt })).toHaveCount(1);
  await expect(page.getByTestId("assistant-md").filter({ hasText: PROVIDER_REPLY })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("body")).not.toContainText(/SSE|Provider|Token|Runtime/);

  await page.getByTestId("tab-home").click();
  await expect(page.getByTestId("home-continue-chat")).toHaveText("继续上次对话");
  await expect(page.getByTestId("home-recent-conversations")).toBeVisible();

  await page.getByTestId("home-view-all").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/conversations/conversations"));
  await expect(page.getByTestId("conversations-list")).toBeVisible();
  await expect(page.getByTestId("session-preview").first()).toBeVisible();
});
