import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  type APIRequestContext,
  expect,
  type Page,
  request as requestFactory,
  type Response,
  test,
} from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  openSharedSession,
  prepareGenerationAccess,
  provisionUser,
  sessionRequest,
  STANDALONE_API_REQUEST_OPTIONS,
  uiLogin,
  waitForGenerationTerminal,
} from "../helpers";

// VC-R30：「我的→聊天与记忆副本」真实下载链。栈、DATA_EXPORT worker、隔离
// MinIO、一次性 downloadUrl 全部真实，不 mock 任何一环。复用 chat 共享会话
// （真实 cookie 会话），当前密码取自 provisionUser 的既有合成凭据，不硬编码、
// 不打印；导出归属锚点是本轮新建的会话与唯一合成消息——共享账号还有其他
// 旅程的历史数据，不断言导出只含本轮内容。08/13 由 playwright.config 的
// 双引擎设备仿真项目（webkit-iphone / chromium-android）各跑一次。

const EXPORTS_PATH = "/api/v1/exports";
const READY_WAIT_MS = 60_000;

/** 仅服务本旅程两处泄漏断言（READY 有效期内与下载后）：DOM 与 Web 存储
 *  是否含本次真实一次性 URL/token。只做布尔断言，敏感值绝不进 expect
 *  实际/期望或日志；不扩展通用框架、不新建文件。 */
async function assertPrivateLinkHidden(
  page: Page,
  url: string,
  token: string,
  when: string,
): Promise<void> {
  const html = await page.content();
  expect(html.includes(url), `DOM leaked the export link ${when}`).toBe(false);
  expect(html.includes(token), `DOM leaked the export token ${when}`).toBe(false);
  const storageLeaked = await page.evaluate(
    ({ url, token }) => {
      const leaked = (store: Storage) => {
        for (let index = 0; index < store.length; index += 1) {
          const value = store.getItem(store.key(index) ?? "") ?? "";
          if (value.includes(url) || value.includes(token)) return true;
        }
        return false;
      };
      return leaked(localStorage) || leaked(sessionStorage);
    },
    { url, token },
  );
  expect(storageLeaked, `storage leaked the export link ${when}`).toBe(false);
}

test("我的→聊天与记忆副本：错密码被拒后真实申请并经浏览器下载一次性JSON", async ({ page }) => {
  const user = await provisionUser(undefined, "relationship-chat");
  const session = await openSharedSession(page, "chat");
  // 面板“当前密码”复核依赖共享会话与合成凭据指向同一账号。
  expect(session.email).toBe(user.email);

  // —— 数据准备（既有 API/helpers）：本轮专属会话 + 唯一合成消息锚点。 ——
  await prepareGenerationAccess(session);
  const anchor = await createRelationshipAndConversation(session);
  const sentinel = `vc-r30-export-anchor-${randomUUID()}`;
  const turn = await sessionRequest(
    page,
    "POST",
    `/api/v1/conversations/${encodeURIComponent(anchor.conversationId)}/generations`,
    { idempotencyKey: randomUUID(), userContent: sentinel },
    { accountId: session.accountId, sessionId: session.sessionId },
  );
  expect(turn.ok, `generation send failed: HTTP ${turn.status}`).toBeTruthy();
  const generationId = String(
    (turn.body as { generationId?: unknown } | null)?.generationId ?? "",
  );
  expect(generationId, "generation send returned no generationId").not.toBe("");
  const terminal = await waitForGenerationTerminal(page, generationId);
  const terminalStatus = String(
    (terminal.body as { status?: unknown } | null)?.status ?? "",
  );
  expect(
    ["COMPLETED", "COMPLETED_FALLBACK"],
    `generation ended as ${terminalStatus}`,
  ).toContain(terminalStatus);

  const history = await sessionRequest(
    page,
    "GET",
    `/api/v1/conversations/${encodeURIComponent(anchor.conversationId)}/messages?limit=10`,
  );
  expect(history.ok, `conversation history read failed: HTTP ${history.status}`).toBeTruthy();
  const rows = Array.isArray(history.body)
    ? history.body as Array<{ messageId?: unknown; content?: unknown }>
    : [];
  const anchorRow = rows.find((row) => row.content === sentinel);
  expect(anchorRow, "sentinel message missing from conversation history").toBeTruthy();
  const anchorMessageId = String(anchorRow?.messageId ?? "");
  expect(anchorMessageId).not.toBe("");

  // —— 真实 UI：我的→聊天与记忆副本。 ——
  await navigateToPage(page, "/pages/account/account");
  await page.getByTestId("data-copy-toggle").click();
  await expect(page.getByTestId("data-copy-panel")).toBeVisible();

  // 错密码：真实 POST 必须被服务端 404 拒绝（fail-closed），面板给出诚实
  // 文案。本轮只声明“被拒绝且可纠正再提交”，不断言服务端零副作用。
  // uni-app H5 的 input 编译为 <uni-input>（data-testid 在外层），fill 需定位
  // 内层原生 input，与 helpers.ts 登录旅程同一模式。
  await page.locator('[data-testid="data-copy-password"] input').fill("E2e-Wrong-Pass-0000!");
  const rejected = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === EXPORTS_PATH);
  await page.getByTestId("data-copy-create").click();
  expect((await rejected).status()).toBe(404);
  await expect(page.getByTestId("data-copy-error")).toHaveText("当前密码不正确，没有创建副本。");

  // 正确密码申请：真实 200 → PENDING。一次性 downloadUrl/downloadToken 只存
  // 测试内存（绝不打印/写日志），供 READY 有效期内的泄漏断言使用。
  await page.locator('[data-testid="data-copy-password"] input').fill(user.password);
  const accepted = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === EXPORTS_PATH);
  await page.getByTestId("data-copy-create").click();
  const created = await accepted;
  expect(created.status()).toBe(200);
  const createdBody = (await created.json()) as {
    downloadUrl?: unknown;
    downloadToken?: unknown;
  };
  // 敏感值绝不作为 expect 的实际/期望：仅用类型+长度布尔断言作闸门，
  // URL/token 本体只落测试内存供两处泄漏断言使用。
  expect(
    typeof createdBody.downloadUrl === "string" && createdBody.downloadUrl.length > 0,
    "create response carried no usable downloadUrl",
  ).toBe(true);
  expect(
    typeof createdBody.downloadToken === "string" && createdBody.downloadToken.length > 0,
    "create response carried no usable downloadToken",
  ).toBe(true);
  const privateUrl = typeof createdBody.downloadUrl === "string" ? createdBody.downloadUrl : "";
  const privateToken = typeof createdBody.downloadToken === "string"
    ? createdBody.downloadToken
    : "";
  await expect(page.getByTestId("data-copy-progress")).toBeVisible();

  // 等真实 worker 把 PENDING 变 READY：面板无自动轮询，仅在按钮仍存在且
  // 可用时点击“查看进度”，并以该次真实状态 GET 的响应为步进（不用任意
  // sleep）。面板翻到 READY/FAILED/EXPIRED 都会移除进度按钮——若点击前恰
  // 好翻转，回到循环顶以真实下载按钮收尾，绝不等待已消失的旧按钮；终态
  // 失败由状态文案断言给出明确原因。
  const deadline = Date.now() + READY_WAIT_MS;
  while (!(await page.getByTestId("data-copy-download").isVisible())) {
    const state = (await page.locator(".data-copy-state").textContent()) ?? "";
    expect(state, `export left PENDING unexpectedly: ${state}`).not.toContain("没有整理成功");
    expect(state, `export left PENDING unexpectedly: ${state}`).not.toContain("下载链接已过期");
    expect(Date.now() < deadline, "export never became READY").toBeTruthy();
    const progress = page.getByTestId("data-copy-progress");
    if (!(await progress.isVisible())) continue;
    await expect(progress).toBeEnabled();
    const statusArrived = page.waitForResponse((response) =>
      response.request().method() === "GET"
        && /^\/api\/v1\/exports\/\d+$/.test(new URL(response.url()).pathname));
    await progress.click();
    const status = await statusArrived;
    expect(status.ok(), `progress check failed: HTTP ${status.status()}`).toBeTruthy();
  }

  // READY 有效期内（一次性链接尚未消费）：DOM 与 Web 存储都不得出现真实 URL/token。
  await assertPrivateLinkHidden(page, privateUrl, privateToken, "while READY");

  // 只计 download 路径的真实 GET（一次性链接必须恰好消费一次）。
  let downloadGets = 0;
  page.on("request", (request) => {
    if (request.method() === "GET"
      && /\/api\/v1\/exports\/\d+\/download\?/.test(request.url())) {
      downloadGets += 1;
    }
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("data-copy-download").click();
  const download = await downloadPromise;

  // 文件名取 requestedAt 本地时间，不含内部 ID。
  expect(download.suggestedFilename()).toMatch(/^聊天与记忆副本-\d{8}-\d{4}\.json$/);

  // 服务器原始字节：int64 ID 只能按“字段+数字边界”在原文做布尔匹配；
  // JSON.parse 仅用于无损的结构与计数检查（大整数会被舍入，禁止数值比较）。
  const downloadPath = await download.path();
  expect(downloadPath, "browser did not persist the downloaded file").toBeTruthy();
  const raw = await readFile(downloadPath as string, "utf8");
  expect(
    new RegExp(`"conversationId":${anchor.conversationId}(?!\\d)`).test(raw),
    `anchor conversation ${anchor.conversationId} missing from export`,
  ).toBe(true);
  expect(
    new RegExp(`"messageId":${anchorMessageId}(?!\\d)`).test(raw),
    "anchor message id missing from export",
  ).toBe(true);
  expect(raw.includes(sentinel), "anchor synthetic content missing from export").toBe(true);

  const exported = JSON.parse(raw) as {
    conversations?: unknown;
    memories?: unknown;
    conversationCount?: unknown;
  };
  expect(Array.isArray(exported.conversations)).toBe(true);
  expect(Array.isArray(exported.memories)).toBe(true);
  expect(Number(exported.conversationCount)).toBeGreaterThanOrEqual(1);

  // 一次性收口与泄漏面（布尔断言，不把敏感值写进 expect 的实际/期望）。
  expect(downloadGets).toBe(1);
  await expect(page.getByTestId("data-copy-download")).toHaveCount(0);
  await expect(page.getByTestId("data-copy-reapply")).toBeVisible();
  const pageHtml = await page.content();
  expect(pageHtml.includes("/api/v1/exports/")).toBe(false);
  expect(pageHtml.includes("download?token")).toBe(false);
  const storageLeaked = await page.evaluate(() => {
    const hasExportPath = (store: Storage) => {
      for (let index = 0; index < store.length; index += 1) {
        if ((store.getItem(store.key(index) ?? "") ?? "").includes("/api/v1/exports/")) {
          return true;
        }
      }
      return false;
    };
    return hasExportPath(localStorage) || hasExportPath(sessionStorage);
  });
  expect(storageLeaked).toBe(false);
  // 通用路径标记之外，本次实际消费过的 URL/token 同样不得残留。
  await assertPrivateLinkHidden(page, privateUrl, privateToken, "after download");
});

// VC-R48：同 context 双 Tab 的跨 Tab 副本归属。Tab A 以共享 chat 会话打开
// 「我的→聊天与记忆副本」并填好当前密码但不提交；Tab B 在同一
// BrowserContext 走真实登录页换装另一账号。共享 cookie jar 意味着 B 登录后
// 任何 API 请求（包括 A 页发起的 POST /api/v1/exports）都以 B 的会话身份
// 到达服务器。刻意不新增 A 侧 witness（不 mock、不注入 cookie）：A 页本地
// auth 不随跨 Tab 登录刷新，这正是陈旧提交风险的来源。
// VC-R49：B 真实登录前只等到下一个 30 秒 TOTP 步边界（global-setup 刚消费
// 当前步，服务端一次性步号不可重放）；owner 见证改用冻结真实 B 凭证的独立
// APIRequestContext，不再依赖与 A 共用的可变 cookie jar。
// VC-R52：服务端上线期望账号前置条件（X-VC-Expected-Account-ID；失配写
// 409 + ACCOUNT_CONTEXT_CHANGED）后，A 的陈旧 POST 必须被拒，账号页给出
// 「登录状态已更新」反馈并 reconcile 到 B；随后正向路径要求用户重新填 B
// 的密码确认，B 的副本创建真实成功并轮询到 READY（B 段计数与旧意图观测
// 分开快照）。「2xx + 冻结 B owner 见证 200」仍是明确归属红。Playwright
// 不允许在 describe 内用 test.use 关闭 trace/screenshot/video（会强制新
// worker），而文件顶层会改变旧用例的录制策略，故录制策略只随 config/CLI；
// 本用例在 finally 先关闭两页再做最终断言，失败的 error-context 不会残留
// 密码输入与私有链接。观测只落布尔、状态码与计数，密码/cookie/token/链接/
// exportId 本体绝不进断言或日志。
test.describe("VC-R48 cross-tab data copy ownership", () => {
  test("cross-tab export does not create a copy for the newly signed-in account", async ({ page }) => {
    let pageB: Page | null = null;
    let outcome: "post" | "feedback" | "none" = "none";
    let postStatus = 0;
    let exportPosts = 0;
    // 旧意图观测的计数快照：B 段合法 POST 不得污染它（VC-R52）。
    let stalePhaseExportPosts = 0;
    let ownerStatus = 0;
    let feedbackSeen = false;
    let bSessionValidAfter = false;
    let bAfterStatus = 0;
    let frozenB: APIRequestContext | null = null;

    try {
      // Tab A：共享 chat 会话与合成账号同源（真实 cookie，不 mock）。
      const userA = await provisionUser(undefined, "relationship-chat");
      const sessionA = await openSharedSession(page, "chat");
      expect(sessionA.email === userA.email, "shared chat session must belong to user A").toBe(true);

      await navigateToPage(page, "/pages/account/account");
      await expect(page.getByTestId("account-identity")).toBeVisible();
      const tabAEmail = ((await page.getByTestId("account-email").textContent()) ?? "").trim();
      expect(tabAEmail === userA.email, "Tab A must render account A").toBe(true);

      // 只填不提交：陈旧凭据的因果观察在 B 换装之后再触发。
      await page.getByTestId("data-copy-toggle").click();
      await expect(page.getByTestId("data-copy-panel")).toBeVisible();
      const passwordInput = page.locator('[data-testid="data-copy-password"] input');
      await passwordInput.fill(userA.password);
      await expect(page.getByTestId("data-copy-create")).toBeEnabled();

      // Tab B：同 context 新 Tab，真实登录另一合成账号（池内共用同一密码，
      // 只做布尔比较，值绝不输出）。
      pageB = await page.context().newPage();
      const userB = await provisionUser(undefined, "companion-memory");
      expect(userA.email !== userB.email, "Tab B must sign in a different account").toBe(true);
      const samePassword = userA.password === userB.password;
      expect(
        samePassword,
        "pool accounts must share one synthetic password (value never printed)",
      ).toBe(true);
      // B 的 TOTP 前置：global-setup 刚用当前 30 秒步为该账号 enroll 并消费了
      // 验证码，服务端（V134）要求本次 consumed_step 严格大于上次，同步重放
      // 会被 404 拒绝。这是"一次性时间步已被消费"的真实前置，不是等待
      // absence、不吞错误、不削弱服务端防重放：只等到下一个 30 秒边界再加
      // 最小调度余量（最多约 31s，沿用 90s 用例超时，不 retry），让
      // uiLogin 内按 Date.now() 取的验证码落在严格更晚的步。
      const TOTP_STEP_MS = 30_000;
      const nextTotpStepAt = (Math.floor(Date.now() / TOTP_STEP_MS) + 1) * TOTP_STEP_MS;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(0, nextTotpStepAt + 1_000 - Date.now()));
      });
      const sessionB = await uiLogin(pageB, userB);
      expect(sessionB.accountId !== sessionA.accountId, "Tab B must hold a different account session").toBe(true);

      const bSession = await sessionRequest(pageB, "GET", "/api/v1/auth/session");
      const bBody = bSession.body as { accountId?: unknown; passwordMustChange?: unknown } | null;
      // passwordMustChange 必须严格为 false：字段缺失不算“已验证为 false”。
      const bActive = bSession.status === 200
        && bBody?.accountId === sessionB.accountId
        && bBody?.passwordMustChange === false;
      expect(
        bActive,
        `Tab B must hold an ACTIVE session for account B (session GET ${bSession.status})`,
      ).toBe(true);

      // 归属见证凭证冻结：pageB.context().request 与 Tab A 共用可变 cookie
      // jar，稍后的 GET 200 不能单独证明 owner 是 B。把真实 B 登录后的
      // storageState 只保存在内存（不落盘、不输出），以同一真实 baseURL 与
      // 实际 UA 创建独立 APIRequestContext 继承真实 B 凭证（不伪造 cookie），
      // 先用它确认 /auth/session 确为 B，之后 owner GET 只走这条冻结凭证。
      const bOrigin = new URL(pageB.url()).origin;
      const bHeaders = { "Content-Type": "application/json", Origin: bOrigin };
      // 独立 requestFactory.newContext 不继承浏览器 context 的
      // ignoreHTTPSErrors，TLS 栈必须显式带（HTTP 模式为空对象，不变）。
      const frozenBContext = await requestFactory.newContext({
        baseURL: bOrigin,
        userAgent: await pageB.evaluate(() => navigator.userAgent),
        storageState: await pageB.context().storageState(),
        ...STANDALONE_API_REQUEST_OPTIONS,
      });
      frozenB = frozenBContext;
      const frozenSession = await frozenBContext.get("/api/v1/auth/session", { headers: bHeaders });
      const frozenBody = (await frozenSession.json().catch(() => null)) as
        | { accountId?: unknown; passwordMustChange?: unknown }
        | null;
      const frozenIsB = frozenSession.status() === 200
        && frozenBody?.accountId === sessionB.accountId
        && frozenBody?.passwordMustChange === false;
      expect(
        frozenIsB,
        `frozen B credentials must resolve to account B's ACTIVE session (session GET ${frozenSession.status()})`,
      ).toBe(true);

      // 模拟真实用户切回 Tab A 后再核对：不操作 pinia、不强留 A 身份。A 页
      // 本地 auth 不随跨 Tab 登录刷新时，邮箱仍渲染 A、密码输入与按钮未被
      // 打断；若页面已真实感知换号并清掉旧意图，任一不成立即前置 FAIL——
      // 陈旧提交场景不成立，按实际状态安全失败，不伪造表单。
      await page.bringToFront();
      const tabAEmailRecheck = ((await page.getByTestId("account-email").textContent()) ?? "").trim();
      const formIntact = tabAEmailRecheck === userA.email
        && (await passwordInput.inputValue()) === userA.password
        && (await page.getByTestId("data-copy-create").isEnabled());
      expect(formIntact, "Tab A must still render account A with its filled password form").toBe(true);

      // 因果观察：真实 POST 响应与「登录状态已更新」反馈二选一，先注册
      // 计数，不做定时 absence 轮询。
      page.on("request", (request) => {
        if (request.method() === "POST"
          && new URL(request.url()).pathname === EXPORTS_PATH) {
          exportPosts += 1;
        }
      });
      const postPromise = page.waitForResponse((response) =>
        response.request().method() === "POST"
        && new URL(response.url()).pathname === EXPORTS_PATH);
      // 反馈不绑死面板内部：账号页任意层级可见的「登录状态已更新」提示都算，
      // 只复用 R39 文案语义，不指定实现位置。
      const feedback = page.getByText(/登录状态已更新/);
      await page.getByTestId("data-copy-create").click();
      // 输掉的一支最终的超时/Target closed 拒绝被吞掉只为避免 unhandled
      // rejection，判定只依赖先 settle 的赢家；feedback 一支由 config 的
      // expect 超时自然有界，不新增超时常量。
      const settled = await Promise.race([
        postPromise
          .then((response) => ({ kind: "post" as const, response }))
          .catch(() => ({ kind: "none" as const })),
        expect(feedback)
          .toBeVisible()
          .then(() => ({ kind: "feedback" as const }))
          .catch(() => ({ kind: "none" as const })),
      ]);
      outcome = settled.kind;
      expect(
        outcome !== "none",
        "neither a real POST /api/v1/exports response nor the session-changed feedback was observed after clicking 申请副本",
      ).toBe(true);

      // feedback 赢不等于本地 0 POST 拦截：服务端 409 同样触发该反馈，IPC
      // 事件与 DOM 观察都可能让 feedback 分支先 settle。已观测到真实 POST
      // 请求时，用同一个已注册的 postPromise 收取其真实响应，走与 post 赢
      // 家完全相同的「拒绝 POST + 反馈 + B 仍有效」判定；只有从未发出 POST
      // 才是本地拦截分支。
      let postResponse: Response | null = settled.kind === "post" ? settled.response : null;
      if (settled.kind === "feedback" && exportPosts > 0) {
        const collected = await postPromise.catch((): Response | null => null);
        expect(
          collected,
          "a POST /api/v1/exports request was observed but its response never arrived",
        ).toBeTruthy();
        postResponse = collected!;
      }

      if (postResponse) {
        postStatus = postResponse.status();
        // 前置过滤：401/429/5xx 属于前置未成立，不能作为归属判定证据。
        expect(
          postStatus !== 401 && postStatus !== 429 && postStatus < 500,
          `POST /api/v1/exports answered ${postStatus}: precondition not met (unauthorized / rate limited / server error)`,
        ).toBe(true);

        if (postStatus >= 200 && postStatus < 300) {
          const body = (await postResponse.json().catch(() => null)) as
            | { exportId?: unknown }
            | null;
          const exportId = typeof body?.exportId === "string" ? body.exportId : "";
          expect(exportId !== "", "create response carried no exportId").toBe(true);
          // owner 见证只走冻结的真实 B 凭证 context：共享 jar 即使被晚到的
          // 响应改回 A，也不会把 A 的副本误判成 B 归属（假红）；200 才是
          // B owner 见证。绝不读取/打印 downloadUrl/downloadToken。归属判定
          // 不依赖响应后的 UI 状态：A 的提交意图已在点击前由 formIntact 正向
          // 确证，界面迟到的变化洗不掉已创建的 B 副本。
          ownerStatus = (await frozenBContext.get(
            `/api/v1/exports/${encodeURIComponent(exportId)}`,
            { headers: bHeaders },
          )).status();
          // 见证前置过滤：冻结凭证被拒/限流/服务端错误属于前置未成立，
          // 不能当作"不是 B 的副本"或任何安全结论。
          expect(
            ownerStatus !== 401 && ownerStatus !== 429 && ownerStatus < 500,
            `owner witness GET /api/v1/exports/{id} answered ${ownerStatus}: precondition not met (frozen B credentials rejected / rate limited / server error)`,
          ).toBe(true);
        }

        // 「2xx 且 B owner 见证 200」已是明确归属红，不再等待反馈或 UI 收尾；
        // 其余 POST 结局不得直接当绿：必须正向等到具体「登录状态已更新」
        // 反馈可见才记 feedbackSeen，B 会话仍有效另由下方核验。
        if (!(postStatus >= 200 && postStatus < 300 && ownerStatus === 200)) {
          await expect(
            feedback,
            `POST /api/v1/exports answered ${postStatus} without the session-changed feedback; a wrong-password or existing-PENDING rejection is not protection`,
          ).toBeVisible();
          feedbackSeen = true;
        }
      }

      // B 会话仍有效：陈旧提交不得撤销 B 的 ACTIVE 会话（passwordMustChange
      // 同样严格为 false）。
      const bAfter = await sessionRequest(pageB, "GET", "/api/v1/auth/session");
      bAfterStatus = bAfter.status;
      const bAfterBody = bAfter.body as { accountId?: unknown; passwordMustChange?: unknown } | null;
      bSessionValidAfter = bAfter.status === 200
        && bAfterBody?.accountId === sessionB.accountId
        && bAfterBody?.passwordMustChange === false;

      // —— VC-R52 正向路径：陈旧意图被拒（非 2xx）后的前端owned恢复。 ——
      // 只有「旧意图已创建 B 副本」的红分支跳过（上面已在归属判定前失败）；
      // POST 409/feedback 两种拒收结局都必须走完：页面 reconcile 到 B、旧
      // 密码表单被清空、反馈可见，然后用户重新确认操作，B 的副本创建成功。
      stalePhaseExportPosts = exportPosts;
      if (!(postStatus >= 200 && postStatus < 300 && ownerStatus === 200)) {
        // 页面 reconcile 到 B（账号页身份经 omit 头的 GET /auth/session 恢复），
        // 反馈在账号页层级可见，旧密码意图落牌（表单清空）。
        await expect(page.getByTestId("account-email")).toHaveText(userB.email);
        await expect(feedback).toBeVisible();
        await expect(passwordInput).toHaveValue("");

        // 重建后的副本面板是折叠的初始态（v-show 隐藏）：读真实
        // aria-expanded，只在关闭时正常 click 展开（不 force、不改 DOM），
        // 确认面板可见且密码为空，再由用户重填 B 的密码并确认——实现不得
        // 自动重放，重放必须来自真实用户操作。
        const copyToggle = page.getByTestId("data-copy-toggle");
        await expect(copyToggle).toBeEnabled();
        if ((await copyToggle.getAttribute("aria-expanded")) === "false") {
          await copyToggle.click();
        }
        await expect(page.getByTestId("data-copy-panel")).toBeVisible();
        await expect(passwordInput).toBeVisible();
        await expect(passwordInput).toHaveValue("");
        await passwordInput.fill(userB.password);
        const retryAccepted = page.waitForResponse((response) =>
          response.request().method() === "POST"
          && new URL(response.url()).pathname === EXPORTS_PATH);
        await page.getByTestId("data-copy-create").click();
        const retry = await retryAccepted;
        expect(
          retry.status() >= 200 && retry.status() < 300,
          `B's re-confirmed export create must succeed, got HTTP ${retry.status()}`,
        ).toBe(true);
        expect(exportPosts - stalePhaseExportPosts, "exactly one POST belongs to B's re-confirmed intent").toBe(1);

        // 轮询既有状态端点等真实 READY（面板无自动轮询，以「查看进度」的
        // 真实状态 GET 为步进，沿用第一例的 READY_WAIT_MS 约束），不把
        // PENDING 留给下一引擎。
        const retryDeadline = Date.now() + READY_WAIT_MS;
        while (!(await page.getByTestId("data-copy-download").isVisible())) {
          const state = (await page.locator(".data-copy-state").textContent()) ?? "";
          expect(state, `B's retry export left PENDING unexpectedly: ${state}`).not.toContain("没有整理成功");
          expect(state, `B's retry export left PENDING unexpectedly: ${state}`).not.toContain("下载链接已过期");
          expect(Date.now() < retryDeadline, "B's retry export never became READY").toBeTruthy();
          const progress = page.getByTestId("data-copy-progress");
          if (!(await progress.isVisible())) continue;
          await expect(progress).toBeEnabled();
          const statusArrived = page.waitForResponse((response) =>
            response.request().method() === "GET"
            && /^\/api\/v1\/exports\/\d+$/.test(new URL(response.url()).pathname));
          await progress.click();
          const status = await statusArrived;
          expect(status.ok(), `B's retry progress check failed: HTTP ${status.status()}`).toBeTruthy();
        }
      }
    } finally {
      // 关闭是标准清理：让失败的 error-context 不残留密码输入与私有链接；
      // 任何前置断言异常同样经过这里。
      if (pageB && !pageB.isClosed()) await pageB.close();
      if (!page.isClosed()) await page.close();
      if (frozenB) await frozenB.dispose();
    }

    // 最终归属判定：只用已收集的布尔/状态码/计数，不再触碰页面。A 的意图
    // 已在点击前由 formIntact 正向确证（未成立早已在 try 内 FAIL），红条件
    // 只看「POST 2xx + 冻结 B 凭证 owner 见证 200」，不以响应后的 UI 状态为
    // 必要条件——界面迟到改成 B 也不能把已创建的 B 副本洗成绿。
    const staleCopyOwnedByB = postStatus >= 200 && postStatus < 300 && ownerStatus === 200;
    expect(
      staleCopyOwnedByB,
      `Tab A's stale export request created a copy owned by the newly signed-in account B (POST ${postStatus} + frozen-B owner witness GET ${ownerStatus}; exportPosts=${exportPosts}; B shared-jar session after: valid=${bSessionValidAfter} GET ${bAfterStatus}; A's intent was confirmed before the click)`,
    ).toBe(false);
    expect(
      bSessionValidAfter,
      `Tab B's session must remain valid and ACTIVE for account B after Tab A's stale click (shared-jar session GET ${bAfterStatus})`,
    ).toBe(true);
    // 旧意图观测收口：发出过陈旧 POST 时，保护 = 该 POST 被拒（上方红判定
    // 已排除 2xx+B owner 200）且页面给出「登录状态已更新」反馈；只有确实
    // 未发出 POST 的本地拦截分支才要求 feedback 赢家 + 零 POST（feedback
    // 先 settle 不能等价本地拦截：服务端 409 同样触发反馈）。
    if (stalePhaseExportPosts > 0) {
      expect(
        feedbackSeen,
        `POST /api/v1/exports answered ${postStatus} without the session-changed feedback; a wrong-password or existing-PENDING rejection is not protection`,
      ).toBe(true);
    } else {
      expect(
        outcome,
        "no stale POST went out and no session-changed feedback was observed",
      ).toBe("feedback");
    }
  });
});
