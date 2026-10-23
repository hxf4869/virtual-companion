import { expect, test, type Route } from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  openSharedSession,
  prepareGenerationAccess,
  PROVIDER_REPLY,
  sessionRequest,
  waitForGenerationTerminal,
} from "../helpers";

// Commit the first POST on the real server, then lose only its browser
// response. The retry must resolve that same turn while the next draft stays
// editable; sending that draft afterward remains an explicit new action.
test("retry confirms the original message while preserving the next draft", async ({ page }, testInfo) => {
  const session = await openSharedSession(page, "chat");
  await prepareGenerationAccess(session);
  const context = await createRelationshipAndConversation(session);
  await navigateToPage(page, "/pages/chat/chat?relationshipId=" + context.relationshipId
    + "&conversationId=" + context.conversationId);
  const input = page.locator('[data-testid="message-input"] textarea');
  await expect(input).toBeVisible();
  const original = "今天有点忙，想把这句话慢慢说完。";
  const nextDraft = "下一条草稿，请先留在输入框里。";
  const generationPath = "/api/v1/conversations/" + context.conversationId + "/generations";
  const routeMatch = "**" + generationPath;
  const sent: Array<{ idempotencyKey?: unknown; userContent?: unknown; sourceUserMessageId?: unknown }> = [];
  let firstStatus = 0;
  let firstGenerationId = "";
  let observeFirst!: () => void;
  const firstObserved = new Promise<void>((resolve) => { observeFirst = () => resolve(); });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = () => resolve(); });
  const intercept = async (route: Route): Promise<void> => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    sent.push(route.request().postDataJSON() as typeof sent[number]);
    if (sent.length !== 1) { await route.continue(); return; }
    observeFirst();
    await firstGate;
    try {
      const upstream = await route.fetch();
      firstStatus = upstream.status();
      const body = await upstream.json() as { generationId?: unknown };
      firstGenerationId = String(body.generationId ?? "");
    } finally {
      await route.abort("failed");
    }
  };
  await page.route(routeMatch, intercept);
  try {
    await input.fill(original);
    await page.getByTestId("send").click();
    await firstObserved;
    // The original request is pending: this is a later draft, not an edit of
    // an already-failed message. Only the network outcome changes afterward.
    await input.fill(nextDraft);
    await expect(input).toHaveValue(nextDraft);
    releaseFirst();
    await expect(page.getByTestId("chat-send-error")).toBeVisible();
    expect(firstStatus).toBeGreaterThanOrEqual(200);
    expect(firstStatus).toBeLessThan(300);
    expect(firstGenerationId).not.toBe("");
    await waitForGenerationTerminal(page, firstGenerationId);
    await expect(page.getByTestId("retry")).toHaveText("重试原消息");
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(widths.page, "retry feedback must fit the mobile viewport").toBeLessThanOrEqual(widths.viewport);
    await page.screenshot({ path: testInfo.outputPath("retry-original-with-next-draft.png"), animations: "disabled" });

    const replayResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === generationPath);
    await page.getByTestId("retry").click();
    const replay = await replayResponse;
    expect(replay.ok()).toBeTruthy();
    const replayBody = await replay.json() as { generationId?: unknown };
    expect(String(replayBody.generationId ?? "")).toBe(firstGenerationId);
    expect(sent).toHaveLength(2);
    expect(sent.map((body) => body.userContent)).toEqual([original, original]);
    expect(typeof sent[0].idempotencyKey).toBe("string");
    expect(sent[0].idempotencyKey).not.toBe("");
    expect(sent[1].idempotencyKey).toBe(sent[0].idempotencyKey);
    expect(sent.every((body) => body.sourceUserMessageId === undefined)).toBe(true);
    await expect(input).toHaveValue(nextDraft);
    await expect(page.getByTestId("user-message").filter({ hasText: original })).toHaveCount(1);
    await expect(page.getByTestId("assistant-md").filter({ hasText: PROVIDER_REPLY })).toHaveCount(1);

    const originalHistory = await sessionRequest(page, "GET",
      "/api/v1/conversations/" + context.conversationId + "/messages?limit=20");
    expect(originalHistory.ok).toBeTruthy();
    expect(Array.isArray(originalHistory.body)).toBe(true);
    const firstRows = originalHistory.body as Array<{ role?: unknown; content?: unknown }>;
    expect(firstRows.filter((row) => row.role === "user").map((row) => row.content)).toEqual([original]);

    // B is sent only after the user presses Send; it gets a new key and does
    // not turn the unknown retry into a duplicate user message.
    await expect(page.getByTestId("send")).toBeEnabled();
    const nextResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === generationPath
      && response.request().postDataJSON()?.userContent === nextDraft);
    await page.getByTestId("send").click();
    expect((await nextResponse).ok()).toBeTruthy();
    await expect(input).toHaveValue("");
    await expect(page.getByTestId("user-message").filter({ hasText: nextDraft })).toHaveCount(1);
    await expect(page.getByTestId("assistant-md").filter({ hasText: PROVIDER_REPLY })).toHaveCount(2);
    expect(sent).toHaveLength(3);
    expect(sent[2].userContent).toBe(nextDraft);
    expect(sent[2].idempotencyKey).not.toBe(sent[0].idempotencyKey);
    const history = await sessionRequest(page, "GET",
      "/api/v1/conversations/" + context.conversationId + "/messages?limit=20");
    expect(history.ok).toBeTruthy();
    expect(Array.isArray(history.body)).toBe(true);
    const rows = history.body as Array<{ role?: unknown; content?: unknown }>;
    expect(rows.filter((row) => row.role === "user").map((row) => row.content)).toEqual([original, nextDraft]);
  } finally {
    releaseFirst();
    await page.unroute(routeMatch, intercept);
  }
});
