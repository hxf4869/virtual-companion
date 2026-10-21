import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import {
  createRelationshipAndConversation,
  navigateToPage,
  openSharedSession,
  prepareGenerationAccess,
  provisionUser,
  sessionRequest,
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

test("我的→聊天与记忆副本：错密码被拒后真实申请并经浏览器下载一次性JSON", async ({ page }) => {
  const user = await provisionUser(undefined, "relationship-chat");
  const session = await openSharedSession(page, "chat");
  // 面板“当前密码”复核依赖共享会话与合成凭据指向同一账号。
  expect(session.email).toBe(user.email);

  // —— 数据准备（既有 API/helpers）：本轮专属会话 + 唯一合成消息锚点。 ——
  await prepareGenerationAccess(page);
  const anchor = await createRelationshipAndConversation(page);
  const sentinel = `vc-r30-export-anchor-${randomUUID()}`;
  const turn = await sessionRequest(
    page,
    "POST",
    `/api/v1/conversations/${encodeURIComponent(anchor.conversationId)}/generations`,
    { idempotencyKey: randomUUID(), userContent: sentinel },
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
  const privateUrl = typeof createdBody.downloadUrl === "string" ? createdBody.downloadUrl : "";
  const privateToken = typeof createdBody.downloadToken === "string"
    ? createdBody.downloadToken
    : "";
  expect(privateUrl, "create response carried no downloadUrl").not.toBe("");
  expect(privateToken, "create response carried no downloadToken").not.toBe("");
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

  // READY 有效期内（一次性链接尚未消费）：DOM 与 Web 存储都不得出现真实
  // URL/token（布尔 includes 断言，敏感值绝不进 expect 实际/期望或日志）。
  const readyHtml = await page.content();
  expect(readyHtml.includes(privateUrl)).toBe(false);
  expect(readyHtml.includes(privateToken)).toBe(false);
  const readyStorageLeaked = await page.evaluate(
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
    { url: privateUrl, token: privateToken },
  );
  expect(readyStorageLeaked, "storage held the live export link while READY").toBe(false);

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
});
