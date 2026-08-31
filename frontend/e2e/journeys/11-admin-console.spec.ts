import { expect, test, type Page } from "@playwright/test";

import { navigateToPage, uiLogin } from "../helpers";

const ADMIN = {
  username: "e2e-admin",
  password: "E2e-Admin-Pass-1234!",
};

async function openAdminSection(
  page: Page,
  section: "overview" | "models" | "routing" | "system",
  path: string,
  contentTestId: string,
  heading: string,
): Promise<void> {
  await page.getByRole("button", { name: "打开后台导航" }).click();
  const item = page.getByTestId(`admin-nav-${section}`);
  await expect(item).toBeVisible();
  await item.click();
  await page.waitForURL((url) => url.hash.startsWith(`#${path}`));
  await expect(page.locator(".ac-heading__title")).toHaveText(heading);
  await expect(page.getByTestId(contentTestId)).toBeVisible();
}

// Runs last because it uses the isolated bootstrap ADMIN. The journey is
// deliberately read-only: provider credentials and routing order are shared
// runtime configuration for the other browser journeys.
test("ADMIN can read and navigate the Go runtime console without changing configuration", async ({
  page,
}) => {
  await uiLogin(page, ADMIN);

  const adminWrites: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith("/api/v1/admin/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
    ) {
      adminWrites.push(`${request.method()} ${url.pathname}`);
    }
  });

  await navigateToPage(page, "/pages/admin/admin");
  await expect(page.locator(".ac-heading__title")).toHaveText("运行总览");
  const overview = page.getByTestId("admin-overview");
  await expect(overview).toBeVisible();
  await expect(overview).toContainText("Go Runtime");
  await expect(overview).toContainText("服务模式");

  await page.getByRole("button", { name: "打开后台导航" }).click();
  await expect(page.getByRole("navigation").getByRole("button")).toHaveCount(4);
  await expect(page.getByTestId("admin-nav-overview")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: "关闭后台导航" }).click();

  await openAdminSection(
    page,
    "models",
    "/pages/admin-models/admin-models",
    "admin-models",
    "模型服务",
  );
  await expect(page.getByTestId("admin-nav-models")).toHaveAttribute(
    "aria-current",
    "page",
  );

  await openAdminSection(
    page,
    "routing",
    "/pages/admin-routing/admin-routing",
    "admin-routing",
    "路由策略",
  );
  await expect(page.getByTestId("admin-nav-routing")).toHaveAttribute(
    "aria-current",
    "page",
  );

  await openAdminSection(
    page,
    "system",
    "/pages/admin-system/admin-system",
    "admin-system",
    "系统状态",
  );
  const system = page.getByTestId("admin-system");
  await expect(system).toContainText("存活检查");
  await expect(system).toContainText("就绪检查");
  await expect(system).toContainText("服务模式");

  const refreshed = page.waitForResponse((response) =>
    response.request().method() === "GET" &&
    new URL(response.url()).pathname === "/api/v1/version",
  );
  await page.getByTestId("system-refresh").click();
  expect((await refreshed).ok()).toBeTruthy();
  await expect(system).toBeVisible();

  await page.getByRole("button", { name: "打开后台导航" }).click();
  await page.getByRole("button", { name: "返回应用" }).click();
  await page.waitForURL((url) =>
    url.hash.startsWith("#/pages/account/account"),
  );
  await expect(page.getByTestId("me-hub")).toBeVisible();
  await expect(page.getByTestId("account-role")).toHaveText("管理员");

  expect(adminWrites, "read-only console smoke must not mutate admin configuration").toEqual([]);
});
