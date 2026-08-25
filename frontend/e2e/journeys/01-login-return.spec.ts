import { expect, test } from "@playwright/test";

import { provisionUser, uiLogin } from "../helpers";

// Journey 1 — login, keyboard/focus, and the complete post-login return.
test("login preserves a protected deep link and its query", async ({
  page,
  request,
}) => {
  const target = "/pages/memory/memory?from=e2e-return";
  await page.goto(`/#${target}`);

  await expect(page).toHaveURL(/#\/pages\/login\/login/);
  await expect(page.getByTestId("submit")).toBeVisible();
  await expect(page).toHaveURL(
    /return=(?:%252F|%2F)pages(?:%252F|%2F)memory/,
  );

  // A rejected credential never discloses account existence and returns real
  // keyboard focus to the native username input.
  const rejected = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/auth/login",
  );
  await page.locator('[data-testid="username"] input').fill("e2e-no-such-user");
  await page.locator('[data-testid="password"] input').fill("wrong-Pass-123!");
  await page.locator('[data-testid="password"] input').press("Enter");
  expect((await rejected).status()).toBe(404);
  await expect(page.getByTestId("error")).toContainText("用户名或密码错误");
  await expect(page.locator('[data-testid="username"] input')).toBeFocused();

  const user = await provisionUser(request, "login-return");
  await uiLogin(page, user, { openPage: false });

  // uni-app uses a hash router: both the page path and its query live in hash.
  await page.waitForURL(
    (url) => url.hash === `#${target}`,
    { timeout: 20_000 },
  );
  // Phase 4 IA：页面标题由 PageHeader 渲染（记忆）；用 heading 角色断言
  // 深链确实落到了记忆页。
  await expect(
    page.getByRole("heading", { name: "记忆" }),
  ).toBeVisible();
});
