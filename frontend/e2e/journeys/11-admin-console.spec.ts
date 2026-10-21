import { expect, test, type Page } from "@playwright/test";

import {
  navigateToPage,
  openSharedSession,
  sessionRequest,
  SHARED_ADMIN_ACCOUNT,
  uiLogin,
} from "../helpers";

async function openMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "打开后台导航" }).click();
}

test("ADMIN can navigate the four honest management sections without writes", async ({ page }) => {
  const session = await openSharedSession(page, "admin");

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
  await expect(page.getByTestId("account-email")).toHaveText(session.email);
  await expect(page.getByTestId("me-admin")).toBeVisible();

  expect(adminWrites).toEqual([]);
});

// VC-R38 基线红 → VC-R39 绿：Tab A 打开真实“放弃未保存变更？”确认窗后，
// Tab B 在同一 BrowserContext 用受信设备 cookie 真实重登录换装新会话 S1；
// A 再确认旧窗。基线时迟到的 logout 读共享 cookie jar（新 vc_session + 新
// CSRF）发出，服务器只撤销“请求 token”的会话，Tab B 的 S1 被误撤。修复后
// 壳层以确认前后 CSRF cookie 是否变化撤销旧意图，因果锚点是它渲染的可见
// 反馈，而不是固定等待或空轮询。断言只记录状态码、请求计数与派生布尔，
// 不落任何 Cookie/CSRF/Token/header/响应体。
test("ADMIN confirming a stale dirty-logout draft must not revoke a newer same-account session in another tab", async ({ page }, testInfo) => {
  await openSharedSession(page, "admin");

  let logoutRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST"
      && new URL(request.url()).pathname === "/api/v1/auth/logout") {
      logoutRequests += 1;
    }
  });

  await navigateToPage(page, "/pages/admin-models/admin-models");
  await expect(page.getByTestId("admin-models")).toBeVisible();
  await expect(page.getByTestId("provider-add")).toBeEnabled();
  // 一次 provider-add 即建立“新增模型提供方”本地草稿，无需填写或保存。
  await page.getByTestId("provider-add").click();

  await openMenu(page);
  await expect(page.locator(".ac-rail")).toHaveClass(/ac-rail--open/);
  // 供 Root 本地视觉核验：抽屉展开完成态。animations: "disabled" 让 CSS
  // transition 快进到终态再截图，不加 sleep、不改 DOM。
  await page.screenshot({
    path: testInfo.outputPath("admin-nav-open.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByText("放弃未保存变更？", { exact: true })).toBeVisible();

  // Tab B：同上下文真实重登录，取得与共享 S0 不同的新会话 S1。
  const pageB = await page.context().newPage();
  const cookiesBefore = await page.context().cookies();
  const session0 = cookiesBefore.find((cookie) => cookie.name === "vc_session")?.value ?? "";
  const loginResponsePromise = pageB.waitForResponse(
    (response) =>
      response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/v1/auth/login",
  );
  await uiLogin(pageB, SHARED_ADMIN_ACCOUNT);
  const loginResponse = await loginResponsePromise;
  const trustedActive =
    ((await loginResponse.json()) as { nextStep?: unknown }).nextStep === "ACTIVE";
  expect(trustedActive, "受信设备重登录应直接进入 ACTIVE").toBe(true);
  const cookiesAfter = await page.context().cookies();
  const session1 = cookiesAfter.find((cookie) => cookie.name === "vc_session")?.value ?? "";
  const credentialRotated = session0 !== "" && session1 !== "" && session0 !== session1;
  expect(credentialRotated, "Tab B 登录必须换装新会话凭据（仅断言布尔）").toBe(true);

  const beforeConfirm = await sessionRequest(pageB, "GET", "/api/v1/auth/session");
  expect(beforeConfirm.status, "Tab B 新会话在确认前必须有效").toBe(200);

  // A 确认旧窗：壳层发现凭据已变，撤销旧意图并渲染可见反馈。该反馈只在
  // 取消分支渲染，且与发 logout 的分支互斥，所以它出现后请求计数必为 0。
  await page.getByText("放弃并离开", { exact: true }).click();
  await expect(
    page.getByText("登录状态已更新，请重新确认退出", { exact: true }),
  ).toBeVisible();
  expect(logoutRequests, "撤销旧退出意图不得发出 logout").toBe(0);
  const afterCancel = await sessionRequest(pageB, "GET", "/api/v1/auth/session");
  expect(afterCancel.status, "确认旧退出草稿不得撤销 Tab B 的新会话").toBe(200);

  // 控制段：dirty 草稿仍在、抽屉仍开，不重新导航/建草稿/开菜单，直接再次
  // 点击可见的退出按钮确认新的意图。同一 S1、凭据未再变化，正常确认退出
  // 必须真实生效：logout 200、A 回登录页、B 侧会话 401。只撤销当前 S1，
  // 不触碰磁盘上的 shared-admin S0。
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByText("放弃未保存变更？", { exact: true })).toBeVisible();
  const controlLogoutPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/v1/auth/logout",
  );
  await page.getByText("放弃并离开", { exact: true }).click();
  const controlLogout = await controlLogoutPromise;
  expect(controlLogout.status(), "正常未变凭据的确认退出必须真实生效").toBe(200);
  expect(logoutRequests, "整个旅程恰好发出一次 logout").toBe(1);
  await page.waitForURL((url) => url.hash.includes("/pages/login/login"));
  const controlAfter = await sessionRequest(pageB, "GET", "/api/v1/auth/session");
  expect(controlAfter.status, "控制段只撤销当前 S1").toBe(401);
});
