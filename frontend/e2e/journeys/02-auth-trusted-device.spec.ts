import { expect, test } from "@playwright/test";

import { navigateToPage, provisionUser, uiLogin } from "../helpers";

test("a trusted device skips only TOTP on the next password login", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "auth-trusted-device");
  await uiLogin(page, user, { trustDevice: true });

  await navigateToPage(page, "/pages/account/account");
  await page.getByTestId("account-logout").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/login/login"));

  const loginResponse = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/auth/login",
  );
  await page.locator('[data-testid="account"] input').fill(user.email);
  await page.locator('[data-testid="password"] input').fill(user.password);
  await page.getByTestId("submit").click();
  const response = await loginResponse;
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({ nextStep: "ACTIVE" });
  // uni-app H5 normalizes the pages.json home route to the bare "#/" hash
  // (the product lands there via uni.redirectTo); accept it exactly like
  // helpers.navigateToPage does for /pages/index/index.
  await page.waitForURL((url) =>
    url.hash.startsWith("#/pages/index/index") || ["", "#", "#/"].includes(url.hash),
  );
  await expect(page.getByText("验证登录", { exact: true })).toHaveCount(0);
});

// VC-R164: 退出结果无法确认时的如实反馈。响应模拟：仅第一次
// POST /auth/logout 由 page.route 以 503 应答——不是真实后端/DB 故障注入。
test("an unconfirmed logout keeps the session honest until a retry signs out for real", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "navigation-smoke");
  await uiLogin(page, user);

  await navigateToPage(page, "/pages/account/account");
  let logoutCalls = 0;
  await page.route("**/api/v1/auth/logout", async (route) => {
    logoutCalls += 1;
    if (logoutCalls === 1) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "UNAVAILABLE", message: "simulated" }),
      });
    }
    return route.fallback();
  });

  await page.getByTestId("account-logout").click();
  // 失败如实反馈：按钮附近出现可重试提示，身份保留、不导航。
  await expect(page.getByTestId("account-logout-error")).toBeVisible();
  await expect(page.getByTestId("account-logout-error"))
    .toHaveText("暂时无法确认退出结果，请重试。");
  await expect(page.getByTestId("account-email")).toHaveText(user.email);
  const stillValid = await page.request.get("/api/v1/auth/session");
  expect(stillValid.status()).toBe(200);

  // 刷新后仍是同一账号：服务端会话从未被动过。
  await page.reload();
  await expect(page.getByTestId("account-email")).toHaveText(user.email);

  // 第二次退出走真实 API：成功落登录页，会话真实失效（401）。
  await page.getByTestId("account-logout").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/login/login"));
  const revoked = await page.request.get("/api/v1/auth/session");
  expect(revoked.status()).toBe(401);
});
