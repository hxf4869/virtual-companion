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

/** W3C APG radio group: the checked option is the group's only Tab stop and,
 * right after a key press, also the focused one. */
async function expectKeyboardSelected(page: Page, testid: string): Promise<void> {
  const option = page.getByTestId(testid);
  await expect(option).toHaveAttribute("aria-checked", "true");
  await expect(option).toHaveAttribute("tabindex", "0");
  await expect(option).toBeFocused();
}

test("companion settings keyboard radio navigation", async ({ page }) => {
  await openSharedSession(page, "memory");
  await navigateToPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("companion-form")).toBeVisible();

  // Keyboard edits touch only the local draft: the page must send no prefs
  // PATCH while editing (the save button is never clicked in this journey).
  let prefsPatches = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH"
      && /^\/api\/v1\/relationships\/[^/]+$/.test(new URL(request.url()).pathname)) {
      prefsPatches += 1;
    }
  });

  // Known local starting point through the visible controls, independent of
  // whatever the shared seeded user currently has saved.
  await page.getByTestId("pref-reply-length-MEDIUM").click();
  await page.getByTestId("pref-initiative-LOW").click();
  await page.getByTestId("pref-advice-ASK_FIRST").click();
  await page.getByTestId("pref-humor-LIGHT").click();
  for (const testid of [
    "pref-reply-length-MEDIUM", "pref-initiative-LOW", "pref-advice-ASK_FIRST", "pref-humor-LIGHT",
  ]) {
    await expect(page.getByTestId(testid)).toHaveAttribute("aria-checked", "true");
  }

  // Right/Left from the focused checked option select and focus the neighbour,
  // wrapping at both ends. The h5-a11y shim already makes every uni-button a
  // Tab stop and handles Enter/Space; the arrow keys and the roving tabindex
  // (only the checked option stays in the Tab order) are the page's own job.
  await page.getByTestId("pref-reply-length-MEDIUM").focus();
  await expect(page.getByTestId("pref-reply-length-MEDIUM")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expectKeyboardSelected(page, "pref-reply-length-LONG");
  await expect(page.getByTestId("pref-reply-length-MEDIUM")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("pref-reply-length-MEDIUM")).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowRight");
  await expectKeyboardSelected(page, "pref-reply-length-SHORT");
  await page.keyboard.press("ArrowLeft");
  await expectKeyboardSelected(page, "pref-reply-length-LONG");
  await page.keyboard.press("ArrowLeft");
  await expectKeyboardSelected(page, "pref-reply-length-MEDIUM");

  // Tab enters each group on its checked option only and leaves it with the
  // next Tab; Shift+Tab walks back the same way.
  await page.getByTestId("pref-companion-name").locator("input").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("pref-user-address-as").locator("input")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("pref-reply-length-MEDIUM")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("pref-initiative-LOW")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("pref-advice-ASK_FIRST")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("pref-humor-LIGHT")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("pref-advice-ASK_FIRST")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("pref-initiative-LOW")).toBeFocused();

  // Up/Down behave like Left/Right and wrap, each group on its own.
  await page.keyboard.press("ArrowDown");
  await expectKeyboardSelected(page, "pref-initiative-MEDIUM");
  await page.keyboard.press("ArrowUp");
  await expectKeyboardSelected(page, "pref-initiative-LOW");
  await page.keyboard.press("ArrowUp");
  await expectKeyboardSelected(page, "pref-initiative-HIGH");
  await page.keyboard.press("ArrowDown");
  await expectKeyboardSelected(page, "pref-initiative-LOW");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("pref-advice-ASK_FIRST")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expectKeyboardSelected(page, "pref-advice-DIRECT");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("pref-humor-LIGHT")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expectKeyboardSelected(page, "pref-humor-WARM");
  await page.keyboard.press("ArrowUp");
  await expectKeyboardSelected(page, "pref-humor-LIGHT");
  await expect(page.getByTestId("pref-reply-length-MEDIUM")).toHaveAttribute("aria-checked", "true");

  // Space / Enter activation comes from the h5-a11y shim's document-level
  // handler (Enter on keydown, Space armed on keydown and fired on keyup); the
  // page passes both keys through untouched, so the real browser must still
  // end up with the focused option checked.
  await page.getByTestId("pref-humor-NONE").focus();
  await page.keyboard.press("Space");
  await expectKeyboardSelected(page, "pref-humor-NONE");
  await page.getByTestId("pref-advice-RARE").focus();
  await page.keyboard.press("Enter");
  await expectKeyboardSelected(page, "pref-advice-RARE");

  // The mouse keeps working and moves the Tab stop with the selection.
  await page.getByTestId("pref-reply-length-SHORT").click();
  await expect(page.getByTestId("pref-reply-length-SHORT")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("pref-reply-length-SHORT")).toHaveAttribute("tabindex", "0");
  await expect(page.getByTestId("pref-reply-length-MEDIUM")).toHaveAttribute("tabindex", "-1");

  expect(prefsPatches).toBe(0);
});

/** Push a page onto the real in-app history stack (uni.navigateTo →
 * router.push), unlike navigateToPage's redirectTo replace, so browser back
 * and the page-header back both have a previous in-app page to land on. */
async function pushPage(page: Page, href: string): Promise<void> {
  await page.evaluate((url) => {
    const uniApi = (globalThis as Record<string, unknown>).uni as
      | { navigateTo?: (options: { url: string }) => void }
      | undefined;
    uniApi?.navigateTo({ url });
  }, href);
  const path = href.split("?", 1)[0];
  await page.waitForURL((url) => url.hash.startsWith(`#${path}`), { timeout: 20_000 });
}

/** The active relationship row's saved companion name straight from the API:
 * the untouched server baseline the discarded drafts are compared against. */
async function readServerCompanionName(page: Page): Promise<string> {
  const list = await sessionRequest(page, "GET", "/api/v1/relationships");
  expect(list.ok, `relationships read failed: ${list.status}`).toBeTruthy();
  const rows = (Array.isArray(list.body) ? list.body : []) as Array<{
    active?: boolean;
    companionName?: unknown;
  }>;
  const active = rows.find((row) => row.active);
  // An empty saved name is a legitimate baseline (default companion); what
  // matters is that a row exists to compare the untouched server state to.
  expect(active, "the shared account must have an active relationship").toBeTruthy();
  return String(active?.companionName ?? "");
}

/** A reload dismissed at the browser's beforeunload prompt aborts with
 * ERR_ABORTED; that one expected rejection is swallowed, anything else
 * propagates. */
function expectAbortedReload(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => undefined,
    (error: unknown) => {
      const message = String((error as { message?: string } | null)?.message ?? error);
      if (!message.includes("ERR_ABORTED")) throw error;
    },
  );
}

// VC-R178: unsaved companion-settings changes are confirmed before leaving.
// Every H5 leave path funnels through getApp().$router, so the page's removable
// beforeEach guard covers the browser back button and the page-header back
// alike; the confirmation is the browser's native confirm dialog (keyboard
// operable, no custom modal layer) and refresh/close go through the standard
// beforeunload. Discarding never PATCHes: the server keeps the last saved
// values and a later re-entry re-reads them.
test("companion settings confirm before discarding unsaved changes on leave", async ({ page }, testInfo) => {
  await openSharedSession(page, "memory");
  const baselineName = await readServerCompanionName(page);

  const DRAFT_NAME = "未保存草稿R178";
  let prefsPatches = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH"
      && /^\/api\/v1\/relationships\/[^/]+$/.test(new URL(request.url()).pathname)) {
      prefsPatches += 1;
    }
  });

  // Real stack: index → account → companion, both pushes.
  await pushPage(page, "/pages/account/account");
  await pushPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("companion-form")).toBeVisible();
  await fillUniInput(page, "pref-companion-name", DRAFT_NAME);
  await page.getByTestId("pref-reply-length-SHORT").click();
  await expect(page.getByTestId("companion-dirty")).toBeVisible();

  // The native confirm freezes page JS, so every dialog-triggering action is
  // started unawaited, the dialog handled, and only then the action awaited.

  // —— Browser back · continue editing: the dialog must name the draft loss,
  // dismissing it keeps the page (vue-router restores the history entry) with
  // fields and options untouched and no PATCH. ——
  const backDismissDialog = page.waitForEvent("dialog");
  const backStay = page.goBack();
  const dismissed = await backDismissDialog;
  expect(dismissed.type()).toBe("confirm");
  expect(dismissed.message()).toContain("本页还有更改");
  await dismissed.dismiss();
  await backStay;
  await page.waitForURL((url) => url.hash.startsWith("#/pages/companion/companion"));
  await expect(page.getByTestId("companion-form")).toBeVisible();
  expect(await readUniInputValue(page, "pref-companion-name")).toBe(DRAFT_NAME);
  await expect(page.getByTestId("pref-reply-length-SHORT")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("companion-dirty")).toBeVisible();
  expect(prefsPatches).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("01-browser-back-dismissed.png") });

  // —— Browser back · discard and leave: accepted, lands on the previous page
  // (account) and still sends nothing to the server. ——
  const backAcceptDialog = page.waitForEvent("dialog");
  const backLeave = page.goBack();
  const leftByBack = await backAcceptDialog;
  expect(leftByBack.type()).toBe("confirm");
  await leftByBack.accept();
  await backLeave;
  await page.waitForURL((url) => url.hash.startsWith("#/pages/account/account"));
  expect(prefsPatches).toBe(0);

  // Re-entry (replace from account) re-reads the server baseline: the
  // discarded draft is gone and the page starts clean.
  await navigateToPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("companion-form")).toBeVisible();
  expect(await readUniInputValue(page, "pref-companion-name")).toBe(baselineName);
  await expect(page.getByTestId("companion-dirty")).toHaveCount(0);

  // —— Refresh · beforeunload: while dirty the reload is blocked when the
  // browser dialog is dismissed (draft still on screen), then goes through
  // once accepted; the reloaded page shows the server value, not the draft. ——
  await fillUniInput(page, "pref-companion-name", DRAFT_NAME);
  await expect(page.getByTestId("companion-dirty")).toBeVisible();
  const reloadBlockedDialog = page.waitForEvent("dialog");
  // Dismissing the beforeunload leaves Playwright's reload() pending forever
  // (no ERR_ABORTED rejection), so it is never awaited; the rejection handler
  // still surfaces any real failure, and the draft assertions below prove the
  // reload was actually blocked.
  void expectAbortedReload(page.reload());
  const beforeunloadStay = await reloadBlockedDialog;
  expect(beforeunloadStay.type()).toBe("beforeunload");
  await beforeunloadStay.dismiss();
  await expect(page.getByTestId("companion-form")).toBeVisible();
  expect(await readUniInputValue(page, "pref-companion-name")).toBe(DRAFT_NAME);
  expect(prefsPatches).toBe(0);

  const reloadProceedsDialog = page.waitForEvent("dialog");
  const reloaded = page.reload();
  const beforeunloadLeave = await reloadProceedsDialog;
  expect(beforeunloadLeave.type()).toBe("beforeunload");
  await beforeunloadLeave.accept();
  await reloaded;
  await expect(page.getByTestId("companion-form")).toBeVisible();
  expect(await readUniInputValue(page, "pref-companion-name")).toBe(baselineName);
  await expect(page.getByTestId("companion-dirty")).toHaveCount(0);

  // —— Page-header back · continue editing, then discard: the header's
  // uni.navigateBack goes through the same guard; dismissing keeps the draft,
  // accepting leaves the companion page. ——
  await fillUniInput(page, "pref-companion-name", DRAFT_NAME);
  await expect(page.getByTestId("companion-dirty")).toBeVisible();
  const headerDismissDialog = page.waitForEvent("dialog");
  const headerStayClick = page.getByTestId("page-back").click();
  const dismissedHeader = await headerDismissDialog;
  expect(dismissedHeader.type()).toBe("confirm");
  expect(dismissedHeader.message()).toContain("本页还有更改");
  await dismissedHeader.dismiss();
  await headerStayClick;
  await page.waitForURL((url) => url.hash.startsWith("#/pages/companion/companion"));
  expect(await readUniInputValue(page, "pref-companion-name")).toBe(DRAFT_NAME);

  const headerAcceptDialog = page.waitForEvent("dialog");
  const headerLeaveClick = page.getByTestId("page-back").click();
  const leftByHeader = await headerAcceptDialog;
  expect(leftByHeader.type()).toBe("confirm");
  await leftByHeader.accept();
  await headerLeaveClick;
  await page.waitForURL((url) => !url.hash.startsWith("#/pages/companion/companion"));
  expect(prefsPatches).toBe(0);

  // The whole journey never changed the server: the API still returns the
  // saved baseline and a final re-entry renders it clean.
  expect(await readServerCompanionName(page)).toBe(baselineName);
  await navigateToPage(page, "/pages/companion/companion");
  await expect(page.getByTestId("companion-form")).toBeVisible();
  expect(await readUniInputValue(page, "pref-companion-name")).toBe(baselineName);
  await expect(page.getByTestId("companion-dirty")).toHaveCount(0);

  // —— The dirty page itself must not gain horizontal overflow at the three
  // acceptance widths (the confirmation is native browser UI, not page DOM). ——
  await fillUniInput(page, "pref-companion-name", DRAFT_NAME);
  await expect(page.getByTestId("companion-dirty")).toBeVisible();
  for (const [width, height] of [[320, 568], [390, 844], [430, 932]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId("companion-form")).toBeVisible();
    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow, `${width}px viewport must not scroll horizontally`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`02-dirty-${width}.png`) });
  }
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
  | { kind: "http"; container: string; dockerContext: string; providerLogPath: string }
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
  if (state.version !== 4) throw new Error("HTTP stack requires v4 ownership state; legacy state is preserved");
  const container = String(state.container ?? "");
  const dockerContext = String(state.dockerContext ?? "");
  const providerLogPath = String(state.providerLogPath ?? "");
  if (!container || dockerContext !== "orbstack" || !providerLogPath) throw new Error("HTTP stack lacks owned PG/provider metadata");
  return { kind: "http", container, dockerContext, providerLogPath };
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
  const raw = await readFile(state.providerLogPath, "utf8");
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

// VC-R177：V68 的 vc.list_memory 会把过期事件惰性改为 EXPIRED 并照常返回。
// 通过当前认证 API 造一条普通 ACCEPTED 记录与一条已过期的已确认事件，
// 先用原始 GET 证明后端真的回 EXPIRED/ACCEPTED，再断言真实记忆页接受该
// 合法回包：普通记忆可见、无列表错误、过期内容不进入活动视图。
test("memory page accepts expired event records", async ({ page }) => {
  const session = await openSharedSession(page, "memory");
  const relationshipId = await getDefaultRelationshipId(session.page);

  const FACT_SUMMARY = "用户每年秋天安排一次例行体检。";
  const EVENT_SUMMARY = "用户上个月预约了牙医复诊。";
  const writeOptions = { accountId: session.accountId, sessionId: session.sessionId };
  // 创建成功后立即登记自己的 id：中途任何失败也走 finally 软删除清理。
  const createdIds: Array<{ memoryId: string; label: string }> = [];

  function candidateIdOf(result: { ok: boolean; status: number; body: unknown }, label: string): string {
    expect(result.ok, `${label} create failed: ${result.status}`).toBeTruthy();
    const memoryId = String((result.body as { memoryId?: unknown } | null)?.memoryId ?? "");
    expect(memoryId, `${label} create returned no id`).not.toBe("");
    return memoryId;
  }

  try {
    // 一条普通 RELATIONSHIP 记忆：创建（PENDING_CONFIRMATION）并确认（ACCEPTED）。
    const fact = await sessionRequest(
      page,
      "POST",
      `/api/v1/relationships/${encodeURIComponent(relationshipId)}/memories/candidates`,
      { scope: "RELATIONSHIP", summary: FACT_SUMMARY },
      writeOptions,
    );
    const factId = candidateIdOf(fact, "fact candidate");
    createdIds.push({ memoryId: factId, label: "fact candidate" });
    const factConfirm = await sessionRequest(
      page,
      "POST",
      `/api/v1/memories/${encodeURIComponent(factId)}/confirm`,
      undefined,
      writeOptions,
    );
    expect(factConfirm.ok, `fact confirm failed: ${factConfirm.status}`).toBeTruthy();

    // 一条已过期事件：eventAt 在 2 天前、eventExpiresAt 在 1 天前（PLANNED），
    // 确认后由下一次 list 读取惰性改为 EXPIRED 并照常返回。
    const event = await sessionRequest(
      page,
      "POST",
      `/api/v1/relationships/${encodeURIComponent(relationshipId)}/memories/candidates`,
      {
        scope: "RELATIONSHIP",
        summary: EVENT_SUMMARY,
        eventAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        eventStatus: "PLANNED",
        eventExpiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      },
      writeOptions,
    );
    const eventId = candidateIdOf(event, "event candidate");
    createdIds.push({ memoryId: eventId, label: "event candidate" });
    const eventConfirm = await sessionRequest(
      page,
      "POST",
      `/api/v1/memories/${encodeURIComponent(eventId)}/confirm`,
      undefined,
      writeOptions,
    );
    expect(eventConfirm.ok, `event confirm failed: ${eventConfirm.status}`).toBeTruthy();

    // 原始 GET 先证明后端事实：事件行 EXPIRED、普通记忆行 ACCEPTED。
    const list = await sessionRequest(
      page,
      "GET",
      `/api/v1/relationships/${encodeURIComponent(relationshipId)}/memories`,
    );
    expect(list.ok, `memories read failed: ${list.status}`).toBeTruthy();
    const rows = (Array.isArray(list.body) ? list.body : []) as Array<{
      memoryId?: unknown;
      status?: unknown;
    }>;
    const eventRow = rows.find((row) => String(row.memoryId) === eventId);
    expect(
      eventRow?.status,
      "the overdue event must read back EXPIRED through the real API",
    ).toBe("EXPIRED");
    const factRow = rows.find((row) => String(row.memoryId) === factId);
    expect(
      factRow?.status,
      "the plain memory must read back ACCEPTED through the real API",
    ).toBe("ACCEPTED");

    // 真实记忆页必须接受该合法回包：普通记忆可见、无列表错误、过期内容
    // 不进入已保存/待确认活动视图。
    await navigateToPage(page, "/pages/memory/memory");
    await expect(page.getByTestId("autosave-note")).toBeVisible();
    await expect(page.getByTestId("memory-row").filter({ hasText: FACT_SUMMARY })).toHaveCount(1);
    await expect(page.getByTestId("memory-list-error")).toHaveCount(0);
    await expect(page.getByTestId("memory-row").filter({ hasText: EVENT_SUMMARY })).toHaveCount(0);
    await expect(page.getByTestId("pending-row").filter({ hasText: EVENT_SUMMARY })).toHaveCount(0);
  } finally {
    // 只清理本 case 创建的两条记录，不触碰共享账号的其它数据。先尝试删除
    // 全部登记的 id（单条失败不中断后续尝试），保存每次结果后统一断言：
    // 清理失败不得被静默吞掉，否则会污染共享 memory 账号。
    const cleanupResults: Array<{ label: string; ok: boolean; status: number }> = [];
    for (const { memoryId, label } of createdIds) {
      const deleted = await sessionRequest(
        page,
        "DELETE",
        `/api/v1/memories/${encodeURIComponent(memoryId)}`,
        undefined,
        writeOptions,
      );
      cleanupResults.push({ label, ok: deleted.ok, status: deleted.status });
    }
    for (const result of cleanupResults) {
      expect(
        result.ok,
        `cleanup delete failed for ${result.label}: ${result.status}`,
      ).toBeTruthy();
    }
  }
});
