// TASK-0034/TASK-0103: shared authenticated transport factory for the H5 API.
// It injects the Bearer access token from the auth store and, on an HTTP 401,
// asks the auth store to clear the session and redirect to the login page (the
// access token has expired or been invalidated server-side). Existence is never
// disclosed: a 404/403 response is passed through as a plain non-OK result,
// never an error that reveals resource existence.
//
// TASK-0103 (P1-09 frontend + 条件风险 4, Owner decision 2026-08-08): this is
// the single place where session credentials are attached -- every request
// sends credentials:"include" (so the HttpOnly vc_refresh cookie travels
// automatically) and every state-changing request (POST/PUT/PATCH/DELETE)
// injects the double-submit X-CSRF-Token header from the vc_csrf cookie.
// Pages and business stores never hand-assemble auth headers.
//
// The transport stays transport-only: it never reads chat drafts, memory
// content or any model-bound context, so a token can never leak into a prompt.

import type { AuthTransport } from "@/api/auth";

export interface AuthTokenProvider {
  getAccessToken(): string | null;
  onUnauthorized(): void;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE = "vc_csrf";
const CSRF_HEADER = "X-CSRF-Token";

/** Read the double-submit CSRF cookie (non-HttpOnly, JS-readable by design). */
function readCsrfCookie(): string | null {
  try {
    if (typeof document === "undefined") {
      return null;
    }
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Build a JSON transport that attaches the current access token, sends the
 * session cookies (credentials:"include"), injects the CSRF token on
 * state-changing methods and routes 401 responses to the auth store.
 * login/refresh must use this too: on a 401 from refresh the store clears and
 * redirects, which is exactly the fail-closed behavior the server guarantees.
 */
export function createAuthenticatedTransport(provider: AuthTokenProvider): AuthTransport {
  return {
    async request(method: string, path: string, body?: unknown) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = provider.getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      if (STATE_CHANGING_METHODS.has(method)) {
        const csrf = readCsrfCookie();
        if (csrf) {
          headers[CSRF_HEADER] = csrf;
        }
      }
      const response = await fetch(path, {
        method,
        headers,
        credentials: "include",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 401) {
        provider.onUnauthorized();
      }
      const json: unknown = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, json };
    },
  };
}
