import { expect, test } from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  prepareGenerationAccess,
  PROVIDER_REPLY,
  provisionUser,
  uiLogin,
} from "../helpers";

// Journey 4 — an interrupted first Fetch-SSE connection survives a full page
// reload. The durable generation is recovered; the user turn is never posted
// a second time.
test("reload recovers after the first SSE connection is interrupted", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "realtime-recovery");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.accessToken);
  const context = await createRelationshipAndConversation(session.accessToken);

  let generationPosts = 0;
  let streamAttempts = 0;
  page.on("request", (observed) => {
    const path = new URL(observed.url()).pathname;
    if (
      observed.method() === "POST" &&
      /\/api\/v1\/conversations\/\d+\/generations$/.test(path)
    ) {
      generationPosts += 1;
    }
  });

  let markFirstStreamAborted: (() => void) | undefined;
  const firstStreamAborted = new Promise<void>((resolve) => {
    markFirstStreamAborted = resolve;
  });
  await page.route("**/api/v1/realtime/streams/**", async (route) => {
    streamAttempts += 1;
    if (streamAttempts === 1) {
      await route.abort("failed");
      markFirstStreamAborted?.();
      return;
    }
    await route.continue();
  });

  await navigateToPage(
    page,
    `/pages/chat/chat?relationshipId=${context.relationshipId}&conversationId=${context.conversationId}`,
  );
  const input = page.locator('[data-testid="message-input"] input');
  await expect(input).toBeVisible();

  const prompt = "连接断开后也请接着完成这一轮。";
  await input.fill(prompt);
  await page.getByTestId("send").click();
  await firstStreamAborted;

  // Only the reloaded page can issue this snapshot request: the original run
  // is in its reconnect backoff after the deliberately aborted first stream.
  const restoredSnapshot = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/api\/v1\/generations\/\d+\/snapshot$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  expect((await restoredSnapshot).ok()).toBeTruthy();

  await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）");
  await expect(page.getByTestId("assistant-md")).toContainText(PROVIDER_REPLY);
  await expect(
    page.locator('[data-testid="chat-message"].user').filter({ hasText: prompt }),
  ).toHaveCount(1);
  await expect(page.locator('[data-testid="chat-message"].assistant')).toHaveCount(1);
  expect(streamAttempts).toBeGreaterThanOrEqual(1);
  expect(generationPosts).toBe(1);
});
