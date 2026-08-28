import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

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

// ---------------------------------------------------------------------------
// round10（P2-3）：真实经过 Vite proxy 的 SSE 租约传播证据。runtime 对 SSE
// 订阅按 owner 维护并发租约（上限 3、TTL 130s）：生成 worker 的轮询间隔
// 给出数秒的"运行中静默窗口"，此刻订阅进入 live-tail 且无任何写回——若
// 客户端 abort 未被代理传播，runtime 直到 TTL 前都不会察觉，租约滞留。
// 用例在同一 owner 上持有 2 个真实代理订阅后从浏览器 abort 其中之一，随后
// 的第 3 个订阅必须立即被接纳（200 且非 stream.denied）：若被 abort 的租约
// 未释放，owner 已持有 3 个租约，新订阅必然 429。全部订阅都以页面同源
// fetch 发起，链路为 浏览器 → vite /api 代理 → runtime。
// ---------------------------------------------------------------------------
test("a browser-side abort of a proxied SSE subscription frees the runtime lease promptly", async ({
  page,
  request,
}: {
  page: Page;
  request: APIRequestContext | undefined;
}) => {
  test.setTimeout(150_000);
  const user = await provisionUser(request, "realtime-recovery");
  // 套跑共享登录来源桶（10 次/60 秒）：429 时做有界等待重试，不放宽断言。
  let session: Awaited<ReturnType<typeof uiLogin>>;
  try {
    session = await uiLogin(page, user);
  } catch (err) {
    if (!String(err).includes("429")) throw err;
    await page.waitForTimeout(65_000);
    session = await uiLogin(page, user);
  }
  await prepareGenerationAccess(session.accessToken);
  const context = await createRelationshipAndConversation(session.accessToken);
  // 页面只需位于 vite 源（同源 fetch 才走代理）；登录后的落地页即可。
  await page.goto("/#/pages/login/login");

  const report = await page.evaluate(
    async ({ token, conversationId }) => {
      const authHeaders = { Authorization: `Bearer ${token}` };
      const postJson = async (url: string, body: unknown) => {
        const r = await fetch(url, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      };
      const mintTicket = (generationId: string, seq: string) =>
        postJson("/api/v1/realtime/tickets", {
          generationId,
          sessionId: `e2e-lease-${seq}`,
          origin: location.origin,
          streamEpoch: "1",
          afterSeq: "0",
        });
      interface OpenStream {
        status: number;
        contentType: string;
        closedByServerBeforeAbort: boolean;
        firstChunk: string;
      }
      const openStream = async (
        generationId: string,
        seq: string,
        abortAfterMs: number,
      ): Promise<{ opened: OpenStream | null; abort: () => void; abortDone: Promise<void> }> => {
        const ticket = (await mintTicket(generationId, seq)).body as {
          ticketId?: string;
          secret?: string;
        };
        if (!ticket?.ticketId || !ticket?.secret) {
          throw new Error(`ticket mint failed for ${seq}`);
        }
        const params = new URLSearchParams({
          ticketId: ticket.ticketId,
          secret: ticket.secret,
          sessionId: `e2e-lease-${seq}`,
          origin: location.origin,
          streamEpoch: "1",
        });
        const controller = new AbortController();
        const response = await fetch(
          `/api/v1/realtime/streams/${encodeURIComponent(generationId)}?${params}`,
          {
            headers: { Accept: "text/event-stream", "Last-Event-ID": "0" },
            signal: controller.signal,
          },
        );
        const opened: OpenStream = {
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          closedByServerBeforeAbort: false,
          firstChunk: "",
        };
        // 读首个 chunk（若有）并监视 body 是否在 abort 前被服务端关闭
        //（前提守卫：生成必须仍处于运行中的 live-tail，否则租约会被自然
        // 完成而释放，测试前提失效）。
        const reader = response.body?.getReader() ?? null;
        const closedWatcher = (async () => {
          if (!reader) return;
          try {
            const first = await reader.read();
            if (first.value) {
              opened.firstChunk = new TextDecoder().decode(first.value);
            }
            // 继续读到关闭（首个 chunk 后没有更多事件即保持挂起）。
            await reader.read();
            opened.closedByServerBeforeAbort = true;
          } catch {
            /* aborted */
          }
        })();
        const abortDone = (async () => {
          await new Promise((resolve) => setTimeout(resolve, abortAfterMs));
          controller.abort();
          await closedWatcher.catch(() => undefined);
        })();
        return { opened, abort: () => controller.abort(), abortDone };
      };

      // 1) 发起一个真实生成（worker 轮询间隔给出运行窗口）。
      const created = await postJson(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/generations`,
        {
          idempotencyKey: `e2e-lease-${Date.now()}`,
          userContent: "用于验证代理断开传播的一次生成。",
        },
      );
      const generationId = String((created.body as { generationId?: unknown })?.generationId ?? "");
      if (created.status !== 200 || !generationId) {
        return { error: `generation create failed: ${created.status}` };
      }

      // 2) 并发打开两个真实代理 SSE 订阅并保持持有。
      const holdA = await openStream(generationId, "hold-a", 10_000_000);
      const holdB = await openStream(generationId, "hold-b", 10_000_000);
      if (holdA.opened!.status !== 200 || holdB.opened!.status !== 200) {
        holdA.abort();
        holdB.abort();
        return {
          error: `hold streams not admitted: a=${holdA.opened!.status} b=${holdB.opened!.status}`,
        };
      }
      if (
        holdA.opened!.firstChunk.includes("stream.denied") ||
        holdB.opened!.firstChunk.includes("stream.denied")
      ) {
        holdA.abort();
        holdB.abort();
        return { error: "hold stream denied (ticket/epoch mismatch)" };
      }
      // 给两个订阅一点时间确认 body 未被服务端关闭（live-tail 保持）。
      await new Promise((resolve) => setTimeout(resolve, 250));
      const premiseBroken =
        holdA.opened!.closedByServerBeforeAbort || holdB.opened!.closedByServerBeforeAbort;

      // 3) 浏览器主动 abort 第一个持有订阅；随后立即发起第 3 个订阅——
      //    若租约未释放（owner 已持有 3 个），新订阅必然 429。
      const probeStartAt = performance.now();
      holdA.abort();
      await holdA.abortDone;
      const probe = await openStream(generationId, "probe", 5);
      const probeElapsedMs = performance.now() - probeStartAt;
      const probeStatus = probe.opened!.status;
      const probeDenied = probe.opened!.firstChunk.includes("stream.denied");
      probe.abort();
      await probe.abortDone;
      holdB.abort();
      await holdB.abortDone;
      return {
        generationId,
        premiseBroken,
        probeStatus,
        probeDenied,
        probeElapsedMs,
        holdAFirstChunk: holdA.opened!.firstChunk.slice(0, 60),
      };
    },
    { token: session.accessToken, conversationId: context.conversationId },
  );

  expect(report.error ?? "", "the proxied SSE chain must be drivable").toBe("");
  expect(
    report.premiseBroken,
    "the generation must still be running (live-tail holds the leases; a completed " +
      "generation would release them naturally and void the premise)",
  ).toBe(false);
  expect(
    report.probeStatus,
    "the next subscription after a browser abort must be admitted (429 would mean " +
      "the aborted lease was not released — proxy did not propagate the disconnect)",
  ).toBe(200);
  expect(report.probeDenied, "the next subscription must not be denied").toBe(false);
  expect(
    report.probeElapsedMs,
    `the next subscription succeeded in ${report.probeElapsedMs?.toFixed(0)}ms — ` +
      "dramatically shorter than the 130s lease TTL",
  ).toBeLessThan(10_000);
});
