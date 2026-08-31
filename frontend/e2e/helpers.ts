import {
  type APIRequestContext,
  expect,
  type Page,
  request as requestFactory,
} from "@playwright/test";

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
  "admission-gate",
  "relationship-chat",
  // round11：03 的视口/状态矩阵测试与 130 条种子流测试拆分账号——后端
  // SSE 租约按用户计（上限 3，滞留至 130s TTL，见 Journey04 的
  // READY_FOR_OWNER），同账号内新增的真实发送会把后续测试的流挤成
  // 第 4 条而必然 429。
  "relationship-viewport",
  "relationship-viewport-wide",
  // 纠偏重写：03 的操作与边界测试独立账号，避免与 smoke/举报共享登录限流桶。
  "relationship-ops",
  "realtime-recovery",
  "memory-lifecycle",
  "export-lifecycle",
  "provider-faults",
  // DOGFOOD-09：可访问性 journey（08）的独立账号，避免与其他 journey 的
  // 关系/记忆状态互相污染。
  "accessibility",
  // round6：流式证据/会话切换 journey（09）的独立账号——同轮套跑中与
  // journey-03 的登录次数解耦，避免共享登录限流桶。
  "streaming-evidence",
  "navigation-smoke",
] as const;

export type E2EUserSuffix = (typeof E2E_USER_SUFFIXES)[number];

export interface E2EUser {
  username: string;
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
    username: `e2e-user-${suffix}`,
    password: "E2e-User-Pass-1234!",
  };
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
  options: { openPage?: boolean } = {},
): Promise<E2ESession> {
  if (options.openPage !== false) {
    await page.goto("/#/pages/login/login");
  }
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/auth/login",
  );
  await page.locator('[data-testid="username"] input').fill(user.username);
  await page.locator('[data-testid="password"] input').fill(user.password);
  await page.getByTestId("submit").click();
  const response = await responsePromise;
  expect(response.ok(), `UI login failed: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as {
    accountId?: unknown;
  };
  await page.waitForURL((url) => !url.hash.includes("/pages/login/login"), {
    timeout: 20_000,
  });
  return {
    accountId: asId(body.accountId, "accountId"),
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

/** Create real relationship/conversation setup without bypassing ownership. */
export async function createRelationshipAndConversation(
  page: Page,
): Promise<E2EConversation> {
  const relationship = await sessionRequest(page, "POST", "/api/v1/relationships", {
      personaRef: "gentle-listener",
  });
  expect(
    relationship.ok,
    `relationship creation failed: ${relationship.status}`,
  ).toBeTruthy();
  const relationshipBody = relationship.body as {
    relationshipId?: unknown;
  };
  const relationshipId = asId(
    relationshipBody.relationshipId,
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

/** Create a candidate with a real evidence chain for the memory UI journey. */
export async function createMemoryCandidate(
  page: Page,
  relationshipId: string,
  summary: string,
  evidence: string,
): Promise<string> {
  const response = await sessionRequest(
    page,
    "POST",
    `/api/v1/relationships/${encodeURIComponent(relationshipId)}/memories/candidates`,
    {
      scope: "RELATIONSHIP",
      summary,
      evidence: [evidence],
    },
  );
  expect(
    response.ok,
    `memory candidate creation failed: ${response.status}`,
  ).toBeTruthy();
  const body = response.body as { memoryId?: unknown };
  return asId(body.memoryId, "memoryId");
}
