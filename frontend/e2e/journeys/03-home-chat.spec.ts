import { expect, test, type Route } from "@playwright/test";

import {
  navigateToPage,
  openSharedSession,
  prepareGenerationAccess,
  PROVIDER_REPLY,
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
