import { expect, test } from "@playwright/test";

import {
  navigateToPage,
  prepareGenerationAccess,
  PROVIDER_REPLY,
  provisionUser,
  uiLogin,
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

// P1-A（round3）：五视口几何矩阵。Codex 复审要求——单一滚动 ownership
// （chat-history 是唯一纵向滚动容器，输入栏是 chat-main 之外的独立区域），
// 375×812 / 390×844 / 812×375 / 768×1024 / 1440×900 下：
//   1. 输入框与发送/取消/重试按钮始终完整落在视口内，可见高度 ≥44px；
//   2. 消息历史与反馈/模式行是滚动内容，可见边界不与输入栏相交；
//   3. 滚动容器到顶/底后上述断言仍成立，页头不滚出；
//   4. scrollWidth ≤ innerWidth；
//   5. round3 截图为完整 viewport page screenshot（非元素截图、非裁切）。
test("chat viewport geometry holds across 375x812 / 390x844 / 812x375 / 768x1024 / 1440x900", async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
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
  await input.fill("五个视口下都要完整读到这条真实消息。");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）", {
    timeout: 30_000,
  });

  type Box = {
    top: number; bottom: number; left: number; right: number;
    width: number; height: number;
  };
  const measure = () =>
    page.evaluate(() => {
      const box = (el: Element | null): Box | null => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          top: r.top, bottom: r.bottom, left: r.left, right: r.right,
          width: r.width, height: r.height,
        };
      };
      const history = document.querySelector('[data-testid="history"]');
      const historyRect = history as HTMLElement | null;
      const hv = historyRect
        ? { top: historyRect.getBoundingClientRect().top, bottom: historyRect.getBoundingClientRect().bottom }
        : null;
      // 可见消息：与 history 可视区相交（滚出视口的消息布局位置可能在
      // 容器之外，不参与“不被输入栏遮挡”断言）。
      const visibleMessages = hv
        ? Array.from(document.querySelectorAll('[data-testid="chat-message"]'))
            .map(box)
            .filter(
              (b): b is Box =>
                b !== null && b.top < hv.bottom - 0.5 && b.bottom > hv.top + 0.5,
            )
        : [];
      const scrollContainers = Array.from(
        document.querySelectorAll(".chat-main *"),
      )
        .filter((el) => {
          const s = getComputedStyle(el);
          return (s.overflowY === "auto" || s.overflowY === "scroll") &&
            (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight;
        })
        .map((el) => String((el as HTMLElement).className));
      const mainEl = document.querySelector(".chat-main") as HTMLElement | null;
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        header: box(document.querySelector(".chat-header")),
        inputArea: box(document.querySelector(".chat-input-area")),
        nativeInput: box(document.querySelector('[data-testid="message-input"] input')),
        send: box(document.querySelector('[data-testid="send"]')),
        cancel: box(document.querySelector('[data-testid="cancel"]')),
        retry: box(document.querySelector('[data-testid="retry"]')),
        history: box(history),
        historyClientHeight: historyRect ? historyRect.clientHeight : 0,
        visibleMessages,
        feedbackRow: box(document.querySelector('[data-testid="feedback-row"]')),
        modeRow: box(document.querySelector('[data-testid="mode-row"]')),
        assistantMessage: box(document.querySelector('[data-testid="assistant-md"]')),
        scrollContainers,
        mainOverflowY: mainEl ? getComputedStyle(mainEl).overflowY : null,
      };
    });

  const assertCoreGeometry = (
    m: Awaited<ReturnType<typeof measure>>,
    label: string,
  ) => {
    // 整页无横向溢出。
    expect(m.scrollWidth, `${label} scrollWidth`).toBeLessThanOrEqual(m.viewportWidth);
    // 页头完整在视口内（不随内容滚动）。
    expect(m.header!.top, `${label} header top`).toBeGreaterThanOrEqual(-0.5);
    expect(m.header!.bottom, `${label} header bottom`).toBeLessThanOrEqual(m.viewportHeight + 0.5);
    // 输入栏：独立区域，完整落在视口底部。
    expect(m.inputArea, `${label} inputArea box`).not.toBeNull();
    expect(m.inputArea!.top, `${label} inputArea top`).toBeGreaterThanOrEqual(0);
    expect(m.inputArea!.bottom, `${label} inputArea bottom`).toBeLessThanOrEqual(m.viewportHeight + 0.5);
    // 原生输入框与发送按钮：可见高度 ≥44 且完整。
    expect(m.nativeInput!.height, `${label} input height`).toBeGreaterThanOrEqual(44);
    expect(m.nativeInput!.bottom, `${label} input bottom`).toBeLessThanOrEqual(m.viewportHeight + 0.5);
    expect(m.send!.height, `${label} send height`).toBeGreaterThanOrEqual(44);
    expect(m.send!.bottom, `${label} send bottom`).toBeLessThanOrEqual(m.viewportHeight + 0.5);
    // 取消/重试只在流式/失败态渲染；存在时必须同样达标。
    for (const [name, b] of [["cancel", m.cancel], ["retry", m.retry]] as const) {
      if (b) {
        expect(b.height, `${label} ${name} height`).toBeGreaterThanOrEqual(44);
        expect(b.bottom, `${label} ${name} bottom`).toBeLessThanOrEqual(m.viewportHeight + 0.5);
      }
    }
    // 消息历史是滚动内容：容器边界不越过输入栏；部分滚出的消息由
    // history 自身 overflow 裁切（视觉），其可见段（与 history 视口的
    // 交集）不得越过输入栏上沿——即输入栏从不覆盖消息。
    expect(m.history!.bottom, `${label} history bottom`).toBeLessThanOrEqual(m.inputArea!.top + 0.5);
    for (const [i, msg] of m.visibleMessages.entries()) {
      expect(Math.min(msg.bottom, m.history!.bottom), `${label} visible message ${i} clipped bottom`)
        .toBeLessThanOrEqual(m.inputArea!.top + 0.5);
    }
    // 单一纵向滚动 ownership：chat-main 自身永不滚，实际可滚的纵向容器
    // 只能是 chat-history（内容不满时列表为空也成立）。
    expect(m.mainOverflowY, `${label} chat-main overflow-y`).toBe("hidden");
    for (const cls of m.scrollContainers) {
      expect(cls, `${label} scrollable container class`).toContain("chat-history");
    }
  };

  const scrollHistoryTo = async (position: "top" | "bottom") => {
    await page.evaluate((pos) => {
      const el = document.querySelector('[data-testid="history"]') as HTMLElement | null;
      if (!el) return;
      el.scrollTop = pos === "top" ? 0 : el.scrollHeight;
    }, position);
    await page.waitForTimeout(150);
  };

  const VIEWPORTS: Array<{ w: number; h: number; name: string; deep: boolean }> = [
    { w: 375, h: 812, name: "375x812", deep: true },
    { w: 390, h: 844, name: "390x844", deep: false },
    { w: 812, h: 375, name: "812x375", deep: true },
    { w: 768, h: 1024, name: "768x1024", deep: false },
    { w: 1440, h: 900, name: "1440x900", deep: false },
  ];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(200);

    // 初始态（打开会话即贴底）：核心几何 + 深度断言。
    const initial = await measure();
    assertCoreGeometry(initial, `${vp.name} initial`);
    if (vp.deep) {
      // 运行时几何证据（复审引用）：输入栏 / 原生输入框 / 发送按钮 / 消息区。
      // eslint-disable-next-line no-console
      console.log(
        `[geometry] ${vp.name} inputArea=${JSON.stringify(initial.inputArea)} ` +
        `input=${JSON.stringify(initial.nativeInput)} send=${JSON.stringify(initial.send)} ` +
        `history=${JSON.stringify(initial.history)}`,
      );
    }
    if (vp.deep) {
      // 812×375 初始态必须完整读到真实用户/助手消息。
      expect(initial.assistantMessage!.bottom, `${vp.name} assistant visible bottom`)
        .toBeLessThanOrEqual(initial.history!.bottom + 0.5);
      expect(initial.assistantMessage!.height, `${vp.name} assistant height`)
        .toBeGreaterThan(12);
      expect(initial.historyClientHeight, `${vp.name} history client height`)
        .toBeGreaterThanOrEqual(96);
      // 反馈/模式行是滚动内容：滚到底后完整可见且不与输入栏相交。
      expect(initial.modeRow!.bottom, `${vp.name} mode row bottom`)
        .toBeLessThanOrEqual(initial.inputArea!.top + 0.5);
      if (initial.feedbackRow) {
        expect(initial.feedbackRow.bottom, `${vp.name} feedback row bottom`)
          .toBeLessThanOrEqual(initial.inputArea!.top + 0.5);
      }
    }
    if (vp.name === "375x812") {
      await page.screenshot({
        path: ".impeccable/review/round3/chat-375x812.png",
        fullPage: false,
      });
    }
    if (vp.name === "390x844") {
      await page.screenshot({
        path: ".impeccable/review/round3/chat-390x844.png",
        fullPage: false,
      });
    }
    if (vp.name === "812x375") {
      await page.screenshot({
        path: ".impeccable/review/round3/chat-812x375.png",
        fullPage: false,
      });
    }

    // 滚动到顶：历史消息可见，输入栏与页头仍完整。
    await scrollHistoryTo("top");
    const top = await measure();
    assertCoreGeometry(top, `${vp.name} scrolled-top`);
    if (vp.name === "812x375") {
      // 初始态已贴底（与 bottom 截图一致）；scrolled 取顶部状态，证明
      // 滚动到任意位置输入栏仍完整。
      await page.screenshot({
        path: ".impeccable/review/round3/chat-812x375-scrolled.png",
        fullPage: false,
      });
    }

    // 滚动到底：反馈/模式行完整可见且不被输入栏遮挡。
    await scrollHistoryTo("bottom");
    const bottom = await measure();
    assertCoreGeometry(bottom, `${vp.name} scrolled-bottom`);
    if (bottom.modeRow) {
      expect(bottom.modeRow.height, `${vp.name} mode row height at bottom`)
        .toBeGreaterThanOrEqual(44);
      expect(bottom.modeRow.bottom, `${vp.name} mode row bottom at bottom`)
        .toBeLessThanOrEqual(bottom.inputArea!.top + 0.5);
    }
    if (bottom.feedbackRow) {
      expect(bottom.feedbackRow.height, `${vp.name} feedback row height at bottom`)
        .toBeGreaterThanOrEqual(44);
      expect(bottom.feedbackRow.bottom, `${vp.name} feedback row bottom at bottom`)
        .toBeLessThanOrEqual(bottom.inputArea!.top + 0.5);
    }
    if (vp.name === "768x1024") {
      await page.screenshot({
        path: ".impeccable/review/round3/chat-768x1024.png",
        fullPage: false,
      });
    }
    if (vp.name === "1440x900") {
      await page.screenshot({
        path: ".impeccable/review/round3/chat-1440x900.png",
        fullPage: false,
      });
    }
  }

  // 流式与失败态的取消/重试按钮几何：挂起 SSE 流让 streaming 可测
  //（generations POST 正常完成才进入 streaming 相位），再 abort 制造
  // failed 态（375×812 下验证 ≥44 且完整在视口内）。
  await page.setViewportSize({ width: 375, height: 812 });
  let releaseHang: (() => void) | undefined;
  let streamHits = 0;
  await page.route("**/api/v1/realtime/streams/*", async (route) => {
    streamHits += 1;
    if (streamHits === 1) {
      // 仅第一次挂起（供测量 streaming 态）；重连请求直接失败，
      // 让传输层收敛到 failed 而不是在挂起的 route 上死等。
      await new Promise<void>((resolve) => {
        releaseHang = resolve;
      });
    }
    await route.abort("connectionfailed");
  });
  await input.fill("这条消息会失败，用来量取消与重试按钮。");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("cancel")).toBeVisible({ timeout: 30_000 });

  const streaming = await measure();
  expect(streaming.cancel, "cancel box while streaming").not.toBeNull();
  expect(streaming.cancel!.height).toBeGreaterThanOrEqual(44);
  expect(streaming.cancel!.bottom).toBeLessThanOrEqual(streaming.viewportHeight + 0.5);

  releaseHang?.();
  await expect(page.getByTestId("retry")).toBeVisible({ timeout: 30_000 });
  const failed = await measure();
  expect(failed.retry, "retry box after failure").not.toBeNull();
  expect(failed.retry!.height).toBeGreaterThanOrEqual(44);
  expect(failed.retry!.bottom).toBeLessThanOrEqual(failed.viewportHeight + 0.5);
  expect(failed.inputArea!.bottom).toBeLessThanOrEqual(failed.viewportHeight + 0.5);
  await page.unroute("**/api/v1/realtime/streams/*");
});
