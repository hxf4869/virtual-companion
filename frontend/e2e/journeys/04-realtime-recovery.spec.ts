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
  await expect(page.getByTestId("assistant-md")).toContainText(PROVIDER_REPLY);
  await expect(
    page.locator('[data-testid="chat-message"].user').filter({ hasText: prompt }),
  ).toHaveCount(1);
  await expect(page.locator('[data-testid="chat-message"].assistant')).toHaveCount(1);
  expect(streamAttempts).toBeGreaterThanOrEqual(1);
  expect(generationPosts).toBe(1);
});

// ---------------------------------------------------------------------------
// round11（P1-1/P2-2）：真实经过 Vite proxy 的 SSE 断开传播证据（脱敏版）。
//
// 本测试只证明前端侧的两件事：
//   1. 建立真实代理链路（浏览器同源 fetch → vite /api 代理 → runtime）并
//      收到真实 SSE 字节；浏览器 abort 后，代理钩子在严格时限内关闭上游
//      transport（vite dev server 日志中的固定事件行，直接证据）；
//   2. 代理日志完全脱敏——新增日志片段不含 `?`/`secret=`/`ticketId=`，
//      也不含本次测试实际持有的 secret 原值。
//
// 后端事实（round10 手动取证，DB 直查 vc.sensitive_route_lease）：runtime
// 的 RealtimeStreamController 在 controller 线程内同步 complete() emitter
// （Spring 7 的 async-启动前完成路径不触发 onCompletion 回调），因此【每条】
// SSE 租约都滞留到 130s TTL——无论客户端断开与否、无论流自然完成还是中途
// abort。这是后端缺陷（READY_FOR_OWNER：第 4 条流可能 429），本轮不修改
// 后端；vite 代理钩子无法弥补它。后端租约上限为 3，因此本测试不把“下一条
// 订阅成功”当作租约释放的证据——那没有证明力；也不等待 130s TTL，不用
// 重试掩盖。
// ---------------------------------------------------------------------------
const PROXY_CLOSE_EVENT = "[vite-proxy] upstream transport closed after client disconnect";

test("a browser abort of a proxied SSE subscription closes the proxy upstream transport, and the proxy log stays credential-free", async ({
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

  // secret 只回到测试进程内存做“日志不含原值”断言；绝不打印或落盘。
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
        secret: string;
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
          secret: ticket.secret,
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
      first.abort();
      await first.settled();
      return {
        generationId,
        firstStatus: first.status,
        firstContentType: first.contentType,
        firstEvents,
        firstSecret: first.secret,
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

  // 代理端及时关闭上游 transport：abort 后严格时限内出现固定关闭事件。
  // 事件行是唯一被读取的内容；测试不得把代理日志原文再次输出。
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
          const added = execSync(
            `tail -c +$(( ${Number(logSizeBefore)} + 1 )) ${h5Log}`,
          )
            .toString()
            .trim();
          return added.includes(PROXY_CLOSE_EVENT) ? PROXY_CLOSE_EVENT : "";
        } catch {
          return "";
        }
      },
      { timeout: 10_000, intervals: [200, 500] },
    )
    .toBe(PROXY_CLOSE_EVENT);

  // 脱敏判据（round11 P1-1）：新增日志片段不含查询串/凭据参数形状，也不含
  // 本次测试实际持有的 secret 原值。
  const addedLog = execSync(
    `tail -c +$(( ${Number(logSizeBefore)} + 1 )) ${h5Log}`,
  )
    .toString()
    .trim();
  expect(
    addedLog.includes("?"),
    "the added proxy log must not contain any query string",
  ).toBe(false);
  expect(addedLog.includes("secret="), "no secret= parameter in the log").toBe(false);
  expect(addedLog.includes("ticketId="), "no ticketId= parameter in the log").toBe(false);
  expect(
    addedLog.includes(report.firstSecret ?? "__no_secret__"),
    "the live secret value must never reach the proxy log",
  ).toBe(false);
});
