import {
  type APIRequestContext,
  expect,
  type Page,
  request as requestFactory,
} from "@playwright/test";

// S0-23 shared helpers. Every credential and record is synthetic and confined
// to the isolated local stack.

export const ADMIN_USERNAME = "e2e-admin";
export const ADMIN_PASSWORD = "E2e-Admin-Pass-1234!";
export const PROVIDER_REPLY = "I hear you. Take a breath; there's no rush.";
export const SAFETY_BLOCK_SENTINEL = "[[E2E_SAFETY_BLOCK]]";
export const PROVIDER_TIMEOUT_SENTINEL = "[[E2E_PROVIDER_TIMEOUT]]";

const API_BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${process.env.E2E_H5_PORT ?? "5173"}`;

const REQUIRED_CONSENTS = [
  "SERVICE_TERMS",
  "PRIVACY_POLICY",
  "AI_CONTENT_NOTICE",
] as const;

export const E2E_USER_SUFFIXES = [
  "login-return",
  "admission-gate",
  "relationship-chat",
  "realtime-recovery",
  "memory-lifecycle",
  "export-lifecycle",
  "provider-faults",
  // DOGFOOD-09：可访问性 journey（08）的独立账号，避免与其他 journey 的
  // 关系/记忆状态互相污染。
  "accessibility",
] as const;

export type E2EUserSuffix = (typeof E2E_USER_SUFFIXES)[number];

export interface E2EUser {
  username: string;
  password: string;
}

export interface E2ESession {
  accessToken: string;
  accountId: string;
}

export interface E2EConversation {
  relationshipId: string;
  conversationId: string;
}

let cachedAdminToken: Promise<string> | null = null;

function asId(value: unknown, label: string): string {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error(`${label} was missing from the E2E API response`);
}

/**
 * Fetch one worker-local admin token with a throwaway stateless API context.
 * Disposing the context also disposes its CSRF/refresh cookies, so later test
 * request fixtures never inherit a mismatched cookie jar.
 */
export async function adminToken(): Promise<string> {
  if (!cachedAdminToken) {
    cachedAdminToken = (async () => {
      const api = await requestFactory.newContext({ baseURL: API_BASE_URL });
      try {
        const res = await api.post("/api/v1/auth/login", {
          data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
        });
        expect(res.ok(), `admin login failed: ${res.status()}`).toBeTruthy();
        const body = (await res.json()) as { accessToken?: unknown };
        if (typeof body.accessToken !== "string" || !body.accessToken) {
          throw new Error("admin login returned no accessToken");
        }
        return body.accessToken;
      } finally {
        await api.dispose();
      }
    })();
  }
  return cachedAdminToken;
}

function userFor(suffix: E2EUserSuffix): E2EUser {
  return {
    username: `e2e-user-${suffix}`,
    password: `E2e-User-${suffix}-Pass-1234!`,
  };
}

/**
 * Create the fixed synthetic account pool once in Playwright global setup.
 * A failed test may restart its worker process; keeping admin login here avoids
 * turning those restarts into repeated privileged logins that hit the real
 * source limiter and hide the original failure.
 */
export async function seedE2EUsers(): Promise<void> {
  const token = await adminToken();
  const api = await requestFactory.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const listed = await api.get("/api/v1/auth/admin/accounts");
    expect(listed.ok(), `account listing failed: ${listed.status()}`).toBeTruthy();
    const body = (await listed.json()) as Array<{ username?: unknown }>;
    const existing = new Set(
      body
        .map((row) => row.username)
        .filter((username): username is string => typeof username === "string"),
    );
    for (const suffix of E2E_USER_SUFFIXES) {
      const user = userFor(suffix);
      if (existing.has(user.username)) continue;
      const response = await api.post("/api/v1/auth/admin/accounts", {
        data: {
          username: user.username,
          password: user.password,
          displayName: `E2E 用户 ${suffix}`,
          role: "USER",
        },
      });
      expect(
        response.ok(),
        `account provisioning failed for ${suffix}: ${response.status()}`,
      ).toBeTruthy();
    }
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

/** UI login through the real login page; returns only the in-memory API token. */
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
    accessToken?: unknown;
    accountId?: unknown;
  };
  if (typeof body.accessToken !== "string" || !body.accessToken) {
    throw new Error("UI login returned no accessToken");
  }
  await page.waitForURL((url) => !url.hash.includes("/pages/login/login"), {
    timeout: 20_000,
  });
  return {
    accessToken: body.accessToken,
    accountId: asId(body.accountId, "accountId"),
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
  await page.waitForURL((url) => url.hash.startsWith(`#${path}`), {
    timeout: 20_000,
  });
}

async function bearerContext(accessToken: string): Promise<APIRequestContext> {
  return requestFactory.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
}

/** Satisfy the synthetic stack's real server-side age/consent gate. */
export async function prepareGenerationAccess(accessToken: string): Promise<void> {
  const api = await bearerContext(accessToken);
  try {
    const age = await api.post("/api/v1/age/verification");
    expect(age.ok(), `age verification failed: ${age.status()}`).toBeTruthy();
    for (const consentType of REQUIRED_CONSENTS) {
      const consent = await api.put("/api/v1/consents", {
        data: { consentType, version: "2026-08", granted: true },
      });
      expect(
        consent.ok(),
        `${consentType} grant failed: ${consent.status()}`,
      ).toBeTruthy();
    }
  } finally {
    await api.dispose();
  }
}

/** Create real relationship/conversation setup without bypassing ownership. */
export async function createRelationshipAndConversation(
  accessToken: string,
): Promise<E2EConversation> {
  const api = await bearerContext(accessToken);
  try {
    const relationship = await api.post("/api/v1/relationships", {
      data: { personaRef: "gentle-listener" },
    });
    expect(
      relationship.ok(),
      `relationship creation failed: ${relationship.status()}`,
    ).toBeTruthy();
    const relationshipBody = (await relationship.json()) as {
      relationshipId?: unknown;
    };
    const relationshipId = asId(
      relationshipBody.relationshipId,
      "relationshipId",
    );

    const conversation = await api.post("/api/v1/conversations", {
      data: { relationshipId },
    });
    expect(
      conversation.ok(),
      `conversation creation failed: ${conversation.status()}`,
    ).toBeTruthy();
    const conversationBody = (await conversation.json()) as {
      conversationId?: unknown;
    };
    return {
      relationshipId,
      conversationId: asId(conversationBody.conversationId, "conversationId"),
    };
  } finally {
    await api.dispose();
  }
}

/** Create a candidate with a real evidence chain for the memory UI journey. */
export async function createMemoryCandidate(
  accessToken: string,
  relationshipId: string,
  summary: string,
  evidence: string,
): Promise<string> {
  const api = await bearerContext(accessToken);
  try {
    const response = await api.post(
      `/api/v1/relationships/${encodeURIComponent(relationshipId)}/memories/candidates`,
      {
        data: {
          scope: "RELATIONSHIP",
          summary,
          evidence: [evidence],
        },
      },
    );
    expect(
      response.ok(),
      `memory candidate creation failed: ${response.status()}`,
    ).toBeTruthy();
    const body = (await response.json()) as { memoryId?: unknown };
    return asId(body.memoryId, "memoryId");
  } finally {
    await api.dispose();
  }
}
