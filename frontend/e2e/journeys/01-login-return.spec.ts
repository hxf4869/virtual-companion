import { expect, test } from "@playwright/test";

import { completeLoginChallenge, provisionUser, STACK_KIND } from "../helpers";

test("login preserves a current protected deep link", async ({ page, request }, testInfo) => {
  const target = "/pages/conversations/conversations";
  await page.goto(`/#${target}`);

  await expect(page).toHaveURL(/#\/pages\/login\/login/);
  await expect(page).toHaveURL(/return=(?:%252F|%2F)pages/);

  const rejected = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/auth/login",
  );
  await page.locator('[data-testid="account"] input').fill("e2e-no-such-user@example.test");
  await page.locator('[data-testid="password"] input').fill("wrong-Pass-123!");
  await page.locator('[data-testid="password"] input').press("Enter");
  expect((await rejected).status()).toBe(404);
  await expect(page.getByTestId("error")).toContainText("账号或密码不正确");
  await expect(page.locator('[data-testid="account"] input')).toBeFocused();

  // VC-R166: login-return 是非共享种子账号，全新独立栈上首次登录即首次
  // 设置。手动密码提交替代 uiLogin；仅第一个 authenticator-setup 请求由
  // route.fetch 真实准备成功后向页面模拟 503（响应模拟，非真实后端/DB
  // 故障注入）。manualKey 只留在内存里做布尔比较，绝不打印或断言原值。
  const user = await provisionUser(request, "login-return");
  let setupCalls = 0;
  let firstSetupUrl = "";
  let firstManualKey: string | null = null;
  await page.route("**/api/v1/auth/challenges/*/authenticator-setup", async (route) => {
    setupCalls += 1;
    if (setupCalls > 1) {
      return route.fallback();
    }
    const real = await route.fetch();
    expect(real.ok(), "first real authenticator setup must succeed").toBeTruthy();
    firstSetupUrl = route.request().url();
    const body = (await real.json()) as { manualKey?: unknown };
    if (typeof body.manualKey === "string") firstManualKey = body.manualKey;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "UNAVAILABLE", message: "simulated" }),
    });
  });

  // 手动密码提交替代 uiLogin：真实凭据经 submit.click 提交；waiter 以帐号
  // 布尔匹配，避免接到前一次错误登录的迟到响应。只断言 ok/nextStep，不输出
  // postData/密码/Cookie/token。
  const accountInput = page.locator('[data-testid="account"] input');
  const passwordInput = page.locator('[data-testid="password"] input');
  const loginResponse = page.waitForResponse(
    (response) => {
      if (response.request().method() !== "POST") return false;
      if (new URL(response.url()).pathname !== "/api/v1/auth/login") return false;
      try {
        return response.request().postDataJSON()?.account === user.email;
      } catch {
        return false;
      }
    },
  );
  await accountInput.fill(user.email);
  await passwordInput.fill(user.password);
  await page.getByTestId("submit").click();
  const login = await loginResponse;
  expect(login.ok()).toBeTruthy();

  // 首次二维码加载失败如实反馈：可重试提示可见，不谎称「验证已失效」。
  await expect(page.getByTestId("setup-load-error")).toBeVisible();
  await expect(page.getByTestId("setup-load-error"))
    .toContainText("二维码暂时没有加载出来");
  await expect(page.getByText("本次登录验证已失效")).toHaveCount(0);
  // 临时失败页快照（此刻无二维码/密钥/恢复码），供 Root 人工视觉检查。
  await page.screenshot({ path: testInfo.outputPath("setup-retry.png") });

  // 重试走真实 API：同一 challenge 复用同一 pending key（V123 COALESCE），
  // 只做布尔比较。
  const secondSetup = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/authenticator-setup")
      && response.ok(),
  );
  await page.getByTestId("setup-retry").click();
  const second = await secondSetup;
  expect(
    new URL(second.url()).pathname === new URL(firstSetupUrl).pathname,
    "retry must reuse the same challenge",
  ).toBe(true);
  const shownKey = (await page.locator(".vc-authenticator-setup__manual-key").textContent())
    ?.replace(/\s/gu, "");
  expect(
    typeof firstManualKey === "string" && shownKey === firstManualKey,
    "retry must reuse the same pending manual key",
  ).toBe(true);

  // 完成首次设置与恢复码展示，仍回原 protected deep link。
  await completeLoginChallenge(page, user, login);

  await page.waitForURL((url) => url.hash === `#${target}`, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "全部会话" })).toBeVisible();

  // VC-R79 TLS 栈（VC_SESSION_COOKIE_SECURE=true 的承诺属性）：真实 UI 登录
  // 完成后，浏览器 context 中的 vc_session / vc_csrf 必须带 Secure。只做
  // 布尔存在性/属性断言；cookie 对象与值绝不进入 expect 实际/期望或日志。
  // HTTP 模式不断言。
  if (STACK_KIND === "tls") {
    const cookies = await page.context().cookies();
    for (const name of ["vc_session", "vc_csrf"]) {
      const cookie = cookies.find((candidate) => candidate.name === name);
      const present = cookie !== undefined;
      expect(present, `${name} must be present after a real UI login`).toBe(true);
      expect(
        cookie?.secure === true,
        `${name} must carry the Secure attribute`,
      ).toBe(true);
    }
  }
});
