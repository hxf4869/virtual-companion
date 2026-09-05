import {
  type APIRequestContext,
  expect,
  type Page,
  type Response,
  request as requestFactory,
} from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

// S0-23 shared helpers. Every credential and record is synthetic and confined
// to the isolated local stack.

export const PROVIDER_REPLY = "I hear you. Take a breath; there's no rush.";
export const SAFETY_BLOCK_SENTINEL = "[[E2E_SAFETY_BLOCK]]";
export const PROVIDER_TIMEOUT_SENTINEL = "[[E2E_PROVIDER_TIMEOUT]]";

export const API_BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${process.env.E2E_H5_PORT ?? "5173"}`;

const REQUIRED_CONSENTS = [
  "SERVICE_TERMS",
  "PRIVACY_POLICY",
  "AI_CONTENT_NOTICE",
  "THIRD_PARTY_MODEL_PROCESSING",
  "SENSITIVE_DATA_PROCESSING",
] as const;

export const E2E_USER_SUFFIXES = [
  "login-return",
  "auth-trusted-device",
  "relationship-chat",
  "realtime-recovery",
  "provider-faults",
  "accessibility",
  "navigation-smoke",
] as const;

export type E2EUserSuffix = (typeof E2E_USER_SUFFIXES)[number];

export interface E2EUser {
  email: string;
  password: string;
}

export interface E2ESession {
  accountId: string;
  page: Page;
}

export interface E2EConversation {
  relationshipId: string;
  conversationId: string;
}

function asId(value: unknown, label: string): string {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error(`${label} was missing from the E2E API response`);
}

function userFor(suffix: E2EUserSuffix): E2EUser {
  return {
    email: `e2e-user-${suffix}@example.test`,
    password: "E2e-User-Pass-1234!",
  };
}

function authMaterialPath(): string {
  const stateFile = process.env.E2E_STACK_STATE_FILE;
  if (!stateFile) throw new Error("E2E_STACK_STATE_FILE is required for authenticator setup");
  return `${stateFile}.auth.json`;
}

async function readAuthenticatorSecrets(): Promise<Record<string, string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(authMaterialPath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("E2E authenticator material must be an object");
    }
    const result: Record<string, string> = {};
    for (const [email, secret] of Object.entries(parsed)) {
      if (typeof secret !== "string" || !/^[A-Z2-7]+$/.test(secret)) {
        throw new Error(`E2E authenticator material is invalid for ${email}`);
      }
      result[email] = secret;
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    throw error;
  }
}

async function saveAuthenticatorSecret(email: string, secret: string): Promise<void> {
  const path = authMaterialPath();
  const next = { ...await readAuthenticatorSecrets(), [email]: secret };
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function decodeBase32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.toUpperCase().replace(/=+$/u, "")) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("invalid E2E TOTP secret");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function currentTOTP(secret: string, now = Date.now()): string {
  const counter = BigInt(Math.floor(now / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

/**
 * Verify the isolated stack once in Playwright global setup. The fixed
 * synthetic account pool is seeded directly by scripts/dev/e2e-stack.sh
 * because the production admin account-management API has been retired.
 */
export async function seedE2EUsers(): Promise<void> {
  const api = await requestFactory.newContext({ baseURL: API_BASE_URL });
  try {
    const version = await api.get("/api/v1/version");
    expect(version.ok(), `E2E runtime unavailable: ${version.status()}`).toBeTruthy();
  } finally {
    await api.dispose();
  }
}

/**
 * Return one account from the pool created by global setup.
 * The request context is unused (pool is pre-seeded); it stays in the
 * signature for call-site stability and may be omitted — e.g. from
 * beforeAll, where the test-scoped `request` fixture is unavailable.
 */
export async function provisionUser(
  _request: APIRequestContext | undefined,
  suffix: E2EUserSuffix,
): Promise<E2EUser> {
  return userFor(suffix);
}

/** UI login through the real page; the returned Page owns the opaque cookies. */
export async function uiLogin(
  page: Page,
  user: E2EUser,
  options: { openPage?: boolean; trustDevice?: boolean } = {},
): Promise<E2ESession> {
  if (options.openPage !== false) {
    await page.goto("/#/pages/login/login");
  }
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/auth/login",
  );
  await page.locator('[data-testid="account"] input').fill(user.email);
  await page.locator('[data-testid="password"] input').fill(user.password);
  await page.getByTestId("submit").click();
  const response = await responsePromise;
  return completeLoginChallenge(page, user, response, options);
}

/** Complete the server-selected second step after credentials were submitted. */
export async function completeLoginChallenge(
  page: Page,
  user: E2EUser,
  response: Response,
  options: { trustDevice?: boolean } = {},
): Promise<E2ESession> {
  expect(response.ok(), `UI login failed: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as {
    nextStep?: unknown;
    challengeId?: unknown;
    accountId?: unknown;
  };
  let accountId: unknown = body.accountId;

  if (body.nextStep === "AUTHENTICATOR_SETUP_REQUIRED") {
    const codeInput = page.locator('[data-testid="setup-code"] input');
    await expect(codeInput).toBeVisible();
    const secret = (await page.locator(".vc-authenticator-setup__manual-key").textContent())
      ?.replace(/\s/gu, "");
    if (!secret || !/^[A-Z2-7]+$/.test(secret)) {
      throw new Error("authenticator setup did not expose a valid manual key");
    }
    const confirmPromise = page.waitForResponse(
      (candidate) => candidate.request().method() === "POST"
        && new URL(candidate.url()).pathname.endsWith("/authenticator-confirm"),
    );
    await codeInput.fill(currentTOTP(secret));
    if (options.trustDevice) {
      await page.getByText("信任此设备 90 天", { exact: true }).click();
    }
    await page.getByTestId("setup-submit").click();
    const confirmed = await confirmPromise;
    expect(confirmed.ok(), `authenticator setup failed: ${confirmed.status()}`).toBeTruthy();
    accountId = ((await confirmed.json()) as { accountId?: unknown }).accountId;
    await saveAuthenticatorSecret(user.email, secret);
    await expect(page.getByTestId("recovery-continue")).toBeVisible();
    await page.getByTestId("recovery-continue").click();
  } else if (body.nextStep === "TOTP_REQUIRED") {
    const secret = (await readAuthenticatorSecrets())[user.email];
    if (!secret) {
      throw new Error(`no E2E authenticator material is available for ${user.email}`);
    }
    const verifyPromise = page.waitForResponse(
      (candidate) => candidate.request().method() === "POST"
        && new URL(candidate.url()).pathname.endsWith("/totp"),
    );
    const codeInput = page.locator('[data-testid="totp-code"] input');
    await expect(codeInput).toBeVisible();
    await codeInput.fill(currentTOTP(secret));
    if (options.trustDevice) {
      await page.getByText("信任此设备 90 天", { exact: true }).click();
    }
    await page.getByTestId("totp-submit").click();
    const verified = await verifyPromise;
    expect(verified.ok(), `TOTP verification failed: ${verified.status()}`).toBeTruthy();
    accountId = ((await verified.json()) as { accountId?: unknown }).accountId;
  } else if (body.nextStep !== "ACTIVE") {
    throw new Error(`UI login stopped at unsupported next step: ${String(body.nextStep)}`);
  }

  await page.waitForURL((url) => !url.hash.includes("/pages/login/login"), {
    timeout: 20_000,
  });
  return {
    accountId: asId(accountId, "accountId"),
    page,
  };
}

/** Navigate inside uni-app without a full reload (and therefore without an
 * unnecessary refresh-token rotation). */
export async function navigateToPage(page: Page, href: string): Promise<void> {
  await page.evaluate((url) => {
    const uniApi = (globalThis as Record<string, unknown>).uni as
      | { redirectTo?: (options: { url: string }) => void }
      | undefined;
    if (uniApi?.redirectTo) {
      uniApi.redirectTo({ url });
    } else {
      location.hash = `#${url}`;
    }
  }, href);
  const path = href.split("?", 1)[0];
  await page.waitForURL((url) =>
    url.hash.startsWith(`#${path}`)
      || (path === "/pages/index/index" && ["", "#", "#/"].includes(url.hash)), {
    timeout: 20_000,
  });
}

export interface E2EApiResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** Execute an API request through the logged-in browser context. Its request
 * context shares the page's opaque-cookie jar, while reading the CSRF cookie
 * outside the document avoids racing a just-completed UI navigation. */
export async function sessionRequest(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<E2EApiResult> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === "vc_csrf")?.value ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: new URL(page.url()).origin,
  };
  if (csrf && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers["X-CSRF-Token"] = decodeURIComponent(csrf);
  }
  const response = await page.context().request.fetch(path, {
    method,
    headers,
    data: body,
  });
  return {
    ok: response.ok(),
    status: response.status(),
    body: await response.json().catch(() => null),
  };
}

/** Wait for a generation to leave the outstanding set before creating the
 * next synthetic turn. This keeps fixtures below the real per-owner cap and
 * verifies that the worker, provider and durable snapshot all make progress. */
export async function waitForGenerationTerminal(
  page: Page,
  generationId: string,
  timeoutMs = 20_000,
): Promise<E2EApiResult> {
  const startedAt = Date.now();
  let latest: E2EApiResult = { ok: false, status: 0, body: null };
  while (Date.now() - startedAt < timeoutMs) {
    latest = await sessionRequest(
      page,
      "GET",
      `/api/v1/generations/${encodeURIComponent(generationId)}/snapshot`,
    );
    if (latest.ok) {
      const status = String(
        (latest.body as { status?: unknown } | null)?.status ?? "",
      );
      if ([
        "COMPLETED",
        "COMPLETED_FALLBACK",
        "CANCELLED",
        "FAILED_FINAL",
        "INPUT_BLOCKED",
        "OUTPUT_BLOCKED",
      ].includes(status)) {
        return latest;
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error(
    `generation ${generationId} did not become terminal within ${timeoutMs}ms (last HTTP ${latest.status})`,
  );
}

/** Satisfy the synthetic stack's real server-side age/consent gate. */
export async function prepareGenerationAccess(page: Page): Promise<void> {
  const age = await sessionRequest(page, "POST", "/api/v1/age/verification");
  expect(age.ok, `age verification failed: ${age.status}`).toBeTruthy();
  for (const consentType of REQUIRED_CONSENTS) {
    const consent = await sessionRequest(page, "PUT", "/api/v1/consents", {
      consentType,
      version: "2026-08",
      granted: true,
    });
    expect(
      consent.ok,
      `${consentType} grant failed: ${consent.status}`,
    ).toBeTruthy();
  }
}

/** Use the product-created default relationship and create one real conversation. */
export async function createRelationshipAndConversation(
  page: Page,
): Promise<E2EConversation> {
  const relationship = await sessionRequest(page, "GET", "/api/v1/relationships");
  expect(
    relationship.ok,
    `default relationship lookup failed: ${relationship.status}`,
  ).toBeTruthy();
  const rows = Array.isArray(relationship.body)
    ? relationship.body as Array<{ relationshipId?: unknown; active?: unknown }>
    : [];
  const relationshipBody = rows.find((row) => row.active === true) ?? rows[0];
  expect(relationshipBody, "active default relationship is present").toBeTruthy();
  const relationshipId = asId(
    relationshipBody?.relationshipId,
    "relationshipId",
  );

  const conversation = await sessionRequest(page, "POST", "/api/v1/conversations", {
    relationshipId,
  });
  expect(
    conversation.ok,
    `conversation creation failed: ${conversation.status}`,
  ).toBeTruthy();
  const conversationBody = conversation.body as {
    conversationId?: unknown;
  };
  return {
    relationshipId,
    conversationId: asId(conversationBody.conversationId, "conversationId"),
  };
}

/** Read the product-created default relationship without creating another one. */
export async function getDefaultRelationshipId(page: Page): Promise<string> {
  const response = await sessionRequest(page, "GET", "/api/v1/relationships");
  expect(response.ok, `default relationship lookup failed: ${response.status}`).toBeTruthy();
  const rows = Array.isArray(response.body)
    ? response.body as Array<{ relationshipId?: unknown; active?: unknown }>
    : [];
  const row = rows.find((candidate) => candidate.active === true) ?? rows[0];
  return asId(row?.relationshipId, "relationshipId");
}

/*
 * The old memory-candidate helper intentionally disappeared with the memory
 * center. Server-side memory and governance APIs remain covered by backend
 * tests; the current consumer E2E suite only drives visible product journeys.
 */
