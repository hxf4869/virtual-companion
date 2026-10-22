import { expect, test } from "@playwright/test";

import { provisionUser, STACK_KIND, uiLogin } from "../helpers";

test("login preserves a current protected deep link", async ({ page, request }) => {
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

  const user = await provisionUser(request, "login-return");
  await uiLogin(page, user, { openPage: false });

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
