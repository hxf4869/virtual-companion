import { expect, test, type Route } from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  openSharedSession,
  prepareGenerationAccess,
  PROVIDER_REPLY,
  sessionRequest,
} from "../helpers";

test("home starts the first conversation and later resumes it", async ({ page }) => {
  const session = await openSharedSession(page, "chat");
  await prepareGenerationAccess(session);

  await navigateToPage(page, "/pages/index/index");
  await expect(page.getByTestId("current-relationship")).toBeVisible();
  await expect(page.getByTestId("home-start-chat")).toHaveText("开始第一次对话");
  await page.getByTestId("home-start-chat").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/chat/chat"));
  await expect(page.getByTestId("empty-history")).toContainText("从这里开始");
  await expect(page.getByTestId("chat-ai-label")).toContainText("非真人");

  const prompt = "今天有点忙，想慢慢聊一会儿。";
  const draft = "等回复时写下的另一句";
  // VC-R172: 两个真实 POST 各自经独立 route gate 延迟（continue 放行，不
  // mock 响应）：先放行创建观察准备反馈，再放行 generation 观察发送进度与
  // 真实回复。method!==POST 的请求 fallback 放行；finally 无条件释放两个
  // gate 并按既有方式 unroute，断言失败也不遗留悬挂 handler。
  let createPosts = 0;
  let generationPosts = 0;
  let releaseCreate!: () => void;
  let releaseGeneration!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const generationGate = new Promise<void>((resolve) => {
    releaseGeneration = resolve;
  });
  const gateCreate = async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createPosts += 1;
    await createGate;
    await route.continue();
  };
  const gateGeneration = async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    generationPosts += 1;
    await generationGate;
    await route.continue();
  };
  try {
    await page.route(/\/api\/v1\/conversations$/, gateCreate);
    await page.route(/\/generations$/, gateGeneration);
    const accepted = page.waitForResponse(
      (response) => response.request().method() === "POST"
        && /\/api\/v1\/conversations\/\d+\/generations$/.test(new URL(response.url()).pathname),
    );
    const messageInput = page.locator('[data-testid="message-input"] textarea');
    await messageInput.fill(prompt);
    await page.getByTestId("send").click();

    // 建会话挂起：发送不可提交、准备反馈可见、空态让位；等待期间真实写入
    // 下一条草稿（fill 对禁用输入会失败超时，写入成功即证可编辑）。
    await expect(page.getByTestId("send")).toBeDisabled();
    await expect(page.getByTestId("empty-history")).toHaveCount(0);
    await expect(page.getByTestId("status")).toContainText("正在准备会话…");
    await messageInput.fill(draft);
    await expect(messageInput).toHaveValue(draft);

    releaseCreate();
    await expect.poll(() => generationPosts, { timeout: 15_000 }).toBe(1);

    // generation POST 挂起：明确的发送进度、发送不可提交，B 仍可编辑/保留。
    await expect(page.getByTestId("send")).toBeDisabled();
    await expect(page.getByTestId("status")).toContainText("正在发送…");
    await messageInput.fill(draft);
    await expect(messageInput).toHaveValue(draft);

    releaseGeneration();
    expect((await accepted).ok()).toBeTruthy();

    await expect(page.getByTestId("user-message").filter({ hasText: prompt })).toHaveCount(1);
    await expect(page.getByTestId("assistant-md").filter({ hasText: PROVIDER_REPLY })).toBeVisible({
      timeout: 30_000,
    });
    // 两个 POST 各恰好一次；等待期的 B 草稿保留，状态区不再有准备/发送进度。
    expect(createPosts).toBe(1);
    expect(generationPosts).toBe(1);
    await expect(messageInput).toHaveValue(draft);
    await expect(page.getByTestId("status")).not.toContainText(/正在准备会话…|正在发送…/);
    await expect(page.locator("body")).not.toContainText(/SSE|Provider|Token|Runtime/);
  } finally {
    releaseCreate();
    releaseGeneration();
    await page.unroute(/\/api\/v1\/conversations$/, gateCreate);
    await page.unroute(/\/generations$/, gateGeneration);
  }

  await page.getByTestId("tab-home").click();
  await expect(page.getByTestId("home-continue-chat")).toHaveText("继续上次对话");
  await expect(page.getByTestId("home-recent-conversations")).toBeVisible();

  await page.getByTestId("home-view-all").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/conversations/conversations"));
  await expect(page.getByTestId("conversations-list")).toBeVisible();
  await expect(page.getByTestId("session-preview").first()).toBeVisible();
});

// VC-R179：已排队的跟底帧不抢走阅读位置。scheduleScrollToBottom 的帧
// 排队后，仅原生 scroll（滚动条拖拽/辅助滚动，无 wheel/touchmove/
// keydown 用户意图）把 followingLatest 置 false，不取消排队帧——旧
// 生产在帧回调里仍写 scrollTop=scrollHeight 抢走阅读位置。验证保持
// 原生语义：同一个同步 JS 段内 dispatch resize（排队跟底帧）→ 设置
// 阅读位置 → dispatch scroll；同步段内排队的 RAF 不会执行，段内对
// requestAnimationFrame 仅透明计数并立即透传原生，段结束即恢复，排队
// 帧随后由浏览器自然执行——全部回调原生调度，无控制器状态遗留。
test("queued auto-scroll frames keep the reading position after a native scroll away", async ({ page }, testInfo) => {
  const session = await openSharedSession(page, "chat");
  await prepareGenerationAccess(session);
  const { relationshipId, conversationId } = await createRelationshipAndConversation(session);
  const writeOptions = { accountId: session.accountId, sessionId: session.sessionId };

  try {
    await navigateToPage(
      page,
      `/pages/chat/chat?relationshipId=${encodeURIComponent(relationshipId)}&conversationId=${encodeURIComponent(conversationId)}`,
    );
    await expect(page.getByTestId("empty-history")).toContainText("从这里开始");

    // 一条长而合法的合成消息：70 行显式换行短句（总长 <1000 字，UI
    // maxlength=4000 内），配合栈内 loopback provider 的固定回复，一次
    // 真实发送即可得到多屏可滚动历史，不跑多轮、不碰真实供应商。
    const longPrompt = Array.from({ length: 70 }, (_, index) => `第${index + 1}行：慢慢说，我在听。`).join("\n");
    await page.locator('[data-testid="message-input"] textarea').fill(longPrompt);
    await page.getByTestId("send").click();

    // completed 与历史窗口刷新之间，finalAssistant 与持久化消息可能短暂
    // 同时渲染；取最后一条，语义仍是"本会话出现 provider 回复"。
    await expect(page.getByTestId("assistant-md").filter({ hasText: PROVIDER_REPLY }).last())
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("status")).not.toContainText("正在回复");

    const distanceFromBottom = () => page.evaluate(() => {
      const node = document.querySelector<HTMLElement>('[data-testid="history"]');
      return node ? node.scrollHeight - node.clientHeight - node.scrollTop : Number.NaN;
    });

    // 可滚动历史成立：等待历史回读完成后差值 >400（同一条件，等待而非
    // 放宽），再确认自动跟随已把视口带到最新消息附近。
    await expect.poll(() => page.evaluate(() => {
      const node = document.querySelector<HTMLElement>('[data-testid="history"]');
      return node ? node.scrollHeight - node.clientHeight : Number.NaN;
    }), { timeout: 10_000 }).toBeGreaterThan(400);
    await expect.poll(distanceFromBottom, { timeout: 10_000 }).toBeLessThanOrEqual(48);

    // 前置高度正控（原生 RAF，任何包装之前）：贴底状态下 932→700 缩高，
    // 既有自动跟随应把视口带回底部。
    await page.setViewportSize({ width: 430, height: 932 });
    await expect.poll(distanceFromBottom, { timeout: 5_000 }).toBeLessThanOrEqual(48);
    await page.setViewportSize({ width: 430, height: 700 });
    await expect.poll(distanceFromBottom, { timeout: 5_000 }).toBeLessThanOrEqual(48);

    // 三档设计规定视口各核一次布局与阅读位置：每档先正常布局并准备贴底
    // （原生 RAF），再注入同步竞态。
    for (const [width, height] of [[320, 568], [390, 844], [430, 932]] as const) {
      await page.setViewportSize({ width, height });
      await expect.poll(distanceFromBottom, { timeout: 5_000 }).toBeLessThanOrEqual(48);

      const queued = await page.evaluate(async () => {
        const node = document.querySelector<HTMLElement>('[data-testid="history"]');
        if (!node) throw new Error("history node not found");
        const original = window.requestAnimationFrame;
        const waitFrames = (count: number) => new Promise<void>((resolve) => {
          let left = count;
          const tick = (): void => {
            left -= 1;
            if (left <= 0) resolve();
            else original.call(window, tick);
          };
          original.call(window, tick);
        });
        // 让既有帧先完成（pendingScrollFrame 归零、布局稳定）。
        await waitFrames(2);
        let scheduled = 0;
        let readingTop = 0;
        try {
          // 同步段开始：仅计数并立即透传原生（不拦截 callback、不造 ID、
          // 不改 cancel）；段内排队的 RAF 在本任务结束后由浏览器执行。
          window.requestAnimationFrame = (callback: FrameRequestCallback) => {
            scheduled += 1;
            return original.call(window, callback);
          };
          window.dispatchEvent(new Event("resize"));
          readingTop = node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 600);
          node.dispatchEvent(new Event("scroll", { bubbles: true }));
        } finally {
          window.requestAnimationFrame = original;
        }
        // 同步段结束即恢复原始引用；排队帧随后自然执行——修复后按最新
        // followingLatest 跳过，旧生产写回底部。
        await waitFrames(2);
        return { scheduled, readingTop, keptTop: node.scrollTop };
      });

      expect(queued.scheduled, `no follow frame scheduled at ${width}x${height}`).toBeGreaterThan(0);
      expect(queued.keptTop, `reading position stolen at ${width}x${height}`).toBe(queued.readingTop);
      await expect(page.getByTestId("back-to-latest")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`vc-r179-reading-kept-${width}x${height}.png`) });

      // 真实 UI 回到最新：视口回到底部，下一档从跟随状态重新开始。
      await page.getByTestId("back-to-latest").click();
      await expect.poll(distanceFromBottom, { timeout: 5_000 }).toBeLessThanOrEqual(48);
    }

    // 末尾高度正控（原生 RAF）：末档真实回到最新贴底后紧跟 932→700 缩
    // 高——贴底写入会同步更新观测基线，不依赖等待 scroll 事件消化，既
    // 有自动跟随应把视口带回底部。
    await page.setViewportSize({ width: 430, height: 700 });
    await expect.poll(distanceFromBottom, { timeout: 5_000 }).toBeLessThanOrEqual(48);
  } finally {
    // 只软删除本 case 创建的会话，不触碰共享账号其它数据。
    const deleted = await sessionRequest(
      page,
      "DELETE",
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
      undefined,
      writeOptions,
    );
    expect(deleted.ok, `conversation cleanup failed: ${deleted.status}`).toBeTruthy();
  }
});
