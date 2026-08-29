import { expect, test, type Page, type Route } from "@playwright/test";

import {
  navigateToPage,
  prepareGenerationAccess,
  provisionUser,
  uiLogin,
  type E2ESession,
  type E2EUserSuffix,
} from "../helpers";

// Journey 9（round7）——三个证据型测试：
//
// 1) 流式增量 + 真实服务端终态形态（浏览器级生产 transport）：
//    addInitScript 劫持 window.fetch 仅接管 /realtime/tickets 与
//    /realtime/streams/*，测试逐帧 enqueue 真实 ReadableStream 字节。
//    终态按 0184 runtime 的真实形态发送——`event: snapshot` 元数据帧不含
//    events，服务端只补发 cursor 后的 terminal 尾巴；预置历史中绝不出现
//    流式全文，正式回复只有在终态之后才由分页路由放出，因此
//    formalCount===1 只能由"本轮真实提交"满足。
// 2) 快速连续切换会话（stale response 串写）：点击 B（其分页被路由延迟
//    挂起），不等它返回立即点回 A；最终视图必须只含当前会话的消息，
//    迟到的 B 响应不得改写消息、标题镜像或贴底锚。
// 3) 稳定候选的前置验证（round7 六）：任何程序化滚动之前先断言
//    following=true / followRun=idle / draftCount=0 且几何 ≥320ms 不变，
//    然后才允许滚动；chat-812x375-settled.png 紧接该断言生成。

const SHOTS = ".impeccable/review/round7";

type Box = { top: number; bottom: number; left: number; right: number; width: number; height: number };

interface SwitchGeometry {
  history: Box | null;
  assistantBubble: Box | null;
  assistantLastMid: string | null;
  mids: string[];
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
    const assistants = Array.from(
      document.querySelectorAll('[data-testid="chat-message"].assistant'),
    ) as HTMLElement[];
    const last = assistants[assistants.length - 1] ?? null;
    const bubble = last?.querySelector(".msg-content") ?? null;
    return {
      history: box(historyEl),
      assistantBubble: box(bubble),
      assistantLastMid: last?.dataset.mid ?? null,
      mids: assistants.map((n) => n.dataset.mid ?? ""),
      draftCount: document.querySelectorAll('[data-testid="draft"]').length,
      // following 由几何推导：距底 ≤48px 即视为跟随（与页面的回底阈值一致）。
      following:
        (historyEl as HTMLElement | null) === null
          ? null
          : (historyEl as HTMLElement).scrollHeight -
              (historyEl as HTMLElement).scrollTop -
              (historyEl as HTMLElement).clientHeight <=
            48
          ? "true"
          : "false",
      scrollTop: (historyEl as HTMLElement)?.scrollTop ?? 0,
    };
  });
}

/**
 * round7：containment 必须在连续 N 个采样（间隔 ~150ms）里都成立才采信，
 * 避免把收敛过程中的瞬时帧当作终态证据。返回最后一个稳定样本供断言。
 */
async function assertLatestContainedStable(
  page: Page,
  label: string,
  opts: { samples?: number; interval?: number; timeout?: number } = {},
): Promise<SwitchGeometry> {
  const need = opts.samples ?? 3;
  const interval = opts.interval ?? 150;
  let streak = 0;
  let lastStable: SwitchGeometry | null = null;
  await expect
    .poll(
      async () => {
        const m = await measureSwitch(page);
        if (!m.assistantBubble || !m.history) {
          streak = 0;
          return false;
        }
        const contained =
          m.assistantBubble.top >= m.history.top - 0.5 &&
          m.assistantBubble.bottom <= m.history.bottom + 0.5;
        if (contained) {
          streak += 1;
          lastStable = m;
        } else {
          streak = 0;
        }
        return streak >= need;
      },
      { timeout: opts.timeout ?? 12_000, intervals: [interval, interval * 2] },
    )
    .toBe(true);
  expect(lastStable, `${label} stable sample captured`).not.toBeNull();
  assertLatestContained(lastStable!, label);
  return lastStable!;
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

/**
 * 页头/标题/会话元数据稳定后再截图：字体就绪 + 连续两帧几何一致 +
 * 320ms 无布局变化。仅取 chrome 区域盒子对比，避免内容驱动抖动误判。
 */
async function waitForChromeStable(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.waitForFunction(
    () => {
      const key = (el: Element | null): string => {
        if (!el) return "";
        const r = el.getBoundingClientRect();
        return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      };
      const chrome = [
        document.querySelector('[data-testid="history"]'),
        document.querySelector(".chat-page"),
        document.querySelector("uni-page__header") ?? document.querySelector("uni-page"),
      ].map((el) => key(el));
      const w = window as unknown as Record<string, string | undefined>;
      const stamp = JSON.stringify(chrome);
      if (w.__chromeStamp !== stamp) {
        w.__chromeStamp = stamp;
        w.__chromeSince = String(Date.now());
        return false;
      }
      return Date.now() - Number(w.__chromeSince ?? "0") >= 320;
    },
    { timeout: 15_000, polling: 60 },
  );
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

/** 计数所有正式助手行中出现 full 的次数（子串重复也如实计数）。 */
function formalOccurrences(page: Page, full: string): Promise<number> {
  return page.evaluate((fullText) => {
    let occurrences = 0;
    for (const node of document.querySelectorAll('[data-testid="chat-message"].assistant')) {
      const text = node.textContent ?? "";
      let idx = text.indexOf(fullText);
      while (idx !== -1) {
        occurrences += 1;
        idx = text.indexOf(fullText, idx + fullText.length);
      }
    }
    return occurrences;
  }, full);
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

test("in-browser transport streams deltas and completes through a real snapshot-metadata tail", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  // 仅劫持 realtime endpoints 的 fetch 补丁——其余请求全部透传。
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
  // 消息分页按会话提供合成历史。种子收尾与流式全文刻意不同，并且分页路由
  // 只在终态后才把本轮正式回复放进返回页——formalCount 从此不可能假绿。
  const CONV_ID = "e2e-conv-stream";
  const DRAFT_CHUNKS = [
    "夜色安静下来，",
    "我把今天的疲惫放在一边；",
    "你可以慢慢讲，我在这里。",
  ];
  const DRAFT_FULL = DRAFT_CHUNKS.join("");
  const USER_PROMPT = "今天有点累，想找人说说。";
  const SEED_TAIL = "这条会话此前的最后一条历史回复。";
  const messages = makeSynthetic(20, CONV_ID, "s", SEED_TAIL);
  messages.unshift({
    messageId: "s-user-final",
    conversationId: CONV_ID,
    role: "user",
    content: USER_PROMPT,
  });
  // 终态后释放的本轮正式回复（服务端提交形态）。
  let formalReleased = false;

  await page.route(/\/api\/v1\/conversations(\?.*)?$/, async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    await route.fallback(); // 创建会话走真实后端
  });
  await page.route(/\/api\/v1\/conversations\/[^/]+\/messages/, async (route: Route) => {
    const url = new URL(route.request().url());
    const after = url.searchParams.get("after");
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const view = formalReleased ? [...messages, {
      messageId: "s-formal-commit",
      conversationId: CONV_ID,
      role: "assistant",
      content: DRAFT_FULL,
    }] : messages;
    const startIdx = after ? view.findIndex((m) => m.messageId === after) + 1 : 0;
    const slice =
      startIdx > 0 ? view.slice(startIdx, startIdx + limit) : view.slice(0, limit);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(slice),
    });
  });
  await page.route(/\/api\/v1\/conversations\/[^/]+\/generations$/, async (route: Route) => {
    expect(route.request().method()).toBe("POST");
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

  await navigateToPage(page, "/pages/chat/chat");
  const input = page.locator('[data-testid="message-input"] textarea');
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

  // ---- 终态前：正式回复绝不存在 ----
  expect(await formalOccurrences(page, DRAFT_FULL), "no committed copy before terminal")
    .toBe(0);

  // 第一批 delta（连接仍打开）。
  await pushFrame(frame("chat.accepted", 1, {}));
  await pushFrame(frame("chat.delta", 2, DRAFT_CHUNKS[0]));
  await expect(page.getByTestId("draft")).toContainText(DRAFT_CHUNKS[0]!, { timeout: 15_000 });
  expect(await formalOccurrences(page, DRAFT_FULL)).toBe(0);
  expect(await connectionOpen(), "connection still open at first batch").toBe(true);

  // 第二批：草稿增长一次。
  await page.waitForTimeout(120);
  await pushFrame(frame("chat.delta", 3, DRAFT_CHUNKS[1]));
  await expect(page.getByTestId("draft")).toContainText(DRAFT_CHUNKS[1]!, { timeout: 15_000 });
  const lenAfterSecond = await page.evaluate(
    () => document.querySelector('[data-testid="draft"]')?.textContent?.length ?? 0,
  );
  expect(lenAfterSecond).toBeGreaterThan(DRAFT_CHUNKS[0]!.length);
  await waitForChromeStable(page);
  await page.screenshot({ path: `${SHOTS}/streaming-draft-1.png` });

  // 第三批：草稿第二次增长；连接仍开着。
  await page.waitForTimeout(120);
  await pushFrame(frame("chat.delta", 4, DRAFT_CHUNKS[2]));
  await expect(page.getByTestId("draft")).toContainText(DRAFT_CHUNKS[2]!, { timeout: 15_000 });
  const lenThird = await page.evaluate(
    () => document.querySelector('[data-testid="draft"]')?.textContent?.length ?? 0,
  );
  expect(lenThird, "draft grows a second time in the same connection")
    .toBeGreaterThan(lenAfterSecond);
  expect(await connectionOpen(), "connection open through both growth observations").toBe(true);
  await waitForChromeStable(page);
  await page.screenshot({ path: `${SHOTS}/streaming-draft-2.png` });

  // ---- 真实服务端终态形态：snapshot 元数据（无 events）+ cursor 后尾巴 ----
  formalReleased = true; // 只有终态后的分页才会放回正式回复
  await pushFrame('event: snapshot\ndata: {"status":"COMPLETED","generationId":101}\n\n');
  await pushFrame(frame("chat.completed", 5, ""));
  // 冻结之后的迟到事件与控制帧都不得改变结果。
  await pushFrame(frame("chat.delta", 99, "__LATE_NEVER_APPLIED__"));
  await pushFrame("event: stream.gap\n\n");
  await page.evaluate(() => {
    const ctrl = (window as unknown as Record<string, { close(): void } | undefined>).__sseCtrl!;
    ctrl.close();
  });

  await expect(page.getByTestId("assistant-md").filter({ hasText: DRAFT_FULL }).last()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="draft"]')).toHaveCount(0);
  // 正式回复恰好一份（终态后 store 会重开分页拉取提交行——轮询直到出现，
  // 再钉死"恰好一份"）；迟到的标记文本无处可寻。
  await expect
    .poll(async () => formalOccurrences(page, DRAFT_FULL), {
      timeout: 20_000,
      intervals: [200, 400],
    })
    .toBe(1);
  await page.waitForTimeout(400); // 迟到写入窗口
  expect(await formalOccurrences(page, DRAFT_FULL), "stays exactly one").toBe(1);
  expect((await page.content()).includes("__LATE_NEVER_APPLIED__")).toBe(false);
  await expect(
    page.locator('[data-testid="chat-message"].assistant').last(),
  ).toContainText(DRAFT_FULL.slice(-12));
  // 终态提交行 append 与跟随落底帧之间有一帧间隙：轮询等待落底完成。
  await expect
    .poll(async () => (await measureSwitch(page)).following, { timeout: 8_000, intervals: [80, 160] })
    .toBe("true");
  expect((await measureSwitch(page)).following, "follows latest on settle")
    .toBe("true");

  await waitForChromeStable(page);
  await page.screenshot({ path: `${SHOTS}/streaming-terminal.png` });
});

function setViewport812x375(page: Page): Promise<void> {
  return page.setViewportSize({ width: 812, height: 375 });
}

test("rapid conversation switching never lets a stale response paint the wrong window", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await setViewport812x375(page);
  const { relationshipId } = await loginWithRelationship(page, request, "streaming-evidence");

  // A=130 条（默认打开），B=90 条但首个分页响应被路由层延迟挂起。
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
    content: "B 开场：另一段长长的陪伴记录。",
  });

  let bDelayMs = 0; // >0 时让 B 的分页挂起一段时间再返回

  const bMessagesHandler = async (route: Route): Promise<void> => {
    if (bDelayMs > 0) {
      const wait = bDelayMs;
      bDelayMs = 0; // 只延迟第一次
      await page.waitForTimeout(wait);
    }
    const url = new URL(route.request().url());
    const after = url.searchParams.get("after");
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const startIdx = after ? convB.findIndex((m) => m.messageId === after) + 1 : 0;
    const slice =
      startIdx > 0 ? convB.slice(startIdx, startIdx + limit) : convB.slice(0, limit);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(slice),
    });
  };

  await page.route("**/api/v1/conversations?**", convListHandler);
  await page.route(/\/api\/v1\/conversations\/e2e-conv-a\/messages/, async (route: Route) => {
    const url = new URL(route.request().url());
    const after = url.searchParams.get("after");
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const startIdx = after ? convA.findIndex((m) => m.messageId === after) + 1 : 0;
    const slice =
      startIdx > 0 ? convA.slice(startIdx, startIdx + limit) : convA.slice(0, limit);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(slice),
    });
  });
  await page.route(/\/api\/v1\/conversations\/e2e-conv-b\/messages/, bMessagesHandler);

  await navigateToPage(page, "/pages/chat/chat");
  await expect(page.locator('[data-testid="message-input"] textarea')).toBeVisible();
  await expect(page.locator('[data-testid="chat-message"].assistant').last())
    .toContainText(A_TAIL.slice(0, 12), { timeout: 30_000 });

  // 先把视口推离底部并交还给用户（如实命名：程序化跳转制造前提）。
  await jumpToMiddle(page);
  await expect
    .poll(async () => (await measureSwitch(page)).following, {
      timeout: 5_000,
      intervals: [60, 120],
    })
    .toBe("false");
  const midTopA = await page.evaluate(
    () => (document.querySelector('[data-testid="history"]') as HTMLElement)?.scrollTop ?? 0,
  );

  // ---- 快速连续点击：B 挂起 → 不等结果立刻切回 A ----
  // 会话切换收进"更多"菜单：每次切换 = 打开菜单 → 点会话（菜单自动关闭）。
  bDelayMs = 2_800;
  await page.getByTestId("chat-context-open").click();
  await page.locator('[data-testid="conversation-item"]').first().click();
  // 不等 B 的任何内容，直接点回 A。
  await page.getByTestId("chat-context-open").click();
  await expect(page.locator('[data-testid="conversation-item"]').first()).toBeVisible();
  await page.locator('[data-testid="conversation-item"]').nth(1).click();

  // 当前窗口只能是 A：所有正式助手行的 messageId 都是 a-*；
  // follow 收敛到最新消息且完整可见。
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
  const aFinal = await assertLatestContainedStable(page, "rapid switch final window");
  expect(aFinal.mids.length, "window renders messages").toBeGreaterThan(0);
  expect(aFinal.mids.filter((mid) => !mid.startsWith("a-")), "only A's own messageIds")
    .toEqual([]);
  expect(aFinal.draftCount).toBe(0);

  // B 的迟到响应在此期间落回来——窗口必须原封不动。
  await page.waitForTimeout(4_000);
  const afterStale = await measureSwitch(page);
  expect(afterStale.mids.filter((mid) => !mid.startsWith("a-")))
    .toEqual([]);
  expect(afterStale.mids.length).toBe(aFinal.mids.length);
  expect(afterStale.assistantLastMid).toBe(aFinal.assistantLastMid);
  expect(afterStale.draftCount).toBe(0);
  expect(afterStale.scrollTop, "scrollTop not yanked by stale B chain")
    .toBeGreaterThanOrEqual(midTopA);

  await waitForChromeStable(page);
  await page.screenshot({ path: `${SHOTS}/rapid-conversation-switch-final.png` });

  // 反向核对仍可用：手动切到 B，等它的真实返回，尾部完整可见。
  await page.getByTestId("chat-context-open").click();
  await expect(page.locator('[data-testid="conversation-item"]').first()).toBeVisible();
  await page.locator('[data-testid="conversation-item"]').first().click();
  await expect(page.locator('[data-testid="chat-message"].assistant').last())
    .toContainText(B_TAIL.slice(0, 12), { timeout: 30_000 });
  await expect
    .poll(async () => (await measureSwitch(page)).following, { timeout: 8_000, intervals: [80, 160] })
    .toBe("true");
  const bState = await assertLatestContainedStable(page, "conversation B landing");
  expect(bState.scrollTop, "B lands near its own tail, not A's middle")
    .toBeGreaterThanOrEqual(midTopA);
});

/** 程序化跳转到内容中段（如实命名）：制造“用户已滚离”的布局前提。 */
async function jumpToMiddle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
    if (!el) return;
    el.scrollTop = Math.round(el.scrollHeight * 0.4);
  });
}
