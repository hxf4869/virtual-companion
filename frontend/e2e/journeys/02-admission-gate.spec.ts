import { expect, test } from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  provisionUser,
  uiLogin,
} from "../helpers";

// Journey 2 — the server, not the H5, is the first-turn admission authority.
test("an unverified account cannot create its first generation", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "admission-gate");
  const session = await uiLogin(page, user);
  const context = await createRelationshipAndConversation(session.accessToken);

  await navigateToPage(
    page,
    `/pages/chat/chat?relationshipId=${context.relationshipId}&conversationId=${context.conversationId}`,
  );
  const input = page.locator('[data-testid="message-input"] input');
  await expect(input).toBeVisible();

  const prompt = "我们开始第一次聊天吧";
  const generationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/conversations\/\d+\/generations$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await input.fill(prompt);
  await page.getByTestId("send").click();

  const response = await generationResponse;
  expect(response.status()).toBe(403);
  expect((await response.json()) as { code?: string }).toMatchObject({
    code: "AGE_VERIFICATION_REQUIRED",
  });
  expect(response.headers()["x-request-id"]).toBeTruthy();

  // The UI keeps the unsent draft and never fabricates an assistant reply.
  await expect(input).toHaveValue(prompt);
  await expect(page.getByTestId("status")).not.toContainText("已完成");
  await expect(page.getByTestId("assistant-md")).toHaveCount(0);
  await expect(page.getByTestId("chat-send-error")).toHaveCount(0);
});
