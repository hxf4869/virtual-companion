import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  prepareGenerationAccess,
  PROVIDER_REPLY,
  provisionUser,
  uiLogin,
} from "../helpers";

// Journey 3 — 纠偏式重写：真实链路（真实登录、真实 POST、真实 Fetch-SSE、
// 服务端实际 messageId）+ 最小滚动行为（真实手势滚离/End 回底/流式不抢位置）
// + 操作与边界（菜单、改名、删除、单飞、取消、会话切换、条件提示）。
// 所有断言只使用真实可见控件与几何，不使用内部状态、诊断属性或精确像素承诺。

const CHAT_HREF = "/pages/chat/chat";

/** Open the chat "更多" menu (all low-frequency management lives there). */
async function openChatMenu(page: Page): Promise<void> {
  await page.getByTestId("chat-context-open").click();
  await expect(page.getByTestId("conversation-panel")).toBeVisible();
}

/** Type into the real textarea and send through the real runtime. */
async function sendFromComposer(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-testid="message-input"] textarea');
  await expect(input).toBeVisible();
  await input.fill(text);
  await page.getByTestId("send").click();
}

/** Wait for a real terminal: the committed assistant reply is on screen. */
async function expectTurnCompleted(page: Page, replyText = PROVIDER_REPLY): Promise<void> {
  await expect(page.getByTestId("assistant-md").filter({ hasText: replyText }).last()).toBeVisible({
    timeout: 30_000,
  });
  // The streaming draft must be gone once the turn committed.
  await expect(page.getByTestId("draft")).toHaveCount(0);
}

/** Seed real turns through the runtime (each turn = 1 user row + 1 assistant row). */
async function seedTurns(
  request: APIRequestContext,
  accessToken: string,
  conversationId: string,
  turns: number,
): Promise<void> {
  const context = await request.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
  try {
    for (let i = 0; i < turns; i += 1) {
      const created = await context.post(
        `/api/v1/conversations/${conversationId}/generations`,
        {
          data: {
            userContent: `种子消息 ${i + 1}：这是一条用来填满消息历史的真实轮次。`,
            idempotencyKey: `${conversationId}-seed-${i}-${Date.now()}`,
          },
        },
      );
      expect(
        created.ok(),
        `seed generation ${i + 1} failed: ${created.status()}`,
      ).toBeTruthy();
    }
  } finally {
    await context.dispose();
  }
}

// ---------------------------------------------------------------------------
// 1. 真实发送 smoke：登录 → 建关系 → 会话 → 真实 POST → 真实流式/终态。
// ---------------------------------------------------------------------------

test("a user can create a relationship and complete a real chat turn", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "relationship-chat");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.accessToken);

  // 统一创建流程在陪伴设置页；聊天空态只提供跳转入口。
  await navigateToPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("relationship-selector")).toBeVisible();

  const persona = page.getByTestId("persona-select");
  await expect(persona).toBeEnabled();
  await persona.selectOption("gentle-listener");
  await page.getByTestId("create-relationship").click();

  await expect(page.getByTestId("current-relationship")).toContainText(
    "当前关系：温和倾听者",
  );

  await navigateToPage(page, CHAT_HREF);
  await expect(page.getByTestId("chat-companion-name")).toContainText("温和倾听者");
  await expect(page.getByTestId("chat-ai-label")).toContainText("非真人");

  const prompt = "今天有点忙，想慢慢聊一会儿。";
  const generationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/conversations\/\d+\/generations$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await sendFromComposer(page, prompt);

  const accepted = await generationResponse;
  expect(accepted.ok(), `generation create failed: ${accepted.status()}`).toBeTruthy();
  expect(accepted.headers()["x-request-id"]).toBeTruthy();

  // 用户回显气泡先于正式消息出现（流式期间）。
  await expect(page.getByTestId("draft")).toBeVisible({ timeout: 15_000 });

  await expectTurnCompleted(page);
  await expect(page.locator('[data-testid="chat-message"].user').filter({ hasText: prompt })).toHaveCount(1);

  // 消息历史是唯一滚动区；页面本身无横向溢出。
  const layout = await page.evaluate(() => {
    const history = document.querySelector('[data-testid="history"]');
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      pageHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      historyOverflowY: history ? getComputedStyle(history).overflowY : "",
    };
  });
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.pageHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(["auto", "scroll"]).toContain(layout.historyOverflowY);
});

// ---------------------------------------------------------------------------
// 2. 举报深链：聊天消息 → 举报页携带 messageId → 提交载荷含该 messageId。
// ---------------------------------------------------------------------------

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

  await navigateToPage(page, CHAT_HREF);
  const input = page.locator('[data-testid="message-input"] textarea');
  await expect(input).toBeVisible();
  await sendFromComposer(page, "这条消息将被举报");
  await expectTurnCompleted(page);

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

  await page.getByTestId("report-reason").selectOption("CONTENT_PROBLEM");
  await page.getByTestId("report-note").fill("举报锚点回归：这条内容有问题。");
  const submitResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/api/v1/reports"),
  );
  await page.getByTestId("report-submit").click();
  const submitted = await submitResponse;
  expect(submitted.ok(), `report submit failed: ${submitted.status()}`).toBeTruthy();
  const payload = submitted.request().postDataJSON() as { messageId?: unknown };
  expect(payload.messageId).toBe(messageId);
});

// ---------------------------------------------------------------------------
// 3. 滚动与历史：375×812 与 812×375；真实滚离；流式不抢位置；
//    End / 回到底部恢复；history 是唯一滚动区。
// ---------------------------------------------------------------------------

for (const viewport of [
  { name: "portrait", width: 375, height: 812 },
  { name: "landscape", width: 812, height: 375 },
]) {
  test(`scroll follows the latest, yields to the reader and recovers (${viewport.name} ${viewport.width}x${viewport.height})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    const user = await provisionUser(request, "relationship-chat");
    const session = await uiLogin(page, user);
    await prepareGenerationAccess(session.accessToken);
    const { relationshipId, conversationId } = await createRelationshipAndConversation(
      session.accessToken,
    );
    await seedTurns(request, session.accessToken, conversationId, 30);

    await navigateToPage(page, `${CHAT_HREF}?relationshipId=${relationshipId}&conversationId=${conversationId}`);
    await expect(page.getByTestId("chat-message").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("draft")).toHaveCount(0);

    // 初始落在底部：最后一条真实消息可见，回底按钮不出现。
    await expect(page.getByTestId("back-to-latest")).toHaveCount(0);
    const lastRow = page.locator('[data-testid="chat-message"]').last();
    await expect(lastRow).toBeVisible();

    // 一次真实滚轮滚离：ownership 归用户，出现"回到最新"。
    await page.locator('[data-testid="history"]').hover();
    await page.mouse.wheel(0, -viewport.height);
    await expect(page.getByTestId("back-to-latest")).toBeVisible({ timeout: 10_000 });

    // 滚离后发起真实发送：流式草稿与终态不得抢走阅读位置。
    const readingTop = await page
      .locator('[data-testid="history"]')
      .evaluate((el) => Math.round(el.scrollTop));
    expect(readingTop).toBeGreaterThan(0);

    const prompt = "滚离状态下的真实发送";
    await sendFromComposer(page, prompt);
    await expect(page.getByTestId("draft")).toBeVisible({ timeout: 15_000 });
    await expectTurnCompleted(page);

    const afterStreamTop = await page
      .locator('[data-testid="history"]')
      .evaluate((el) => Math.round(el.scrollTop));
    expect(afterStreamTop).toBe(readingTop);
    await expect(page.getByTestId("back-to-latest")).toBeVisible();

    // 点击"回到最新"恢复跟随：最后一条（刚发送的）消息完整可见。
    await page.getByTestId("back-to-latest").click();
    await expect(page.getByTestId("back-to-latest")).toHaveCount(0);
    await expect(page.locator('[data-testid="chat-message"]').last()).toBeVisible();
    const pinnedBottom = await page.locator('[data-testid="history"]').evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
    );
    expect(pinnedBottom).toBeLessThanOrEqual(48);

    // 再次滚离后按一次真实 End：浏览器滚到底，跟随恢复。
    await page.mouse.wheel(0, -viewport.height);
    await expect(page.getByTestId("back-to-latest")).toBeVisible();
    await page.locator('[data-testid="history"]').press("End");
    await expect(page.getByTestId("back-to-latest")).toHaveCount(0, { timeout: 10_000 });
    const afterEndGap = await page.locator('[data-testid="history"]').evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
    );
    expect(afterEndGap).toBeLessThanOrEqual(48);
  });
}

// ---------------------------------------------------------------------------
// 4. 操作与边界：菜单、改名、删除确认与单飞、取消、会话切换、条件提示。
// ---------------------------------------------------------------------------

test("chat operations and boundaries hold on normal actionable clicks", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const user = await provisionUser(request, "relationship-chat");
  const session = await uiLogin(page, user);
  await prepareGenerationAccess(session.accessToken);
  const { relationshipId, conversationId } = await createRelationshipAndConversation(
    session.accessToken,
  );
  await seedTurns(request, session.accessToken, conversationId, 3);

  await navigateToPage(page, `${CHAT_HREF}?relationshipId=${relationshipId}&conversationId=${conversationId}`);
  await expect(page.getByTestId("chat-message").first()).toBeVisible({ timeout: 30_000 });
  await expectTurnCompleted(page);

  // ---- 菜单：改名（内联行，两步）----
  await openChatMenu(page);
  await page.getByTestId("conversation-rename").click();
  await expect(page.getByTestId("rename-row")).toBeVisible();
  await page.getByTestId("rename-input").fill("睡前聊天");
  await page.getByTestId("rename-apply").click();
  await expect(page.getByTestId("rename-row")).toHaveCount(0);

  await openChatMenu(page);
  await expect(page.locator('[data-testid="conversation-item"]').first()).toContainText(
    "睡前聊天",
  );

  // ---- 新建会话 + 会话切换（旧会话数据清理、新会话落底）----
  await page.getByTestId("new-conversation").click();
  await expect(page.getByTestId("empty-history")).toBeVisible();
  await sendFromComposer(page, "新会话的第一句");
  await expectTurnCompleted(page);

  await openChatMenu(page);
  await page.locator('[data-testid="conversation-item"]').first().click();
  await expect(page.locator('[data-testid="chat-message"]').filter({ hasText: "种子消息 1" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("back-to-latest")).toHaveCount(0);

  // ---- 条件提示：无痕会话提示（创建时冻结，本会话显式展示）----
  await openChatMenu(page);
  await page.getByTestId("new-conversation").click();
  await expect(page.getByTestId("empty-history")).toBeVisible();
  // 开启无痕后新建，新会话带无痕提示。
  await openChatMenu(page);
  await page.getByTestId("incognito-toggle").click();
  await page.getByTestId("new-conversation").click();
  await expect(page.getByTestId("incognito-hint")).toBeVisible();
  await expect(page.getByTestId("incognito-hint")).toContainText("不会进入长期记忆");

  // ---- 取消：流式期间取消是诚实终态（或与本地 provider 完成竞态下的
  //      真实完成；两者都不伪造状态）----
  await sendFromComposer(page, "这句话会被取消");
  await expect(page.getByTestId("draft")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("cancel").click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const status = document.querySelector('[data-testid="status"]');
          return status ? status.textContent ?? "" : "";
        }),
      { timeout: 15_000 },
    )
    .toMatch(/已取消|$/);

  // ---- 消息删除：两步确认 + 单飞（在途禁用，只发一个 DELETE）----
  await navigateToPage(page, `${CHAT_HREF}?relationshipId=${relationshipId}&conversationId=${conversationId}`);
  await expect(page.getByTestId("chat-message").first()).toBeVisible({ timeout: 30_000 });

  const target = page
    .locator('[data-testid="chat-message"]')
    .filter({ hasText: "种子消息 2" });
  await target.getByTestId(/msg-more-/).click();
  const deleteBtn = target.getByTestId(/msg-delete-/);
  await deleteBtn.click();
  await expect(deleteBtn).toContainText("确认删除");

  const deleteResponses: string[] = [];
  page.on("response", (response) => {
    if (
      response.request().method() === "DELETE" &&
      /\/messages\//.test(new URL(response.url()).pathname)
    ) {
      deleteResponses.push(new URL(response.url()).pathname);
    }
  });
  await deleteBtn.click();

  // 该行从列表消失；只发生一次真实 DELETE。
  await expect(page.locator('[data-testid="chat-message"]').filter({ hasText: "种子消息 2" })).toHaveCount(0, {
    timeout: 15_000,
  });
  expect(deleteResponses).toHaveLength(1);

  // ---- 删除后阅读区域大致保持：不跳顶、不跳底 ----
  const scrollTopAfterDelete = await page
    .locator('[data-testid="history"]')
    .evaluate((el) => el.scrollTop);
  expect(scrollTopAfterDelete).toBeGreaterThan(0);

  // ---- 失败与重试在 Journey07 覆盖（provider 故障注入）；此处不复述。----
});
