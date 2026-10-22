import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

import {
  getDefaultRelationshipId,
  navigateToPage,
  openSharedSession,
  prepareGenerationAccess,
  PROVIDER_REPLY,
  sessionRequest,
  waitForGenerationTerminal,
} from "../helpers";

/**
 * DOGFOOD-xx companion + memory settings journeys: the two pages added with
 * the audit-remediation round. The first two journeys drive only visible
 * product UI with no provider calls; the autosave journey additionally sends
 * two real synthetic chat turns through the loopback provider to verify the
 * saved, later-recalled and disabled behaviours end to end.
 */

/** uni-app renders <input> as a wrapper custom element; fill whichever level
 * holds the real <input>. */
async function fillUniInput(page: Page, testid: string, value: string): Promise<void> {
  const host = page.getByTestId(testid);
  const native = host.locator("input");
  if ((await native.count()) > 0) {
    await native.fill(value);
  } else {
    await host.fill(value);
  }
}

async function readUniInputValue(page: Page, testid: string): Promise<string> {
  return page.getByTestId(testid).evaluate((element) => {
    const input = element.matches("input")
      ? (element as HTMLInputElement)
      : element.querySelector("input");
    return input ? input.value : element.textContent ?? "";
  });
}

test("companion settings save survives a full re-read", async ({ page }) => {
  await openSharedSession(page, "memory");
  await navigateToPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("companion-form")).toBeVisible();

  await fillUniInput(page, "pref-companion-name", "小白");
  await page.getByTestId("pref-reply-length-SHORT").click();
  await page.getByTestId("pref-initiative-MEDIUM").click();
  await expect(page.getByTestId("companion-dirty")).toBeVisible();

  await page.getByTestId("companion-save").click();
  await expect(page.getByTestId("companion-saved")).toBeVisible();

  // Leave and come back: the form baseline must come from the server, not
  // from in-page state.
  await navigateToPage(page, "/pages/account/account");
  await navigateToPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("companion-form")).toBeVisible();
  expect(await readUniInputValue(page, "pref-companion-name")).toBe("小白");
  await expect(page.getByTestId("pref-reply-length-SHORT")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByTestId("pref-initiative-MEDIUM")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("memory page autosave toggle round-trips through the server", async ({ page }) => {
  await openSharedSession(page, "memory");
  await navigateToPage(page, "/pages/memory/memory");

  // The toggle stays disabled while loading; the ready note is the sync point.
  await expect(page.getByTestId("autosave-note")).toBeVisible();
  const toggle = page.getByTestId("autosave-toggle");
  // V66 default: auto memory starts enabled.
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).toHaveText("已开启");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveText("已关闭");

  await navigateToPage(page, "/pages/account/account");
  await navigateToPage(page, "/pages/memory/memory");
  await expect(page.getByTestId("autosave-note")).toBeVisible();
  await expect(page.getByTestId("autosave-toggle")).toHaveAttribute("aria-checked", "false");

  // A fresh user has no memories yet: the empty state renders.
  await expect(page.getByTestId("memory-empty")).toBeVisible();

  // Restore the default so the shared seeded user keeps its baseline state.
  await page.getByTestId("autosave-toggle").click();
  await expect(page.getByTestId("autosave-toggle")).toHaveAttribute("aria-checked", "true");
});

// The loopback provider derives the extraction item from the user's own first
// clause containing the trigger keyword; the server then requires the summary
// to be the「用户」prefix plus that verbatim span.
const AUTOSAVE_FACT_A = "我喜欢周末去户外徒步，人少的时候最舒服";
const AUTOSAVE_SUMMARY_A = "用户我喜欢周末去户外徒步";
const AUTOSAVE_FACT_B = "我最近迷上了户外骑行，绕湖最舒服";
const AUTOSAVE_SUMMARY_B = "用户我最近迷上了户外骑行";

const MEMORY_BLOCK_BEGIN = "[VC_MEMORY_DATA_BEGIN]";
const MEMORY_BLOCK_END = "[VC_MEMORY_DATA_END]";

interface ProviderLogEntry {
  kind?: unknown;
  messages?: unknown;
}

function entryMessages(entry: ProviderLogEntry | undefined): Array<{ content?: unknown }> {
  if (!entry || !Array.isArray(entry.messages)) return [];
  return entry.messages as Array<{ content?: unknown }>;
}

function messageText(message: { content?: unknown }): string {
  return typeof message.content === "string" ? message.content : "";
}

/** The dedicated memory block is its own system message fenced by the
 * VC_MEMORY_DATA markers; only text inside the fence counts as recall. */
function memoryBlockFence(content: string): string {
  const begin = content.indexOf(MEMORY_BLOCK_BEGIN);
  const end = content.indexOf(MEMORY_BLOCK_END);
  if (begin < 0 || end < begin) return "";
  return content.slice(begin + MEMORY_BLOCK_BEGIN.length, end);
}

/** Send one synthetic turn through the real chat UI and return the server's
 * generation id (an opaque id string, never a rounded number). */
async function sendChatTurn(page: Page, text: string): Promise<string> {
  const accepted = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && /\/api\/v1\/conversations\/\d+\/generations$/.test(new URL(response.url()).pathname),
  );
  await page.locator('[data-testid="message-input"] textarea').fill(text);
  await page.getByTestId("send").click();
  const response = await accepted;
  expect(response.ok(), `generation create failed: ${response.status()}`).toBeTruthy();
  const generationId = String(
    ((await response.json()) as { generationId?: unknown })?.generationId ?? "",
  );
  expect(generationId, "generation create returned no id").not.toBe("");
  return generationId;
}

function generationStatus(body: unknown): string {
  return String((body as { status?: unknown } | null)?.status ?? "");
}

/** Extraction runs as its own job after the turn completes; wait for the
 * saved row through the product memories API before asserting the page. */
async function waitForAutoSavedMemory(
  page: Page,
  relationshipId: string,
  summary: string,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    const list = await sessionRequest(
      page,
      "GET",
      `/api/v1/relationships/${encodeURIComponent(relationshipId)}/memories`,
    );
    if (list.ok && Array.isArray(list.body)) {
      const found = (list.body as Array<{ summary?: unknown; status?: unknown; autoSaved?: unknown }>)
        .some((item) => item.summary === summary && item.status === "ACCEPTED" && item.autoSaved === true);
      if (found) return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`auto-saved memory did not appear via the memories API within 20s`);
}

/** VC-R79：v2（HTTP 栈，宿主侧 pg 容器）与 v3（TLS 栈，compose 服务
 * 容器 ID + 容器内只读探测）两种 state 形态。 */
type StackState =
  | { kind: "http"; container: string; dockerContext: string }
  | {
      kind: "tls";
      dockerContext: string;
      dbContainer: string;
      runtimeContainer: string;
      providerContainer: string;
      providerLogPath: string;
    };

async function readStackState(): Promise<StackState> {
  const stateFile = process.env.E2E_STACK_STATE_FILE;
  if (!stateFile) throw new Error("E2E_STACK_STATE_FILE is required to locate the stack PG");
  const state = JSON.parse(await readFile(stateFile, "utf8")) as {
    version?: unknown;
    container?: unknown;
    containers?: Record<string, unknown> | undefined;
    dockerContext?: unknown;
    providerLogPath?: unknown;
  };
  if (state.version === 3) {
    // TLS 栈不发布宿主端口：等价读取全部经 docker --context exec 进容器。
    // 任一所需容器缺失即抛错——断言绝不能因此静默弱化成 0 或跳过。
    const need = (name: string): string => {
      const value = state.containers?.[name];
      if (typeof value !== "string" || !value) {
        throw new Error(`TLS stack state lacks the ${name} container id`);
      }
      return value;
    };
    const dockerContext = String(state.dockerContext ?? "");
    const providerLogPath = String(state.providerLogPath ?? "");
    if (!dockerContext || !providerLogPath) {
      throw new Error("TLS stack state lacks docker context or provider log metadata");
    }
    return {
      kind: "tls",
      dockerContext,
      dbContainer: need("db"),
      runtimeContainer: need("runtime"),
      providerContainer: need("provider"),
      providerLogPath,
    };
  }
  const container = String(state.container ?? "");
  const dockerContext = String(state.dockerContext ?? "");
  if (!container || !dockerContext) throw new Error("stack state lacks PG container metadata");
  return { kind: "http", container, dockerContext };
}

/** One read-only status|close_reason row for the turn's MEMORY_EXTRACT job,
 * straight from this stack's own isolated PG container. TLS 栈用 compose db
 * 服务容器与 vc_migrator 角色；HTTP 栈保持宿主侧 pg 容器 + postgres。 */
async function queryMemoryExtractJob(
  state: StackState,
  owner: string,
  generationId: string,
): Promise<string> {
  if (!/^\d+$/.test(owner) || !/^\d+$/.test(generationId)) {
    throw new Error("memory-extract job query requires numeric ids");
  }
  const sql = "SELECT status || '|' || coalesce(last_error_code, '') FROM vc.work_item"
    + ` WHERE owner_user_id = ${owner} AND kind = 'MEMORY_EXTRACT' AND ref_id = ${generationId}`;
  const psqlArgs = state.kind === "tls"
    ? ["--context", state.dockerContext, "exec", state.dbContainer,
      "psql", "-U", "vc_migrator", "-d", "vc", "-tAc", sql]
    : ["--context", state.dockerContext, "exec", state.container,
      "psql", "-U", "postgres", "-d", "vc", "-tAc", sql];
  const execFile = promisify(execFileCallback);
  const { stdout } = await execFile("docker", psqlArgs, { timeout: 5_000 });
  return stdout.trim();
}

function readPrometheusGauge(text: string, name: string): number | null {
  for (const line of text.split("\n")) {
    if (line.startsWith(`${name} `)) {
      const value = Number.parseFloat(line.slice(name.length + 1).trim());
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

/** Read the runtime's own vc_generation_active gauge from the existing
 * /actuator/prometheus endpoint. A null return means the endpoint, metric or
 * value was not observable and is never treated as zero. TLS 栈的 runtime 不
 * 发布宿主端口：经容器内 busybox wget 读取同一 gauge，失败同样返回 null。 */
async function readGenerationActive(state: StackState): Promise<number | null> {
  if (state.kind === "tls") {
    const result = spawnSync(
      "docker",
      [
        "--context", state.dockerContext,
        "exec", state.runtimeContainer,
        "wget", "-q", "-O", "-", "http://127.0.0.1:8080/actuator/prometheus",
      ],
      { encoding: "utf8", timeout: 5_000 },
    );
    if (result.status !== 0) return null;
    return readPrometheusGauge(result.stdout, "vc_generation_active");
  }
  const port = process.env.E2E_RUNTIME_PORT ?? "18080";
  try {
    const response = await fetch(`http://127.0.0.1:${port}/actuator/prometheus`);
    if (!response.ok) return null;
    return readPrometheusGauge(await response.text(), "vc_generation_active");
  } catch {
    return null;
  }
}

/** Causal barrier for "turn B's whole generation handler has returned".
 * Turn B's COMPLETED snapshot was already confirmed, so its
 * dispatchGeneration has necessarily entered (a terminal status only ever
 * proves entry). jobs/loop.go increments activeGenerations on handler entry
 * and decrements it only when the handler returns, and
 * enqueue_memory_extract is a synchronous call inside that handler — so on
 * this serial, exclusively-owned runtime, reading an observable
 * vc_generation_active === 0 proves the handler (including its enqueue
 * decision) has returned. Neither the terminal snapshot nor the parent job
 * row proves exit: go_finalize_generation closes the GENERATION job in SQL
 * before the Go handler reaches its enqueue call. */
async function waitForGenerationHandlerReturned(
  page: Page,
  state: StackState,
  timeoutMs = 20_000,
): Promise<void> {
  const startedAt = Date.now();
  let last: number | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await readGenerationActive(state);
    if (last === 0) return;
    await page.waitForTimeout(100);
  }
  throw new Error(
    `generation handler for the disabled turn did not observably return (last observed active=${last})`,
  );
}

function parseProviderLogLines(raw: string): ProviderLogEntry[] {
  return raw.trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as ProviderLogEntry);
}

async function readProviderRequestLog(state: StackState): Promise<ProviderLogEntry[]> {
  if (state.kind === "tls") {
    // provider 跑在 runtime 网络命名空间的 node 容器里，宿主不可达：
    // 日志经 docker exec cat 读取，行解析与 HTTP 模式完全一致。
    const execFile = promisify(execFileCallback);
    const { stdout } = await execFile(
      "docker",
      [
        "--context", state.dockerContext,
        "exec", state.providerContainer,
        "cat", state.providerLogPath,
      ],
      { timeout: 5_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return parseProviderLogLines(stdout);
  }
  const port = process.env.E2E_PROVIDER_PORT ?? "19090";
  const path = process.env.E2E_PROVIDER_REQUEST_LOG
    ?? `/tmp/vc-e2e-provider-requests-${port}.log`;
  const raw = await readFile(path, "utf8");
  return parseProviderLogLines(raw);
}

test("autosave saves a stated preference, recalls it in a later turn, and stops saving when off", async ({ page }) => {
  const session = await openSharedSession(page, "memory");
  await prepareGenerationAccess(session);
  const relationshipId = await getDefaultRelationshipId(session.page);

  // —— Save: a plain low-sensitivity preference stated in the user's own
  // words must land as an auto-saved ACCEPTED memory. ——
  await navigateToPage(page, "/pages/index/index");
  await page.getByTestId("home-start-chat").click();
  await page.waitForURL((url) => url.hash.startsWith("#/pages/chat/chat"));
  await expect(page.getByTestId("empty-history")).toContainText("从这里开始");

  const turnA = await sendChatTurn(page, AUTOSAVE_FACT_A);
  const terminalA = await waitForGenerationTerminal(page, turnA);
  expect(
    generationStatus(terminalA.body),
    `turn A ended as ${generationStatus(terminalA.body)}; only COMPLETED turns feed extraction`,
  ).toBe("COMPLETED");
  await expect(page.getByTestId("assistant-md").filter({ hasText: PROVIDER_REPLY })).toBeVisible();

  await waitForAutoSavedMemory(page, relationshipId, AUTOSAVE_SUMMARY_A);
  await navigateToPage(page, "/pages/memory/memory");
  await expect(page.getByTestId("autosave-note")).toBeVisible();
  const savedRow = page.getByTestId("memory-row").filter({ hasText: AUTOSAVE_SUMMARY_A });
  await expect(savedRow).toHaveCount(1);
  await expect(savedRow.getByTestId("memory-summary")).toHaveText(AUTOSAVE_SUMMARY_A);
  await expect(savedRow.getByTestId("memory-badge")).toHaveText("自动保存");

  // —— Disable through the real toggle: wait for the actual 200 PUT, and the
  // pref stays off until the no-new-save evidence is fully collected. ——
  const prefDisable = page.waitForResponse(
    (response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === "/api/v1/memory-auto-save-pref",
  );
  await page.getByTestId("autosave-toggle").click();
  const prefResponse = await prefDisable;
  expect(prefResponse.ok(), `memory autosave pref disable failed: ${prefResponse.status}`).toBeTruthy();
  await expect(page.getByTestId("autosave-toggle")).toHaveAttribute("aria-checked", "false");

  // —— Recall: a different new conversation of the same relationship states
  // preference B. A must appear in B's request inside the dedicated memory
  // block (not as history echo: the new conversation has no history and B's
  // own text never contains A's span). ——
  await navigateToPage(page, "/pages/chat/chat");
  await page.getByTestId("chat-context-open").click();
  await page.getByTestId("new-conversation").click();
  await expect(page.getByTestId("empty-history")).toContainText("从这里开始");

  const turnB = await sendChatTurn(page, AUTOSAVE_FACT_B);
  const terminalB = await waitForGenerationTerminal(page, turnB);
  expect(
    generationStatus(terminalB.body),
    `turn B ended as ${generationStatus(terminalB.body)}; the off toggle must not block the chat itself`,
  ).toBe("COMPLETED");

  const stackState = await readStackState();
  const entries = await readProviderRequestLog(stackState);
  const requestB = entries
    .filter((entry) => entry.kind === "chat")
    .filter((entry) => entryMessages(entry).some((message) => messageText(message).includes(AUTOSAVE_FACT_B)))
    .pop();
  if (!requestB) {
    throw new Error("turn B's generation request is missing from the provider request log");
  }
  const messagesB = entryMessages(requestB);
  const withSummaryA = messagesB.filter((message) => messageText(message).includes(AUTOSAVE_SUMMARY_A));
  const blockMessage = withSummaryA.find((message) => messageText(message).includes(MEMORY_BLOCK_BEGIN));
  const block = blockMessage ? memoryBlockFence(messageText(blockMessage)) : "";
  expect(
    withSummaryA.length === 1
      && blockMessage !== undefined
      && block.includes(`- ${AUTOSAVE_SUMMARY_A}`)
      && !block.includes(AUTOSAVE_SUMMARY_B),
    "turn B's request carries the saved memory exactly once, inside the dedicated memory block",
  ).toBe(true);

  // —— Stop: the causal barrier first (B's whole generation handler, including
  // its synchronous enqueue decision, has observably returned), then the
  // extraction side must show the deliberate no-row suppression; the API and
  // the page confirm A stays and B never lands. ——
  await waitForGenerationHandlerReturned(page, stackState);
  expect(
    await queryMemoryExtractJob(stackState, session.accountId, turnB),
    "the disabled turn must leave no MEMORY_EXTRACT job row (V125 suppresses enqueue while the pref is off)",
  ).toBe("");

  const afterList = await sessionRequest(
    page,
    "GET",
    `/api/v1/relationships/${encodeURIComponent(relationshipId)}/memories`,
  );
  expect(afterList.ok, `memories re-read failed: ${afterList.status}`).toBeTruthy();
  const summaries = (Array.isArray(afterList.body) ? afterList.body : []) as Array<{ summary?: unknown }>;
  expect(summaries.some((item) => item.summary === AUTOSAVE_SUMMARY_A)).toBe(true);
  expect(summaries.some((item) => item.summary === AUTOSAVE_SUMMARY_B)).toBe(false);

  await navigateToPage(page, "/pages/account/account");
  await navigateToPage(page, "/pages/memory/memory");
  await expect(page.getByTestId("autosave-note")).toBeVisible();
  await expect(page.getByTestId("memory-row").filter({ hasText: AUTOSAVE_SUMMARY_A })).toHaveCount(1);
  await expect(page.getByTestId("memory-row").filter({ hasText: AUTOSAVE_SUMMARY_B })).toHaveCount(0);

  // Restore the default so the shared seeded user keeps its baseline state.
  await page.getByTestId("autosave-toggle").click();
  await expect(page.getByTestId("autosave-toggle")).toHaveAttribute("aria-checked", "true");
});
