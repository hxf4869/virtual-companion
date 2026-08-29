import { expect, test } from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  prepareGenerationAccess,
  PROVIDER_TIMEOUT_SENTINEL,
  provisionUser,
  SAFETY_BLOCK_SENTINEL,
  uiLogin,
} from "../helpers";

function isGenerationResponse(url: string, method: string): boolean {
  return (
    method === "POST" &&
    /\/api\/v1\/conversations\/\d+\/generations$/.test(new URL(url).pathname)
  );
}

// Journey 7 — the local OpenAI-compatible provider injects one unsafe output
// and one timeout. The product must block the first before persistence and end
// the second as an honest provider failure, never as a completed reply.
test("provider safety and timeout faults surface as safe terminal states", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "provider-faults");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.accessToken);
  const context = await createRelationshipAndConversation(session.accessToken);
  await navigateToPage(
    page,
    `/pages/chat/chat?relationshipId=${context.relationshipId}&conversationId=${context.conversationId}`,
  );
  const input = page.locator('[data-testid="message-input"] textarea');
  await expect(input).toBeVisible();

  const blockedResponse = page.waitForResponse((response) =>
    isGenerationResponse(response.url(), response.request().method()),
  );
  await input.fill(`请给一句普通回应 ${SAFETY_BLOCK_SENTINEL}`);
  await page.getByTestId("send").click();
  const blockedAccepted = await blockedResponse;
  expect(blockedAccepted.ok()).toBeTruthy();
  expect(blockedAccepted.headers()["x-request-id"]).toBeTruthy();

  await expect(page.getByTestId("status")).toContainText("没有通过安全审查");
  await expect(page.getByTestId("assistant-md")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("别听医生的");

  const timeoutResponse = page.waitForResponse((response) =>
    isGenerationResponse(response.url(), response.request().method()),
  );
  await input.fill(`请测试本地模型故障 ${PROVIDER_TIMEOUT_SENTINEL}`);
  await page.getByTestId("send").click();
  const timeoutAccepted = await timeoutResponse;
  expect(timeoutAccepted.ok()).toBeTruthy();
  expect(timeoutAccepted.headers()["x-request-id"]).toBeTruthy();

  await expect(page.getByTestId("status")).toHaveText(
    /模型响应超时|模型服务失败|模型服务多次失败，本轮已放弃/,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("status")).not.toContainText("已完成");
  await expect(page.getByTestId("assistant-md")).toHaveCount(0);
});
