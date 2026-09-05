import { expect, test, type Page } from "@playwright/test";

import { navigateToPage, uiLogin } from "../helpers";

const ADMIN = {
  email: "e2e-admin@example.test",
  password: "E2e-Admin-Pass-1234!",
};

async function openMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "打开后台导航" }).click();
}

test("ADMIN can navigate the four honest management sections without writes", async ({ page }) => {
  await uiLogin(page, ADMIN);

  const adminWrites: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/admin/")
      && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      adminWrites.push(`${request.method()} ${path}`);
    }
  });

  await navigateToPage(page, "/pages/admin/admin");
  await expect(page.locator(".ac-heading__title")).toHaveText("注册审核");
  await expect(page.getByTestId("review-empty")).toBeVisible();

  await openMenu(page);
  const navigation = page.getByRole("navigation");
  await expect(navigation.getByRole("button")).toHaveCount(4);
  await expect(navigation.getByRole("button")).toHaveText([
    "注册审核",
    "账号",
    "模型与路由",
    "运行状态",
  ]);
  await page.getByTestId("admin-nav-accounts").click();
  await expect(page.locator(".ac-heading__title")).toHaveText("账号");
  await expect(page.getByTestId("admin-accounts")).toBeVisible();

  await openMenu(page);
  await page.getByTestId("admin-nav-models").click();
  await expect(page.locator(".ac-heading__title")).toHaveText("模型与路由");
  await expect(page.getByTestId("admin-models")).toBeVisible();

  await page.getByTestId("model-routing-open").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/admin-routing/admin-routing"));
  await expect(page.locator(".ac-heading__title")).toHaveText("模型与路由 · 路由顺序");
  await expect(page.getByTestId("admin-routing")).toBeVisible();

  await openMenu(page);
  await page.getByTestId("admin-nav-system").click();
  await expect(page.locator(".ac-heading__title")).toHaveText("运行状态");
  await expect(page.getByTestId("admin-system")).toContainText("存活检查");
  await expect(page.getByTestId("admin-system")).toContainText("就绪检查");

  await openMenu(page);
  await page.getByRole("button", { name: "返回应用" }).click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/account/account"));
  await expect(page.getByTestId("account-email")).toHaveText(ADMIN.email);
  await expect(page.getByTestId("me-admin")).toBeVisible();

  expect(adminWrites).toEqual([]);
});
