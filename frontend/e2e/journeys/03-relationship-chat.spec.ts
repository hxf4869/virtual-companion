import { expect, test } from "@playwright/test";

import {
  navigateToPage,
  prepareGenerationAccess,
  PROVIDER_REPLY,
  provisionUser,
  uiLogin,
} from "../helpers";

// Journey 3 — create the first relationship in the H5, then complete one
// generation through the real runtime, worker, provider adapter and Fetch-SSE.
test("a user can create a relationship and complete a real chat turn", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "relationship-chat");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.accessToken);

  // 统一创建流程在陪伴设置页（前端产品化重构 Phase 3）；聊天空态只提供
  // 跳转入口。
  await navigateToPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("relationship-selector")).toBeVisible();

  const persona = page.getByTestId("persona-select");
  await expect(persona).toBeEnabled();
  await persona.selectOption("gentle-listener");
  await page.getByTestId("create-relationship").click();

  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
  );

  await navigateToPage(page, "/pages/chat/chat");
  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
  );
  await expect(page.getByTestId("conversation-panel")).toBeVisible();

  const prompt = "今天有点忙，想慢慢聊一会儿。";
  const generationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/conversations\/\d+\/generations$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.locator('[data-testid="message-input"] input').fill(prompt);
  await page.getByTestId("send").click();

  const accepted = await generationResponse;
  expect(accepted.ok(), `generation create failed: ${accepted.status()}`).toBeTruthy();
  expect(accepted.headers()["x-request-id"]).toBeTruthy();

  await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）");
  await expect(page.getByTestId("assistant-md")).toHaveCount(1);
  await expect(page.getByTestId("assistant-md")).toContainText(PROVIDER_REPLY);
  await expect(
    page.locator('[data-testid="chat-message"].user').filter({ hasText: prompt }),
  ).toHaveCount(1);
  await expect(page.locator('[data-testid="chat-message"].assistant')).toHaveCount(1);

  // The shipped phone viewport must not require page-level horizontal scroll.
  const geometry = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
});

// P1-2 回归：聊天消息 → 举报页深链（hash 路由携带 messageId）→ 最终提交
// 载荷必须包含正确的 messageId。举报页从 location.hash 读取，不再只读
// location.search。
test("a message report deep link carries messageId into the submit payload", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "relationship-chat");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.accessToken);

  await navigateToPage(page, "/pages/companion/companion");
  await page.getByTestId("persona-select").selectOption("gentle-listener");
  await page.getByTestId("create-relationship").click();
  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
  );

  await navigateToPage(page, "/pages/chat/chat");
  const input = page.locator('[data-testid="message-input"] input');
  await expect(input).toBeVisible();
  await input.fill("这条消息将被举报");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）", {
    timeout: 30_000,
  });

  // 消息级"更多"展开后进入举报说明，再打开举报页。
  const firstUser = page.locator('[data-testid="chat-message"]').filter({
    hasText: "这条消息将被举报",
  });
  await firstUser.getByTestId(/msg-more-/).click();
  await firstUser.getByTestId(/msg-report-/).first().click();
  await firstUser.getByTestId("msg-report-open-page").click();

  await expect(page.getByTestId("report-anchor")).toBeVisible();
  const messageId = (await page.url()).match(/messageId=([^&/]+)/)?.[1] ?? "";
  expect(messageId).not.toBe("");

  await page.getByTestId("report-note").locator("textarea, input").first()
    .fill("举报回归：消息内容让我不安");
  const payloadPromise = page.waitForRequest(
    (req) =>
      req.method() === "POST" &&
      new URL(req.url()).pathname === "/api/v1/reports",
  );
  await page.getByTestId("report-submit").click();
  const body = (await payloadPromise).postDataJSON() as { messageId?: string };
  expect(body.messageId).toBe(messageId);
});
