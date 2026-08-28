import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
// round10（P2-3）：真实经过 Vite proxy 的 SSE 断开传播证据。
//
// 已实证的后端事实（round10 手动取证，DB 直查 vc.sensitive_route_lease）：
// runtime 的 RealtimeStreamController 在 controller 线程内同步 complete()
// emitter（Spring 7 的 async-启动前完成路径不触发 onCompletion 回调），
// 因此【每条】SSE 租约都会滞留到 130s TTL——无论客户端断开与否、无论流
// 自然完成还是中途 abort。租约释放是后端缺陷，本轮不修改后端；vite 代理
// 钩子无法弥补它，但钩子本身的行为必须被真实证明：
//   1. 建立真实代理链路（浏览器同源 fetch → vite /api 代理 → runtime），
//      收到真实 SSE 事件；
//   2. 浏览器 abort 后，代理钩子在严格时限内销毁上游（vite dev server
//      日志中的 `[vite-proxy] ... upstream destroyed` 行，直接证据）；
//   3. 下一次订阅在显著短于 130s TTL 的严格时限内成功（200 + 收到事件）。
// ---------------------------------------------------------------------------
test("a browser abort of a proxied SSE subscription propagates: the proxy destroys the upstream and the next subscription succeeds promptly", async ({
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

  // 标记当前 vite dev server 日志长度：后续只检索新增部分。
  const stateFile = process.env.E2E_STACK_STATE_FILE ?? "";
  expect(stateFile, "stack state file path must be exported").not.toBe("");
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as {
    supervisorPid: number;
  };
  const h5Log = `/tmp/vc-e2e-h5-${state.supervisorPid}.log`;
  const logSizeBefore = (execSync(`stat -f %z ${h5Log} || stat -c %s ${h5Log}`).toString().trim());
  expect(Number.isFinite(Number(logSizeBefore)), "vite dev server log readable").toBe(true);

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
      const subscribe = async (
        generationId: string,
        seq: string,
      ): Promise<{
        status: number;
        contentType: string;
        events: string;
        abort(): void;
        settled(): Promise<void>;
      }> => {
        const ticket = (
          await postJson("/api/v1/realtime/tickets", {
            generationId,
            sessionId: `e2e-prop-${seq}`,
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
          sessionId: `e2e-prop-${seq}`,
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
        const state = { events: "" };
        const reader = response.body?.getReader() ?? null;
        const done = (async () => {
          if (!reader) return;
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              state.events += new TextDecoder().decode(chunk.value);
              if (state.events.length > 400) controller.abort();
            }
          } catch {
            /* aborted — expected */
          }
        })();
        return {
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          get events() {
            return state.events;
          },
          abort(): void {
            controller.abort();
          },
          settled(): Promise<void> {
            return done;
          },
        };
      };

      // 1) 真实生成 + 真实代理订阅：确认链路收到真实 SSE 字节。
      const created = await postJson(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/generations`,
        {
          idempotencyKey: `e2e-prop-${Date.now()}`,
          userContent: "用于验证代理断开传播的一次生成。",
        },
      );
      if (created.status !== 200) {
        return { error: `generation create failed: ${created.status}` };
      }
      const generationId = String(
        (created.body as { generationId?: unknown })?.generationId ?? "",
      );
      if (!generationId) return { error: "generation create returned no id" };

      const first = await subscribe(generationId, "first");
      if (first.status !== 200) {
        first.abort();
        return { error: `first proxied subscription failed: ${first.status}` };
      }
      // 等真实事件（live delta 或终态 snapshot——生成 ~0.3-3s 内完成）。
      for (let i = 0; i < 40 && first.events.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const firstEvents = first.events;

      // 2) 浏览器主动 abort（未消费完即断开）。
      const abortAt = performance.now();
      first.abort();
      await first.settled();

      // 3) 下一次订阅：显著短于 130s TTL 的严格时限内成功，并收到事件。
      const second = await subscribe(generationId, "second");
      const secondAfterMs = performance.now() - abortAt;
      const secondStatus = second.status;
      for (let i = 0; i < 40 && second.events.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const secondEvents = second.events;
      second.abort();
      await second.settled();
      return {
        generationId,
        firstStatus: first.status,
        firstContentType: first.contentType,
        firstEvents,
        secondStatus,
        secondEvents,
        secondAfterMs,
      };
    },
    { token: session.accessToken, conversationId: context.conversationId },
  );

  expect(report.error ?? "", "the proxied SSE chain must be drivable").toBe("");
  expect(report.firstStatus, "the real proxied SSE subscription is admitted").toBe(200);
  expect(
    report.firstContentType,
    "the response is a real event-stream through the proxy",
  ).toContain("text/event-stream");
  expect(
    (report.firstEvents ?? "").length,
    "real SSE bytes were received through the proxy chain",
  ).toBeGreaterThan(0);

  // 代理端及时断开上游：abort 后严格时限内出现销毁日志（直接证据）。
  let destroyLine = "";
  await expect
    .poll(
      () => {
        try {
          const size = Number(
            execSync(`stat -f %z ${h5Log} || stat -c %s ${h5Log}`)
              .toString()
              .trim(),
          );
          if (size <= Number(logSizeBefore)) return "";
          destroyLine = execSync(
            `tail -c +$(( ${Number(logSizeBefore)} + 1 )) ${h5Log} | grep -F "upstream destroyed: /api/v1/realtime/streams/" | tail -1 || true`,
          )
            .toString()
            .trim();
          return destroyLine;
        } catch {
          return "";
        }
      },
      { timeout: 10_000, intervals: [200, 500] },
    )
    .not.toBe("");
  expect(destroyLine, "the vite proxy destroyed the upstream promptly").toContain(
    "upstream destroyed: /api/v1/realtime/streams/",
  );

  // 下一次订阅：200 + 收到事件 + 严格时限（<< 130s TTL）。
  expect(
    report.secondStatus,
    "the next subscription after the abort is admitted promptly",
  ).toBe(200);
  expect(
    (report.secondEvents ?? "").length,
    "the next subscription received real SSE bytes",
  ).toBeGreaterThan(0);
  expect(
    report.secondAfterMs,
    `the next subscription succeeded in ${report.secondAfterMs?.toFixed(0)}ms — dramatically shorter than the 130s lease TTL`,
  ).toBeLessThan(10_000);
  console.info(
    `[round10 P2-3 evidence] gen=${report.generationId} ` +
      `proxyDestroy="${destroyLine.slice(0, 120)}" ` +
      `nextSubscriptionMs=${report.secondAfterMs?.toFixed(0)}`,
  );
});
