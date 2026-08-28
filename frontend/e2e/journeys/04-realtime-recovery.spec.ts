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
//
// 全部订阅都以页面同源 fetch 发起，链路为 浏览器 → vite /api 代理 → runtime。
// 阶段一（决定性判据）：持有 A/B/C 三个真实代理订阅后从浏览器 abort A，
// 随后的探测订阅 D 必须立即被接纳——若 A 的租约未释放，owner 已持有 3 个
// 租约，D 必然 429。再 abort B 并探测 E（一致性：连续两次 abort 都必须释放）。
// 阶段二（取证诊断）：一条自然完成的流（读至服务端关闭）之后，持有 F/G
// 两个运行中订阅并探测 I——用于记录"完成态流租约是否滞留至 TTL"（five
// viewports 用例 429 的根因取证；后端行为只报告不断言）。
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
      // 后端对状态变更请求要求 double-submit CSRF：从 vc_csrf cookie 读取
      // 并注入 X-CSRF-Token（与生产 transport 的行为一致）。
      const csrf =
        document.cookie.match(/(?:^|;\s*)vc_csrf=([^;]*)/)?.[1] ?? "";
      const authHeaders = { Authorization: `Bearer ${token}`, "X-CSRF-Token": csrf };
      const postJson = async (url: string, body: unknown) => {
        const r = await fetch(url, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      };
      const createGeneration = async (content: string): Promise<string> => {
        const created = await postJson(
          `/api/v1/conversations/${encodeURIComponent(conversationId)}/generations`,
          {
            idempotencyKey: `e2e-lease-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            userContent: content,
          },
        );
        if (created.status !== 200) {
          throw new Error(`generation create failed: ${created.status}`);
        }
        return String((created.body as { generationId?: unknown })?.generationId ?? "");
      };
      interface HeldStream {
        status: number;
        firstChunk: string;
        closedByServer: boolean;
        abort(): void;
        settled(): Promise<void>;
      }
      const openStream = async (
        generationId: string,
        seq: string,
      ): Promise<HeldStream> => {
        const ticket = (
          await postJson("/api/v1/realtime/tickets", {
            generationId,
            sessionId: `e2e-lease-${seq}`,
            origin: location.origin,
            streamEpoch: "1",
            afterSeq: "0",
          })
        ).body as { ticketId?: string; secret?: string };
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
            headers: {
              ...authHeaders,
              Accept: "text/event-stream",
              "Last-Event-ID": "0",
            },
            signal: controller.signal,
          },
        );
        const state = { status: response.status, firstChunk: "", closedByServer: false };
        const reader = response.body?.getReader() ?? null;
        const done = (async () => {
          if (!reader) return;
          try {
            const first = await reader.read();
            if (first.value) {
              state.firstChunk = new TextDecoder().decode(first.value);
            }
            await reader.read(); // 静默 live-tail 保持挂起；服务端关闭则置位。
            state.closedByServer = true;
          } catch {
            /* aborted — expected */
          }
        })();
        // getter 读活值：status/firstChunk/closedByServer 由读循环异步置位。
        return {
          get status() {
            return state.status;
          },
          get firstChunk() {
            return state.firstChunk;
          },
          get closedByServer() {
            return state.closedByServer;
          },
          abort(): void {
            controller.abort();
          },
          settled(): Promise<void> {
            return done;
          },
        };
      };
      const waitMs = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      // ---- 阶段一：abort 传播的决定性判据 ----
      // worker 轮询间隔内生成必须保持运行（live-tail 持有租约）；轮询相位
      // 可能恰好在持有建立后立即拾取并完成生成（前提失效），做有界重试。
      interface Phase1 {
        retryable: boolean;
        reason?: string;
        gen1?: string;
        holdStatuses?: number[];
        probeDStatus?: number;
        probeDDenied?: boolean;
        probeDAfterMs?: number;
        probeEStatus?: number;
        probeEDenied?: boolean;
      }
      const attemptPhase1 = async (): Promise<Phase1> => {
        const gen = await createGeneration("用于验证代理断开传播的一次生成。");
        const [a, b, c] = await Promise.all([
          openStream(gen, "hold-a"),
          openStream(gen, "hold-b"),
          openStream(gen, "hold-c"),
        ]);
        const cleanup = async (): Promise<void> => {
          a.abort();
          b.abort();
          c.abort();
          await Promise.all([a.settled(), b.settled(), c.settled()]);
        };
        if ([a, b, c].some((s) => s.status === 429)) {
          await cleanup();
          return { retryable: true, reason: "hold hit a lingering lease (429)" };
        }
        if ([a, b, c].some((s) => s.firstChunk.includes("stream.denied"))) {
          await cleanup();
          return { retryable: true, reason: "hold denied (ticket/epoch mismatch)" };
        }
        await waitMs(250);
        if ([a, b, c].some((s) => s.closedByServer)) {
          await cleanup();
          return { retryable: true, reason: "generation completed before holds settled" };
        }
        const probeStartAt = performance.now();
        a.abort();
        await a.settled();
        const probeD = await openStream(gen, "probe-d");
        const probeDAfterMs = performance.now() - probeStartAt;
        const dStatus = probeD.status;
        const dDenied = probeD.firstChunk.includes("stream.denied");
        probeD.abort();
        await probeD.settled();

        b.abort();
        await b.settled();
        const probeE = await openStream(gen, "probe-e");
        const eStatus = probeE.status;
        const eDenied = probeE.firstChunk.includes("stream.denied");
        probeE.abort();
        await probeE.settled();
        c.abort();
        await c.settled();
        return {
          retryable: false,
          gen1: gen,
          holdStatuses: [a.status, b.status, c.status],
          probeDStatus: dStatus,
          probeDDenied: dDenied,
          probeDAfterMs,
          probeEStatus: eStatus,
          probeEDenied: eDenied,
        };
      };
      let phase1: Phase1 = { retryable: true, reason: "not attempted" };
      const phase1RetryReasons: string[] = [];
      for (let i = 0; i < 4 && phase1.retryable; i += 1) {
        phase1 = await attemptPhase1();
        if (phase1.retryable) {
          phase1RetryReasons.push(phase1.reason ?? "?");
          await waitMs(400);
        }
      }

      if (phase1.retryable) {
        return {
          error: `premise never held: ${phase1RetryReasons.join("; ")}`,
        };
      }

      // ---- 阶段二：自然完成的流之后，租约是否仍被占用（根因取证） ----
      const gen2 = await createGeneration("用于验证完成态流租约释放的第二次生成。");
      const natural = await openStream(gen2, "natural");
      let naturallyClosed = false;
      for (let i = 0; i < 40 && !naturallyClosed; i += 1) {
        await waitMs(500);
        naturallyClosed = natural.closedByServer;
      }
      const gen3 = await createGeneration("用于持有运行中订阅的第三次生成。");
      const [f, g] = await Promise.all([
        openStream(gen3, "hold-f"),
        openStream(gen3, "hold-g"),
      ]);
      const hold2Statuses = [f.status, g.status];
      await waitMs(150);
      // 前提：F/G 仍保持打开（生成运行中）——否则 probeI 不可解读。
      const premise2Held =
        hold2Statuses.every((s) => s === 200) &&
        !f.closedByServer &&
        !g.closedByServer;
      const probeI = await openStream(gen3, "probe-i");
      const probeIStatus = probeI.status;
      natural.abort();
      f.abort();
      g.abort();
      probeI.abort();
      await Promise.all([
        natural.settled(),
        f.settled(),
        g.settled(),
        probeI.settled(),
      ]);

      return {
        gen1: phase1.gen1,
        holdStatuses: phase1.holdStatuses,
        probeDStatus: phase1.probeDStatus,
        probeDDenied: phase1.probeDDenied,
        probeDAfterMs: phase1.probeDAfterMs,
        probeEStatus: phase1.probeEStatus,
        probeEDenied: phase1.probeEDenied,
        naturallyClosed,
        premise2Held,
        hold2Statuses,
        probeIStatus,
      };
    },
    { token: session.accessToken, conversationId: context.conversationId },
  );

  expect(report.error ?? "", "the proxied SSE chain must be drivable").toBe("");
  expect(report.holdStatuses, "three real proxied holds must be admitted").toEqual([
    200, 200, 200,
  ]);
  expect(
    report.probeDStatus,
    "the next subscription after a browser abort must be admitted (429 would mean " +
      "the aborted lease was not released — proxy did not propagate the disconnect)",
  ).toBe(200);
  expect(report.probeDDenied, "the probe subscription must not be denied").toBe(false);
  expect(
    report.probeDAfterMs,
    `the next subscription succeeded in ${report.probeDAfterMs?.toFixed(0)}ms — ` +
      "dramatically shorter than the 130s lease TTL",
  ).toBeLessThan(10_000);
  expect(
    report.probeEStatus,
    "a second abort must also release its lease immediately",
  ).toBe(200);
  expect(report.probeEDenied).toBe(false);
  // 阶段二只作取证：自然完成的流关闭后，若 probeI=429，说明完成态流的租约
  // 滞留到 TTL（five-viewports 重试 429 的服务端根因）——该行为属后端，
  // 本轮不改后端；结论进入最终报告。
  console.info(
    `[round10 P2-3 evidence] naturallyClosed=${report.naturallyClosed} ` +
      `hold2=${JSON.stringify(report.hold2Statuses)} ` +
      `probeAfterNaturalCompletion=${report.probeIStatus}`,
  );
});
