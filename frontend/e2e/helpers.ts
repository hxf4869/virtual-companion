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

// VC-R79 栈模式：默认 http（scripts/dev/e2e-stack.sh）；tls 为
// scripts/dev/e2e-tls-stack.sh 的 TLS 真实栈（Caddy 自签 + 生产镜像）。
export type E2EStackKind = "http" | "tls";

/** E2E_STACK_KIND 只接受 http（未设置时的默认）与 tls；其它值立即报错，
 * 绝不静默落回 HTTP 模式。纯函数，供 config/helpers/vitest 共用。 */
export function parseE2EStackKind(value: string | undefined): E2EStackKind {
  if (value === undefined) return "http";
  if (value === "http" || value === "tls") return value;
  throw new Error(`E2E_STACK_KIND must be "http" or "tls", got: ${value}`);
}

export const STACK_KIND: E2EStackKind = parseE2EStackKind(process.env.E2E_STACK_KIND);

/** TLS 栈的默认 BASE_URL（E2E_BASE_URL 未提供时）。 */
export function tlsBaseUrl(tlsPort: string | undefined): string {
  return `https://localhost:${tlsPort ?? "18457"}`;
}

/** API base 与 config BASE_URL 共用同一派生：显式 E2E_BASE_URL 优先，
 * 其次按栈模式取 TLS https 或 H5 dev server 的 loopback http。 */
export function resolveE2EApiBaseUrl(env: {
  [name: string]: string | undefined;
}): string {
  if (env.E2E_BASE_URL) return env.E2E_BASE_URL;
  return parseE2EStackKind(env.E2E_STACK_KIND) === "tls"
    ? tlsBaseUrl(env.E2E_TLS_PORT)
    : `http://127.0.0.1:${env.E2E_H5_PORT ?? "5173"}`;
}

export const API_BASE_URL = resolveE2EApiBaseUrl(process.env);

/** 独立 requestFactory.newContext 不继承浏览器 context 的
 * ignoreHTTPSErrors（Playwright 1.62 GlobalAPIRequestContext 只读自身
 * options）。TLS 栈的自签 Caddy local CA 必须在每个独立 context 上显式
 * 放行；HTTP 模式返回空对象，行为不变。此选项只服务本轮合成栈，真实
 * TLS 校验由启动器 curl --cacert 完成。 */
export function standaloneRequestOptions(
  kind: E2EStackKind,
): { ignoreHTTPSErrors?: boolean } {
  return kind === "tls" ? { ignoreHTTPSErrors: true } : {};
}

export const STANDALONE_API_REQUEST_OPTIONS = standaloneRequestOptions(STACK_KIND);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** full 模式 HTTP 栈的 E2E_BASE_URL 校验（既有语义逐字保留）：loopback
 * http、无 userinfo。返回 null 表示合法，否则返回错误消息。 */
export function httpBaseUrlProblem(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "full E2E_BASE_URL must be a loopback HTTP URL";
  }
  if (parsed.protocol !== "http:"
      || !LOOPBACK_HOSTS.has(parsed.hostname)
      || parsed.username !== ""
      || parsed.password !== "") {
    return "full E2E_BASE_URL must be a loopback HTTP URL";
  }
  return null;
}

/** TLS 栈的 E2E_BASE_URL 校验：夹具固定 VC_DOMAIN=localhost、Origin
 * allowlist 与 CA 也只验 localhost（https://127.0.0.1 会 403 / Cookie 域
 * 不一致），故 hostname 必须恰为 localhost；端口比较用 URL.origin 的规范
 * 形式（https 默认 443 在 origin 中省略），确保被接受的 URL 与后端
 * allowlist 永不漂移。返回 null 表示合法，否则返回带具体原因的错误。 */
export function tlsBaseUrlProblem(raw: string, tlsPort: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "TLS E2E_BASE_URL must be a loopback HTTPS URL: failed to parse";
  }
  if (parsed.protocol !== "https:") {
    return `TLS E2E_BASE_URL must be https (got ${parsed.protocol}//)`;
  }
  if (parsed.hostname !== "localhost") {
    return `TLS E2E_BASE_URL hostname must be exactly localhost (got ${parsed.hostname}); the TLS stack and its CA/Origin allowlist only serve localhost`;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "TLS E2E_BASE_URL must not carry userinfo";
  }
  const derivedOrigin = new URL(tlsBaseUrl(tlsPort)).origin;
  if (parsed.origin !== derivedOrigin) {
    return `TLS E2E_BASE_URL must equal the TLS stack origin ${derivedOrigin} (got ${parsed.origin})`;
  }
  return null;
}

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
  "auth-session-context",
  "relationship-chat",
  "realtime-recovery",
  "provider-faults",
  "accessibility",
  "navigation-smoke",
  "companion-memory",
] as const;

export type E2EUserSuffix = (typeof E2E_USER_SUFFIXES)[number];

export interface E2EUser {
  email: string;
  password: string;
}

export interface E2ESession {
  accountId: string;
  /** VC-R169: committed non-credential session id (decimal string). */
  sessionId: string;
  /** Account email owning this session; used for on-page identity assertions. */
  email: string;
  page: Page;
}

/** One already-authenticated account shared by journeys that exercise product
 * behavior rather than the login flow itself. Sharing a single server-side
 * session keeps each full run inside the backend's real login rate limits:
 * 5 attempts per 15 minutes keyed by account email, plus 10 per minute per
 * source for each request kind (backend internal/auth/limiter.go). */
export type SharedSessionKind = "chat" | "memory" | "admin";

const SHARED_SESSION_ACCOUNTS: Record<SharedSessionKind, E2EUser> = {
  chat: userFor("relationship-chat"),
  memory: userFor("companion-memory"),
  admin: { email: "e2e-admin@example.test", password: "E2e-Admin-Pass-1234!" },
};

/** The shared ADMIN account itself, for journeys that re-login the same
 * account through the real UI (VC-R38 cross-tab logout). */
export const SHARED_ADMIN_ACCOUNT: E2EUser = SHARED_SESSION_ACCOUNTS.admin;

interface SharedSessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

interface SharedSessionFile {
  cookies: SharedSessionCookie[];
  accountId: string;
  /** VC-R169: committed session id from the establishing response. */
  sessionId: string;
  email: string;
}

function sharedSessionPath(kind: SharedSessionKind): string {
  const stateFile = process.env.E2E_STACK_STATE_FILE;
  if (!stateFile) throw new Error("E2E_STACK_STATE_FILE is required for shared sessions");
  return `${stateFile}.shared-${kind}.json`;
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
  const api = await requestFactory.newContext({
    baseURL: API_BASE_URL,
    ...STANDALONE_API_REQUEST_OPTIONS,
  });
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
  // VC-R169: a direct ACTIVE login response already carries the committed
  // session id; challenge completion replaces it below.
  let committedSessionId = typeof (body as { sessionId?: unknown }).sessionId === "string"
    ? (body as { sessionId: string }).sessionId
    : "";

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
    const confirmedBody = (await confirmed.json()) as { accountId?: unknown; sessionId?: unknown };
    accountId = confirmedBody.accountId;
    committedSessionId = typeof confirmedBody.sessionId === "string" ? confirmedBody.sessionId : "";
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
    const verifiedBody = (await verified.json()) as { accountId?: unknown; sessionId?: unknown };
    accountId = verifiedBody.accountId;
    committedSessionId = typeof verifiedBody.sessionId === "string" ? verifiedBody.sessionId : "";
  } else if (body.nextStep !== "ACTIVE") {
    throw new Error(`UI login stopped at unsupported next step: ${String(body.nextStep)}`);
  }

  await page.waitForURL((url) => !url.hash.includes("/pages/login/login"), {
    timeout: 20_000,
  });
  return {
    accountId: asId(accountId, "accountId"),
    sessionId: committedSessionId === ""
      ? (() => { throw new Error("login completion did not expose a sessionId"); })()
      : committedSessionId,
    email: user.email,
    page,
  };
}

/**
 * Enroll each shared account once through the real API so the journeys using
 * it never spend the backend's shared authenticator rate-limit budget on
 * logins. Runs in global setup, before any browser test. The opaque session
 * cookies are persisted per kind and replayed by openSharedSession.
 */
export async function bootstrapSharedSessions(): Promise<void> {
  for (const kind of ["chat", "memory", "admin"] as const) {
    await bootstrapSharedSession(kind);
  }
}

async function bootstrapSharedSession(kind: SharedSessionKind): Promise<void> {
  const account = SHARED_SESSION_ACCOUNTS[kind];
  const api = await requestFactory.newContext({
    baseURL: API_BASE_URL,
    ...STANDALONE_API_REQUEST_OPTIONS,
  });
  const origin = new URL(API_BASE_URL).origin;
  const jsonHeaders = { "Content-Type": "application/json", Origin: origin };
  try {
    const login = await api.post("/api/v1/auth/login", {
      headers: jsonHeaders,
      data: { account: account.email, password: account.password },
    });
    expect(login.ok(), `shared ${kind} login failed: ${login.status()}`).toBeTruthy();
    const loginBody = (await login.json()) as {
      nextStep?: unknown;
      challengeId?: unknown;
    };
    const challengeId = String(loginBody.challengeId ?? "");
    expect(challengeId, `shared ${kind} login returned no challenge`).not.toBe("");

    // Idempotent across cold and kept (E2E_STACK_KEEP) stacks: a fresh
    // account enrolls its authenticator here; an account that already
    // enrolled on a previous run completes the seeded-secret TOTP challenge
    // instead, so re-running global setup never hard-fails on reuse.
    let accountId: unknown;
    let sharedSessionId: unknown;
    if (loginBody.nextStep === "TOTP_REQUIRED") {
      const secret = (await readAuthenticatorSecrets())[account.email];
      if (!secret) {
        throw new Error(
          `shared ${kind} account is enrolled but no E2E authenticator material is available for ${account.email}`,
        );
      }
      const verified = await api.post(
        `/api/v1/auth/challenges/${encodeURIComponent(challengeId)}/totp`,
        {
          headers: jsonHeaders,
          data: { code: currentTOTP(secret), trustDevice: true },
        },
      );
      expect(verified.ok(), `shared ${kind} TOTP verification failed: ${verified.status()}`)
        .toBeTruthy();
      const verifiedBody = (await verified.json()) as { accountId?: unknown; sessionId?: unknown };
      accountId = verifiedBody.accountId;
      sharedSessionId = verifiedBody.sessionId;
    } else {
      expect(
        loginBody.nextStep,
        `shared ${kind} login stopped at an unexpected step`,
      ).toBe("AUTHENTICATOR_SETUP_REQUIRED");
      const enrollment = await enrollSharedAuthenticator(api, jsonHeaders, kind, challengeId);
      accountId = enrollment.accountId;
      sharedSessionId = enrollment.sessionId;
      // The manual key is the account's permanent seed; persist it only on
      // the enrollment path (the TOTP path reuses the stored secret).
      await saveAuthenticatorSecret(account.email, enrollment.manualKey);
    }

    const state = await api.storageState();
    const shared: SharedSessionFile = {
      cookies: state.cookies as SharedSessionCookie[],
      accountId: asId(accountId, "accountId"),
      sessionId: asId(sharedSessionId, "sessionId"),
      email: account.email,
    };
    await writeFile(sharedSessionPath(kind), `${JSON.stringify(shared)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } finally {
    await api.dispose();
  }
}

/** Enroll a fresh account's authenticator on its pending login challenge. */
async function enrollSharedAuthenticator(
  api: APIRequestContext,
  jsonHeaders: Record<string, string>,
  kind: SharedSessionKind,
  challengeId: string,
): Promise<{ accountId: unknown; sessionId: unknown; manualKey: string }> {
  const setup = await api.post(
    `/api/v1/auth/challenges/${encodeURIComponent(challengeId)}/authenticator-setup`,
    { headers: jsonHeaders },
  );
  expect(setup.ok(), `shared ${kind} authenticator setup failed: ${setup.status()}`)
    .toBeTruthy();
  const manualKey = ((await setup.json()) as { manualKey?: unknown }).manualKey;
  if (typeof manualKey !== "string" || !/^[A-Z2-7]+$/.test(manualKey)) {
    throw new Error(`shared ${kind} setup did not expose a valid manual key`);
  }

  const confirm = await api.post(
    `/api/v1/auth/challenges/${encodeURIComponent(challengeId)}/authenticator-confirm`,
    {
      headers: jsonHeaders,
      data: { code: currentTOTP(manualKey), trustDevice: true },
    },
  );
  expect(confirm.ok(), `shared ${kind} authenticator confirm failed: ${confirm.status()}`)
    .toBeTruthy();
  const confirmBody = (await confirm.json()) as { accountId?: unknown; sessionId?: unknown };
  return { accountId: confirmBody.accountId, sessionId: confirmBody.sessionId, manualKey };
}

/** Resume the shared authenticated session inside this test's browser context
 * instead of driving the login form. The journeys keep their per-user server
 * state (relationships, conversations, consents) on the shared account. */
export async function openSharedSession(
  page: Page,
  kind: SharedSessionKind = "chat",
): Promise<E2ESession> {
  const shared = JSON.parse(
    await readFile(sharedSessionPath(kind), "utf8"),
  ) as SharedSessionFile;
  await page.context().addCookies(shared.cookies);
  const documentResponse = await page.goto("/#/pages/index/index");
  // A hash-only navigation keeps the previous anonymous auth store alive.
  // Discover the newly installed cookies from a fresh document exactly once.
  if (documentResponse === null) await page.reload();
  await expect(
    page.getByTestId("consumer-tabbar"),
    `shared ${kind} session (${shared.email}) is not authenticated`,
  ).toBeVisible();
  return {
    accountId: shared.accountId,
    sessionId: shared.sessionId,
    email: shared.email,
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

/** VC-R52 server expected-account precondition: state-changing requests must
 * declare the account the session belongs to (X-VC-Expected-Account-ID), taken
 * from the E2ESession's known accountId. Reads keep the header-less shape. */
const EXPECTED_ACCOUNT_HEADER = "X-VC-Expected-Account-ID";
const EXPECTED_SESSION_HEADER = "X-VC-Expected-Session-ID";
const STATE_CHANGING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

export interface SessionRequestOptions {
  /** Known accountId from E2ESession (openSharedSession / uiLogin). */
  accountId?: string;
  /** VC-R169: committed session id from E2ESession; carried on writes so the
   * fixture mirrors the real page (never re-derived from cookies). */
  sessionId?: string;
}

/** Execute an API request through the logged-in browser context. Its request
 * context shares the page's opaque-cookie jar, while reading the CSRF cookie
 * outside the document avoids racing a just-completed UI navigation. */
export async function sessionRequest(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
  options: SessionRequestOptions = {},
): Promise<E2EApiResult> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === "vc_csrf")?.value ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: new URL(page.url()).origin,
  };
  if (csrf && STATE_CHANGING_METHODS.includes(method)) {
    headers["X-CSRF-Token"] = decodeURIComponent(csrf);
  }
  if (options.accountId && STATE_CHANGING_METHODS.includes(method)) {
    headers[EXPECTED_ACCOUNT_HEADER] = options.accountId;
  }
  if (options.sessionId && STATE_CHANGING_METHODS.includes(method)) {
    headers[EXPECTED_SESSION_HEADER] = options.sessionId;
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
export async function prepareGenerationAccess(session: E2ESession): Promise<void> {
  const page = session.page;
  const { accountId, sessionId } = session;
  const age = await sessionRequest(page, "POST", "/api/v1/age/verification", undefined, {
    accountId,
    sessionId,
  });
  expect(age.ok, `age verification failed: ${age.status}`).toBeTruthy();
  for (const consentType of REQUIRED_CONSENTS) {
    const consent = await sessionRequest(page, "PUT", "/api/v1/consents", {
      consentType,
      version: "2026-08",
      granted: true,
    }, { accountId, sessionId });
    expect(
      consent.ok,
      `${consentType} grant failed: ${consent.status}`,
    ).toBeTruthy();
  }
}

/** Use the product-created default relationship and create one real conversation. */
export async function createRelationshipAndConversation(
  session: E2ESession,
): Promise<E2EConversation> {
  const page = session.page;
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
  }, { accountId: session.accountId, sessionId: session.sessionId });
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
