// TASK-0034: shared authenticated transport factory for the H5 API. It injects
// the Bearer access token from the auth store and, on an HTTP 401, asks the
// auth store to clear the session and redirect to the login page (the access
// token has expired or been invalidated server-side). Existence is never
// disclosed: a 404/403 response is passed through as a plain non-OK result,
// never an error that reveals resource existence.
//
// The transport stays transport-only: it never reads chat drafts, memory
// content or any model-bound context, so a token can never leak into a prompt.

import type { AuthTransport } from "@/api/auth";

export interface AuthTokenProvider {
  getAccessToken(): string | null;
  onUnauthorized(): void;
}

/**
 * Build a JSON transport that attaches the current access token and routes 401
 * responses to the auth store. login/refresh must use this too: on a 401 from
 * refresh the store clears and redirects, which is exactly the fail-closed
 * behavior the server guarantees.
 */
export function createAuthenticatedTransport(provider: AuthTokenProvider): AuthTransport {
  return {
    async request(method: string, path: string, body?: unknown) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = provider.getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(path, {
        method,
        headers,
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
