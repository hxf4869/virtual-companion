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
