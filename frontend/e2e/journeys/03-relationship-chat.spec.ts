import { expect, test, type Page, type Route } from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  prepareGenerationAccess,
  PROVIDER_REPLY,
  provisionUser,
  uiLogin,
  type E2ESession,
  type E2EUser,
} from "../helpers";

// Journey 3 — create the first relationship in the H5, then complete one
// generation through the real runtime, worker, provider adapter and Fetch-SSE.
test("a user can create a relationship and complete a real chat turn", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "relationship-chat");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.accessToken);

  // 统一创建流程在陪伴设置页（前端产品化重构 Phase 3）；聊天空态只提供
  // 跳转入口。
  await navigateToPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("relationship-selector")).toBeVisible();

  const persona = page.getByTestId("persona-select");
  await expect(persona).toBeEnabled();
  await persona.selectOption("gentle-listener");
  await page.getByTestId("create-relationship").click();

  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
  );

  await navigateToPage(page, "/pages/chat/chat");
  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
  );
  await expect(page.getByTestId("conversation-panel")).toBeVisible();

  const prompt = "今天有点忙，想慢慢聊一会儿。";
  const generationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/conversations\/\d+\/generations$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.locator('[data-testid="message-input"] input').fill(prompt);
  await page.getByTestId("send").click();

  const accepted = await generationResponse;
  expect(accepted.ok(), `generation create failed: ${accepted.status()}`).toBeTruthy();
  expect(accepted.headers()["x-request-id"]).toBeTruthy();

  await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）");
  await expect(page.getByTestId("assistant-md")).toHaveCount(1);
  await expect(page.getByTestId("assistant-md")).toContainText(PROVIDER_REPLY);
  await expect(page.locator('[data-testid="chat-message"].user').filter({ hasText: prompt })).toHaveCount(1);
  await expect(page.locator('[data-testid="chat-message"].assistant')).toHaveCount(1);

  // The shipped phone viewport must not require page-level horizontal scroll.
  const geometry = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
});

// P1-2 回归：聊天消息 → 举报页深链（hash 路由携带 messageId）→ 最终提交
// 载荷必须包含正确的 messageId。举报页从 location.hash 读取，不再只读
// location.search。
test("a message report deep link carries messageId into the submit payload", async ({
  page,
  request,
}) => {
  // 全量套跑时登录来源桶（10 次/60 秒）可能被前面的 journey 占满；
  // 限流是真实行为，做一次有界等待重试，不放宽任何断言。
  test.setTimeout(180_000);
  const user = await provisionUser(request, "relationship-chat");
  let session: Awaited<ReturnType<typeof uiLogin>>;
  try {
    session = await uiLogin(page, user);
  } catch (err) {
    if (!String(err).includes("429")) throw err;
    await page.waitForTimeout(65_000);
    session = await uiLogin(page, user);
  }
  await prepareGenerationAccess(session.accessToken);

  await navigateToPage(page, "/pages/companion/companion");
  await page.getByTestId("persona-select").selectOption("gentle-listener");
  await page.getByTestId("create-relationship").click();
  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
  );

  await navigateToPage(page, "/pages/chat/chat");
  const input = page.locator('[data-testid="message-input"] input');
  await expect(input).toBeVisible();
  await input.fill("这条消息将被举报");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）", {
    timeout: 30_000,
  });

  // 消息级"更多"展开后进入举报说明，再打开举报页。
  const firstUser = page.locator('[data-testid="chat-message"]').filter({
    hasText: "这条消息将被举报",
  });
  await firstUser.getByTestId(/msg-more-/).click();
  await firstUser.getByTestId(/msg-report-/).first().click();
  await firstUser.getByTestId("msg-report-open-page").click();

  await expect(page.getByTestId("report-anchor")).toBeVisible();
  const messageId = (await page.url()).match(/messageId=([^&/]+)/)?.[1] ?? "";
  expect(messageId).not.toBe("");

  await page.getByTestId("report-note").locator("textarea, input").first()
    .fill("举报回归：消息内容让我不安");
  const payloadPromise = page.waitForRequest(
    (req) =>
      req.method() === "POST" &&
      new URL(req.url()).pathname === "/api/v1/reports",
  );
  await page.getByTestId("report-submit").click();
  const body = (await payloadPromise).postDataJSON() as { messageId?: string };
  expect(body.messageId).toBe(messageId);
});

// ---------------------------------------------------------------------------
// P1/P2（round5）共享工具：更严格、禁止假绿的几何测量与断言。
// 纪律：等待只允许用于视口切换过渡与终局轮询上限，绝不允许用来绕过
// 首手势竞争或伪造稳定（稳定性必须连续采样证明）。
// ---------------------------------------------------------------------------

type Box = {
  top: number; bottom: number; left: number; right: number;
  width: number; height: number;
};

interface Geometry {
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  windowScrollY: number;
  docScrollTop: number;
  header: Box | null;
  inputArea: Box | null;
  nativeInput: Box | null;
  send: Box | null;
  cancel: Box | null;
  retry: Box | null;
  history: Box | null;
  historyClientHeight: number;
  /** 与 history 可视区相交且面积>36px² 的真实消息（显式断言非空）。 */
  visibleMessages: Box[];
  /** 与 visibleMessages 对齐的可见 messageId 序列（DOM 顺序）。 */
  visibleIds: string[];
  /** 最新正式助手消息的正文气泡盒。 */
  assistantBox: Box | null;
  /** 最新真实用户消息的整盒。 */
  userBox: Box | null;
  userIntersectHeight: number;
  draftCount: number;
  assistantCount: number;
  feedbackRow: Box | null;
  modeRow: Box | null;
  interiorScrollContainers: string[];
  outerShellScrolled: string[];
}

async function measure(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const box = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        width: r.width, height: r.height,
      };
    };
    const historyEl = document.querySelector('[data-testid="history"]');
    const hv = historyEl?.getBoundingClientRect() ?? null;

    // “可见”必须真实成立：与 history 可视区相交面积 > 6×6px 才计入，
    // 且调用方必须显式断言非空（禁止空数组假绿）。
    const visibleMessages: Box[] = [];
    const visibleIds: string[] = [];
    let userBox: Box | null = null;
    let userIntersectHeight = 0;
    if (hv) {
      for (const node of document.querySelectorAll('[data-testid="chat-message"]')) {
        const b = box(node);
        if (!b) continue;
        const overlap =
          Math.min(b.bottom, hv.bottom) - Math.max(b.top, hv.top);
        if (overlap <= 6 || Math.min(b.right, hv.right) - Math.max(b.left, hv.left) <= 6) {
          continue;
        }
        visibleMessages.push(b);
        const mid = (node as HTMLElement).dataset.mid ?? "";
        visibleIds.push(mid);
        if (node.classList.contains("user")) {
          userBox = b;
          userIntersectHeight = overlap;
        }
      }
    }

    // 最新正式助手消息 = 最后一个 assistant 气泡（draft 不是正式消息）。
    const assistants = document.querySelectorAll('[data-testid="chat-message"].assistant');
    // 盒子取“回复正文气泡”（不含角色标签与"更多"操作行）——“回复完整可见”
    // 指内容本体；整行高度随消息级操作按钮变化，不构成可读性约束。
    const assistantBubble =
      assistants[assistants.length - 1]?.querySelector(".msg-content") ?? null;

    // 内层：chat-main 及其后代里任何可纵向滚动的容器；外层：document/
    // body/uni-app 外壳不得出现第二个纵向滚动或被滚走。
    const interior: string[] = [];
    for (const el of document.querySelectorAll(".chat-main, .chat-main *")) {
      const s = getComputedStyle(el);
      if (
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight
      ) {
        interior.push(String((el as HTMLElement).className));
      }
    }
    const outer: string[] = [];
    for (const el of [
      document.scrollingElement ?? document.documentElement,
      document.body,
      ...document.querySelectorAll("uni-app, uni-page, uni-page-wrapper, uni-page-body"),
    ]) {
      const node = el as HTMLElement;
      if (!node) continue;
      if (node.scrollHeight > node.clientHeight + 1 && node.scrollTop !== 0) {
        outer.push(`${node.tagName}:scrollTop=${node.scrollTop}`);
      } else if (getComputedStyle(node).overflowY === "scroll") {
        outer.push(`${node.tagName}:overflowY=scroll`);
      }
    }

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      windowScrollY: window.scrollY,
      docScrollTop: (document.scrollingElement as HTMLElement | null)?.scrollTop ?? 0,
      header: box(document.querySelector(".chat-header")),
      inputArea: box(document.querySelector(".chat-input-area")),
      nativeInput: box(document.querySelector('[data-testid="message-input"] input')),
      send: box(document.querySelector('[data-testid="send"]')),
      cancel: box(document.querySelector('[data-testid="cancel"]')),
      retry: box(document.querySelector('[data-testid="retry"]')),
      history: box(historyEl),
      historyClientHeight: (historyEl as HTMLElement | null)?.clientHeight ?? 0,
      visibleMessages,
      visibleIds,
      assistantBox: box(assistantBubble),
      userBox,
      userIntersectHeight,
      draftCount: document.querySelectorAll('[data-testid="draft"]').length,
      assistantCount: assistants.length,
      feedbackRow: box(document.querySelector('[data-testid="feedback-row"]')),
      modeRow: box(document.querySelector('[data-testid="mode-row"]')),
      interiorScrollContainers: interior,
      outerShellScrolled: outer,
    };
  });
}

function assertCoreGeometry(
  m: Geometry,
  label: string,
  opts: {
    assistantCount?: number;
    /** 短横屏把整屏让给堆叠条件头/顶部行时，消息可为零的合法例外。 */
    allowNoVisibleMessages?: boolean;
  } = {},
): void {
  // 外壳零滚动：window.scrollY 与 scrollingElement 都必须是 0。
  expect(m.windowScrollY, `${label} window.scrollY`).toBe(0);
  expect(m.docScrollTop, `${label} document.scrollTop`).toBe(0);
  // 整页无横向溢出。
  expect(m.scrollWidth, `${label} scrollWidth`).toBeLessThanOrEqual(m.viewportWidth);
  // 页头完整在视口内（不随内容滚动）。
  expect(m.header!.top, `${label} header top`).toBeGreaterThanOrEqual(-0.5);
  expect(m.header!.bottom, `${label} header bottom`).toBeLessThanOrEqual(m.viewportHeight + 0.5);
  // 输入栏：独立区域，完整落在视口底部。
  expect(m.inputArea, `${label} inputArea box`).not.toBeNull();
  expect(m.inputArea!.top, `${label} inputArea top`).toBeGreaterThanOrEqual(0);
  expect(m.inputArea!.bottom, `${label} inputArea bottom`)
    .toBeLessThanOrEqual(m.viewportHeight + 0.5);
  expect(m.nativeInput!.height, `${label} input height`).toBeGreaterThanOrEqual(44);
  expect(m.nativeInput!.bottom, `${label} input bottom`).toBeLessThanOrEqual(m.viewportHeight + 0.5);
  expect(m.send!.height, `${label} send height`).toBeGreaterThanOrEqual(44);
  expect(m.send!.bottom, `${label} send bottom`).toBeLessThanOrEqual(m.viewportHeight + 0.5);
  for (const [name, b] of [["cancel", m.cancel], ["retry", m.retry]] as const) {
    if (b) {
      expect(b.height, `${label} ${name} height`).toBeGreaterThanOrEqual(44);
      expect(b.bottom, `${label} ${name} bottom`).toBeLessThanOrEqual(m.viewportHeight + 0.5);
    }
  }
  // history 与输入栏零覆盖，也不压到页头之下。
  expect(m.history!.bottom, `${label} history bottom`)
    .toBeLessThanOrEqual(m.inputArea!.top + 0.5);
  expect(m.history!.top, `${label} history top`).toBeGreaterThanOrEqual(m.header!.bottom - 0.5);
  expect(m.historyClientHeight, `${label} history client height`).toBeGreaterThan(60);
  // P2（round5）显式非零断言：可视区内必须有真实挂载的消息（本文件被测
  // 的内容承载状态至少有一条已落库内容），空数组不得继续通过。唯一的
  // 合法例外是“短视口顶部被条件系统行占满”的展示态。
  if (!opts.allowNoVisibleMessages) {
    expect(
      m.visibleMessages.length,
      `${label} visible messages must be non-zero`,
    ).toBeGreaterThan(0);
    expect(m.visibleIds.length, `${label} visible ids mirror boxes`)
      .toBe(m.visibleMessages.length);
  }
  // 完成态不能残留流式草稿；正式助手回复份数按状态裁定（单轮会话传 1，
  // 其余状态不计数——虚拟窗口会挂载多条历史行）。
  expect(m.draftCount, `${label} completed draft count`).toBe(0);
  if (opts.assistantCount !== undefined) {
    expect(m.assistantCount, `${label} formal assistant count`).toBe(opts.assistantCount);
  }
  // 单一纵向滚动 ownership：内容溢出时唯一可滚容器是 chat-history；
  // 外壳无第二滚动。
  for (const cls of m.interiorScrollContainers) {
    expect(cls, `${label} scrollable container class`).toContain("chat-history");
  }
  expect(m.outerShellScrolled, `${label} outer shell scrolled`).toEqual([]);
}

/** 锚定态验收：最新正式助手回复完整落在 history 可视矩形内。 */
function assertAnchoredLatest(m: Geometry, label: string): void {
  expect(m.assistantBox, `${label} assistant present`).not.toBeNull();
  expect(
    m.assistantBox!.top,
    `${label} assistant.top >= history.top`,
  ).toBeGreaterThanOrEqual(m.history!.top - 0.5);
  expect(
    m.assistantBox!.bottom,
    `${label} assistant.bottom <= history.bottom`,
  ).toBeLessThanOrEqual(m.history!.bottom + 0.5);
}

async function setViewport(page: Page, w: number, h: number): Promise<void> {
  // 视口切换的布局/RO 过渡 allowance；不是手势或稳定性的替代品。
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(250);
  // round8（四）：round7 的 width-before 实际渲染为 800x384——几何证据必须
  // 以真实视口为前提，此后每次切宽立即断言 Playwright 实际视口精确匹配。
  const actual = page.viewportSize();
  expect(
    actual && actual.width === w && actual.height === h,
    `viewport must be exactly ${w}x${h}, got ${JSON.stringify(actual)}`,
  ).toBe(true);
}

/** 程序化跳转（顶部/底部）；不内置等待——调用方用轮询判定后续状态。 */
async function jumpHistory(page: Page, position: "top" | "bottom"): Promise<void> {
  const result = await page.evaluate((pos) => {
    const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
    if (!el) return null;
    const target = pos === "top" ? 0 : el.scrollHeight;
    el.scrollTop = target;
    return el.scrollTop;
  }, position);
  if (result === null) throw new Error("history element missing for jump");
}

async function historyRectCenter(page: Page): Promise<{ x: number; y: number }> {
  const rect = await page.evaluate(() => {
    const r = document
      .querySelector('[data-testid="history"]')
      ?.getBoundingClientRect();
    return r ? { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 } : null;
  });
  expect(rect, "history rendered").not.toBeNull();
  return rect!;
}


/** 真实滚轮把消息区滚到内容顶部（用户手势语义），供头部横幅可达检查。 */
async function wheelUpToTop(page: Page): Promise<void> {
  const rect = await historyRectCenter(page);
  await page.mouse.move(rect.x, rect.y);
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, -2600);
    await page.waitForTimeout(140);
  }
}


/** 程序化修正（P1-5 #7 如实命名）：若锚定静止位裁到最新用户消息之外，
 * 做一次 history 内程序化滚动把它带入可视区——这是可读性兜底检查，
 * 不冒充用户手势；用轮询而不是 sleep 判定结果。 */
async function ensureLatestUserVisible(page: Page): Promise<Geometry> {
  const start = await measure(page);
  if (start.userBox && start.userIntersectHeight > 10) return start;
  // 分段上滚：170px 起步，必要时加倍一次；全程用轮询判定结果。
  for (const dy of [170, 340]) {
    await page.evaluate((d) => {
      const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
      if (!el || el.scrollHeight <= el.clientHeight) return;
      el.scrollTop = Math.max(0, el.scrollTop - d);
    }, dy);
    await expect
      .poll(
        async () => (await measure(page)).userIntersectHeight,
        { timeout: 5_000, intervals: [100, 200] },
      )
      .toBeGreaterThan(10);
    return measure(page);
  }
  return measure(page);
}

/** 滚离场景下的“一次滚动可达”：程序化上滚一屏内并轮询最新用户消息相交。 */
async function ensureLatestUserVisibleAfterScrollable(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
    if (!el || el.scrollHeight <= el.clientHeight) return;
    el.scrollTop = Math.max(0, el.scrollTop - 220);
  });
  await expect
    .poll(
      async () => (await measure(page)).userIntersectHeight,
      { timeout: 4_000, intervals: [100, 200] },
    )
    .toBeGreaterThan(10);
}

/** 物理收敛轮询：锚点矩形回到 history 内后由调用方硬断言兜底。 */
async function waitAnchorConverged(page: Page, label: string): Promise<void> {
  try {
    await expect
      .poll(
        async () => {
          const m = await measure(page);
          if (!m.assistantBox || !m.history) return false;
          return (
            m.assistantBox.top >= m.history.top - 0.5 &&
            m.assistantBox.bottom <= m.history.bottom + 0.5
          );
        },
        { timeout: 26_000, intervals: [150, 300, 600] },
      )
      .toBe(true);
  } catch (err) {
    const m = await measure(page);
    throw new Error(
      `${label}: contained=${JSON.stringify({ a: m.assistantBox, h: m.history, follow: await page.getAttribute('[data-testid="history"]', 'data-following'), status: await page.getByTestId('status').textContent(), drafts: m.draftCount })} :: ${String(err)}`,
    );
  }
}

/** 滚到顶并等待跟随状态机判定为“离开”（data-following 直接暴露结果）。 */
async function scrollToTopAndReleaseFollow(page: Page): Promise<void> {
  await jumpHistory(page, "top");
  await expect
    .poll(
      () => page.getAttribute('[data-testid="history"]', "data-following"),
      { timeout: 5_000, intervals: [50, 100, 250] },
    )
    .toBe("false");
}

async function historyScrollTop(page: Page): Promise<number> {
  return page.evaluate(() =>
    (document.querySelector('[data-testid="history"]') as HTMLElement | null)?.scrollTop ?? 0,
  );
}

/**
 * P1-B（round6）：ownership 的一次真实滚轮接管。
 * P1-5（round6）返工：Playwright 首个合成 wheel 在本环境会被 Chromium 合成
 * 器吞掉（历史三轮复现），按规范改用一次 CDP `Input.dispatchMouseEvent`
 * （type: mouseWheel）——只发一个真实向上 wheel 事件，禁止"校准微轮 +
 * 主手势"的双事件组合。data-following 必须在该手势产生的首个非回声滚动
 * 事件上立即翻转为 false，且位移生效。
 */
async function singleWheelUpRelease(page: Page, dy = -1500): Promise<number> {
  const rect = await historyRectCenter(page);
  const before = await historyScrollTop(page);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: rect.x,
      y: rect.y,
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: rect.x,
      y: rect.y,
      deltaX: 0,
      deltaY: dy,
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
  // 合成器把滚轮位移排到下一帧才落地：ownership 与位移都用轮询读取，
  // 禁止紧跟派发的同步单次读数。
  await expect
    .poll(
      () => page.getAttribute('[data-testid="history"]', "data-following"),
      { timeout: 3_000, intervals: [30, 60, 150] },
    )
    .toBe("false");
  await expect
    .poll(() => historyScrollTop(page), { timeout: 3_000, intervals: [40, 80] })
    .toBeLessThan(before - 300);
  return historyScrollTop(page);
}

/** 视口锚快照：独立从真实 DOM 测量（messageId + getBoundingClientRect）。
 * P1-5（round6）：不再读取 data-preserve-mid/off——验收 oracle 必须与引擎
 * 内部状态解耦，禁止拿被测对象的发布值证明自身正确。 */
interface ViewportAnchor {
  mid: string | null;
  offsetFromHistoryTop: number;
}

async function viewportAnchorSnapshot(page: Page): Promise<ViewportAnchor> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="history"]');
    if (!(el instanceof HTMLElement)) return { mid: null, offsetFromHistoryTop: Number.NaN };
    const rect = el.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    let best: { mid: string; off: number; dist: number } | null = null;
    let fallback: { mid: string; off: number } | null = null;
    for (const node of el.querySelectorAll('[data-testid="chat-message"]')) {
      const host = node as HTMLElement;
      if (!host.dataset.mid) continue;
      const r = host.getBoundingClientRect();
      if (r.bottom <= rect.top + 1) continue;
      const snapOf = () => ({
        mid: host.dataset.mid ?? "",
        off: Math.max(0, r.top - rect.top),
      });
      // round8：镜像产品的"最接近视口垂直中心的完整可见行"首选规则；
      // 否则退化取首个与可视矩形真实相交的行。
      if (r.top >= rect.top + 8 && r.bottom <= rect.bottom + 0.5 && r.top >= rect.top - 0.5) {
        const dist = Math.abs(r.top + r.height / 2 - centerY);
        if (!best || dist < best.dist) {
          best = { ...snapOf(), dist };
        }
        continue;
      }
      if (!fallback) fallback = snapOf();
    }
    if (best) return { mid: best.mid, offsetFromHistoryTop: best.off };
    return fallback
      ? { mid: fallback.mid, offsetFromHistoryTop: fallback.off }
      : { mid: null, offsetFromHistoryTop: Number.NaN };
  });
}

/** 真实可见行高：最新正式助手正文气泡的 computed line-height（px）。
 * P1-5（round6）：宽度切换等重排的容差必须由真实可见行高推导，
 * 禁止固定 ±260px 之类的魔法数。 */
/**
 * P1-5（round6）：锚定稳定性以"同一 messageId + 基于真实可见行高的像素
 * 容差"判定；NaN 偏移一律失败，禁止空值/自比较蒙混。
 */
function historyScrollTopT(page: Page): () => Promise<number> {
  return () => historyScrollTop(page);
}

/** 读取指定 messageId 行相对 history 顶边的偏移；未挂载返回 NaN。 */
async function rowOffsetInHistory(page: Page, mid: string): Promise<number> {
  return page.evaluate((id) => {
    const history = document.querySelector('[data-testid="history"]');
    const node = document.querySelector(`[data-mid="${id}"]`);
    if (!history || !node) return Number.NaN;
    const hr = history.getBoundingClientRect();
    const r = (node as HTMLElement).getBoundingClientRect();
    return r.top - hr.top;
  }, mid);
}

/**
 * round8（一）：位置保持的唯一合法口径——独立 DOM 尺的 history-relative
 * 偏移与完整几何记录：
 *   offset = messageRow.getBoundingClientRect().top - history.getBoundingClientRect().top
 * 条件头、top spacer、scrollTop 的整体变化都必须由生产实现吸收，oracle
 * 不做任何扣除。data-preserve-* 属性只允许用于失败诊断，不进入成功判据。
 */
interface RowGeometry {
  rowTop: number;
  rowBottom: number;
  historyTop: number;
  historyBottom: number;
  offset: number;
  scrollTop: number;
  scrollHeight: number;
  mountedRows: number;
  fullyInside: boolean;
}

async function readRowGeometry(page: Page, mid: string): Promise<RowGeometry | null> {
  return page.evaluate((id) => {
    const history = document.querySelector('[data-testid="history"]');
    const node = document.querySelector(`[data-mid="${id}"]`);
    if (!(history instanceof HTMLElement) || !(node instanceof HTMLElement)) return null;
    const hr = history.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    return {
      rowTop: r.top,
      rowBottom: r.bottom,
      historyTop: hr.top,
      historyBottom: hr.bottom,
      offset: r.top - hr.top,
      scrollTop: history.scrollTop,
      scrollHeight: history.scrollHeight,
      mountedRows: history.querySelectorAll('[data-testid="chat-message"]').length,
      fullyInside: r.top >= hr.top - 0.5 && r.bottom <= hr.bottom + 0.5,
    };
  }, mid);
}

/**
 * round8（一）：收敛等待只认外部 DOM——同一 messageId 连续 ≥4 次采样、
 * 时间跨度 ≥320ms 内偏移波动 ≤1px，且期间该行完整落入 history 矩形；
 * 满足后返回最终几何。不接受任何引擎发布状态作为成功判据。
 * round10（P2-2）：requireFull=false 时放宽为"与 history 可视矩形真实相交
 * （>6px）"——锚行删除场景的下方幸存行可能部分超出底缘，其 history-relative
 * 偏移依旧可测且必须被钉回。
 */
async function waitForSettledRowGeometry(
  page: Page,
  mid: string,
  label: string,
  opts: { requireFull?: boolean } = {},
): Promise<RowGeometry> {
  const requireFull = opts.requireFull !== false;
  const stamps: { t: number; off: number }[] = [];
  try {
    await expect
      .poll(
        async () => {
          const g = await readRowGeometry(page, mid);
          const placementOk = requireFull
            ? !!g && g.fullyInside
            : !!g && g.rowBottom - g.historyTop > 6 && g.historyBottom - g.rowTop > 6;
          if (!g || !placementOk) {
            stamps.length = 0;
            return false;
          }
          stamps.push({ t: Date.now(), off: g.offset });
          // 连续 ≥4 次采样、覆盖 ≥320ms、期间偏移波动 ≤1px。
          if (stamps.length < 4) return false;
          const win = stamps.slice(-4);
          const spanMs = win[win.length - 1]!.t - win[0]!.t;
          if (spanMs < 320) return false;
          const offs = win.map((x) => x.off);
          return Math.max(...offs) - Math.min(...offs) <= 1;
        },
        { timeout: 24_000, intervals: [110] },
      )
      .toBe(true);
  } catch (err) {
    const last = stamps[stamps.length - 1];
    let liveNote = "";
    if (!last) {
      const live = await readRowGeometry(page, mid);
      const ds = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="history"]');
        if (!(el instanceof HTMLElement)) return null;
        return {
          run: el.dataset.preserveRun ?? null,
          phase: el.dataset.preservePhase ?? null,
          gen: el.dataset.preserveGen ?? null,
          conv: el.dataset.preserveConverged ?? null,
          resid: el.dataset.preserveResidualPx ?? null,
          fol: el.dataset.following ?? null,
          lastMid: el.dataset.preserveLastMid ?? null,
          override: el.dataset.preserveOverride ?? null,
          mounted: Array.from(
            el.querySelectorAll('[data-testid="chat-message"]'),
          ).map((n) => (n as HTMLElement).dataset.mid ?? ""),
        };
      });
      const hist = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="history"]');
        return el instanceof HTMLElement ? { st: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight } : null;
      });
      liveNote = ` live=${JSON.stringify(live)} hist=${JSON.stringify(hist)} ds=${JSON.stringify(ds)}`;
    }
    const tail = stamps
      .slice(-16)
      .map((x) => `${x.off.toFixed(1)}@${x.t}`)
      .join(",");
    const spread = (() => {
      if (stamps.length < 4) return NaN;
      let bestSpan = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 3 < stamps.length; i += 1) {
        const w = stamps.slice(i, i + 4);
        const spanMs = w[3]!.t - w[0]!.t;
        const range = Math.max(...w.map((x) => x.off)) - Math.min(...w.map((x) => x.off));
        if (spanMs >= 320) bestSpan = Math.min(bestSpan, range);
      }
      return bestSpan;
    })();
    throw new Error(
      `${label}: row ${mid} never settled (${stamps.length} samples, last=${
        last ? last.off.toFixed(2) : "unmounted/not-inside"
      }, minStableRange=${Number.isNaN(spread) ? "n/a" : spread.toFixed(2)}, tail=${tail})${liveNote} :: ${String(err)}`,
    );
  }
  const final = await readRowGeometry(page, mid);
  expect(final, `${label}: final geometry of ${mid} readable`).not.toBeNull();
  return final!;
}

/**
 * round10（P1-1/P2-2）：正常静止事务的收敛判据——converged=true、run=idle、
 * override=released 三者同时成立。预算耗尽的显性失败不再是合法终态（高刷
 * 环境下安静窗与写入预算已分离）；此判据只作生命周期同步门，几何成败仍由
 * 独立 DOM 尺裁定。
 */
async function waitPreserveSettled(page: Page, label: string): Promise<void> {
  let lastObserved = "";
  await expect
    .poll(
      async () => {
        lastObserved = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="history"]');
          if (!(el instanceof HTMLElement)) return "";
          return [
            el.dataset.preserveRun ?? "",
            el.dataset.preserveConverged ?? "",
            el.dataset.preserveOverride ?? "",
          ].join("|");
        });
        return lastObserved;
      },
      { timeout: 15_000, intervals: [80, 160, 320] },
    )
    .toBe("idle|true|released");
  expect(
    lastObserved,
    `${label}: preserve lifecycle settled as idle|true|released`,
  ).toBe("idle|true|released");
}

/**
 * round10（P2-2.4）：在触发动作【之前】安装 data-preserve-run 生命周期监听
 * （MutationObserver），避免轮询采样漏掉短暂的 active 状态。返回读取函数。
 */
async function installPreserveRunRecorder(
  page: Page,
): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="history"]');
    if (!(el instanceof HTMLElement)) {
      throw new Error("history element missing for preserve-run recorder");
    }
    const holder = el as HTMLElement & { __preserveRunLog?: string[] };
    const seen: string[] = [el.dataset.preserveRun ?? "absent"];
    holder.__preserveRunLog = seen;
    const record = (): void => {
      const next = el.dataset.preserveRun ?? "absent";
      if (seen[seen.length - 1] !== next) seen.push(next);
    };
    new MutationObserver(record).observe(el, {
      attributes: true,
      attributeFilter: ["data-preserve-run"],
    });
  });
  return () =>
    page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="history"]',
      ) as (HTMLElement & { __preserveRunLog?: string[] }) | null;
      return el?.__preserveRunLog ? [...el.__preserveRunLog] : [];
    });
}

/**
 * round8（四）：在可视且完整落入 history 的挂载行中，选出全部严格位于参照
 * 行上方/下方的候选取最贴近者——展开/折叠/删除的目标必须明确位于锚行上
 * 方（反之锚行必须明确位于删除目标下方），否则扰动天然不移动锚点，属于
 * 假绿。找不到满足条件的行时显式失败。
 */
async function pickMountedRowRelativeTo(
  page: Page,
  opts:
    | {
        side: "above";
        refMid: string;
        excludeMids: string[];
        requirePrefix?: string;
        requireVisible?: boolean;
      }
    | {
        side: "below";
        refMid: string;
        excludeMids: string[];
        requirePrefix?: string;
        requireVisible?: boolean;
      },
): Promise<string | null> {
  return page.evaluate(
    ({ side, refMid, excludeMids, requirePrefix, requireVisible }) => {
      const el = document.querySelector('[data-testid="history"]');
      if (!(el instanceof HTMLElement)) return null;
      const histRect = el.getBoundingClientRect();
      const ref = el.querySelector(`[data-mid="${refMid}"]`);
      if (!(ref instanceof HTMLElement)) return null;
      const refRect = ref.getBoundingClientRect();
      let best: { mid: string; dist: number } | null = null;
      for (const node of el.querySelectorAll('[data-testid="chat-message"]')) {
        const host = node as HTMLElement & { dataset: { mid?: string } };
        const mid = host.dataset.mid;
        if (!mid || excludeMids.includes(mid)) continue;
        if (requirePrefix && !mid.startsWith(requirePrefix)) continue;
        const r = host.getBoundingClientRect();
        // round8：候补必须与参照行严格异侧（2px 保护带）；requireVisible
        // 时还必须完整落入 history 可视矩形——选中视口外行只会诱使测试
        // 框架隐式滚动，那是被禁止的越权操作。
        const strictly =
          side === "above"
            ? r.bottom <= refRect.top - 2
            : r.top >= refRect.bottom + 2;
        if (!strictly) continue;
        if (
          requireVisible === true &&
          !(r.top >= histRect.top + 1 && r.bottom <= histRect.bottom - 1)
        ) {
          continue;
        }
        const dist =
          side === "above"
            ? Math.abs(r.bottom - refRect.top)
            : Math.abs(r.top - refRect.bottom);
        if (!best || dist < best.dist) best = { mid, dist };
      }
      return best?.mid ?? null;
    },
    {
      side: opts.side,
      refMid: opts.refMid,
      excludeMids: opts.excludeMids,
      requirePrefix: opts.requirePrefix ?? null,
      requireVisible: opts.requireVisible === true,
    },
  );
}

/**
 * round10（P2-2）：选取参照行【下方】最近的、与 history 可视矩形真实相交
 * （>6px）的种子行——锚行删除场景的下方幸存行可能因锚行展开的操作区被
 * 推出底缘，部分可见行的 history-relative 偏移依旧可测且必须被钉回。
 */
async function pickIntersectingRowBelow(
  page: Page,
  refMid: string,
  excludeMids: string[],
): Promise<string | null> {
  return page.evaluate(
    ({ refMid, excludeMids }) => {
      const el = document.querySelector('[data-testid="history"]');
      if (!(el instanceof HTMLElement)) return null;
      const histRect = el.getBoundingClientRect();
      const ref = el.querySelector(`[data-mid="${refMid}"]`);
      if (!(ref instanceof HTMLElement)) return null;
      const refRect = ref.getBoundingClientRect();
      let best: { mid: string; dist: number } | null = null;
      for (const node of el.querySelectorAll('[data-testid="chat-message"]')) {
        const host = node as HTMLElement & { dataset: { mid?: string } };
        const mid = host.dataset.mid;
        if (!mid || !mid.startsWith("seed-") || excludeMids.includes(mid)) continue;
        const r = host.getBoundingClientRect();
        if (r.top < refRect.bottom + 2) continue; // 必须严格位于参照行下方
        if (Math.min(r.bottom, histRect.bottom) - Math.max(r.top, histRect.top) <= 6) {
          continue; // 必须与可视矩形真实相交
        }
        const dist = Math.abs(r.top - refRect.bottom);
        if (!best || dist < best.dist) best = { mid, dist };
      }
      return best?.mid ?? null;
    },
    { refMid, excludeMids },
  );
}

/**
 * round8（一）：flow-relative 口径已废除。位置保持的偏移一律取
 * {@link readRowGeometry} 的 history-relative `offset`；收敛等待一律走
 * {@link waitForSettledRowGeometry}（连续 ≥3 采样、≥320ms、≤1px、完整
 * 落入矩形）。data-preserve-run 只读不判——不得以"引擎自己说 idle"替代
 * 外部几何稳态。
 */

/** 指定行与其下一个相邻消息行的顶边间距（局部几何守恒的度量对象）。 */
async function rowGapToNext(page: Page, mid: string): Promise<number> {
  return page.evaluate((id) => {
    const history = document.querySelector('[data-testid="history"]');
    const node = document.querySelector(`[data-mid="${id}"]`);
    if (!history || !node?.parentElement) return Number.NaN;
    const siblings = Array.from(node.parentElement.children).filter((n) =>
      n.matches('[data-testid="chat-message"]'),
    );
    const idx = siblings.indexOf(node);
    const next = siblings[idx + 1] as HTMLElement | undefined;
    if (!next) return Number.NaN;
    return (
      next.getBoundingClientRect().top - (node as HTMLElement).getBoundingClientRect().top
    );
  }, mid);
}


/** 连续两次采样（间隔 ~120ms）得到同一锚点才返回——基线必须在静止态冻结。 */
async function stableViewportAnchor(page: Page): Promise<ViewportAnchor> {
  let prev = await viewportAnchorSnapshot(page);
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(120);
    const cur = await viewportAnchorSnapshot(page);
    if (
      prev.mid !== null &&
      prev.mid === cur.mid &&
      Number.isFinite(cur.offsetFromHistoryTop) &&
      Math.abs(cur.offsetFromHistoryTop - prev.offsetFromHistoryTop) <= 1
    ) {
      return cur;
    }
    prev = cur;
  }
  throw new Error(
    `stableViewportAnchor: anchor never stabilized (last mid=${String(prev.mid)} off=${
      Number.isFinite(prev.offsetFromHistoryTop) ? prev.offsetFromHistoryTop.toFixed(2) : "NaN"
    })`,
  );
}

/** P1-5（round6）：宽度对翻等重排下不再使用"±N 行邻域 + 自比较"的宽松
 * 判据；统一改走 {@link assertAnchorHeld} 的"同一 messageId + 真实行高
 * 容差"。此前的 assertAnchorNear 已删除。 */

/** 同一 messageId 的相对偏移不得漂移超过 tol px：等待保持引擎收敛后再判定
 * （单次采样会把尚未完成的合法收敛误读为漂移）。NaN 一律失败。 */
async function assertAnchorHeld(
  page: Page,
  snap: ViewportAnchor,
  label: string,
  tol = 4,
): Promise<void> {
  expect(snap.mid, `${label} anchor mid captured`).not.toBeNull();
  expect(Number.isFinite(snap.offsetFromHistoryTop), `${label} baseline offset finite`).toBe(true);
  let lastMid: string | null = null;
  let lastDrift = Number.NaN;
  try {
    await expect
      .poll(
        async () => {
          const now = await viewportAnchorSnapshot(page);
          lastMid = now.mid;
          if (!now.mid || !snap.mid || now.mid !== snap.mid) return false;
          if (!Number.isFinite(now.offsetFromHistoryTop)) return false;
          lastDrift = Math.abs(now.offsetFromHistoryTop - snap.offsetFromHistoryTop);
          return lastDrift <= tol;
        },
        { timeout: 5_000, intervals: [80, 160] },
      )
      .toBe(true);
  } catch (err) {
    throw new Error(
      `${label}: mid=${String(lastMid)} expected=${snap.mid} drift=${Number.isNaN(lastDrift) ? "n/a" : lastDrift.toFixed(2)} tol=${tol} :: ${String(err)}`,
    );
  }
}

/** 上移出跟随阈值带并把尾部行带进可视区：每档 140px，至多 8 档；
 * 跟随状态机据此让位（真实滚动语义），保持会话定格该尾部视图。 */
async function revealTailFromFollow(page: Page): Promise<void> {
  // 单次绝对底赋值：该写入产生的滚动事件对跟随机而言必然“偏离其上次
  // 写入落点”→ ownership 立即转移（following=false），且间隙为 0 不满足
  // 恢复条件；随后模式行完整落在 history 可视盒内，状态确定不再变化。
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
    // 让可能因校准回填而增长的内容再次把底边推下去，然后重贴底。
    await page.waitForTimeout(140);
  }
  // 浏览器原生兜底：直接把模式行滚入最近可视位（对任何度量差异鲁棒）。
  await page.evaluate(() => {
    document
      .querySelector('[data-testid="mode-row"]')
      ?.scrollIntoView({ block: "nearest" });
  });
  await page.waitForTimeout(120);
}

/** 无空白带：顶垫/相邻行/底垫边界必须连续（±2px），spacer 不许吞内容。 */
async function assertNoBlankBand(page: Page, label: string): Promise<void> {
  const breaks = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="history"]');
    if (!el) return ["history missing"];
    const seq: Element[] = [];
    const topPad = el.querySelector('[data-testid="virt-spacer-top"]');
    if (topPad) seq.push(topPad);
    for (const n of el.querySelectorAll('[data-testid="chat-message"]')) seq.push(n);
    const bottomPad = el.querySelector('[data-testid="virt-spacer-bottom"]');
    if (bottomPad) seq.push(bottomPad);
    const out: string[] = [];
    for (let i = 1; i < seq.length; i += 1) {
      const prev = seq[i - 1].getBoundingClientRect().bottom;
      const cur = seq[i].getBoundingClientRect().top;
      if (Math.abs(cur - prev) > 2) out.push(`gap@${i}:${(cur - prev).toFixed(1)}px`);
    }
    return out;
  });
  expect(breaks, `${label} blank bands between virtual content`).toEqual([]);
}

/**
 * 锚定稳定性：连续采样（默认跨度 ≥320ms、间隔 ~90ms）中 assistant 边界
 * （取整到 0.5px）与 scrollTop 完全一致才通过——单帧命中不算稳定。
 */
async function assertStabilityOverMs(
  page: Page,
  label: string,
  opts: { ms?: number; interval?: number } = {},
): Promise<void> {
  const ms = opts.ms ?? 320;
  const interval = opts.interval ?? 90;
  const samples: string[] = [];
  const started = Date.now();
  while (Date.now() - started < ms) {
    const m = await measure(page);
    if (m.assistantBox && m.history) {
      const r = (v: number) => Math.round(v * 2) / 2;
      samples.push(
        JSON.stringify([
          r(m.assistantBox.top), r(m.assistantBox.bottom),
          m.docScrollTop, m.windowScrollY,
          await historyScrollTop(page),
        ]),
      );
    }
    await page.waitForTimeout(interval);
  }
  const distinct = new Set(samples);
  expect(samples.length, `${label} stability samples taken`).toBeGreaterThanOrEqual(3);
  expect(distinct.size, `${label} repeated samples stay identical (${samples.join(" | ")})`).toBe(1);
}

/**
 * P1-5（round6）逐项滚入（程序化，如实命名）：每次把一个尾部控制组滚动
 * 到 history 视区中心，等待布局静止后【当场】测量该组的 containment。
 * 三组总高超过短视口可同屏范围——语义为"每一项都能完整滚入"，不要求
 * 三者同时可见。返回每组一次"滚入后"的实测结果与按钮巡检。
 */
async function measureTailControlsSequentially(page: Page): Promise<TailControlRow[]> {
  const rows: TailControlRow[] = [];
  // P1-5 #8：滚动与几何读取必须在【同一次 evaluate】内同步完成——
  // scrollIntoView 同步生效布局，而跟随机/保持引擎的任何响应都要等到下
  // 一个动画帧；瞬时快照因此就是"该控件能够完整滚入 history 可视矩形"
  // 的直接证据，不受异步纠正污染。
  for (const tid of ["feedback-row", "memory-prompt", "mode-row"]) {
    const row = await page.evaluate((id) => {
      const history = document.querySelector('[data-testid="history"]');
      const hRect = history?.getBoundingClientRect();
      const node = document.querySelector(`[data-testid="${id}"]`);
      if (!history || !hRect || !node) {
        return { id, missing: true, top: Number.NaN, bottom: Number.NaN, buttons: [] };
      }
      node.scrollIntoView({ block: "center" });
      const r = node.getBoundingClientRect();
      const buttons = Array.from(node.querySelectorAll("button")).map((b) => {
        const br = b.getBoundingClientRect();
        return { top: br.top, bottom: br.bottom, height: br.height };
      });
      return { id, missing: false, top: r.top, bottom: r.bottom, buttons };
    }, tid);
    rows.push(row as TailControlRow);
  }
  return rows;
}

interface TailControlRow {
  id: string;
  missing: boolean;
  top: number;
  bottom: number;
  buttons: Array<{ top: number; bottom: number; height: number }>;
}

/** 当前 history 的可视边界（供调用方对每行结果做断言）。 */
async function historyBounds(page: Page): Promise<{ top: number; bottom: number }> {
  return page.evaluate(() => {
    const r = document
      .querySelector('[data-testid="history"]')
      ?.getBoundingClientRect();
    return { top: r?.top ?? Number.NaN, bottom: r?.bottom ?? Number.NaN };
  });
}

/** 可见按钮触控高度巡检：任一可见 button 高度都不得低于 44px。 */
async function assertVisibleButtonHeights(page: Page, label: string): Promise<void> {
  const offenders = await page.evaluate(() => {
    const out: string[] = [];
    for (const btn of document.querySelectorAll("button")) {
      const r = btn.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.height < 43.5) {
        out.push(`"${((btn.textContent ?? "").trim()).slice(0, 8)}" h=${r.height.toFixed(1)}`);
      }
    }
    return out;
  });
  expect(offenders, `${label} sub-44px visible buttons`).toEqual([]);
}

/** 登录限流重试（套跑共享来源桶）。 */
async function uiLoginWithRetry(page: Page, user: E2EUser): Promise<E2ESession> {
  try {
    return await uiLogin(page, user);
  } catch (err) {
    if (!String(err).includes("429")) throw err;
    await page.waitForTimeout(65_000);
    return uiLogin(page, user);
  }
}

// P1（round4/r5）：五视口几何矩阵 + 锚定跟随初始态 + 条件行状态机。
// visibleMessages 显式非零；最新助手回复直接断言包含性；完成态断言 draft
// 不存在；812×375 追加改名行 / 条件横幅 / 取消点击 / 失败重试等状态；
// 812×375 初始收敛额外要求连续采样稳定（≥320ms 相同边界）。
test("chat geometry holds across five viewports and every 812x375 state", async ({
  page,
  request,
}) => {
  test.setTimeout(480_000);
  const user = await provisionUser(request, "relationship-chat");
  const session = await uiLoginWithRetry(page, user);
  await prepareGenerationAccess(session.accessToken);

  await navigateToPage(page, "/pages/companion/companion");
  await page.getByTestId("persona-select").selectOption("gentle-listener");
  await page.getByTestId("create-relationship").click();
  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
  );

  // P1-5 #8：伪造一条 PENDING_CONFIRMATION 记忆候选（必须先于聊天页
  // 挂载注册——mount 与完成时刻的 pendingMemoryCount 刷新都要走这条拦截，
  // 否则计数停留在真实后端的 0，memory-prompt 行不会渲染）。
  await page.route(/\/api\/v1\/relationships\/[^/]+\/memories/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          memoryId: "seed-mem-matrix",
          scope: "RELATIONSHIP",
          summary: "用户喜欢在夜晚散步",
          status: "PENDING_CONFIRMATION",
        },
      ]),
    });
  });

  await navigateToPage(page, "/pages/chat/chat");
  const input = page.locator('[data-testid="message-input"] input');
  await expect(input).toBeVisible();
  await input.fill("五个视口下都要完整读到这条真实消息。");
  const generationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/conversations\/[^/]+\/generations$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.getByTestId("send").click();
  const generationAccepted = await generationResponsePromise;
  expect(generationAccepted.ok(), "generation create failed").toBeTruthy();
  // 记住本轮会话 id：后续带参重挂载必须回到同一个会话，不能依赖列表顺序。
  const openConvId =
    new URL(generationAccepted.url()).pathname.match(
      /conversations\/([^/]+)\/generations/,
    )?.[1] ?? "";
  expect(openConvId).not.toBe("");
  await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）", {
    timeout: 30_000,
  });

  const SHOTS = ".impeccable/review/round8";
  const SHOTS6 = ".impeccable/review/round8";

  const VIEWPORTS: Array<{ w: number; h: number; name: string }> = [
    // round7（六）：812×375 放在最前——settled 验证必须发生在任何程序化
    // 滚动之前的初始候选上。
    { w: 812, h: 375, name: "812x375" },
    { w: 375, h: 812, name: "375x812" },
    { w: 390, h: 844, name: "390x844" },
    { w: 768, h: 1024, name: "768x1024" },
    { w: 1440, h: 900, name: "1440x900" },
  ];

  {
    const firstName = VIEWPORTS[0]!.name;
    // round8（六）：settled 截图必须名副其实——显式切到首个视口再验证与
    // 拍摄；此刻测试尚未发生任何程序化滚动。
    await setViewport(page, VIEWPORTS[0]!.w, VIEWPORTS[0]!.h);
    // P1-5（round6）：完成稳定性必须在任何程序化滚动之前、且只针对刚完成
    // 的这一轮对话验证一次——data-following=true、draftCount=0、follow run
    // 已 idle、assistant bounds 与 scrollTop 连续 ≥320ms 不变。
    await expect
      .poll(
        () => page.getAttribute('[data-testid="history"]', "data-following"),
        { timeout: 8_000, intervals: [60, 120] },
      )
      .toBe("true");
    await expect
      .poll(
        async () => {
          const runState = await page.evaluate(() => {
            const el = document.querySelector('[data-testid="history"]');
            return el instanceof HTMLElement ? el.dataset.followRun : null;
          });
          const drafts = await page.evaluate(
            () => document.querySelectorAll('[data-testid="draft"]').length,
          );
          return `${runState}:${drafts}`;
        },
        { timeout: 10_000, intervals: [100, 250] },
      )
      .toBe("idle:0");
    await assertStabilityOverMs(page, `${firstName} settled completion`);
    if (firstName === "812x375") {
      // round7（六）：三元组与 ≥320ms 稳定已在上方断言完毕；截图紧接其后，
      // 且此刻测试尚未执行过任何程序化滚动。
      await page.screenshot({ path: `${SHOTS}/chat-812x375-settled.png` });
    }
  }

  for (const vp of VIEWPORTS) {
    await setViewport(page, vp.w, vp.h);

    // 初始态（打开会话即锚定最新回复）。
    await waitAnchorConverged(page, `${vp.name} initial`);
    const initial = await measure(page);
    assertCoreGeometry(initial, `${vp.name} initial`, { assistantCount: 1 });
    assertAnchoredLatest(initial, `${vp.name} initial`);
    // 程序化修正（一次滚动可达语义，按 P1-5 #7 如实命名）。
    const correctedInitial = await ensureLatestUserVisible(page);
    expect(correctedInitial.userIntersectHeight,
      `${vp.name} latest user message after one scroll`).toBeGreaterThan(10);

    if (vp.name === "812x375") {
      // round7（六）：settled 三元组与 ≥320ms 稳定性已在循环前的完成态块中
      // 断言并截图——该验证必须发生在任何程序化滚动之前，此处不再重复。
    }

    if (vp.name === "375x812") {
      await page.screenshot({ path: `${SHOTS}/chat-375x812.png` });
    }
    if (vp.name === "390x844") {
      await page.screenshot({ path: `${SHOTS}/chat-390x844.png` });
    }
    if (vp.name === "812x375") {
      // 滚到顶：页头仍完整、外壳不滚。
      await jumpHistory(page, "top");
      await expect.poll(async () => (await measure(page)).docScrollTop, {
        timeout: 3_000, intervals: [60, 120],
      }).toBe(0);
      const top = await measure(page);
      assertCoreGeometry(top, `${vp.name} scrolled-top`, {
        assistantCount: 1,
        allowNoVisibleMessages: true,
      });
      assertVisibleButtonHeights(page, `${vp.name} scrolled-top`);
      await page.screenshot({ path: `${SHOTS}/chat-812x375-scrolled-top.png` });
      await revealTailFromFollow(page);
    }

    // 滚到底：尾部反馈/模式行完整可达且不被输入栏遮挡（确定性揭示，
    // 与合成器手势时序解耦）。
    // 贴底揭示：尾部行可达性的硬判据由“按钮触控高度巡检 + assertCore
    // Geometry 的零覆盖/单一滚动”共同承载；此处仅要求状态机让位。
    await revealTailFromFollow(page);
    const bottom = await measure(page);
    // 短视口（812×375）在尾部堆叠 feedback/记忆候选/模式行后，控件栈可以
    // 合理占满视口（与条件横幅满屏同型）；高视口仍要求消息可见。
    assertCoreGeometry(bottom, `${vp.name} scrolled-bottom`, {
      assistantCount: 1,
      allowNoVisibleMessages: vp.name === "812x375",
    });
    await assertVisibleButtonHeights(page, `${vp.name} scrolled-bottom`);

    if (vp.name === "812x375") {
      // ---- P1-5 #8（round6）：恢复尾部直接 containment 断言——feedback /
      // memory prompt / mode row 及其按钮必须【逐项完整滚入 history】：
      // top ≥ history.top 且 bottom ≤ history.bottom；禁止以元素总高度代替。
      const tailRows = await measureTailControlsSequentially(page);
      const hBounds = await historyBounds(page);
      for (const row of tailRows) {
        expect(row.missing, `${row.id} rendered`).toBe(false);
        expect(row.top >= hBounds.top - 0.5, `${row.id} top ≥ history.top`).toBe(true);
        expect(row.bottom <= hBounds.bottom + 0.5, `${row.id} bottom ≤ history.bottom`).toBe(true);
        for (const b of row.buttons) {
          expect(b.height, `${row.id} button touch height`).toBeGreaterThanOrEqual(44);
          expect(b.top >= hBounds.top - 0.5, `${row.id} button top within history`).toBe(true);
          expect(b.bottom <= hBounds.bottom + 0.5, `${row.id} button bottom within history`).toBe(true);
        }
      }
      expect([...tailRows.map((r) => r.id)].sort(), "all mandated tail groups measured").toEqual(
        ["feedback-row", "memory-prompt", "mode-row"],
      );
      // 取证：以最后一组（mode 行）滚入后的停驻帧作为尾部控件证据图。
      await page.screenshot({ path: `${SHOTS6}/chat-tail-controls-visible.png` });
    }

    if (vp.name === "768x1024") {
      await page.screenshot({ path: `${SHOTS}/chat-768x1024.png` });
    }
    if (vp.name === "1440x900") {
      await page.screenshot({ path: `${SHOTS}/chat-1440x900.png` });
    }
  }

  // ---- 812×375 改名行打开 ----
  await setViewport(page, 812, 375);
  // 改名行打开属于"用户回到最新消息"的使用语境：先把 ownership 交还给
  // 跟随机（回到底部即恢复），使随后的收缩布局由跟随状态机收敛到最新回复。
  await jumpHistory(page, "bottom");
  await expect
    .poll(
      () => page.getAttribute('[data-testid="history"]', "data-following"),
      { timeout: 6_000, intervals: [60, 120] },
    )
    .toBe("true");
  await waitAnchorConverged(page, "812x375 pre-rename follow");
  await page.getByTestId("conversation-manage").click();
  await page.getByTestId("conversation-rename").click();
  await expect(page.getByTestId("rename-row")).toBeVisible();
  await waitAnchorConverged(page, "812x375 rename-open");
  const renamed = await measure(page);
  assertCoreGeometry(renamed, "812x375 rename-open", { assistantCount: 1 });
  assertAnchoredLatest(renamed, "812x375 rename-open");
  const correctedRename = await ensureLatestUserVisible(page);
  expect(correctedRename.userIntersectHeight, "rename-open user message after one scroll")
    .toBeGreaterThan(10);
  await assertVisibleButtonHeights(page, "812x375 rename-open");
  await page.screenshot({ path: `${SHOTS}/chat-812x375-rename-open.png` });
  await page.getByTestId("rename-cancel").click();

  // ---- 812×375 连续使用提醒 + 记忆导入提示同时出现 ----
  let ctxRel = "";
  {
    const url = new URL(page.url());
    const hashQuery = url.hash.split("?")[1] ?? "";
    const params = new URLSearchParams(hashQuery);
    ctxRel = params.get("relationshipId") ?? "";
  }
  await page.route("**/api/v1/memory-imports**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ acceptedCount: 3 }),
    });
  });
  const dueStatus = (due: boolean): string =>
    JSON.stringify({
      reminderAfterMinutes: 120,
      sessionGapMinutes: 30,
      continuousMinutes: due ? 150 : 12,
      reminderDue: due,
      sessionStartedAt: "2026-08-27T01:00:00Z",
    });
  await page.route("**/api/v1/usage-health/**", async (route) => {
    const req = route.request();
    let due = true;
    if (
      req.method() === "POST" &&
      new URL(req.url()).pathname.endsWith("/reminders")
    ) {
      const body = (req.postDataJSON() ?? {}) as { result?: string };
      due = body.result !== "ENDED" && body.result !== "CONTINUED";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: dueStatus(due),
    });
  });

  await navigateToPage(
    page,
    `/pages/chat/chat?relationshipId=${encodeURIComponent(ctxRel)}` +
      `&conversationId=${encodeURIComponent(openConvId)}`,
  );
  await expect(page.getByTestId("usage-health-banner")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("memory-import-prompt")).toBeVisible();

  // 用户手势滚到头部：跟随机让位，横幅停驻可视区。
  await wheelUpToTop(page);
  await expect
    .poll(
      async () => {
        const hb = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="usage-health-continue"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const h = document
            .querySelector('[data-testid="history"]')
            ?.getBoundingClientRect();
          return { top: r.top, hTop: h?.top ?? 0 };
        });
        return !!hb && hb.top >= hb.hTop - 0.5;
      },
      { timeout: 5_000, intervals: [120, 240] },
    )
    .toBe(true);
  await jumpHistory(page, "top");
  const bannerState = await measure(page);
  assertCoreGeometry(bannerState, "812x375 conditional-banner", {
    assistantCount: 1,
    allowNoVisibleMessages: true,
  });
  await assertVisibleButtonHeights(page, "812x375 conditional-banner");
  // 条件行按钮全部真实可达：逐个滚入滚动内容的可视区（用户可达性语义），
  // 触控高度 ≥44px，且整体不越过 history 底边（P2 round5 补充 bottom
  // 断言，含拒绝导入按钮）。
  for (const tid of [
    "usage-health-continue",
    "usage-health-end",
    "memory-import-confirm",
    "memory-import-discard",
  ]) {
    const target = page.locator(`[data-testid="${tid}"]`);
    await target.scrollIntoViewIfNeeded();
    const hb = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const h = document.querySelector('[data-testid="history"]')?.getBoundingClientRect();
      return {
        top: r.top, bottom: r.bottom, height: r.height,
        hTop: h?.top ?? 0, hBottom: h?.bottom ?? 0,
      };
    }, tid);
    expect(hb, `${tid} rendered`).not.toBeNull();
    expect(hb!.height, `${tid} touch height`).toBeGreaterThanOrEqual(44);
    expect(hb!.top, `${tid} below history top`).toBeGreaterThanOrEqual(hb!.hTop - 0.5);
    expect(hb!.bottom, `${tid} within history bottom`).toBeLessThanOrEqual(hb!.hBottom + 0.5);
  }
  await page.screenshot({
    path: `${SHOTS}/chat-812x375-conditional-banner.png`,
  });
  await page.unroute("**/api/v1/memory-imports**");
  await page.unroute("**/api/v1/usage-health/**");

  // 点“继续使用”（CONTINUED 回写不提醒）让横幅收敛，且不清空当前会话，
  // 保住后续取消/重试流的内容与溢出前提。
  await page.getByTestId("usage-health-continue").click();
  await expect(page.getByTestId("usage-health-banner")).toHaveCount(0, { timeout: 15_000 });

  // ---- 812×375 流式取消（真实点击取消按钮）----
  let sseHits = 0;
  let releaseHang: (() => void) | undefined;
  let sseMode: "hang" | "abort" | "passthrough" = "hang";
  await page.route("**/api/v1/realtime/streams/**", async (route) => {
    sseHits += 1;
    if (sseMode === "hang") {
      if (sseHits === 1) {
        await new Promise<void>((resolve) => {
          releaseHang = resolve;
        });
      }
      await route.abort("connectionfailed");
      return;
    }
    if (sseMode === "abort") {
      await route.abort("connectionfailed");
      return;
    }
    await route.fallback();
  });

  await input.fill("这条消息会被我手动取消。");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("cancel")).toBeVisible({ timeout: 30_000 });
  expect(
    await page.getByTestId("cancel").getAttribute("aria-busy"),
    "cancel reports the in-flight turn",
  ).toBe("true");
  const streaming = await measure(page);
  expect(streaming.cancel!.height).toBeGreaterThanOrEqual(44);
  expect(streaming.inputArea!.bottom).toBeLessThanOrEqual(streaming.viewportHeight + 0.5);
  // 用户先滚到顶部再点取消——终态事件到达时不得改变已停住的 scrollTop。
  await scrollToTopAndReleaseFollow(page);
  const pinnedBeforeCancel = await historyScrollTop(page);
  await page.getByTestId("cancel").click();
  await expect(page.getByTestId("status")).toHaveText("已取消", { timeout: 30_000 });
  await expect
    .poll(() => historyScrollTop(page), { timeout: 3_000, intervals: [80, 160] })
    .toBe(pinnedBeforeCancel);
  const cancelled = await measure(page);
  assertCoreGeometry(cancelled, "812x375 streaming-cancelled");
  expect(cancelled.cancel, "cancel hidden once terminal").toBeNull();
  expect(cancelled.retry, "no retry for a cancelled turn").toBeNull();
  await releaseHang?.();

  // ---- 812×375 失败 → 真实点击重试恢复 ----
  sseMode = "abort";
  sseHits = 0;
  await input.fill("这条消息会先失败一次，然后我真的点重试。");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("retry")).toBeVisible({ timeout: 45_000 });
  const failed = await measure(page);
  assertCoreGeometry(failed, "812x375 failed-state");
  expect(failed.retry!.height).toBeGreaterThanOrEqual(44);
  // 失败态的单一呈现 = 无实时草稿 + 重试按钮存在；历史里既有的正式回复
  // 不受影响（虚拟窗口可能挂载多条）。
  await jumpHistory(page, "bottom");

  // 回到底部附近（跳转产生真实滚动事件）→ 跟随恢复；随后真实点击重试。
  // round10（P2-3）：删除 4×45s 租约窗等待——重试订阅必须在单次有界时限内
  // 成功。唯一的例外是【明确租约错误（429）】允许一次有界重试（真实根因
  // 取证见 Journey04：完成态流的服务端租约会滞留到 TTL，最早的租约到期后
  // 重试即被接纳）；其他传输错误立即失败，绝不以等待 130s TTL 换通过。
  sseMode = "passthrough";
  await page.unroute("**/api/v1/realtime/streams/**");
  let sawLease429 = false;
  const onStreamResponse = (response: { url(): string; status(): number }): void => {
    try {
      if (
        new URL(response.url()).pathname.startsWith("/api/v1/realtime/streams/") &&
        response.status() === 429
      ) {
        sawLease429 = true;
      }
    } catch {
      /* non-absolute URL — not a stream response */
    }
  };
  page.on("response", onStreamResponse);
  try {
    await page.getByTestId("retry").click();
    try {
      await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）", {
        timeout: 45_000,
      });
    } catch (err) {
      expect(
        sawLease429,
        "a second retry click is only allowed for an explicit lease error (429); " +
          "other transport failures must fail immediately",
      ).toBe(true);
      await page.getByTestId("retry").click();
      await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）", {
        timeout: 45_000,
      });
    }
  } finally {
    page.off("response", onStreamResponse);
  }
  // 完成后：若仍处于离开态，则用一次真实“回到底部”恢复跟随；已在跟随
  // 中则任何多余的程序化跳转反而构成让位事件（所有权语义对称）。
  {
    const before = await page.getAttribute('[data-testid="history"]', "data-following");
    if (before !== "true") {
      await jumpHistory(page, "bottom");
      await expect
        .poll(() => page.getAttribute('[data-testid="history"]', "data-following"), {
          timeout: 6_000,
          intervals: [60, 120],
        })
        .toBe("true");
    }
  }
  await waitAnchorConverged(page, "812x375 retry-completed");
  const recovered = await measure(page);
  assertCoreGeometry(recovered, "812x375 retry-completed");
  assertAnchoredLatest(recovered, "812x375 retry-completed");
  const correctedRecovered = await ensureLatestUserVisible(page);
  expect(correctedRecovered.userIntersectHeight, "retry-completed user message after one scroll")
    .toBeGreaterThan(10);
});

// ---------------------------------------------------------------------------
// P2（round5）：130 条合成历史下的虚拟列表遍历、用户滚动 ownership、高度
// 校准保持与堆叠条件头部。全部会话载荷来自拦截的分页 GET（登录/建关系走
// 真实栈）；横幅来自拦截的 usage-health / memory-imports GET。
// ---------------------------------------------------------------------------

type SyntheticMsg = {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
};

function makeSynthetic(total: number, conversationId: string): SyntheticMsg[] {
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const isUser = n % 2 === 1;
    return {
      messageId: `seed-${String(n).padStart(3, "0")}`,
      conversationId,
      role: isUser ? "user" : "assistant",
      content: isUser
        ? `种子问题 ${n}：今天也想慢慢聊聊日常。`
        : n >= total
          ? "这是最后一条正式回复，长度足够在短视口里占据两行以上，用于验证锚定对齐。"
          : `种子回复 ${n}：我在听，不急，慢慢说就好。`,
    };
  });
}

function syntheticListHandler(synthetic: SyntheticMsg[]) {
  return async (route: Route): Promise<void> => {
    const url = new URL(route.request().url());
    const after = url.searchParams.get("after");
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const startIdx = after
      ? synthetic.findIndex((m) => m.messageId === after) + 1
      : 0;
    const slice =
      startIdx > 0 ? synthetic.slice(startIdx, startIdx + limit) : synthetic.slice(0, limit);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(slice),
    });
  };
}

test("anchored follow state machine holds over 130 seeded messages", async ({
  page,
  request,
}) => {
  test.setTimeout(360_000);
  const user = await provisionUser(request, "relationship-chat");
  const session = await uiLoginWithRetry(page, user);
  const { relationshipId, conversationId } = await createRelationshipAndConversation(
    session.accessToken,
  );

  const TOTAL = 130;
  const LAST_MID = `seed-${String(TOTAL).padStart(3, "0")}`;
  const synthetic = makeSynthetic(TOTAL, conversationId);
  await page.route(
    /\/api\/v1\/conversations\/[^/]+\/messages\?.*limit=/,
    syntheticListHandler(synthetic),
  );

  // 堆叠条件头：连续使用提醒 + 记忆导入提示 + 待确认记忆候选与 130 条长
  // 列表全程共存（memories 列表伪造一条 PENDING_CONFIRMATION，驱动尾部
  // memory-prompt 行真实渲染）。
  await page.route(/\/api\/v1\/relationships\/[^/]+\/memories/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          memoryId: "seed-mem-1",
          scope: "RELATIONSHIP",
          summary: "用户提到喜欢在深夜散步",
          status: "PENDING_CONFIRMATION",
        },
      ]),
    });
  });
  await page.route("**/api/v1/memory-imports**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ acceptedCount: 2 }),
    });
  });
  await page.route("**/api/v1/usage-health/**", async (route) => {
    const req = route.request();
    let due = true;
    if (
      req.method() === "POST" &&
      new URL(req.url()).pathname.endsWith("/reminders")
    ) {
      const body = (req.postDataJSON() ?? {}) as { result?: string };
      due = body.result !== "CONTINUED";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reminderAfterMinutes: 120,
        sessionGapMinutes: 30,
        continuousMinutes: due ? 150 : 12,
        reminderDue: due,
        sessionStartedAt: "2026-08-27T01:00:00Z",
      }),
    });
  });

  const SHOTS = ".impeccable/review/round8";
  const SHOTS6 = ".impeccable/review/round8";
  await navigateToPage(
    page,
    `/pages/chat/chat?relationshipId=${encodeURIComponent(relationshipId)}` +
      `&conversationId=${encodeURIComponent(conversationId)}`,
  );
  await expect(page.getByTestId("usage-health-banner")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("memory-import-prompt")).toBeVisible();
  await expect(page.getByTestId("memory-prompt")).toBeVisible();
  await expect(
    page.locator('[data-testid="chat-message"].assistant').last(),
  ).toContainText("最后一条正式回复", { timeout: 20_000 });



  await setViewport(page, 812, 375);
  await waitAnchorConverged(page, "seeded initial");
  const seededInitial = await measure(page);
  assertCoreGeometry(seededInitial, "seeded initial");
  assertAnchoredLatest(seededInitial, "seeded initial");
  expect(
    seededInitial.visibleIds[seededInitial.visibleIds.length - 1],
    "tail anchored on latest id",
  ).toBe(LAST_MID);

  // ---- 用户滚动 ownership：一次滚轮立即接管（无预等待、无双段手势）----
  // 注意：必须先于任何“一次滚动可达”的程序化修正执行——后者本身就是
  // 程序写值，紧邻的手势会被合成器吞掉（环境行为），也会污染
  // “从锚定态一步接管”的判据纯度。
  const away = await singleWheelUpRelease(page);
  expect(await page.getAttribute('[data-testid="history"]', "data-following"), "released")
    .toBe("false");

  // P1-5（round6）：ownership 判据到此为止——上面的单次 CDP wheel 是
  // 唯一承担接管断言的手势。以下再加一段【独立声明的第二手势】，目的仅是
  // 远离"回到底部即恢复跟随"的阈值带（后续删除等收缩布局不会意外归还
  // ownership），不参与接管判据；位置基准直接以稳定锚点读取，扰动判据
  // 全部使用 mid+偏移语义。
  const correctedAway = await historyScrollTop(page);
  {
    const rc = await historyRectCenter(page);
    await page.mouse.move(rc.x, rc.y);
    await page.mouse.wheel(0, -1500);
    await expect
      .poll(historyScrollTopT(page), { timeout: 3_000, intervals: [40, 80] })
      .toBeLessThan(correctedAway - 600);
    await stableViewportAnchor(page);
  }
  // round8（一）：外部语义锚——固定 messageId + history-relative offset，
  // 同一把独立 DOM 尺贯穿全部四组扰动；oracle 不扣除任何整体平移。
  const anchorSnap = await stableViewportAnchor(page);
  const awayMid = anchorSnap.mid;
  expect(awayMid, "a semantic anchor row is mounted").not.toBeNull();
  const awayBaselineOffset = await rowOffsetInHistory(page, awayMid!);
  expect(Number.isFinite(awayBaselineOffset), "away baseline finite").toBe(true);

  // 扰动矩阵一：同宽视口高度变化（ResizeObserver + spacer 重排）。
  // round8（一）：收敛判据要求判据行完整落入 history 矩形——比基线 375 更
  // 矮的视口会物理性裁掉该行，因此这两档只做加高方向的同宽微扰。
  for (const [w0, hh] of [[812, 460], [800, 520]] as const) {
    await setViewport(page, w0, hh);
  }
  {
    const settled = await waitForSettledRowGeometry(page, awayMid!, "equal-height resize");
    const err = Math.abs(settled.offset - awayBaselineOffset);
    expect(err, `equal-height keeps anchor pinned (err=${err.toFixed(2)}px ≤ 4px)`).toBeLessThanOrEqual(4);
    await assertNoBlankBand(page, "equal-height resize");
  }

  // 扰动矩阵二：宽度变化（812×375 → 375×844）。同一保留锚点的
  // history-relative 偏移误差必须 ≤4 CSS px。基线与后态都是同一把独立 DOM
  // 尺；before/after 的完整几何写入证据，锚行前后必须完整可见；测试侧在
  // 基线与后态之间不得发生任何滚动操作。
  const trackedMid = awayMid;
  expect(trackedMid, "tracked anchor row id").not.toBeNull();
  // round8（四）：等高微扰后显式恢复基线视口；before 截图前的实际视口
  // 必须精确等于 812×375。
  await setViewport(page, 812, 375);
  expect(await page.viewportSize(), "width-scenario before viewport").toEqual({
    width: 812,
    height: 375,
  });
  const beforeGeometry = await readRowGeometry(page, trackedMid!);
  expect(beforeGeometry, "width before geometry readable").not.toBeNull();
  expect(beforeGeometry!.fullyInside, "width before: anchor row fully inside history").toBe(true);
  expect(beforeGeometry!.offset, "before geometry equals stableViewportAnchor baseline")
    .toBeCloseTo(awayBaselineOffset, 0.5);
  await page.screenshot({ path: `${SHOTS}/width-before-812x375.png` });
  await setViewport(page, 375, 844);
  const afterGeometry = await waitForSettledRowGeometry(page, trackedMid!, "width-swap 375x844");
  // 后态证据截图必须在最终 ≤4px 断言之前落盘，失败时也留下图像。
  await page.screenshot({ path: `${SHOTS}/width-after-375x844.png` });
  {
    const displacement = Math.abs(afterGeometry.offset - beforeGeometry!.offset);
    const diagState = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="history"]');
      if (!(el instanceof HTMLElement)) return {};
      return {
        preserveRun: el.dataset.preserveRun ?? null,
        preserveConverged: el.dataset.preserveConverged ?? null,
        residualPx: el.dataset.preserveResidualPx ?? null,
        following: el.dataset.following ?? null,
      };
    });
    const geometryTable =
      `before off=${beforeGeometry!.offset.toFixed(2)} rowTop=${beforeGeometry!.rowTop.toFixed(1)} ` +
      `histTop=${beforeGeometry!.historyTop.toFixed(1)} st=${Math.round(beforeGeometry!.scrollTop)} ` +
      `sh=${Math.round(beforeGeometry!.scrollHeight)} rows=${beforeGeometry!.mountedRows} | ` +
      `after off=${afterGeometry.offset.toFixed(2)} rowTop=${afterGeometry.rowTop.toFixed(1)} ` +
      `histTop=${afterGeometry.historyTop.toFixed(1)} st=${Math.round(afterGeometry.scrollTop)} ` +
      `sh=${Math.round(afterGeometry.scrollHeight)} rows=${afterGeometry.mountedRows}`;
    expect(afterGeometry.fullyInside, "width after: anchor row fully inside history").toBe(true);
    expect(
      afterGeometry.mountedRows,
      `virtualization stays bounded during width transaction (${afterGeometry.mountedRows} << ${TOTAL})`,
    ).toBeLessThan(TOTAL / 2);
    expect(String(diagState.following), "width scenario keeps ownership released").toBe("false");
    expect(
      displacement,
      `width-swap pins the anchor to its history-relative offset (disp=${displacement.toFixed(2)}px ≤ 4px; ${geometryTable}; state=${JSON.stringify(diagState)})`,
    ).toBeLessThanOrEqual(4);
    await assertNoBlankBand(page, "after width swap");
    // round10（P1-1）：删除"converged=false + budget:* 也合法"分支——校正
    // 写入预算与 320ms 安静窗的墙钟等待已分离，高刷环境不再是预算耗尽的
    // 借口；正常静止事务必须真实收敛（converged=true、idle、released），
    // 不再残留 rAF/活动事务。
    await waitPreserveSettled(page, "width swap");
    await page.screenshot({ path: `${SHOTS}/width-after-375x844-settled.png` });
  }
  // 回到工作视口：仅恢复环境，不做锚定断言。
  await setViewport(page, 812, 375);

  // ---- 展开 / 折叠行内操作区（仍在滚离态，ownership 保持）----
  // round8 编排说明：三重条件头把窄视口下的 history 压到 ~200px 高——这样
  // 的窄盒里锚行上方不存在"既完整可见、又在其上方"的可操作行，Playwright
  // 点击的 into-view 自动滚动必然发生，并被引擎按产品语义判为真实用户滚动
  // 而重定基准（该语义本身正确）。因此行内操作组换到宽敞工作台视口执行；
  // 切入作为一次普通布局事件交由保持事务钉回，并在读基线前自检 ≤4px。
  await setViewport(page, 1200, 900);
  {
    const restored = await waitForSettledRowGeometry(
      page,
      awayMid!,
      "workspace viewport restore keeps anchor",
    );
    const restoredErr = Math.abs(restored.offset - awayBaselineOffset);
    expect(
      restoredErr,
      `viewport swap into workspace pins the anchor (err=${restoredErr.toFixed(2)}px ≤ 4px)`,
    ).toBeLessThanOrEqual(4);
  }
  // P1-5（round6）/round8（一/四）：先做一次真实滚轮手势把视图推进到
  // 中段开阔区（发生在任何基线读取之前——基线与后态之间无任何测试侧滚
  // 动），ownership 由真实滚动语义重定，保持事务以当下视图建锚。此后
  // 展开/折叠/删除的判据行＝该基准行（data-preserve-mid 仅用于选行编
  // 排，成败完全由独立 DOM 几何裁定）；扰动目标必须完整可见且严格位于
  // 基准行上方——否则布局变化天然不动锚点，属于假绿。
  {
    const rc0 = await historyRectCenter(page);
    await page.mouse.move(rc0.x, rc0.y);
    await page.mouse.wheel(0, -420);
    await page.waitForTimeout(180);
  }
  const basisSnap = await stableViewportAnchor(page);
  const judgeMid = basisSnap.mid;
  expect(judgeMid, "inline-ops judge row captured").not.toBeNull();
  const judgeReadiness = await readRowGeometry(page, judgeMid!);
  expect(judgeReadiness, "judge geometry readable").not.toBeNull();
  expect(judgeReadiness!.fullyInside, "judge fully inside history").toBe(true);
  const expandTargetMid = await pickMountedRowRelativeTo(page, {
    side: "above",
    refMid: judgeMid!,
    excludeMids: [awayMid].filter((m): m is string => m !== null),
    requirePrefix: "seed-",
    requireVisible: true,
  });
  expect(
    expandTargetMid,
    "an actionable row fully visible and strictly above the judge is mounted",
  ).not.toBeNull();

  await page.screenshot({ path: `${SHOTS}/expand-before.png` });

  const expandMore = page.locator(`[data-testid="msg-more-${expandTargetMid}"]`);
  // round8：可见性已由判据预检保证——force 点击杜绝框架隐式滚动
  // （隐式滚动属于被禁止的测试侧滚动，会触发引擎重定基准）。
  await expandMore.click({ force: true });
  await expect(page.locator(`[data-testid="msg-actions-${expandTargetMid}"]`)).toBeVisible();
  // 展开/校准重排后跟随仍为 false；以"展开前基线的同一行位移"判定保持。
  expect(await page.getAttribute('[data-testid="history"]', "data-following")).toBe("false");
  {
    // round8（一）：基准行 history-relative 偏移误差 ≤4 CSS px——插入
    // 内容位于其上方，由保持引擎精确补偿回原始视口偏移。
    const afterExpandGeometry = await waitForSettledRowGeometry(
      page,
      judgeMid!,
      "expansion keeps user position",
    );
    const expandError = Math.abs(afterExpandGeometry.offset - judgeReadiness!.offset);
    expect(
      expandError,
      `expansion pins the anchored row's offset (err=${expandError.toFixed(2)}px ≤ 4px)`,
    ).toBeLessThanOrEqual(4);
    await assertNoBlankBand(page, "after expansion");
  }
  await page.screenshot({ path: `${SHOTS}/expand-after.png` });

  // 折叠：固定同一判据行与目标，先读基线再点击（more 按钮常驻于行内
  // 顶部区，展开态下它保持原可视位置）。
  const collapseBaselineGeometry = await readRowGeometry(page, judgeMid!);
  expect(collapseBaselineGeometry, "collapse baseline geometry readable").not.toBeNull();
  expect(collapseBaselineGeometry!.fullyInside, "collapse judge fully inside history").toBe(true);
  const expandMoreAgain = page.locator(`[data-testid="msg-more-${expandTargetMid}"]`);
  if ((await expandMoreAgain.getAttribute("aria-expanded")) === "true") {
    await expandMoreAgain.click({ force: true });
  }
  await expect(page.locator(`[data-testid="msg-actions-${expandTargetMid}"]`)).toHaveCount(0);
  {
    const afterCollapseGeometry = await waitForSettledRowGeometry(
      page,
      judgeMid!,
      "collapse keeps user position",
    );
    const collapseError = Math.abs(
      afterCollapseGeometry.offset - collapseBaselineGeometry!.offset,
    );
    expect(
      collapseError,
      `collapse pins the anchored row's offset (err=${collapseError.toFixed(2)}px ≤ 4px)`,
    ).toBeLessThanOrEqual(4);
    await assertNoBlankBand(page, "after collapse");
  }
  await page.screenshot({ path: `${SHOTS}/collapse-after.png` });

  // ---- 删除较早消息（滚离态下按 messageId 保持相对偏移）----
  await page.route(
    new RegExp(`/api/v1/conversations/[^/]+/messages/${expandTargetMid}$`),
    async (route) => {
      expect(route.request().method()).toBe("DELETE");
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    },
  );
  // round8（一/四）：删除目标（expandTargetMid）严格位于基准行上方；
  // 判据行仍是基准行，全部基线——messageId、其 history-relative 偏移、
  // 邻行间距——在【点击最终确认之前】读定；杜绝"删后自比较"蒙混。
  const preDeleteReadiness = await readRowGeometry(page, judgeMid!);
  expect(preDeleteReadiness?.fullyInside ?? false, "pre-delete judge fully inside").toBe(true);
  const deleteMore = page.locator(`[data-testid="msg-more-${expandTargetMid}"]`);
  await deleteMore.click({ force: true });
  const deleteBtn = page.locator(`[data-testid="msg-delete-${expandTargetMid}"]`);
  await deleteBtn.click({ force: true });
  await expect(deleteBtn, "two-step delete arm label").toHaveText("确认删除");

  // 菜单已展开、尚未确认：等保持事务对"arm 插入内容"的补偿完成、判据
  // 行几何静止后再读全部基线（仍严格早于最终确认点击）。
  const deleteBaselineGeometry = await waitForSettledRowGeometry(
    page,
    judgeMid!,
    "pre-confirm judge settles",
  );
  expect(deleteBaselineGeometry.fullyInside, "pre-confirm judge fully inside history").toBe(true);
  const gapBeforeConfirm = await rowGapToNext(page, judgeMid!);
  expect(Number.isFinite(gapBeforeConfirm), "pre-confirm neighbor gap measured").toBe(true);
  await page.screenshot({ path: `${SHOTS}/delete-before.png` });

  await deleteBtn.click({ force: true });
  await expect(page.locator(`[data-mid="${expandTargetMid}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-testid="msg-more-${expandTargetMid}"]`)).toHaveCount(0);
  expect(await page.getAttribute('[data-testid="history"]', "data-following")).toBe("false");
  await assertNoBlankBand(page, "after deleting an earlier row");
  {
    // round8（一）主判据：同一基准行的 history-relative 偏移误差 ≤4 CSS
    // px；邻行间距作为辅助量给出真实数值。
    const settledGeometry = await waitForSettledRowGeometry(
      page,
      judgeMid!,
      "deletion keeps user position",
    );
    const anchorError = Math.abs(settledGeometry.offset - deleteBaselineGeometry!.offset);
    const gapAfterDelete = await rowGapToNext(page, judgeMid!);
    expect(
      anchorError,
      `deletion pins the anchored row's offset (err=${anchorError.toFixed(2)}px ≤ 4px; ` +
        `gap ${gapBeforeConfirm!.toFixed(1)}→${gapAfterDelete.toFixed(1)}px @${judgeMid})`,
    ).toBeLessThanOrEqual(4);
    // round10（P2-2.3）：删除后必须 converged=true、idle、released。
    await waitPreserveSettled(page, "earlier-row delete");
    await page.screenshot({ path: `${SHOTS}/delete-after.png` });
  }

  // ---- round9（四）/round10（P2-2）：删除【当前事务锚行】——删除前幸存行
  // 快照 handoff。判据行即引擎基准行本身（data-preserve-mid 仅作生命周期
  // 同步门，成败仍由独立 DOM 几何裁定）。round10 加固：
  //   • 生命周期监听在【最终确认前】安装（MutationObserver，轮询不会漏掉
  //     短暂 active）；
  //   • handoff 幸存行与偏移在确认点击前【立即重新读取并冻结】；
  //   • 删除后必须 converged=true、idle、released；
  //   • 删除后追加一次真实上游高度扰动（展开幸存行上方的行内操作区）——
  //     没有有效 handoff 基准时该扰动必然把幸存行推离基线，杜绝"删除的
  //     行位于锚上方、天然不动"式假绿。
  const SHOTS9 = ".impeccable/review/round9";
  const SHOTS10 = ".impeccable/review/round10";
  {
    // 生命周期同步门：当前引擎基准行确为判据行。
    await expect
      .poll(() => page.getAttribute('[data-testid="history"]', "data-preserve-mid"), {
        timeout: 8_000,
        intervals: [100, 200],
      })
      .toBe(judgeMid);

    // 展开 judge 行内操作区并 arm 两步确认。
    const judgeMore = page.locator(`[data-testid="msg-more-${judgeMid}"]`);
    await judgeMore.click({ force: true });
    await expect(page.locator(`[data-testid="msg-actions-${judgeMid}"]`)).toBeVisible();
    const judgeDelete = page.locator(`[data-testid="msg-delete-${judgeMid}"]`);
    await judgeDelete.click({ force: true });
    await expect(judgeDelete, "two-step delete arm label").toHaveText("确认删除");

    // 确定性幸存行：判据行【下方】最近的、与可视矩形真实相交的种子行
    // （round10/P2-2 与生产快照规则一致：优先后一行）。锚行删除后该行必然
    // 上移——只有真实消费 pre-delete 快照才能把它钉回原位；没有 handoff 时
    // 引擎会把跳变后的视图当新真值，该行离开冻结基线，测试必然失败。
    const survivorMid = await pickIntersectingRowBelow(
      page,
      judgeMid!,
      [awayMid].filter((m): m is string => m !== null),
    );
    expect(
      survivorMid,
      "an intersecting survivor row strictly below the anchor is mounted",
    ).not.toBeNull();
    await page.route(
      new RegExp(`/api/v1/conversations/[^/]+/messages/${judgeMid}$`),
      async (route) => {
        expect(route.request().method()).toBe("DELETE");
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      },
    );

    // arm 插入内容后几何先静止；随后【最终确认前】依次：安装生命周期监听
    // → 重新读取并冻结幸存行基线 → 截图 → 点击确认。
    const survivorSettled = await waitForSettledRowGeometry(
      page,
      survivorMid!,
      "survivor pre-delete baseline",
      { requireFull: false },
    );
    await expect
      .poll(() => page.getAttribute('[data-testid="history"]', "data-preserve-run"), {
        timeout: 8_000,
        intervals: [80, 160],
      })
      .toBe("idle");
    const readPreserveRunLog = await installPreserveRunRecorder(page);
    const survivorBaseline = await readRowGeometry(page, survivorMid!);
    expect(survivorBaseline, "survivor baseline frozen before confirm").not.toBeNull();
    expect(survivorBaseline!.offset, "frozen baseline matches the settled read")
      .toBeCloseTo(survivorSettled.offset, 0.5);
    await page.screenshot({ path: `${SHOTS9}/anchor-delete-before.png` });

    await judgeDelete.click({ force: true });
    await expect(page.locator(`[data-mid="${judgeMid}"]`)).toHaveCount(0);
    // handoff 事务生命周期：确实经历 active→idle（监听器证据，不作成功判据）。
    {
      const lifecycle = await readPreserveRunLog();
      expect(
        lifecycle.includes("active"),
        `the handoff transaction went active (observed ${JSON.stringify(lifecycle)})`,
      ).toBe(true);
    }
    await waitPreserveSettled(page, "anchor-row delete");
    expect(await page.getAttribute('[data-testid="history"]', "data-following")).toBe("false");
    {
      const runLog = await readPreserveRunLog();
      expect(runLog[runLog.length - 1], "lifecycle ends idle").toBe("idle");
      // 主判据（独立 DOM 几何）：同一幸存行删除前后 history-relative
      // 偏移误差 ≤4 CSS px——恢复的是删除前快照，不是跳变后的视图。
      const survivorAfter = await waitForSettledRowGeometry(
        page,
        survivorMid!,
        "anchor-row deletion keeps the survivor at its pre-delete offset",
        { requireFull: false },
      );
      const survivorError = Math.abs(survivorAfter.offset - survivorBaseline!.offset);
      expect(
        survivorError,
        `deleting the anchored row pins the pre-delete survivor (err=${survivorError.toFixed(2)}px ≤ 4px; survivor=${survivorMid})`,
      ).toBeLessThanOrEqual(4);
      await assertNoBlankBand(page, "after deleting the anchored row");
      await page.screenshot({ path: `${SHOTS9}/anchor-delete-after.png` });

      // round10（P2-2.2）：删除后的真实上游扰动——展开幸存行【上方】最近
      // 可见行的行内操作区（上游高度增加）。没有 handoff 基准时，引擎会把
      // 扰动后的视图当新真值，幸存行必然离开冻结基线；有 handoff 基准时
      // 同一幸存行必须被钉回 ≤4px。
      const perturbMid = await pickMountedRowRelativeTo(page, {
        side: "above",
        refMid: survivorMid!,
        excludeMids: [judgeMid, awayMid].filter((m): m is string => m !== null),
        requirePrefix: "seed-",
        requireVisible: true,
      });
      expect(
        perturbMid,
        "a visible row strictly above the survivor is mounted for the perturbation",
      ).not.toBeNull();
      await page.locator(`[data-testid="msg-more-${perturbMid}"]`).click({ force: true });
      await expect(page.locator(`[data-testid="msg-actions-${perturbMid}"]`)).toBeVisible();
      const survivorPerturbed = await waitForSettledRowGeometry(
        page,
        survivorMid!,
        "post-delete upstream perturbation keeps the survivor pinned",
        { requireFull: false },
      );
      const perturbError = Math.abs(survivorPerturbed.offset - survivorBaseline!.offset);
      expect(
        perturbError,
        `upstream perturbation after delete re-pins the handoff survivor (err=${perturbError.toFixed(2)}px ≤ 4px; perturbed=${perturbMid})`,
      ).toBeLessThanOrEqual(4);
      await waitPreserveSettled(page, "post-delete perturbation");
      await assertNoBlankBand(page, "after post-delete perturbation");
      await page.screenshot({ path: `${SHOTS10}/anchor-delete-perturbed.png` });
    }
  }

  // ---- round10（P1-3.4）：程序落点回声一次性消费——active 事务中用户回到
  // 底部，必须被识别为真实用户滚动并恢复 following；随后布局变化自动重锚
  // 到底（最新行完整可见）。End 的 keydown 意图先使未消费回声票据失效，
  // scrollTop 赋值由浏览器发出真实 scroll 事件（非引擎写入，不铸造票据）。
  {
    // 记录引擎自身的程序写入落点（包装实例 scrollTop setter）。
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="history"]');
      if (!(el instanceof HTMLElement)) throw new Error("history missing");
      const holder = el as HTMLElement & {
        __echoSpyInstalled?: boolean;
        __engineLandings?: number[];
      };
      if (holder.__echoSpyInstalled) return;
      holder.__echoSpyInstalled = true;
      holder.__engineLandings = [];
      const desc =
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop") ??
        Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        get: desc.get,
        set(v: number) {
          holder.__engineLandings!.push(Number(v));
          desc.set!.call(el, v);
        },
      });
    });
    expect(await page.getAttribute('[data-testid="history"]', "data-following"))
      .toBe("false");

    // 一次大幅宽度变化（1200→375，同高）：换行全变 → 锚行移动 → 保持事务
    // 产生真实校正写入；读取最近一次程序落点作为"恰好回到底部前"的回声
    // 对照。
    await setViewport(page, 375, 900);
    await expect
      .poll(
        async () => {
          const landings = await page.evaluate(() => {
            const el = document.querySelector('[data-testid="history"]') as
              | (HTMLElement & { __engineLandings?: number[] })
              | null;
            return el?.__engineLandings?.length ?? 0;
          });
          return landings;
        },
        { timeout: 10_000, intervals: [100, 200] },
      )
      .toBeGreaterThan(0);

    // 用户 End 回底：keydown 意图 + 程序赋值产生真实 scroll 事件。即使落点
    // 与最近程序写入相近，一次性票据 + 意图失效也必须判为用户语义 →
    // 底部 gap=0 → following 恢复 true。
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
      const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
      if (el) el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() => page.getAttribute('[data-testid="history"]', "data-following"), {
        timeout: 6_000,
        intervals: [60, 120],
      })
      .toBe("true");

    // 跟随恢复后的布局变化自动重锚到底部：恢复工作台视口 → 最新种子行完整
    // 落入可视区（自动跟随语义的可观测证据）。
    await setViewport(page, 1200, 900);
    await expect
      .poll(
        async () => {
          const m = await measure(page);
          return m.visibleIds[m.visibleIds.length - 1] ?? "";
        },
        { timeout: 10_000, intervals: [120, 240] },
      )
      .toBe(LAST_MID);
    await waitPreserveSettled(page, "user-return-bottom follow re-anchor");
    await page.screenshot({ path: `${SHOTS10}/user-return-bottom.png` });
  }

  // ---- 程序化 scrollTop 遍历（P1-5 #7 如实命名：这不是用户行为验收；
  // 用户手势语义的验收只由上面的单次 CDP wheel ownership 段承担）。
  // 目的：覆盖无空白带与预期 ID 可见的虚拟窗口正确性。----
  await scrollToTopAndReleaseFollow(page);
  const top = await measure(page);
  assertCoreGeometry(top, "seeded scrolled-top", { allowNoVisibleMessages: true });
  // 横幅占满短视口时消息行可为零，但虚拟窗口必须从列表头部开始挂载。
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.querySelector('[data-testid="chat-message"][data-vindex="0"]')
              ?.getAttribute("data-mid") ?? null,
        ),
      { timeout: 8_000, intervals: [120, 240] },
    )
    .toBe("seed-001");
  await assertNoBlankBand(page, "seeded scrolled-top");

  for (const station of ["seed-040", "seed-080"] as const) {
    // 程序化分步推进（scrollTop += 650）：目标行进入可视区为止。
    // 虚拟列表本就只挂载可视邻域；此处验收的是窗口映射，不是手势。
    let reached = false;
    for (let step = 0; step < 90 && !reached; step += 1) {
      reached = await page.evaluate((target) => {
        const el = document.querySelector('[data-testid="history"]');
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const host = el.querySelector(`[data-mid="${target}"]`);
        if (!host) return false;
        const r = host.getBoundingClientRect();
        return Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top) > 6;
      }, station);
      if (reached) break;
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
        if (el) el.scrollTop += 650;
      });
      await page.waitForTimeout(150);
    }
    expect(reached, `${station} becomes visible during reveal traverse`).toBe(true);
    const stationState = await measure(page);
    assertCoreGeometry(stationState, `seeded station ${station}`);
    await assertNoBlankBand(page, `seeded station ${station}`);
    expect(await page.getAttribute('[data-testid="history"]', "data-following")).toBe("false");
    if (station === "seed-080") {
      await page.screenshot({ path: ".impeccable/review/round7/chat-seeded-banner-middle.png" });
    }
  }

  // 尾部与恢复跟随：绝对底一次到位——间隙归零触发自动恢复，状态机
  // 随后把锚点重新收进可视矩形（产品规则的直接验证）。
  await jumpHistory(page, "bottom");
  await expect
    .poll(() => page.getAttribute('[data-testid="history"]', "data-following"), {
      timeout: 5_000,
      intervals: [60, 120],
    })
    .toBe("true");
  await waitAnchorConverged(page, "tail resumed follow");
  {
    const m = await measure(page);
    expect(m.draftCount).toBe(0);
    await assertNoBlankBand(page, "tail resumed follow");
  }

// ---- 回到底部阈值后跟随自动恢复并重新锚定 ----
  await setViewport(page, 812, 368);
  await waitAnchorConverged(page, "resumed follow");
  const resumedFlag = await page.getAttribute('[data-testid="history"]', "data-following");
  expect(resumedFlag, "follow resumed after returning near bottom").toBe("true");
  const resumed = await measure(page);
  assertCoreGeometry(resumed, "resumed follow");
  assertAnchoredLatest(resumed, "resumed follow");
  expect(resumed.visibleIds[resumed.visibleIds.length - 1]).toBe(LAST_MID);
});
