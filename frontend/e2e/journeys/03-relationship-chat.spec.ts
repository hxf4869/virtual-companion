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

// P1-1 回归（812×375 横屏）：真实浏览器几何断言。行级元素只滚不压——
// 当前关系按钮不被裁切（≥44px）、消息区 ≥96px、输入栏完整；滚动到底后
// mode/feedback 行完整可见且与固定输入栏不重叠。
test("landscape 812x375 keeps the chat usable: rows scroll, nothing squashed or covered", async ({
  page,
  request,
}) => {
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
  await input.fill("横屏短视口下也要能完整读到这条消息。");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("status")).toHaveText("已完成（安全终态）", {
    timeout: 30_000,
  });

  await page.setViewportSize({ width: 812, height: 375 });
  const measure = () =>
    page.evaluate(() => {
      const box = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
        };
      };
      const history = document.querySelector('[data-testid="history"]');
      return {
        viewportHeight: window.innerHeight,
        relation: box(document.querySelector('[data-testid="current-relationship"]')),
        relationBtn: box(document.querySelector('[data-testid="deactivate-relationship"]')),
        history: box(history),
        historyClientHeight: history ? history.clientHeight : 0,
        message: box(document.querySelector('[data-testid="assistant-md"]')),
        inputArea: box(document.querySelector(".chat-input-area")),
        input: box(document.querySelector('[data-testid="message-input"] input')),
        modeRow: box(document.querySelector('[data-testid="mode-row"]')),
        feedbackRow: box(document.querySelector('[data-testid="feedback-row"]')),
        mainScroll: (() => {
          const main = document.querySelector(".chat-main") as HTMLElement | null;
          return main
            ? { scrollTop: main.scrollTop, scrollHeight: main.scrollHeight, clientHeight: main.clientHeight }
            : null;
        })(),
      };
    });

  const before = await measure();
  // 当前关系按钮：真实高度 ≥44px，且完整落在视口内（没有被行容器裁掉）。
  expect(before.relationBtn, "relation button box").not.toBeNull();
  expect(before.relationBtn!.height).toBeGreaterThanOrEqual(44);
  expect(before.relationBtn!.width).toBeGreaterThanOrEqual(44);
  expect(before.relationBtn!.bottom).toBeLessThanOrEqual(before.viewportHeight + 0.5);
  expect(before.relation!.height).toBeGreaterThanOrEqual(before.relationBtn!.height);

  // 消息区：实际高度 ≥96px，且助手回复真实渲染（可读）。
  expect(before.historyClientHeight).toBeGreaterThanOrEqual(96);
  expect(before.message!.height).toBeGreaterThan(12);
  expect(before.message!.width).toBeGreaterThan(60);

  // 输入栏：完整落在视口底部，不缺一角。
  expect(before.inputArea!.bottom).toBeLessThanOrEqual(before.viewportHeight + 0.5);
  expect(before.inputArea!.top).toBeGreaterThanOrEqual(before.viewportHeight - 80);
  expect(before.input!.height).toBeGreaterThanOrEqual(44);

  // 滚动到底：mode/feedback 行完整可见，且不与固定输入栏重叠。
  const scrolled = await page.evaluate(() => {
    const main = document.querySelector(".chat-main") as HTMLElement | null;
    if (!main) return false;
    main.scrollTop = main.scrollHeight;
    return true;
  });
  expect(scrolled).toBe(true);
  await page.waitForTimeout(150);
  const after = await measure();
  expect(after.mainScroll!.scrollHeight).toBeGreaterThan(after.mainScroll!.clientHeight);
  for (const [name, row] of [["mode-row", after.modeRow], ["feedback-row", after.feedbackRow]] as const) {
    expect(row, `${name} box`).not.toBeNull();
    expect(row!.bottom).toBeLessThanOrEqual(after.inputArea!.top + 0.5);
    expect(row!.top).toBeGreaterThanOrEqual(0);
    expect(row!.height).toBeGreaterThanOrEqual(44);
  }

  // 整页无横向溢出。
  const geometry = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
});
