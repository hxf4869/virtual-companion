import { expect, test, type Page, type Route } from "@playwright/test";

import {
  navigateToPage,
  prepareGenerationAccess,
  provisionUser,
  uiLogin,
  type E2ESession,
  type E2EUserSuffix,
} from "../helpers";

// Journey 9（round6）——两个证据型测试：
//
// 1) 流式增量发布（浏览器级生产 transport）：通过 addInitScript 替换
//    window.fetch 仅劫持 /realtime/tickets 与 /realtime/streams/*，真实
//    ReadableStream 由测试逐帧 enqueue，连接在终态前始终保持打开。这证明
//    生产浏览器链路在同一连接内把 chat.delta 即时渲染为草稿；草稿至少
//    增长两次。
// 2) 长会话 A/B 切换：130/90 条合成历史的两个会话之间来回切换，
//    每次切换后"最新消息完整可见"，且不沿用上一个会话的 scrollTop。

const SHOTS6 = ".impeccable/review/round6";

type Box = { top: number; bottom: number; left: number; right: number; width: number; height: number };

interface SwitchGeometry {
  history: Box | null;
  assistantBubble: Box | null;
  assistantLastMid: string | null;
  draftCount: number;
  following: string | null;
  scrollTop: number;
}

async function measureSwitch(page: Page): Promise<SwitchGeometry> {
  return page.evaluate(() => {
    const box = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const historyEl = document.querySelector('[data-testid="history"]');
    const hv = historyEl?.getBoundingClientRect() ?? null;
    const assistants = document.querySelectorAll('[data-testid="chat-message"].assistant');
    const last = assistants[assistants.length - 1] ?? null;
    const bubble = last?.querySelector(".msg-content") ?? null;
    return {
      history: box(historyEl),
      assistantBubble: box(bubble),
      assistantLastMid:
        last instanceof HTMLElement
          ? (last as HTMLElement).dataset.mid ?? null
          : null,
      draftCount: document.querySelectorAll('[data-testid="draft"]').length,
      following: (historyEl as HTMLElement | null)?.dataset.following ?? null,
      scrollTop: (historyEl as HTMLElement)?.scrollTop ?? 0,
    };
  });
}

/** 最新正式助手消息完整落在 history 可视矩形内。 */
function assertLatestContained(m: SwitchGeometry, label: string): void {
  expect(m.history, `${label} history rendered`).not.toBeNull();
  expect(m.assistantBubble, `${label} assistant bubble rendered`).not.toBeNull();
  expect(m.assistantBubble!.top, `${label} assistant.top ≥ history.top`)
    .toBeGreaterThanOrEqual(m.history!.top - 0.5);
  expect(m.assistantBubble!.bottom, `${label} assistant.bottom ≤ history.bottom`)
    .toBeLessThanOrEqual(m.history!.bottom + 0.5);
}

interface SyntheticMsg {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
}

function makeSynthetic(total: number, conversationId: string, tag: string, tailText: string): SyntheticMsg[] {
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const isUser = n % 2 === 1;
    return {
      messageId: `${tag}-${String(n).padStart(3, "0")}`,
      conversationId,
      role: isUser ? "user" : "assistant",
      content:
        n >= total
          ? tailText
          : isUser
            ? `${tag} 问题 ${n}：今天也想慢慢聊聊日常。`
            : `${tag} 回复 ${n}：我在听，不急，慢慢说就好。`,
    };
  });
}

function syntheticListHandler(synthetic: SyntheticMsg[]) {
  return async (route: Route): Promise<void> => {
    const url = new URL(route.request().url());
    const after = url.searchParams.get("after");
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const startIdx = after ? synthetic.findIndex((m) => m.messageId === after) + 1 : 0;
    const slice =
      startIdx > 0 ? synthetic.slice(startIdx, startIdx + limit) : synthetic.slice(0, limit);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(slice),
    });
  };
}

/** 套跑共享登录来源桶（10 次/60 秒）：429 时做有界多次等待重试，
 * 不放宽任何断言。 */
async function uiLoginWithRetry(page: Page, user: { username: string; password: string }): Promise<E2ESession> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await uiLogin(page, user);
    } catch (err) {
      if (attempt >= 3 || !String(err).includes("429")) throw err;
      await page.waitForTimeout(65_000);
    }
  }
}

async function loginWithRelationship(
  page: Page,
  requestFixture: Parameters<typeof provisionUser>[0],
  suffix: E2EUserSuffix,
): Promise<{ session: E2ESession; relationshipId: string }> {
  const user = await provisionUser(requestFixture, suffix);
  const session = await uiLoginWithRetry(page, user);
  await prepareGenerationAccess(session.accessToken);

  await navigateToPage(page, "/pages/companion/companion");
  await page.getByTestId("persona-select").selectOption("gentle-listener");
  const relationshipResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/relationships$/.test(new URL(response.url()).pathname),
  );
  await page.getByTestId("create-relationship").click();
  const accepted = await relationshipResponse;
  expect(accepted.ok(), `relationship create failed: ${accepted.status()}`).toBeTruthy();
  const body = (await accepted.json()) as { relationshipId?: unknown };
  const relationshipId =
    typeof body.relationshipId === "string"
      ? body.relationshipId
      : String(body.relationshipId ?? "");
  expect(relationshipId).not.toBe("");
  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
    { timeout: 20_000 },
  );
  return { session, relationshipId };
}

test("in-browser production transport renders each delta while the SSE connection stays open", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  // P1-1（round6）：仅劫持 realtime endpoints 的 fetch 补丁——其余请求
  // （登录、关系、消息分页等）全部透传给原网络栈。
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    type Ctrl = {
      controller: ReadableStreamDefaultController<Uint8Array> | null;
      open: boolean;
      pending: string[];
      push(frame: string): void;
      close(): void;
    };
    const ctrl: Ctrl = {
      controller: null,
      open: false,
      pending: [],
      push(frame: string): void {
        if (this?.controller && this.open) {
          this.controller.enqueue(encoder.encode(frame));
        } else {
          this.pending.push(frame); // 连接尚未建立：暂存到 start 时冲刷
        }
      },
      close(): void {
        this.open = false;
        try {
          this.controller?.close();
        } catch {
          /* already closed */
        }
      },
    };
    (window as unknown as Record<string, unknown>).__sseCtrl = ctrl;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      let path = "";
      try {
        path = new URL(url, location.origin).pathname;
      } catch {
        path = url;
      }
      if (path.endsWith("/realtime/tickets")) {
        return new Response(JSON.stringify({ ticketId: "t-e2e", secret: "s-e2e" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path.includes("/realtime/streams/")) {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            ctrl.controller = c;
            ctrl.open = true;
            for (const frame of ctrl.pending.splice(0)) {
              c.enqueue(encoder.encode(frame));
            }
          },
          cancel() {
            ctrl.open = false;
          },
        });
        const signal = init?.signal ?? undefined;
        signal?.addEventListener(
          "abort",
          () => {
            ctrl.open = false;
            try {
              ctrl.controller?.error(new DOMException("aborted", "AbortError"));
            } catch {
              /* already errored */
            }
          },
          { once: true },
        );
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return originalFetch(input, init);
    };
  });

  await setViewport812x375(page);
  const { relationshipId } = await loginWithRelationship(page, request, "streaming-evidence");

  // 会话列表返回空 → 页面自建一个真实 conversation；generations POST 伪造；
  // 消息分页按会话提供合成历史，最后一条助手行携带与流式全文一致的内容。
  const CONV_ID = "e2e-conv-stream";
  const DRAFT_CHUNKS = [
    "夜色安静下来，",
    "我把今天的疲惫放在一边；",
    "你可以慢慢讲，我在这里。",
  ];
  const DRAFT_FULL = DRAFT_CHUNKS.join("");
  const USER_PROMPT = "今天有点累，想找人说说。";
  const messages = makeSynthetic(20, CONV_ID, "s", DRAFT_FULL);
  messages.unshift({
    messageId: "s-user-final",
    conversationId: CONV_ID,
    role: "user",
    content: USER_PROMPT,
  });

  await page.route(/\/api\/v1\/conversations(\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    // 创建会话走真实后端（conversationId 由服务端分配）。
    await route.fallback();
  });
  await page.route(/\/api\/v1\/conversations\/[^/]+\/messages/, syntheticListHandler(messages));
  await page.route(/\/api\/v1\/conversations\/[^/]+\/generations$/, async (route) => {
    expect(route.request().method()).toBe("POST");
    // 会话 id 直接取自请求路径（挂载时由真实后端创建）。
    const convId =
      new URL(route.request().url()).pathname.match(/conversations\/([^/]+)\/generations$/)?.[1] ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generationId: "gen-e2e-stream",
        conversationId: convId,
        logicalGenerationId: "lg-e2e-stream",
        status: "RUNNING",
        mode: "AUTO",
        createdAt: new Date().toISOString(),
      }),
    });
  });
  await page.route("**/api/v1/generations/gen-e2e-stream/snapshot**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        streamEpoch: 1,
        events: [
          { event: "chat.delta", eventSeq: 1, streamEpoch: 1, payload: DRAFT_FULL },
          { event: "chat.completed", eventSeq: 4, streamEpoch: 1, payload: "" },
        ],
      }),
    });
  });

  await navigateToPage(page, "/pages/chat/chat");
  await expect(page.getByTestId("conversation-panel")).toBeVisible();
  const input = page.locator('[data-testid="message-input"] input');
  await expect(input).toBeVisible();

  const frame = (event: string, seq: number, payload: unknown): string =>
    `event: ${event}\ndata: ${JSON.stringify({ event, eventSeq: seq, streamEpoch: 1, payload })}\n\n`;
  const pushFrame = (f: string): Promise<void> =>
    page.evaluate((raw) => {
      const ctrl = (window as unknown as Record<string, { push(f: string): void } | undefined>).__sseCtrl!;
      ctrl.push(raw);
    }, f);
  const connectionOpen = (): Promise<boolean> =>
    page.evaluate(() => {
      const ctrl = (window as unknown as Record<string, { open: boolean } | undefined>).__sseCtrl;
      return ctrl ? ctrl.open : false;
    });

  await input.fill(USER_PROMPT);
  await page.getByTestId("send").click();
  await expect(page.getByTestId("cancel")).toBeVisible({ timeout: 30_000 });
  expect(await connectionOpen(), "SSE connection held open by the app").toBe(true);

  // ---- 第一批 delta（连接仍打开）----
  await pushFrame(frame("chat.accepted", 1, {}));
  await pushFrame(frame("chat.delta", 2, DRAFT_CHUNKS[0]));
  await expect(page.getByTestId("draft")).toContainText(DRAFT_CHUNKS[0]!, { timeout: 15_000 });
  const lenAfterFirst = await page.evaluate(
    () => document.querySelector('[data-testid="draft"]')?.textContent?.length ?? 0,
  );
  expect(await connectionOpen(), "connection still open at first batch").toBe(true);

  // 短隔断后再推第二批：草稿必须继续增长（第 1 次增长）。
  await page.waitForTimeout(120);
  await pushFrame(frame("chat.delta", 3, DRAFT_CHUNKS[1]));
  await expect(page.getByTestId("draft")).toContainText(DRAFT_CHUNKS[1]!, { timeout: 15_000 });
  const lenAfterSecond = await page.evaluate(
    () => document.querySelector('[data-testid="draft"]')?.textContent?.length ?? 0,
  );
  expect(lenAfterSecond, "draft grows past the first batch").toBeGreaterThan(lenAfterFirst);

  // 连接打开窗口内的第一批证据截图。
  await page.screenshot({ path: `${SHOTS6}/chat-streaming-draft-1.png` });

  // 第 2 次增长，随后立即取证。
  await page.waitForTimeout(120);
  await pushFrame(frame("chat.delta", 4, DRAFT_CHUNKS[2]));
  await expect(page.getByTestId("draft")).toContainText(DRAFT_CHUNKS[2]!, { timeout: 15_000 });
  const lenThird = await page.evaluate(
    () => document.querySelector('[data-testid="draft"]')?.textContent?.length ?? 0,
  );
  expect(lenThird, "draft grows a second time in the same connection")
    .toBeGreaterThan(lenAfterSecond);
  expect(await connectionOpen(), "connection open through both growth observations").toBe(true);
  await page.screenshot({ path: `${SHOTS6}/chat-streaming-draft-2.png` });

  // 终态帧最后入队并关闭连接：completed、草稿消失、正式内容单份。
  await pushFrame(frame("chat.completed", 5, ""));
  await pushFrame(frame("chat.delta", 99, "__LATE_NEVER_APPLIED__")); // 冻结后的事件必须被忽略
  await page.evaluate(() => {
    const ctrl = (window as unknown as Record<string, { close(): void } | undefined>).__sseCtrl!;
    ctrl.close();
  });

  await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）", { timeout: 30_000 });
  await expect(page.locator('[data-testid="draft"]')).toHaveCount(0);
  const formalCount = await page.evaluate((full) => {
    let occurrences = 0;
    for (const node of document.querySelectorAll('[data-testid="chat-message"].assistant')) {
      const text = node.textContent ?? "";
      let idx = text.indexOf(full);
      while (idx !== -1) {
        occurrences += 1;
        idx = text.indexOf(full, idx + full.length);
      }
    }
    return occurrences;
  }, DRAFT_FULL);
  expect(formalCount, "formal committed content appears exactly once").toBe(1);
  await expect(
    page.locator('[data-testid="chat-message"].assistant').last(),
  ).toContainText(DRAFT_FULL.slice(-12));
  expect(await page.getAttribute('[data-testid="history"]', "data-following"), "follows latest on settle")
    .toBe("true");
});

function setViewport812x375(page: Page): Promise<void> {
  return page.setViewportSize({ width: 812, height: 375 });
}

test("switching between two long conversations always lands on the latest message", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const { relationshipId } = await loginWithRelationship(page, request, "streaming-evidence");

  // 两个长会话：A=130 条（默认打开），B=90 条。列表最后一项是挂载时自动
  // 打开的会话 → A 放最后。
  const A_ID = "e2e-conv-a";
  const B_ID = "e2e-conv-b";
  const A_TAIL = "A 会话的收尾回复：夜已经深了，我把灯留给你。";
  const B_TAIL = "B 会话的收尾回复：泡好的茶放在桌上，慢慢喝。";
  const convListHandler = async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          conversationId: B_ID,
          relationshipId,
          title: "长会话 B",
          lastMessagePreview: "泡好的茶放在桌上",
          createdAt: "2026-08-26T10:00:00Z",
        },
        {
          conversationId: A_ID,
          relationshipId,
          title: "长会话 A",
          lastMessagePreview: "夜已经深了",
          createdAt: "2026-08-27T02:00:00Z",
        },
      ]),
    });
  };

  const convA = makeSynthetic(130, A_ID, "a", A_TAIL);
  convA.unshift({
    messageId: "a-user-000",
    conversationId: A_ID,
    role: "user",
    content: "A 开场：从第一句话开始的长对话。",
  });
  const convB = makeSynthetic(90, B_ID, "b", B_TAIL);
  convB.unshift({
    messageId: "b-user-000",
    conversationId: B_ID,
    role: "user",
    content: "B 开场：另一段長长的陪伴记录。",
  });

  await page.route("**/api/v1/conversations?**", convListHandler);
  await page.route(/\/api\/v1\/conversations\/e2e-conv-a\/messages/, syntheticListHandler(convA));
  await page.route(/\/api\/v1\/conversations\/e2e-conv-b\/messages/, syntheticListHandler(convB));

  await navigateToPage(page, "/pages/chat/chat");
  await expect(page.getByTestId("conversation-panel")).toBeVisible();
  // 挂载后自动打开列表最后一项=A；等待 A 的尾部助手行真实挂载。
  await expect(page.locator('[data-testid="chat-message"].assistant').last())
    .toContainText(A_TAIL.slice(0, 12), { timeout: 30_000 });

  // 程序化滚离（如实命名）：锚点深入中段，ownership 转移给用户。
  await jumpToMiddle(page);
  await expect
    .poll(() => page.getAttribute('[data-testid="history"]', "data-following"), {
      timeout: 5_000,
      intervals: [60, 120],
    })
    .toBe("false");
  const midTopA = await page.evaluate(
    () => (document.querySelector('[data-testid="history"]') as HTMLElement)?.scrollTop ?? 0,
  );

  // 切到 B（列表第一项）：B 的最新消息必须完整可见，而不是沿用 A 中段。
  await page.locator('[data-testid="conversation-item"]').first().click();
  await expect(page.locator('[data-testid="chat-message"].assistant').last())
    .toContainText(B_TAIL.slice(0, 12), { timeout: 30_000 });
  await expect
    .poll(async () => (await measureSwitch(page)).following, { timeout: 8_000, intervals: [80, 160] })
    .toBe("true");
  // 收敛后再量：贴底跟随需要少量帧完成对齐。
  await expect
    .poll(
      async () => {
        const m = await measureSwitch(page);
        if (!m.assistantBubble || !m.history) return false;
        return (
          m.assistantBubble.top >= m.history.top - 0.5 &&
          m.assistantBubble.bottom <= m.history.bottom + 0.5
        );
      },
      { timeout: 8_000, intervals: [80, 160] },
    )
    .toBe(true);
  const bState = await measureSwitch(page);
  assertLatestContained(bState, "conversation B landing");
  expect(bState.draftCount).toBe(0);
  expect(bState.scrollTop, "B lands near its own tail, not A's middle")
    .toBeGreaterThanOrEqual(midTopA);
  await page.screenshot({ path: `${SHOTS6}/chat-conversation-switch-latest.png` });

  // 反向切回 A：同样落到 A 的最新消息。
  await page.locator('[data-testid="conversation-item"]').nth(1).click();
  await expect(page.locator('[data-testid="chat-message"].assistant').last())
    .toContainText(A_TAIL.slice(0, 12), { timeout: 30_000 });
  await expect
    .poll(async () => (await measureSwitch(page)).following, { timeout: 8_000, intervals: [80, 160] })
    .toBe("true");
  await expect
    .poll(
      async () => {
        const m = await measureSwitch(page);
        if (!m.assistantBubble || !m.history) return false;
        return (
          m.assistantBubble.top >= m.history.top - 0.5 &&
          m.assistantBubble.bottom <= m.history.bottom + 0.5
        );
      },
      { timeout: 8_000, intervals: [80, 160] },
    )
    .toBe(true);
  const aAgain = await measureSwitch(page);
  assertLatestContained(aAgain, "conversation A re-entry");
  expect(aAgain.draftCount).toBe(0);
  expect(aAgain.scrollTop, "re-entered A also lands on its tail")
    .toBeGreaterThanOrEqual(midTopA);
});

/** 程序化跳转到内容中段（P1-5 #7 如实命名）：制造“用户已滚离”的布局前提。 */
async function jumpToMiddle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
    if (!el) return;
    el.scrollTop = Math.round(el.scrollHeight * 0.4);
  });
}
