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

// VC-R169: 同账号新会话后旧页写入的真实链路。独立合成账号
// auth-session-context（非共享 TOTP 账号）：A 页 uiLogin(trustDevice)→S1 并
// 导航账号页确认就绪（均在 B 之前）；B 同 context（共享 cookie jar +
// trusted-device cookie 跳 TOTP）真实重登 → 同账号 S2。此后 A 绝不导航/
// 刷新/GET：点击退出时页面仍持 S1 编号 → 服务端真实 409 + code 且无
// Set-Cookie，B 的 GET session 仍 200（S2 未被动过）；A 经既有 reconcile
// 发现 S2 后用户第二次点击退出 → 200、登录页、B 的 GET session 401。只
// 断言状态码/计数/派生布尔，凭据不入日志。
test("a same-account relogin invalidates a stale page's logout until it re-discovers", async ({
  page,
  request,
}) => {
  const user = await provisionUser(request, "auth-session-context");
  const pageB = await page.context().newPage();
  try {
    // A: first login establishes S1, then the account page is ready BEFORE B.
    const sessionA = await uiLogin(page, user, { trustDevice: true });
    await navigateToPage(page, "/pages/account/account");
    await expect(page.getByTestId("account-email")).toHaveText(user.email);

    // B: same context, real trusted relogin → same account, new session S2.
    const sessionB = await uiLogin(pageB, user, { trustDevice: false });
    // Derived booleans only: same account, two distinct live session ids.
    expect(sessionA.accountId === sessionB.accountId).toBe(true);
    expect(sessionA.sessionId !== "").toBe(true);
    expect(sessionB.sessionId !== "").toBe(true);
    expect(sessionA.sessionId !== sessionB.sessionId).toBe(true);

    // A never navigates/refreshes: it is still committed to S1. Observe the
    // real stale logout (409 + ACCOUNT_CONTEXT_CHANGED, no Set-Cookie) and
    // the reconcile's discovery GET.
    const staleLogout = page.waitForResponse(
      (response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/v1/auth/logout",
    );
    const discovery = page.waitForResponse(
      (response) => response.request().method() === "GET"
        && new URL(response.url()).pathname === "/api/v1/auth/session",
    );
    let logoutRequests = 0;
    page.on("request", (req) => {
      if (req.method() === "POST"
          && new URL(req.url()).pathname === "/api/v1/auth/logout") {
        logoutRequests += 1;
      }
    });
    await page.getByTestId("account-logout").click();
    const rejected = await staleLogout;
    expect(rejected.status()).toBe(409);
    const rejectedBody = (await rejected.json()) as { code?: unknown };
    expect(rejectedBody.code === "ACCOUNT_CONTEXT_CHANGED").toBe(true);
    expect(logoutRequests).toBe(1);
    const rejectedSetCookies = rejected.headers()["set-cookie"];
    expect(rejectedSetCookies === undefined).toBe(true);

    // A's automatic reconcile discovered S2: the discovery answered 200 with
    // exactly B's session id (derived boolean, never the raw value).
    const discovered = await discovery;
    expect(discovered.status()).toBe(200);
    const discoveredBody = (await discovered.json()) as { sessionId?: unknown };
    expect(discoveredBody.sessionId === sessionB.sessionId).toBe(true);

    // B's S2 session is untouched by the rejected stale write.
    const stillValid = await pageB.request.get("/api/v1/auth/session");
    expect(stillValid.status()).toBe(200);
    const stillValidBody = (await stillValid.json()) as { sessionId?: unknown };
    expect(stillValidBody.sessionId === sessionB.sessionId).toBe(true);

    // A's reconcile completed (same account re-rendered, button ready); the
    // user's second click signs out for real: 200 and B's session is revoked.
    await expect(page.getByTestId("account-email")).toHaveText(user.email);
    await expect(page.getByTestId("account-logout")).toBeEnabled();
    const secondLogout = page.waitForResponse(
      (response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/v1/auth/logout",
    );
    await page.getByTestId("account-logout").click();
    const confirmed = await secondLogout;
    expect(confirmed.status()).toBe(200);
    await page.waitForURL((url) => url.hash.startsWith("#/pages/login/login"));
    expect(logoutRequests).toBe(2);
    const revokedB = await pageB.request.get("/api/v1/auth/session");
    expect(revokedB.status()).toBe(401);
  } finally {
    await pageB.close();
    await page.close();
  }
});
