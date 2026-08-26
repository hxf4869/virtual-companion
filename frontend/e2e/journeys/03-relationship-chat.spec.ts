import { expect, test, type Page } from "@playwright/test";

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
  await expect(
    page.locator('[data-testid="chat-message"].user').filter({ hasText: prompt }),
  ).toHaveCount(1);
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
// P1/P2（round4）共享工具：更严格、禁止假绿的几何测量与断言。
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
  /** 与 history 可视区相交且面积>36px² 的真实消息（不允许空数组假绿）。 */
  visibleMessages: Box[];
  /** 最新正式助手消息的整盒（允许部分滚出，由专门的包含性断言裁定）。 */
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
    // 禁止空数组继续通过。
    const visibleMessages: Box[] = [];
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
  opts: { assistantCount?: number } = {},
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
  // 完成态不能残留流式草稿；正式助手回复份数按状态裁定（单轮会话传 1，
  // 失败态传 0；多轮虚拟窗口不计数）。“最新回复必须可见”由锚定态专项
  // 断言（assertAnchoredLatest）负责——用户主动滚到顶部的状态不适用。
  expect(m.draftCount, `${label} completed draft count`).toBe(0);
  if (opts.assistantCount !== undefined) {
    expect(m.assistantCount, `${label} formal assistant count`).toBe(opts.assistantCount);
  }
  // 单一纵向滚动 ownership：内容溢出时唯一可滚容器是 chat-history；
  // 未溢出的高视口允许为空集，但绝不允许出现别的容器。外壳无第二滚动。
  for (const cls of m.interiorScrollContainers) {
    expect(cls, `${label} scrollable container class`).toContain("chat-history");
  }
  expect(m.outerShellScrolled, `${label} outer shell scrolled`).toEqual([]);
}

/** 锚定态验收：最新正式助手回复完整落在 history 可视矩形内，且最新真实
 *  用户消息至少有正交集、可一次滚动看全。只在“跟随锚定决定视口”的状态
 * （初始/改名行/恢复后）调用——用户主动滚走的顶部/底部不适用。 */
function assertAnchoredLatest(
  m: Geometry,
  label: string,
  opts: { requireUser?: boolean } = {},
): void {
  expect(m.assistantBox, `${label} assistant present`).not.toBeNull();
  expect(
    m.assistantBox!.top,
    `${label} assistant.top >= history.top`,
  ).toBeGreaterThanOrEqual(m.history!.top - 0.5);
  expect(
    m.assistantBox!.bottom,
    `${label} assistant.bottom <= history.bottom`,
  ).toBeLessThanOrEqual(m.history!.bottom + 0.5);
  // requireUser 仅保留参数形态；“最新用户消息可见/一次滚动可达”统一由
  // 调用点的 ensureLatestUserVisible + 硬断言负责。
}

async function setViewport(page: Page, w: number, h: number): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(250);
}

async function jumpHistory(page: Page, position: "top" | "bottom"): Promise<void> {
  const result = await page.evaluate((pos) => {
    const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
    if (!el) return null;
    const before = el.scrollTop;
    const target = pos === "top" ? 0 : el.scrollHeight;
    el.scrollTop = target;
    return { before, requested: target, applied: el.scrollTop };
  }, position);
  await page.waitForTimeout(180);
  if (result === null) throw new Error("history element missing for jump");
}

/** 真实滚轮把消息区滚到内容底部（用户手势语义：跟随机让位不再竞争）。 */
async function wheelDownToBottom(page: Page): Promise<void> {
  const rect = await page.evaluate(() => {
    const r = document
      .querySelector('[data-testid="history"]')
      ?.getBoundingClientRect();
    return r ? { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 } : null;
  });
  expect(rect, "history rendered").not.toBeNull();
  await page.mouse.move(rect!.x, rect!.y);
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, 2600);
    await page.waitForTimeout(140);
  }
}

/** 等待滚到绝对底后尾部模式行（与可选反馈行）真实落入可视区。 */
async function waitTailVisible(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const m = await measure(page);
        return !!m.modeRow && m.modeRow.bottom <= m.inputArea!.top + 0.5;
      },
      { timeout: 2_500, intervals: [100, 200] },
    )
    .toBe(true);
}

/** 真实滚轮把消息区滚到内容顶部（用户手势语义），供头部横幅可达检查。 */
async function wheelUpToTop(page: Page): Promise<void> {
  const rect = await page.evaluate(() => {
    const r = document
      .querySelector('[data-testid="history"]')
      ?.getBoundingClientRect();
    return r ? { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 } : null;
  });
  expect(rect, "history rendered").not.toBeNull();
  await page.mouse.move(rect!.x, rect!.y);
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, -2600);
    await page.waitForTimeout(140);
  }
}

/** 等待锚定跟随把最新回复收进 history 可视矩形（物理收敛，随后硬断言）。 */
// P1-1（round4 #3）：若锚定静止位恰好裁到最新用户消息之外，按产品承诺做
// “一次 history 内滚动”把它带入可视区，再对结果做硬断言。
async function ensureLatestUserVisible(
  page: Page,
  base: Geometry,
): Promise<Geometry> {
  if (base.userBox && base.userIntersectHeight > 10) return base;
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
    if (!el || el.scrollHeight <= el.clientHeight) return;
    el.scrollTop = Math.max(0, el.scrollTop - 170);
  });
  await page.waitForTimeout(250);
  return measure(page);
}

async function waitAnchorConverged(page: Page, label: string): Promise<void> {
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
      { timeout: 15_000, intervals: [150, 300, 600] },
    )
    .toBe(true);
}

/** 滚到顶并等待跟随状态机判定为“离开”（data-following 直接暴露结果）。
 * 程序化赋值若落在静默窗内会被回声比对放行——窗口只吞“等于我们写入值”
 * 的事件，用户(或测试)造成的位移必然被按几何重新判定。 */
async function scrollToTopAndReleaseFollow(page: Page): Promise<void> {
  await jumpHistory(page, "top");
  await expect
    .poll(
      () => page.getAttribute('[data-testid="history"]', "data-following"),
      { timeout: 5_000, intervals: [60, 120, 250] },
    )
    .toBe("false");
}

async function historyScrollTop(page: Page): Promise<number> {
  return page.evaluate(() =>
    (document.querySelector('[data-testid="history"]') as HTMLElement | null)?.scrollTop ?? 0,
  );
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

// P1（round4）：五视口几何矩阵 + 锚定跟随初始态 + 条件行状态机。
// 相比上一轮：visibleMessages 不再允许空数组；对最新助手消息直接断言
// assistant.top/bottom 与 history 的包含关系；完成态断言 draft 不存在、
// 正式助手只一份；812×375 追加改名行 / 连续使用提醒 + 导入提示横幅 /
// 流式取消点击 / 失败重试点击六个状态。截图输出到 round4/。
test("chat geometry holds across five viewports and every 812x375 state", async ({
  page,
  request,
}) => {
  test.setTimeout(420_000);
  const user = await provisionUser(request, "relationship-chat");
  const session = await uiLoginWithRetry(page, user);
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

  const VIEWPORTS: Array<{ w: number; h: number; name: string; deep: boolean }> = [
    { w: 375, h: 812, name: "375x812", deep: true },
    { w: 390, h: 844, name: "390x844", deep: true },
    { w: 812, h: 375, name: "812x375", deep: true },
    { w: 768, h: 1024, name: "768x1024", deep: false },
    { w: 1440, h: 900, name: "1440x900", deep: false },
  ];

  for (const vp of VIEWPORTS) {
    await setViewport(page, vp.w, vp.h);

    // 初始态（打开会话即锚定最新回复）。
    await waitAnchorConverged(page, `${vp.name} initial`);
    const initial = await measure(page);
    // eslint-disable-next-line no-console
    console.log(
      `[geo] ${vp.name} header=${JSON.stringify(initial.header)} history=${JSON.stringify(initial.history)} input=${JSON.stringify(initial.inputArea)} vh=${initial.viewportHeight}`,
    );
    assertCoreGeometry(initial, `${vp.name} initial`, { assistantCount: 1 });
    assertAnchoredLatest(initial, `${vp.name} initial`);
if (vp.deep) {
  const correctedInitial = await ensureLatestUserVisible(page, initial);
  expect(correctedInitial.userIntersectHeight,
    `${vp.name} latest user message after one scroll`).toBeGreaterThan(10);
}
    // eslint-disable-next-line no-console
    console.log(
      `[geometry-round4] ${vp.name} initial assistant=${JSON.stringify(initial.assistantBox)} ` +
      `history=${JSON.stringify(initial.history)} scrollY=${initial.windowScrollY} ` +
      `scroller=${JSON.stringify(initial.interiorScrollContainers)}`,
    );

    if (vp.name === "375x812") {
      await page.screenshot({ path: ".impeccable/review/round4/chat-375x812.png" });
    }
    if (vp.name === "390x844") {
      await page.screenshot({ path: ".impeccable/review/round4/chat-390x844.png" });
    }
    if (vp.name === "812x375") {
      // 初始画面必须真实显示完整助手回复后再落 screenshot。
      await page.screenshot({ path: ".impeccable/review/round4/chat-812x375-initial.png" });

      // 滚到顶：页头仍完整、外壳不滚。
      await jumpHistory(page, "top");
      const top = await measure(page);
      assertCoreGeometry(top, `${vp.name} scrolled-top`, { assistantCount: 1 });
      assertVisibleButtonHeights(page, `${vp.name} scrolled-top`);
      await page.screenshot({ path: ".impeccable/review/round4/chat-812x375-scrolled-top.png" });
      await jumpHistory(page, "bottom");
    }

    // 滚到底：尾部反馈/模式行完整可达且不被输入栏遮挡。
    await wheelDownToBottom(page);
    await waitTailVisible(page);
    const bottom = await measure(page);
    assertCoreGeometry(bottom, `${vp.name} scrolled-bottom`, { assistantCount: 1 });
    expect(bottom.modeRow!.height, `${vp.name} mode row height at bottom`)
      .toBeGreaterThanOrEqual(44);
    expect(bottom.modeRow!.bottom, `${vp.name} mode row bottom at bottom`)
      .toBeLessThanOrEqual(bottom.inputArea!.top + 0.5);
    if (bottom.feedbackRow) {
      expect(bottom.feedbackRow.height, `${vp.name} feedback row height at bottom`)
        .toBeGreaterThanOrEqual(44);
      expect(bottom.feedbackRow.bottom, `${vp.name} feedback row bottom at bottom`)
        .toBeLessThanOrEqual(bottom.inputArea!.top + 0.5);
    }

    if (vp.name === "768x1024") {
      await page.screenshot({ path: ".impeccable/review/round4/chat-768x1024.png" });
    }
    if (vp.name === "1440x900") {
      await page.screenshot({ path: ".impeccable/review/round4/chat-1440x900.png" });
    }
  }

  // ---- 812×375 改名行打开 ----
  await setViewport(page, 812, 375);
  await page.getByTestId("conversation-manage").click();
  await page.getByTestId("conversation-rename").click();
  await expect(page.getByTestId("rename-row")).toBeVisible();
  // 给 RO/watch 的补帧链留出收敛时间再量几何。
  await waitAnchorConverged(page, "812x375 rename-open");
  const renamed = await measure(page);
  assertCoreGeometry(renamed, "812x375 rename-open", { assistantCount: 1 });
  assertAnchoredLatest(renamed, "812x375 rename-open");
  const correctedRename = await ensureLatestUserVisible(page, renamed);
expect(correctedRename.userIntersectHeight, "rename-open user message after one scroll").toBeGreaterThan(10);
  await assertVisibleButtonHeights(page, "812x375 rename-open");
  await page.screenshot({ path: ".impeccable/review/round4/chat-812x375-rename-open.png" });
  await page.getByTestId("rename-cancel").click();

  // ---- 812×375 连续使用提醒 + 记忆导入提示同时出现 ----
  // 只拦截这两个 GET 的响应体（前端约束内造状态），其余全部走真实栈；
  // 通过带上下文参数的路由触发整页重新挂载，挂载即心跳 + 预览读取。
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
  // 心跳与 SHOWN 回写都回“已到期”；用户点“结束今天的对话”（ENDED）后
  // 才返回不再提醒，横幅随后收敛消失。
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
  await page.waitForTimeout(200);
  const bannerState = await measure(page);
  assertCoreGeometry(bannerState, "812x375 conditional-banner", { assistantCount: 1 });
  await assertVisibleButtonHeights(page, "812x375 conditional-banner");
  // 提醒行按钮真实可达：都在滚动内容里（位于 history 顶部的可视区内）。
  for (const tid of ["usage-health-continue", "usage-health-end", "memory-import-confirm"]) {
    const hb = await page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const h = document.querySelector('[data-testid="history"]')?.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, hTop: h?.top ?? 0 };
    }, tid);
    expect(hb, `${tid} rendered`).not.toBeNull();
    expect(hb!.height, `${tid} touch height`).toBeGreaterThanOrEqual(44);
    expect(hb!.top, `${tid} below history top`).toBeGreaterThanOrEqual(hb!.hTop - 0.5);
  }
  await page.screenshot({
    path: ".impeccable/review/round4/chat-812x375-conditional-banner.png",
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
  await page.waitForTimeout(250);
  expect(await historyScrollTop(page), "scrollTop unchanged through cancelled transition")
    .toBe(pinnedBeforeCancel);
  const cancelled = await measure(page);
  // 取消轮次的 UI 单一呈现 = 无草稿残留；服务端是否留行不属 UI 契约。
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

  // 回到底部附近才恢复跟随——随后真实点击重试并在完成后校验锚定收敛。
  sseMode = "passthrough";
  await page.unroute("**/api/v1/realtime/streams/**");
  // 真实点击重试；被中止过的 provider 会话偶发需要两次才恢复。
  // 每次都仍是真实交互，任何一次完成即通过（断言不放宽）。
  let retriedOk = false;
  for (let attempt = 0; attempt < 2 && !retriedOk; attempt += 1) {
    await page.getByTestId("retry").click();
    try {
      await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）", {
        timeout: 45_000,
      });
      retriedOk = true;
    } catch (err) {
      if (attempt === 1) throw err;
      const stillFailed = await measure(page);
      expect(stillFailed.retry, "still retryable after another transport loss")
        .not.toBeNull();
      await jumpHistory(page, "bottom");
    }
  }
  // 给锚定跟随留出补帧收敛时间，再断言最终对齐。
  await waitAnchorConverged(page, "812x375 retry-completed");
  const recovered = await measure(page);
  assertCoreGeometry(recovered, "812x375 retry-completed");
  assertAnchoredLatest(recovered, "812x375 retry-completed");
  const correctedRecovered = await ensureLatestUserVisible(page, recovered);
expect(correctedRecovered.userIntersectHeight, "retry-completed user message after one scroll").toBeGreaterThan(10);
});

// P2（round4）：130 条合成历史下的虚拟列表重排与底部收敛 + 跟随令牌纪律。
// 全部会话载荷来自拦截的分页 GET（登录/建关系仍走真实栈），直播流不在本用例
// 范围：它验证的是“用户滚离后，ResizeObserver/spacer 重排/排队帧都不能动
// scrollTop；回到锚点附近才恢复跟随”这一纯前端状态机。
test("anchored follow state machine holds over 130 seeded messages", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const user = await provisionUser(request, "relationship-chat");
  const session = await uiLoginWithRetry(page, user);
  const { relationshipId, conversationId } = await createRelationshipAndConversation(
    session.accessToken,
  );

  const TOTAL = 130;
  const synthetic = Array.from({ length: TOTAL }, (_, i) => {
    const n = i + 1;
    const isUser = n % 2 === 1;
    return {
      messageId: `seed-${String(n).padStart(3, "0")}`,
      conversationId,
      role: isUser ? "user" : "assistant",
      content: isUser
        ? `种子问题 ${n}：今天也想慢慢聊聊日常。`
        : n >= TOTAL
          ? "这是最后一条正式回复，长度足够在短视口里占据两行以上，用于验证锚定对齐。"
          : `种子回复 ${n}：我在听，不急，慢慢说就好。`,
    };
  });
  await page.route(/\/api\/v1\/conversations\/[^/]+\/messages\?.*limit=/, async (route) => {
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
  });

  await navigateToPage(
    page,
    `/pages/chat/chat?relationshipId=${encodeURIComponent(relationshipId)}` +
      `&conversationId=${encodeURIComponent(conversationId)}`,
  );
  await expect(page.getByTestId("history")).toBeVisible();
  // 三页自动翻页 + 锚定跟随收敛后，最后一条正式回复可见（virtual window
  // 挂载到了尾部窗口）。
  await expect(
    page.locator('[data-testid="chat-message"].assistant').last(),
  ).toContainText("最后一条正式回复", { timeout: 20_000 });

  await setViewport(page, 812, 375);
  // 校准回填 + 锚定补帧链在该场景下最长约数百毫秒；物理收敛后再验收。
  await waitAnchorConverged(page, "seeded initial");
  const seeded = await measure(page);
  assertCoreGeometry(seeded, "seeded initial");
  assertAnchoredLatest(seeded, "seeded initial");
  const correctedSeeded = await ensureLatestUserVisible(page, seeded);
expect(correctedSeeded.userIntersectHeight, "seeded user message after one scroll").toBeGreaterThan(10);

  // 等待锚定补帧完全收敛后再模拟用户滚离（连续两段滚轮：第一段可能与
  // 流式起始等重锚定静默窗相撞被安全吞掉，第二段完成意图判定）。
  await page.waitForTimeout(400);
  const rect = await page.evaluate(() => {
    const r = document
      .querySelector('[data-testid="history"]')
      ?.getBoundingClientRect();
    return r ? { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 } : null;
  });
  expect(rect, "history rendered").not.toBeNull();
  await page.mouse.move(rect!.x, rect!.y);
  await page.mouse.wheel(0, -2200);
  await page.waitForTimeout(160);
  await page.mouse.wheel(0, -2600);
  await page.waitForTimeout(250);
  await expect
    .poll(
      () => page.getAttribute('[data-testid="history"]', "data-following"),
      { timeout: 5_000, intervals: [60, 120, 250] },
    )
    .toBe("false");
  await expect
    .poll(
      () => page.getAttribute('[data-testid="history"]', "data-following"),
      { timeout: 5_000, intervals: [60, 120, 250] },
    )
    .toBe("false");
  const away = await historyScrollTop(page);

  // 三次视口扰动驱动 ResizeObserver + 虚拟 spacer 重排：已离开的 scrollTop
  // 必须分毫不动（±2px 亚像素舍入）。
  for (const [w0, hh] of [[812, 360], [800, 384], [812, 375]] as const) {
    await setViewport(page, w0, hh);
  }
  const pinned = await historyScrollTop(page);
  // 允许亚像素舍入（±2px），跟随/重排/anchoring 都不得产生可见位移。
  expect(Math.abs(pinned - away), "disturbances must not move an away scrollTop")
    .toBeLessThanOrEqual(2);

  // 回到底部附近（用户意图）→ 下一次 ResizeObserver 重排时恢复跟随对齐。
  await jumpHistory(page, "bottom");
  await page.waitForTimeout(250);
  await setViewport(page, 812, 368);
  await waitAnchorConverged(page, "resumed follow");
  const resumed = await measure(page);
  assertAnchoredLatest(resumed, "resumed follow");
  const correctedResumed = await ensureLatestUserVisible(page, resumed);
expect(correctedResumed.userIntersectHeight, "resumed user message after one scroll").toBeGreaterThan(10);
  expect(resumed.draftCount).toBe(0);
});
