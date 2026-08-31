import { expect, test } from "@playwright/test";

import {
  navigateToPage,
  provisionUser,
  uiLogin,
} from "../helpers";

// Journey 2 — an unverified account is sent through the real linear H5
// admission flow before the normal product navigation becomes its next step.
test("an unverified account is routed through age and consent admission", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "admission-gate");
  await uiLogin(page, user);

  await navigateToPage(page, "/pages/index/index");
  const nextStep = page.getByTestId("next-step");
  await expect(nextStep).toContainText("成年", { timeout: 20_000 });
  await page.getByTestId("next-step-go").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/age/age"));

  await expect(page.getByTestId("age-state-label")).toContainText("未核验");
  const verificationResponse = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/age/verification",
  );
  await page.getByTestId("age-verify").click();
  expect((await verificationResponse).ok()).toBeTruthy();
  await expect(page.getByTestId("age-verified")).toBeVisible();

  await navigateToPage(page, "/pages/index/index");
  await expect(page.getByTestId("next-step")).toContainText("确认服务协议", {
    timeout: 20_000,
  });
  await page.getByTestId("next-step-go").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/consent/consent"));
  await expect(page.getByTestId("consent-row").first()).toBeVisible();
  expect(await page.getByTestId("consent-row").count()).toBeGreaterThan(0);
  await expect(page.getByTestId("consent-grant").first()).toBeEnabled();
});
