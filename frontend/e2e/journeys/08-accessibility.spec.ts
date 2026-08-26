import AxeBuilder from "@axe-core/playwright";
import {
  devices,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Response,
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

  // Enter 激活提交：凭据已在上方填好，聚焦 submit 按 Enter，必须走完整登录
  // （请求发出 + 离开登录页）。全量套跑可能撞上真实限流（AuthAbuseGuard），
  // 不放宽任何限流：429 时按 Retry-After 等待后重试（有界 3 次）。
  const enterToLogin = async (): Promise<Response> => {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/auth/login",
    );
    await page.getByTestId("submit").focus();
    await page.keyboard.press("Enter");
    return responsePromise;
  };
  let response = await enterToLogin();
  for (let attempt = 1; response.status() === 429 && attempt < 3; attempt += 1) {
    const parsed = Number(response.headers()["retry-after"]);
    const waitSeconds =
      Number.isFinite(parsed) && parsed >= 1 && parsed <= 65 ? parsed : 61;
    await page.waitForTimeout((waitSeconds + 1) * 1000);
    response = await enterToLogin();
  }
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

/**
 * 全量套跑时，admin setup + 7 个 journey + 本 journey 的 UI 登录都来自同一
 * 回环 source，可能吃满后端真实限流（AuthAbuseGuard 10 次/60 秒/来源）。
 * 这里不放宽任何限流：429 时按响应头 Retry-After 等待后重试（有界 3 次）。
 */
async function uiLoginRespectingSourceLimiter(
  page: Page,
  user: { username: string; password: string },
): Promise<E2ESession> {
  for (let attempt = 1; ; attempt += 1) {
    let retryAfterSeconds: number | null = null;
    const onResponse = (response: Response): void => {
      const isLogin =
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/auth/login";
      if (!isLogin || response.status() !== 429) return;
      const parsed = Number(response.headers()["retry-after"]);
      retryAfterSeconds =
        Number.isFinite(parsed) && parsed >= 1 && parsed <= 65 ? parsed : 61;
    };
    page.on("response", onResponse);
    try {
      return await uiLogin(page, user);
    } catch (error) {
      if (retryAfterSeconds === null || attempt >= 3) throw error;
      await page.waitForTimeout((retryAfterSeconds + 1) * 1000);
    } finally {
      page.removeListener("response", onResponse);
    }
  }
}

test.describe.serial("登录后页面（共享一次登录）", () => {
  let page: Page;
  let context: BrowserContext;
  let session: E2ESession;

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
    session = await uiLoginRespectingSourceLimiter(page, user);
    // 登录后应用把新用户重定向到成年核验/同意引导页；先经真实 API 满足
    // 服务端准入，后续页面导航才不会被引导流再次劫持。
    await prepareGenerationAccess(session.accessToken);
  });

  test.afterAll(async () => {
    await context?.close();
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
    await expect(page.getByTestId("current-relationship")).toContainText(
      "当前关系：",
    );
    await expect(page.getByTestId("conversation-panel")).toBeVisible();

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

  // P1-6：暗色外壳（底栏/页头/聊天头部/内部壳）键盘焦点环必须真的命中
  // --vc-focus-on-env（#f0c983，暗面 ≥3:1），用真实渲染的 computed style
  // 验证，防止选择器写错导致覆盖不生效。
  test("dark-shell focus ring resolves to --vc-focus-on-env", async () => {
    await navigateToPage(page, "/pages/index/index");
    await expect(page.getByTestId("home-hero")).toBeVisible();

    // 真键盘 Tab 触发 :focus-visible（程序化 focus 不保证命中伪类）。
    // 触摸仿真引擎上 Tab 不一定命中伪类，因此分层验证：
    // ① 键盘命中 :focus-visible 时，computed outline-color 必须 = #f0c983；
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
          expect(hit.color, `${testid} 焦点环颜色`).toBe("rgb(240, 201, 131)");
          break;
        }
      }
      expect(sawFocusVisible || (await chromeRuleOk()), `${testid} 未验证到焦点环`).toBe(true);
    }

    async function chromeRuleOk(): Promise<boolean> {
      return page.evaluate(() => {
        const target = "rgb(240, 201, 131)";
        const probe = document.createElement("span");
        document.querySelector(".vc-chrome")?.appendChild(probe);
        const resolved = getComputedStyle(probe).getPropertyValue("--vc-focus-on-env").trim();
        probe.remove();
        if (resolved !== "#f0c983") return false;
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

    // 页头返回（memory 二级页，vc-chrome）。
    await navigateToPage(page, "/pages/memory/memory");
    await expect(page.getByTestId("page-header")).toBeVisible();
    await page.getByTestId("reload").click();
    await tabWalk("page-back");
  });
});
