import {
  expect,
  test,
} from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  prepareGenerationAccess,
  PROVIDER_REPLY,
  PROVIDER_TIMEOUT_SENTINEL,
  provisionUser,
  sessionRequest,
  uiLogin,
  waitForGenerationTerminal,
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
  await prepareGenerationAccess(session.page);
  const context = await createRelationshipAndConversation(session.page);

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
  const input = page.locator('[data-testid="message-input"] textarea');
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

  await expect(page.getByTestId("assistant-md")).toContainText(PROVIDER_REPLY);
  await expect(
    page.locator('[data-testid="chat-message"].user').filter({ hasText: prompt }),
  ).toHaveCount(1);
  await expect(page.locator('[data-testid="chat-message"].assistant')).toHaveCount(1);
  expect(streamAttempts).toBeGreaterThanOrEqual(1);
  expect(generationPosts).toBe(1);
});

test("a browser can abort a proxied SSE subscription and continue using generation recovery", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const user = await provisionUser(request, "realtime-recovery");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.page);
  const context = await createRelationshipAndConversation(session.page);
  // 登录后的落地页已经位于 Vite 源；同源 fetch 会走真实代理链路。

  const created = await sessionRequest(
    page,
    "POST",
    `/api/v1/conversations/${encodeURIComponent(context.conversationId)}/generations`,
    {
      idempotencyKey: `e2e-prop-${Date.now()}`,
      // Keep the upstream SSE open until the browser aborts it. A normal local
      // reply can complete before the first chunk is inspected, which proves
      // normal EOF rather than client-disconnect propagation.
      userContent: `用于验证代理断开传播的一次生成。${PROVIDER_TIMEOUT_SENTINEL}`,
    },
  );
  expect(created.ok, `generation create failed: ${created.status}`).toBeTruthy();
  const generationId = String(
    (created.body as { generationId?: unknown })?.generationId ?? "",
  );
  expect(generationId, "generation create returned no id").not.toBe("");

  // Go v1 的 SSE 直接使用 opaque session cookie，不再铸造 ticket 或把
  // secret 放进查询参数。浏览器主动 abort 后仍需关闭代理上游 transport。
  const report = await page.evaluate(async (generationId) => {
    const controller = new AbortController();
    const response = await fetch(
      `/api/v1/realtime/streams/${encodeURIComponent(generationId)}`,
      {
        credentials: "include",
        headers: { Accept: "text/event-stream", "Last-Event-ID": "0" },
        signal: controller.signal,
      },
    );
    let events = "";
    let firstDone = true;
    let abortError = "";
    const reader = response.body?.getReader() ?? null;
    if (reader) {
      try {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("stream read timeout")), 5_000),
          ),
        ]);
        firstDone = chunk.done;
        if (chunk.value) events = new TextDecoder().decode(chunk.value);
      } finally {
        controller.abort();
      }
      try {
        await reader.read();
      } catch (error) {
        abortError = error instanceof Error ? error.name : String(error);
      }
    } else {
      controller.abort();
    }
    return {
      firstStatus: response.status,
      firstContentType: response.headers.get("content-type") ?? "",
      firstEvents: events,
      firstDone,
      abortError,
    };
  }, generationId);

  expect(report.firstStatus, "the real proxied SSE subscription is admitted").toBe(200);
  expect(
    report.firstContentType,
    "the response is a real event-stream through the proxy",
  ).toContain("text/event-stream");
  expect(
    (report.firstEvents ?? "").length,
    "real SSE bytes were received through the proxy chain",
  ).toBeGreaterThan(0);
  expect(report.firstDone, "the stream is still open before abort").toBe(false);
  expect(report.abortError, "abort terminates the browser body reader").toBe("AbortError");

  const terminal = await waitForGenerationTerminal(page, generationId, 20_000);
  expect((terminal.body as { status?: unknown })?.status).toBe("FAILED_FINAL");
});
