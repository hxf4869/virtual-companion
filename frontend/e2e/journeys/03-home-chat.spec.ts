import { expect, test, type Response, type Route } from "@playwright/test";

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

    const distanceFromBottom = () => page.evaluate(() => {
      const node = document.querySelector<HTMLElement>('[data-testid="history"]');
      return node ? node.scrollHeight - node.clientHeight - node.scrollTop : Number.NaN;
    });

    // VC-R182：初始化空历史已结束、发送前窄拦本会话终局补页——空窗口下
    // 补页首页与最近窗口同形（无 after 游标），故按本会话 messages 路径窄
    // 拦，仅放行 load-more（before 游标）；初始最近窗口在本 route 安装前
    // 已完成，安装后到达的即终局补页。SSE 与身份核对快照照常真实完成。
    // 终局历史挂起期间断言用户长消息仍恰好一条、视口正常贴底；放行并精确
    // unroute 后继续原有前后 932→700 正控、3 尺寸与回到最新流程。
    let releaseFinalHistory!: () => void;
    const finalHistoryGate = new Promise<void>((resolve) => {
      releaseFinalHistory = resolve;
    });
    let heldFinalHistoryCalls = 0;
    let heldFinalHistorySettled = 0;
    const holdFinalHistory = async (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith(`/api/v1/conversations/${conversationId}/messages`)) {
        return route.fallback();
      }
      if (url.searchParams.get("before") !== null) return route.fallback();
      heldFinalHistoryCalls += 1;
      try {
        await finalHistoryGate;
        await route.continue();
      } finally {
        heldFinalHistorySettled += 1;
      }
    };
    await page.route(/\/api\/v1\/conversations\/\d+\/messages/, holdFinalHistory);

    // 一条长而合法的合成消息：70 行显式换行短句（总长 <1000 字，UI
    // maxlength=4000 内），配合栈内 loopback provider 的固定回复，一次
    // 真实发送即可得到多屏可滚动历史，不跑多轮、不碰真实供应商。
    // 声明在 inner try 之外：末尾的同文草稿 B 回归也复用同一输入定位。
    const longPrompt = Array.from({ length: 70 }, (_, index) => `第${index + 1}行：慢慢说，我在听。`).join("\n");
    const submittedPrompt = `${longPrompt}!`;
    const messageInput = page.locator('[data-testid="message-input"] textarea');

    try {
      await messageInput.fill(longPrompt);
      // VC-R183：真实键盘紧接补一个尾字符——uni 对 input 发射做 100ms
      // 节流，连续输入的尾字可能尚未进入 modelValue，提交必须等于用户
      // 当前看到的完整原生输入。点击前先建立本会话 generation POST 等待。
      await messageInput.press("!");
      const generationPost = page.waitForResponse(
        (response) =>
          response.request().method() === "POST"
          && /\/api\/v1\/conversations\/\d+\/generations$/.test(new URL(response.url()).pathname),
      );
      await page.getByTestId("send").click();
      const generationResponse = await generationPost;
      // 只比较"提交正文等于实际完整输入"的布尔，不打印请求/正文/键/ID。
      const submittedBody = generationResponse.request().postDataJSON() as { userContent?: string };
      expect(
        submittedBody.userContent === submittedPrompt,
        "generation POST 提交正文等于实际完整输入（含尾字符）",
      ).toBe(true);

      // completed 与历史窗口刷新之间，finalAssistant 与持久化消息可能短暂
      // 同时渲染；取最后一条，语义仍是"本会话出现 provider 回复"。
      await expect(page.getByTestId("assistant-md").filter({ hasText: PROVIDER_REPLY }).last())
        .toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("status")).not.toContainText("正在回复");

      // 完成而终局历史仍挂起：补页恰好被拦一次；用户长消息不因乐观回显
      // 退出而消失（恰好一条），视口保持贴底、跟随未被夺走。
      await expect.poll(() => heldFinalHistoryCalls, { timeout: 10_000 }).toBe(1);
      await expect(page.getByTestId("user-message").filter({ hasText: "第1行" })).toHaveCount(1);
      await expect(page.getByTestId("user-message")).toHaveCount(1);
      await expect.poll(distanceFromBottom, { timeout: 10_000 }).toBeLessThanOrEqual(48);
      await expect(page.getByTestId("back-to-latest")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("vc-r182-handoff-history-held.png") });

      // VC-R183：发送后本 case 未再输入任何新草稿——真实 textarea 的 value
      // 应已为空（发送同步清空草稿；uni-h5 的 props→原生同步是 100ms 尾部
      // debounce，此刻早已过去）。只轮询 value 长度，不读取/输出正文；失败
      // 时消息附带三项非正文事实（发送键禁用与否、发送错误区有无、textarea
      // 节点数）辅助区分状态残留/DOM 未同步/失败回填，不参与判定。
      const composerFacts = {
        sendDisabled: await page.getByTestId("send").isDisabled(),
        sendErrorCount: await page.getByTestId("chat-send-error").count(),
        textareaCount: await messageInput.count(),
      };
      await expect.poll(() => messageInput.inputValue().then((value) => value.length), {
        message: `发送后无新草稿，真实 textarea value 应为空；前置事实=${JSON.stringify(composerFacts)}`,
        timeout: 5_000,
      }).toBe(0);

      // 放行前先建立该终局 GET 的 response 等待：放行后保存实际 response、
      // 断言真实 HTTP 成功并等响应体完整送达（finished），再等被拦路由真正
      // continue 完成（先于 finally 的 unroute，避免 "Route is already
      // handled" 竞争）。
      const finalHistoryPathname = `/api/v1/conversations/${conversationId}/messages`;
      const finalHistoryResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "GET"
          && new URL(response.url()).pathname === finalHistoryPathname,
      );
      releaseFinalHistory();
      const finalResponse = await finalHistoryResponse;
      expect(finalResponse.ok(), "终局补页真实请求成功").toBeTruthy();
      await finalResponse.finished();
      await expect.poll(() => heldFinalHistorySettled, { timeout: 10_000 })
        .toBe(heldFinalHistoryCalls);

      // 自然双 RAF：响应体送达后浏览器处理响应、store 发布与渲染均已完成
      // ——此刻的各 1 条才是权威行（响应头时刻可能仍渲染过渡行，不能据
      // count=1 断言已权威交接）。无固定 sleep。
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      await expect(page.getByTestId("user-message").filter({ hasText: "第1行" })).toHaveCount(1);
      await expect(page.getByTestId("assistant-md").filter({ hasText: PROVIDER_REPLY })).toHaveCount(1);
    } finally {
      releaseFinalHistory();
      // 等待失败也不吞错：内层 finally 保证仍精确 unroute，错误真实传播。
      try {
        await expect.poll(() => heldFinalHistorySettled, { timeout: 10_000 })
          .toBe(heldFinalHistoryCalls);
      } finally {
        await page.unroute(/\/api\/v1\/conversations\/\d+\/messages/, holdFinalHistory);
      }
    }

    // 可滚动历史成立：等待历史回读完成后差值 >400（同一条件，等待而非
    // 放宽），再确认自动跟随已把视口带到最新消息附近。
    await expect.poll(() => page.evaluate(() => {
      const node = document.querySelector<HTMLElement>('[data-testid="history"]');
      return node ? node.scrollHeight - node.clientHeight : Number.NaN;
    }), { timeout: 10_000 }).toBeGreaterThan(400);
    await expect.poll(distanceFromBottom, { timeout: 10_000 }).toBeLessThanOrEqual(48);

    // VC-R183 修复回归：发送后用户重新写下一条草稿 B（与实际完整提交串
    // 完全同文），不再发送——真实同文新草稿必须原样保留：旧实例的迟到
    // 发射已因实例重建失效，且不得反过来清掉 B。B 随后经历原三尺寸/
    // 阅读/回到最新全流程，末尾仅按长度断言（不输出正文）。
    await messageInput.fill(submittedPrompt);

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

    // VC-R183：同文草稿 B 历经三尺寸/阅读/回到最新流程后仍在（只比长度）。
    const draftBLength = (await messageInput.inputValue()).length;
    expect(draftBLength, "同文新草稿 B 不被旧实例发射清除").toBe(submittedPrompt.length);
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

// VC-R185：A 终态同步在途（completed 后终局补页挂起、权威历史未交接）时，
// 同会话真实发送 B——两轮都必须可提交（不被旧提交长锁静默挡住）；快照与
// SSE 全程真实完成，只挂起本会话所有终局 history GET（before 游标的
// load-more 照常放行）。A/B 用户消息与两条 provider 回复在历史挂起期间
// 都保持且 A 位于 B 之前；放行真实历史后按权威行收敛为各恰两条，不丢、
// 不重复。两轮补页一起挂起一起放行——不单独放行某一轮来掩盖瞬态消失。
test("VC-R185 sends the next turn while the previous final sync is still in flight", async ({ page }, testInfo) => {
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

    // 窄拦本会话 messages GET（空窗口下终局补页与最近窗口同形、无 after 游
    // 标，按路径整体挂起，仅放行 load-more 的 before 游标）；初始最近窗口
    // 在 route 安装前已完成，安装后到达的即 A/B 两轮的终局补页。
    let releaseHistory!: () => void;
    const historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    let heldCalls = 0;
    let heldSettled = 0;
    const holdHistory = async (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith(`/api/v1/conversations/${conversationId}/messages`)) {
        return route.fallback();
      }
      if (url.searchParams.get("before") !== null) return route.fallback();
      heldCalls += 1;
      try {
        await historyGate;
        await route.continue();
      } finally {
        heldSettled += 1;
      }
    };
    await page.route(/\/api\/v1\/conversations\/\d+\/messages/, holdHistory);

    const messageInput = page.locator('[data-testid="message-input"] textarea');
    const promptA = "第一轮：历史还在同步时继续聊。";
    const promptB = "第二轮：同步没完成也挡不住下一条。";
    // 组合 DOM 顺序：history 容器内 user-message 与 assistant-md 按文档顺序
    // 的 testid 数组——只返回 testid，不输出正文/ID。
    const messageRoleSequence = (): Promise<string[]> =>
      page.evaluate(() => {
        const node = document.querySelector('[data-testid="history"]');
        if (!node) return [];
        return Array.from(
          node.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-md"]'),
        ).map((element) => element.getAttribute("data-testid"));
      });
    try {
      // 第一轮 A：真实发送、真实 SSE 完成；终局补页被挂起。
      await messageInput.fill(promptA);
      await page.getByTestId("send").click();
      await expect(page.getByTestId("assistant-md").filter({ hasText: PROVIDER_REPLY }).last())
        .toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("status")).not.toContainText("正在回复");
      await expect.poll(() => heldCalls, { timeout: 10_000 }).toBe(1);

      // A 已完成、终态同步在途：发送键真实可用，第二轮 B 必须能提交——
      // 生成 POST 真实发出并完成（不被任何残留提交锁静默挡住）。
      await messageInput.fill(promptB);
      await expect(page.getByTestId("send")).toBeEnabled();
      await page.getByTestId("send").click();
      await expect(page.getByTestId("assistant-md").filter({ hasText: PROVIDER_REPLY }).nth(1))
        .toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("status")).not.toContainText("正在回复");
      await expect.poll(() => heldCalls, { timeout: 10_000 }).toBe(2);

      // 历史仍全部挂起：A/B 用户消息各恰一条、两条回复各恰一条；first/last
      // 的文本归属证明用户行顺序（A 在 B 之前），组合 DOM 顺序进一步证明
      // 每条回复位于所属轮次之后，不单独放行任何一轮补页。
      const userMessages = page.getByTestId("user-message");
      await expect(userMessages).toHaveCount(2);
      await expect(userMessages.first()).toContainText("第一轮");
      await expect(userMessages.last()).toContainText("第二轮");
      await expect(page.getByTestId("assistant-md")).toHaveCount(2);
      await expect.poll(messageRoleSequence).toEqual([
        "user-message",
        "assistant-md",
        "user-message",
        "assistant-md",
      ]);
      await page.screenshot({ path: testInfo.outputPath("vc-r185-two-turns-history-held.png") });

      // 放行真实历史（两轮补页一起落地）。放行前先注册响应收集 listener：
      // 两份本会话 history 响应都必须真实到达且 ok、body finished——只等
      // 第一份响应或只等 route.continue 结束都不能证明另一份已交接。
      // listener 在 finally 精确移除；gate 与 route 在外层 finally 兜底，
      // 失败不吞错。
      const finalHistoryPathname = `/api/v1/conversations/${conversationId}/messages`;
      const finalHistoryResponses: Response[] = [];
      const collectFinalHistory = (response: Response): void => {
        if (response.request().method() !== "GET") return;
        if (new URL(response.url()).pathname !== finalHistoryPathname) return;
        finalHistoryResponses.push(response);
      };
      page.on("response", collectFinalHistory);
      try {
        releaseHistory();
        await expect.poll(() => finalHistoryResponses.length, { timeout: 10_000 }).toBe(2);
        for (const response of finalHistoryResponses) {
          expect(response.ok(), "终局历史真实请求成功").toBeTruthy();
          await response.finished();
        }
        await expect.poll(() => heldSettled, { timeout: 10_000 }).toBe(heldCalls);
        // 自然双 RAF：响应体送达后浏览器处理、store 发布与渲染均已完成，
        // 此刻的各 2 条与组合顺序才是权威交接后的结果。无固定 sleep。
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        await expect(userMessages).toHaveCount(2);
        await expect(userMessages.first()).toContainText("第一轮");
        await expect(userMessages.last()).toContainText("第二轮");
        await expect(page.getByTestId("assistant-md")).toHaveCount(2);
        await expect.poll(messageRoleSequence).toEqual([
          "user-message",
          "assistant-md",
          "user-message",
          "assistant-md",
        ]);
      } finally {
        page.off("response", collectFinalHistory);
      }
    } finally {
      releaseHistory();
      try {
        await expect.poll(() => heldSettled, { timeout: 10_000 }).toBe(heldCalls);
      } finally {
        await page.unroute(/\/api\/v1\/conversations\/\d+\/messages/, holdHistory);
      }
    }
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
