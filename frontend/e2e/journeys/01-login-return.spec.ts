import { expect, test } from "@playwright/test";

import { provisionUser, uiLogin } from "../helpers";

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
});
