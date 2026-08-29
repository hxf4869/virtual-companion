import AxeBuilder from "@axe-core/playwright";
import {
  devices,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  createMemoryCandidate,
  createRelationshipAndConversation,
  navigateToPage,
  prepareGenerationAccess,
  provisionUser,
  uiLogin,
  type E2ESession,
} from "../helpers";

// DOGFOOD-09（ADR-0006 §1.4）：可访问性可自动化回归。本 journey 只在
// webkit-iphone / chromium-android 两个设备仿真 project 上运行（见
// playwright.config.ts）；真实手机 VoiceOver/TalkBack 冒烟由 Owner 手工执行。
//
// 覆盖：字体放大（viewport 不禁用缩放，见 h5-hardening.spec.ts 守卫）、
// 对比度（axe color-contrast 全量启用；登录页在 submit 禁用态与启用态
// 各扫一次，启用态覆盖主题色按钮）、焦点顺序（登录页键盘 Tab 抽查 +
// uni-button Enter/Space 激活）、语义标签（axe 全量规则，无禁用清单）。
//
// uni-app h5 框架层缺口（uni-input 不透传 aria-label 到原生 input、
// uni-button 无 tabindex 且不内建 Enter/Space 激活、uni-page-head 无
// landmark）已由全局 DOM 修补（src/platform/h5-a11y.ts）与页面源码语义
// （每页 role=main + 一级标题）修复；历史禁用的 label /
// landmark-one-main / region / page-has-heading-one 四条规则已恢复全量
// 启用，禁用清单与对比度放行清单均已删除，不得以新的 allowlist 换绿。

// axe-core 是 @axe-core/playwright 的传递依赖（pnpm 严格 node_modules 不在
// 根可解析），这里从 analyze() 的返回类型推导，避免直接 import 'axe-core'。
type AxeViolations = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"];

function summarize(violations: AxeViolations): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .map((node) => node.target.join(" "))
        .slice(0, 5)
        .join(" | ");
      return `${violation.id} (${violation.impact ?? "?"}) ${violation.help} [${targets}]`;
    })
    .join("\n");
}

// color-contrast 全量启用：uni-button[disabled]（App.vue #6e6e6e 覆盖）与
// memory 页 .hint（#5a6b7b）等已知失败已在页面源码修复，历史放行清单清空
// 后未再引入任何按选择器的豁免。
//
// 历史禁用的 label / landmark-one-main / region / page-has-heading-one 四条
// 规则已随框架层修补与页面源码语义修复恢复。axe 无 runOnly 时默认运行全部
// 规则；这里再对四条显式 enabled:true 交叉保障（防止未来默认行为漂移），
// 禁止改回 enabled:false 或删除规则后用 allowlist 换绿。
const RESTORED_RULES = [
  "label",
  "landmark-one-main",
  "region",
  "page-has-heading-one",
] as const;

async function expectAccessible(page: Page, label: string): Promise<void> {
  const rules = Object.fromEntries(
    RESTORED_RULES.map((id) => [id, { enabled: true }]),
  );
  const results = await new AxeBuilder({ page }).options({ rules }).analyze();
  expect(
    results.violations,
    `[${label}] axe violations:\n${summarize(results.violations)}`,
  ).toEqual([]);
}

async function expectTouchTargets(
  page: Page,
  label: string,
  selectors: string[],
  gapContainers: string[] = [],
): Promise<void> {
  const result = await page.evaluate(
    ({ targetSelectors, containerSelectors }) => ({
      targets: targetSelectors.flatMap((selector) => {
        const matches = [...document.querySelectorAll(selector)];
        if (matches.length === 0) return [{ selector, index: 0, width: 0, height: 0 }];
        return matches.map((el, index) => {
          const rect = el.getBoundingClientRect();
          return { selector, index, width: rect.width, height: rect.height };
        });
      }),
      gaps: containerSelectors.map((selector) => {
        const el = document.querySelector(selector);
        const style = el ? getComputedStyle(el) : null;
        return {
          selector,
          gap: style ? Math.max(parseFloat(style.columnGap), parseFloat(style.rowGap)) : 0,
        };
      }),
    }),
    { targetSelectors: selectors, containerSelectors: gapContainers },
  );
  for (const target of result.targets) {
    const targetLabel = `${label} ${target.selector}[${target.index}]`;
    expect(target.width, `${targetLabel} width`).toBeGreaterThanOrEqual(43.5);
    expect(target.height, `${targetLabel} height`).toBeGreaterThanOrEqual(43.5);
  }
  for (const container of result.gaps) {
    expect(container.gap, `${label} ${container.selector} gap`).toBeGreaterThanOrEqual(8);
  }
}

test("login：axe 全量 + 键盘 Tab 焦点顺序 + Enter/Space 激活", async ({ page }) => {
  await page.goto("/#/pages/login/login");
  const submit = page.getByTestId("submit");
  await expect(submit).toBeVisible();

  // DOGFOOD-STABILIZATION-02 缺陷 6：空表单时 submit 因校验 disabled（uni-h5
  // 把 disabled 渲染为 <uni-button> 上的布尔 attribute），全局修补必须同步出
  // aria-disabled=true + tabindex=-1，键盘与读屏不再聚焦禁用按钮。
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await expect(submit).toHaveAttribute("tabindex", "-1");
  await expectAccessible(page, "login（submit 禁用态）");

  const user = await provisionUser(undefined, "accessibility");
  await page.locator('[data-testid="username"] input').fill(user.username);
  await page.locator('[data-testid="password"] input').fill(user.password);

  // disabled→enabled：Vue 渲染函数删掉 disabled attribute 后 MutationObserver
  // 必须移除 aria-disabled 并把 tabindex 恢复为 0。
  await expect
    .poll(async () => submit.getAttribute("aria-disabled"))
    .toBeNull();
  await expect(submit).toHaveAttribute("tabindex", "0");

  // DOGFOOD-STABILIZATION-03 缺陷 F：启用态也要过 axe color-contrast。
  // .login-submit 主题青已从 #2a9d8f（白字对比度 3.32 < 4.5）加深为
  // #1e8076（4.77:1），此扫描点不得删减或豁免规则换绿。
  await expectAccessible(page, "login（submit 启用态）");

  // enabled→disabled 反向切换：清空密码让校验重新禁用，属性必须切回禁用态；
  // 随后填回供下方键盘与提交流程使用。
  await page.locator('[data-testid="password"] input').fill("");
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await expect(submit).toHaveAttribute("tabindex", "-1");
  await page.locator('[data-testid="password"] input').fill(user.password);
  await expect(submit).toHaveAttribute("tabindex", "0");

  // 键盘可达性抽查：Tab 顺序必须先用户名、再密码、后 submit（故断言相对
  // 顺序而非相邻性）。uni-button 的 tabindex/role 由全局 a11y 修补补齐
  // ——submit 不可聚焦时这里必须失败，不允许条件化放行。
  // 必须在 submit enabled（tabindex=0）之后执行，禁用态它本来就不可聚焦；
  // fill 会把焦点留在最后一个输入框，这里从 body 起步连续 Tab（登录页
  // 产品化后不再有导航按钮作 Tab 起点；username 自身作起点不会进入 order）。
  // Android Chrome 的顺序焦点起点是“最后聚焦的元素”（blur 不重置），
  // 桌面/webkit 则从 body 起。两种引擎都用“走满一个焦点环”的方式验证
  // 相对顺序：username → password → submit 的首次出现必须依次递增。
  const order: string[] = [];
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press("Tab");
    const testId = await page.evaluate(() => {
      const active = document.activeElement;
      const host = active?.closest("[data-testid]");
      return host?.getAttribute("data-testid") ?? null;
    });
    if (testId) order.push(testId);
  }
  // 环形走查：找到 username 之后出现的 password、password 之后出现的
  // submit（环起点的元素会在开头先出现一次）。
  const u = order.indexOf("username");
  expect(u, `tab 顺序异常：${order.join(" -> ")}`).toBeGreaterThanOrEqual(0);
  const p = order.indexOf("password", u + 1);
  expect(p, `tab 顺序异常：${order.join(" -> ")}`).toBeGreaterThan(u);
  const sb = order.indexOf("submit", p + 1);
  expect(sb, `tab 顺序异常：${order.join(" -> ")}`).toBeGreaterThan(p);

  // Space 激活（无导航副作用的控件）：uni-button 是自定义元素，Space 的
  // 默认行为是滚动页面；全局修补在 keydown 阶段只拦截滚动并 arm（repeat
  // 一律不激活），keyup 阶段补发恰好一次 click。press("Space") 覆盖完整
  // keydown+keyup 周期，因此这里断言的是松开后的单次激活。
  await page.getByTestId("invite-toggle").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("invite-panel")).toBeVisible();

  // Enter 激活提交：凭据已在上方填好，聚焦 submit 按 Enter，必须走一次
  // 完整登录。若真实限流返回 429，本测试直接失败并披露，不等待后重登。
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/auth/login",
  );
  await page.getByTestId("submit").focus();
  await page.keyboard.press("Enter");
  const response = await responsePromise;
  expect(
    response.ok(),
    `Enter 提交登录失败：${response.status()}`,
  ).toBeTruthy();
  await page.waitForURL((url) => !url.hash.includes("/pages/login/login"), {
    timeout: 20_000,
  });
});

// 登录后的页面共用一次 UI 登录：真实后端对同一账号的登录接口有速率限制，
// 每个页面各自登录会触发 429。共享 page 需手工按当前 project 的设备描述
// 创建 context（browser.newContext 不继承 project use 的设备仿真）。
const BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${process.env.E2E_H5_PORT ?? "5173"}`;
const FINAL_SHOTS = ".impeccable/review/final-correction";

test.describe.serial("登录后页面（共享一次登录）", () => {
  let page: Page;
  let context: BrowserContext;
  let session: E2ESession;
  let testRoutePatterns: string[] = [];

  test.beforeAll(async ({ browser }, testInfo) => {
    const device =
      testInfo.project.name === "webkit-iphone"
        ? devices["iPhone 13"]
        : devices["Pixel 5"];
    // defaultBrowserType 由 project 决定，不能作为 context option 传入。
    const { defaultBrowserType: _browserType, ...contextOptions } = device;
    context = await browser.newContext({ ...contextOptions, baseURL: BASE_URL });
    page = await context.newPage();
    const user = await provisionUser(undefined, "accessibility");
    session = await uiLogin(page, user);
    // 登录后应用把新用户重定向到成年核验/同意引导页；先经真实 API 满足
    // 服务端准入，后续页面导航才不会被引导流再次劫持。
    await prepareGenerationAccess(session.accessToken);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.afterEach(async () => {
    for (const routePattern of testRoutePatterns) {
      await page.unroute(routePattern);
    }
    testRoutePatterns = [];
  });

  test("index 边界台：axe 全量", async () => {
    // uni-app h5 把 pages.json 首页（index）规范化为 "#/"，hash 不会是
    // "#/pages/index/index"，因此这里以内容可见性为准而不是 navigateToPage。
    if (page.url().indexOf("#/pages/index/index") === -1 && !page.url().endsWith("#/")) {
      await page.evaluate(() => {
        const uniApi = (globalThis as Record<string, unknown>).uni as {
          redirectTo?: (options: { url: string }) => void;
        };
        uniApi?.redirectTo({ url: "/pages/index/index" });
      });
    }
    await expect(page.getByTestId("home-hero")).toBeVisible();
    await expectAccessible(page, "index");
  });

  test("chat 聊天：axe 全量", async () => {
    // 服务端准入已在 beforeAll 满足。走真实 UI 建立关系（与 journey 03
    // 相同路径），保证页面渲染出关系面板与输入区，而不是空选择态。
    // 统一创建流程在陪伴设置页；本账号在全量套跑中可能已有 active 关系
    // （activeCompanionLimit 内），此时聊天页直接进入会话面板。
    await navigateToPage(page, "/pages/companion/companion");
    await expect(page.getByTestId("relationship-selector")).toBeVisible();
    // current-relationship 状态行在"还没有"时也渲染（relStore ready 后出现），
    // 判断依据是内容而不是可见性。
    const status = page.getByTestId("current-relationship");
    await expect(status).toBeVisible({ timeout: 15_000 });
    const hasCompanion = (await status.textContent()).includes("当前关系：");
    if (!hasCompanion) {
      const persona = page.getByTestId("persona-select");
      await expect(persona).toBeEnabled();
      await persona.selectOption("gentle-listener");
      await page.getByTestId("create-relationship").click();
      await expect(page.getByTestId("current-relationship")).toContainText(
        "当前关系：",
      );
    }
    await navigateToPage(page, "/pages/chat/chat");
    // 纠偏式重构：聊天页顶栏展示陪伴名；会话面板收进"更多"菜单。
    await expect(page.getByTestId("chat-companion-name")).toBeVisible();
    await expect(page.locator('[data-testid="message-input"] textarea')).toBeVisible();

    await expectAccessible(page, "chat");
  });

  test("memory 记忆管理：axe 全量", async () => {
    const rel = await createRelationshipAndConversation(session.accessToken);
    await createMemoryCandidate(
      session.accessToken,
      rel.relationshipId,
      "无障碍回归用的合成记忆摘要",
      "message:99001",
    );

    await navigateToPage(
      page,
      `/pages/memory/memory?relationshipId=${rel.relationshipId}`,
    );
    const initialLoad = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname ===
          `/api/v1/relationships/${rel.relationshipId}/memories`,
    );
    await page.getByTestId("reload").click();
    expect((await initialLoad).ok()).toBeTruthy();
    await expect(page.locator(".card.pending")).toHaveCount(1);

    await expectAccessible(page, "memory");
  });

  test("移动端触控区与输入栏采用一个数据驱动浏览器检查", async ({}, testInfo) => {
    const captureFinalShots = testInfo.project.name === "chromium-android";
    const originalViewport = page.viewportSize();
    const rel = await createRelationshipAndConversation(session.accessToken);
    const memoryId = await createMemoryCandidate(
      session.accessToken,
      rel.relationshipId,
      "触控区检查用的合成记忆摘要",
      "message:touch-target",
    );
    const messages = Array.from({ length: 16 }, (_, index) => ({
      messageId: `touch-${index + 1}`,
      conversationId: rel.conversationId,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `触控区检查消息 ${index + 1}：这段普通文本用于让消息历史形成真实滚动高度。`,
      createdAt: "2026-08-29T00:00:00Z",
    }));
    const dueStatus = {
      reminderAfterMinutes: 60,
      sessionGapMinutes: 30,
      continuousMinutes: 61,
      reminderDue: true,
      sessionStartedAt: "2026-08-29T00:00:00Z",
    };

    const routes = {
      serviceMode: "**/api/v1/service-mode",
      heartbeat: "**/api/v1/usage-health/heartbeat",
      usageReminder: "**/api/v1/usage-health/reminder",
      messages: `**/api/v1/conversations/${rel.conversationId}/messages*`,
      reminders: `**/api/v1/relationships/${rel.relationshipId}/reminders*`,
    } as const;
    testRoutePatterns = Object.values(routes);

    await page.route(routes.serviceMode, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ mode: "ZERO_LLM", summary: "AI 服务当前以受限模式运行。" }),
      }),
    );
    await page.route(routes.heartbeat, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dueStatus) }),
    );
    await page.route(routes.usageReminder, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dueStatus) }),
    );
    await page.route(routes.messages, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(messages) }),
    );
    await page.route(routes.reminders, async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            reminderId: "touch-reminder",
            relationshipId: rel.relationshipId,
            text: "触控区检查提醒",
            remindAt: "2026-08-30T00:00:00Z",
            recurrence: "NONE",
            status: "ACTIVE",
            createdAt: "2026-08-29T00:00:00Z",
          },
        ]),
      });
    });

    await navigateToPage(
      page,
      `/pages/chat/chat?relationshipId=${rel.relationshipId}&conversationId=${rel.conversationId}`,
    );
    await expect(page.getByTestId("chat-message").first()).toBeVisible();
    await expect(page.getByTestId("usage-health-banner")).toBeVisible();
    await expect(page.getByTestId("service-mode-hint")).toBeVisible();
    await page.getByTestId("history").evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(page.getByTestId("back-to-latest")).toBeVisible();
    await expectTouchTargets(
      page,
      "chat",
      [
        '[data-testid^="msg-more-"]',
        '[data-testid="usage-health-continue"]',
        '[aria-label="关闭服务状态提示"]',
        '[data-testid="back-to-latest"]',
      ],
      [".context-hint__actions"],
    );

    for (const viewport of [
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 812, height: 375 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const input = document.querySelector('[data-testid="message-input"]');
        const history = document.querySelector('[data-testid="history"]');
        const composer = document.querySelector(".chat-input-area");
        if (!input || !history || !composer) return null;
        const inputRect = input.getBoundingClientRect();
        const historyRect = history.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        return {
          inputHeight: inputRect.height,
          historyHeight: historyRect.height,
          historyBottom: historyRect.bottom,
          composerTop: composerRect.top,
          pageHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
        };
      });
      expect(layout, `${viewport.width}x${viewport.height} layout`).not.toBeNull();
      expect(layout!.inputHeight).toBeGreaterThanOrEqual(44);
      expect(layout!.inputHeight).toBeLessThanOrEqual(48);
      expect(layout!.historyHeight).toBeGreaterThanOrEqual(120);
      expect(layout!.historyBottom).toBeLessThanOrEqual(layout!.composerTop + 1);
      expect(layout!.pageHeight).toBeLessThanOrEqual(layout!.viewportHeight + 1);
      if (captureFinalShots && viewport.width === 390 && viewport.height === 844) {
        await page.screenshot({ path: `${FINAL_SHOTS}/chat-390x844-empty-input.png` });
      }
      if (captureFinalShots && viewport.width === 812 && viewport.height === 375) {
        await page.screenshot({ path: `${FINAL_SHOTS}/chat-812x375-empty-input.png` });
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const nativeInput = page.locator('[data-testid="message-input"] textarea');
    await nativeInput.fill("第一行\n第二行\n第三行\n第四行");
    await expect
      .poll(() => page.getByTestId("message-input").evaluate((el) => el.getBoundingClientRect().height))
      .toBeGreaterThan(48);
    expect(await page.getByTestId("message-input").evaluate((el) => el.getBoundingClientRect().height))
      .toBeLessThanOrEqual(120);
    if (captureFinalShots) {
      await page.screenshot({ path: `${FINAL_SHOTS}/chat-390x844-multiline.png` });
    }
    // uni-h5 对 textarea 输入同步有 100ms 节流；等本次输入稳定后再模拟点击。
    await page.waitForTimeout(150);
    await page.getByTestId("send").click();
    await expect(nativeInput).toHaveValue("");
    await expect
      .poll(() => page.getByTestId("message-input").evaluate((el) => el.getBoundingClientRect().height))
      .toBeLessThanOrEqual(48);
    await expect(page.getByTestId("cancel")).toHaveCount(0, { timeout: 30_000 });
    if (originalViewport) await page.setViewportSize(originalViewport);

    await navigateToPage(
      page,
      `/pages/conversations/conversations?relationshipId=${rel.relationshipId}`,
    );
    await expect(page.getByTestId("conversation-card").first()).toBeVisible();
    await expectTouchTargets(page, "conversations", [
      '[data-testid="nav-chat"]',
      `[data-testid="conversation-manage-${rel.conversationId}"]`,
    ]);

    await navigateToPage(page, `/pages/memory/memory?relationshipId=${rel.relationshipId}`);
    await expect(page.locator(".card.pending").first()).toBeVisible();
    await expectTouchTargets(
      page,
      "memory",
      [
        '[data-testid="reload"]',
        '[data-testid="memory-confirm"]',
        '[data-testid="memory-open-detail"]',
      ],
      [".actions"],
    );

    await navigateToPage(
      page,
      `/pages/memory-detail/memory-detail?relationshipId=${rel.relationshipId}&memoryId=${memoryId}`,
    );
    await expect(page.getByTestId("memory-card")).toBeVisible();
    await expectTouchTargets(page, "memory detail", ['[data-testid="nav-memory"]']);

    await navigateToPage(page, `/pages/companion/companion?relationshipId=${rel.relationshipId}`);
    await expect(page.locator(".gender-chip").first()).toBeVisible();
    await expectTouchTargets(page, "companion", [".gender-chip"], [".gender-row"]);

    await navigateToPage(page, "/pages/health/health");
    await expect(page.getByTestId("health-after-60")).toBeVisible();
    await expectTouchTargets(page, "health", ['[data-testid="health-after-60"]'], [".chip-row"]);

    await navigateToPage(page, `/pages/reminder/reminder?relationshipId=${rel.relationshipId}`);
    await expect(page.getByTestId("reminder-delete")).toBeVisible();
    await expectTouchTargets(page, "reminder", ['[data-testid="reminder-delete"]']);

    if (captureFinalShots) {
      await navigateToPage(page, "/pages/data/data");
      await expect(page.getByTestId("data-account")).toBeVisible();
      await page.screenshot({ path: `${FINAL_SHOTS}/data-account-and-security.png` });
    }
  });

  test("export 数据导出：axe 全量", async () => {
    await navigateToPage(page, "/pages/export/export");
    await expect(page.getByTestId("export-create")).toBeVisible();
    await expectAccessible(page, "export");
  });

  test("account 账号与注销：axe 全量", async () => {
    await navigateToPage(page, "/pages/account/account");
    await expect(page.getByTestId("account-card")).toBeVisible();
    await expectAccessible(page, "account");
  });

  // 底栏、页头、聊天头部和内部壳的键盘焦点环必须命中
  // --vc-focus-on-env；用真实 computed style 验证选择器与变量都生效。
  test("chrome-shell focus ring resolves to --vc-focus-on-env", async () => {
    // 与"index 边界台"测试同因：uni 把首页规范化为 "#/"，webkit 上
    // waitForURL 的 hash 目标不会出现，改用内容可见性判定位。
    await page.evaluate(() => {
      const uniApi = (globalThis as Record<string, unknown>).uni as {
        redirectTo?: (options: { url: string }) => void;
      };
      uniApi?.redirectTo({ url: "/pages/index/index" });
    });
    await expect(page.getByTestId("home-hero")).toBeVisible();

    // 真键盘 Tab 触发 :focus-visible（程序化 focus 不保证命中伪类）。
    // 触摸仿真引擎上 Tab 不一定命中伪类，因此分层验证：
    // ① 键盘命中 :focus-visible 时，computed outline-color 必须 = #2b5c8f；
    // ② 无论如何，页面已应用的样式表中必须存在 `.vc-chrome :focus-visible`
    //    覆盖规则且变量解析为该值（真实渲染 DOM 的级联检查）。
    async function tabWalk(testid: string, max = 24): Promise<void> {
      let sawFocusVisible = false;
      for (let i = 0; i < max; i += 1) {
        await page.keyboard.press("Tab");
        const hit = await page.evaluate(() => {
          const active = document.activeElement;
          const host = active?.closest("[data-testid]");
          return {
            id: host?.getAttribute("data-testid") ?? null,
            matches: active ? active.matches(":focus-visible") : false,
            color: active ? getComputedStyle(active).outlineColor : "",
          };
        });
        if (hit.id === testid && hit.matches) {
          sawFocusVisible = true;
          expect(hit.color, `${testid} 焦点环颜色`).toBe("rgb(43, 92, 143)");
          break;
        }
      }
      expect(sawFocusVisible || (await chromeRuleOk()), `${testid} 未验证到焦点环`).toBe(true);
    }

    async function chromeRuleOk(): Promise<boolean> {
      return page.evaluate(() => {
        const target = "rgb(43, 92, 143)";
        const probe = document.createElement("span");
        document.querySelector(".vc-chrome")?.appendChild(probe);
        const resolved = getComputedStyle(probe).getPropertyValue("--vc-focus-on-env").trim();
        probe.remove();
        if (resolved !== "#2b5c8f") return false;
        for (const sheet of Array.from(document.styleSheets)) {
          let rules: CSSRuleList;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule) {
              const sel = rule.selectorText ?? "";
              if (
                sel.includes(".vc-chrome") &&
                sel.includes(":focus-visible") &&
                rule.style.outlineColor.includes("--vc-focus-on-env")
              ) {
                return true;
              }
            }
          }
        }
        return false;
      });
    }

    // 底栏导航项（vc-chrome）。
    await tabWalk("tab-memory");

    // 页头返回（help 是 consumer-sub 二级页，vc-chrome；四入口 tab 根页
    // 如 memory 按 IA 无返回键，不是缺陷）。
    await navigateToPage(page, "/pages/help/help");
    await expect(page.getByTestId("page-back")).toBeVisible();
    await tabWalk("page-back");

    // 沉浸式聊天头部（vc-chrome）：返回入口落在暗色头部内。
    await navigateToPage(page, "/pages/chat/chat");
    await expect(page.getByTestId("nav-conversations")).toBeVisible();
    await tabWalk("nav-conversations");
  });
});
