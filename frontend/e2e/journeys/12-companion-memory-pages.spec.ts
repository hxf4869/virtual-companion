import { execFile as execFileCallback } from "node:child_process";
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

interface StackState {
  container: string;
  dockerContext: string;
}

async function readStackState(): Promise<StackState> {
  const stateFile = process.env.E2E_STACK_STATE_FILE;
  if (!stateFile) throw new Error("E2E_STACK_STATE_FILE is required to locate the stack PG");
  const state = JSON.parse(await readFile(stateFile, "utf8")) as {
    container?: unknown;
    dockerContext?: unknown;
  };
  const container = String(state.container ?? "");
  const dockerContext = String(state.dockerContext ?? "");
  if (!container || !dockerContext) throw new Error("stack state lacks PG container metadata");
  return { container, dockerContext };
}

/** One read-only status|close_reason row for the turn's MEMORY_EXTRACT job,
 * straight from this stack's own isolated PG container. */
async function queryMemoryExtractJob(
  state: StackState,
  owner: string,
  generationId: string,
): Promise<string> {
  if (!/^\d+$/.test(owner) || !/^\d+$/.test(generationId)) {
    throw new Error("memory-extract job query requires numeric ids");
  }
  const execFile = promisify(execFileCallback);
  const { stdout } = await execFile(
    "docker",
    [
      "--context", state.dockerContext,
      "exec", state.container,
      "psql", "-U", "postgres", "-d", "vc", "-tAc",
      "SELECT status || '|' || coalesce(last_error_code, '') FROM vc.work_item"
        + ` WHERE owner_user_id = ${owner} AND kind = 'MEMORY_EXTRACT' AND ref_id = ${generationId}`,
    ],
    { timeout: 5_000 },
  );
  return stdout.trim();
}

interface GenerationGauges {
  active: number | null;
  claimsTotal: number | null;
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

/** Read the runtime's own generation gauges from the existing
 * /actuator/prometheus endpoint. A null gauge means the metric or endpoint
 * was not observable and is never treated as zero. */
async function readGenerationGauges(): Promise<GenerationGauges> {
  const port = process.env.E2E_RUNTIME_PORT ?? "18080";
  try {
    const response = await fetch(`http://127.0.0.1:${port}/actuator/prometheus`);
    if (!response.ok) return { active: null, claimsTotal: null };
    const text = await response.text();
    return {
      active: readPrometheusGauge(text, "vc_generation_active"),
      claimsTotal: readPrometheusGauge(text, "vc_job_claims_total"),
    };
  } catch {
    return { active: null, claimsTotal: null };
  }
}

/** The journeys run serially, so before turn B starts every earlier handler
 * must have returned. Returns the claim counter as the baseline. */
async function waitForGenerationIdle(page: Page, timeoutMs = 20_000): Promise<number> {
  const startedAt = Date.now();
  let last: GenerationGauges = { active: null, claimsTotal: null };
  while (Date.now() - startedAt < timeoutMs) {
    last = await readGenerationGauges();
    if (last.active === 0 && last.claimsTotal !== null) return last.claimsTotal;
    await page.waitForTimeout(100);
  }
  throw new Error(
    `vc_generation_active did not settle at 0 before the disabled turn (last observed active=${last.active} claims=${last.claimsTotal})`,
  );
}

/** Causal barrier for "the turn's whole generation handler has returned".
 *
 * Entry proof uses the monotonic claim counter: jobs/loop.go ClaimOnce
 * increments vc_job_claims_total for every successfully claimed job and then
 * synchronously launches dispatchGeneration for a GENERATION claim, and on
 * this serial journey turn B's GENERATION job is the only job that can be
 * claimed after the baseline — so claims > baseline proves turn B's handler
 * really entered. (vc_generation_peak cannot prove this: it is a concurrency
 * high-water mark that only moves when active exceeds the historical peak,
 * so serial turns after the first never move it.)
 *
 * Exit proof uses vc_generation_active: dispatchGeneration increments it on
 * handler entry and decrements it only when the handler returns, and
 * enqueue_memory_extract is a synchronous call inside that handler — so an
 * observable 0 proves the enqueue decision has executed. Neither the
 * terminal snapshot nor the parent job row implies this:
 * go_finalize_generation closes the GENERATION job in SQL before the Go
 * handler reaches its enqueue call. */
async function waitForGenerationHandlerReturned(
  page: Page,
  baselineClaims: number,
  timeoutMs = 20_000,
): Promise<void> {
  const startedAt = Date.now();
  let last: GenerationGauges = { active: null, claimsTotal: null };
  while (Date.now() - startedAt < timeoutMs) {
    last = await readGenerationGauges();
    if (last.active === 0 && last.claimsTotal !== null && last.claimsTotal > baselineClaims) return;
    await page.waitForTimeout(100);
  }
  throw new Error(
    `generation handler for the disabled turn did not observably return (last observed active=${last.active} claims=${last.claimsTotal} baselineClaims=${baselineClaims})`,
  );
}

/** Read after the handler-return barrier: the enqueue decision has executed,
 * so with the pref already off, vc.enqueue_memory_extract (V125) creating no
 * job row is the deliberate suppression path. A row only exists when the
 * switch was flipped after enqueue; it must then be DONE|AUTO_SAVE_OFF. */
function assertMemoryExtractOutcome(row: string): void {
  if (row === "" || row === "DONE|AUTO_SAVE_OFF") return;
  throw new Error(
    `memory-extract outcome for the disabled turn is neither the deliberate no-job path nor DONE|AUTO_SAVE_OFF (row: ${row})`,
  );
}

async function readProviderRequestLog(): Promise<ProviderLogEntry[]> {
  const port = process.env.E2E_PROVIDER_PORT ?? "19090";
  const path = process.env.E2E_PROVIDER_REQUEST_LOG
    ?? `/tmp/vc-e2e-provider-requests-${port}.log`;
  const raw = await readFile(path, "utf8");
  return raw.trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as ProviderLogEntry);
}

test("autosave saves a stated preference, recalls it in a later turn, and stops saving when off", async ({ page }) => {
  const session = await openSharedSession(page, "memory");
  await prepareGenerationAccess(session.page);
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

  // Baseline before turn B: serial journeys mean an idle gauge here, and the
  // claim-counter baseline lets the barrier below attribute one handler
  // entry to B.
  const baselineClaims = await waitForGenerationIdle(page);
  const turnB = await sendChatTurn(page, AUTOSAVE_FACT_B);
  const terminalB = await waitForGenerationTerminal(page, turnB);
  expect(
    generationStatus(terminalB.body),
    `turn B ended as ${generationStatus(terminalB.body)}; the off toggle must not block the chat itself`,
  ).toBe("COMPLETED");

  const entries = await readProviderRequestLog();
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
  // its synchronous enqueue decision, has observably returned), then read the
  // extraction side once; the API and the page confirm A stays and B never
  // lands. ——
  await waitForGenerationHandlerReturned(page, baselineClaims);
  const stackState = await readStackState();
  assertMemoryExtractOutcome(await queryMemoryExtractJob(stackState, session.accountId, turnB));

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
