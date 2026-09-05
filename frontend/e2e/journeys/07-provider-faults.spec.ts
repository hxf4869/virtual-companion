import { expect, test } from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  prepareGenerationAccess,
  PROVIDER_TIMEOUT_SENTINEL,
  provisionUser,
  SAFETY_BLOCK_SENTINEL,
  uiLogin,
  waitForGenerationTerminal,
} from "../helpers";

function isGenerationResponse(url: string, method: string): boolean {
  return (
    method === "POST" &&
    /\/api\/v1\/conversations\/\d+\/generations$/.test(new URL(url).pathname)
  );
}

// The local provider injects one unsafe output and one timeout. The consumer
// sees only useful product copy; provider and protocol details stay hidden.
test("provider safety and timeout faults surface as safe terminal states", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "provider-faults");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.page);
  const context = await createRelationshipAndConversation(session.page);
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

  await expect(page.getByTestId("status")).toContainText("这句话暂时无法回应");
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
  const timeoutGeneration = (await timeoutAccepted.json()) as {
    generationId?: unknown;
  };
  const timeoutGenerationId = String(timeoutGeneration.generationId ?? "");
  expect(timeoutGenerationId, "timeout generation id is present").not.toBe("");
  const terminal = await waitForGenerationTerminal(page, timeoutGenerationId, 20_000);
  expect(
    (terminal.body as { status?: unknown })?.status,
    "the provider timeout is durably terminal before checking its UI copy",
  ).toBe("FAILED_FINAL");

  await expect(page.getByTestId("chat-send-error")).toContainText("没发出，点此重试", {
    timeout: 60_000,
  });
  await expect(page.locator("body")).not.toContainText(/Provider|SSE|FAILED_FINAL|模型响应超时/);
  await expect(page.getByTestId("assistant-md")).toHaveCount(0);
});
