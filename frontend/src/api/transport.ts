// G9 / ADR-0007: cookie-session H5 transport. The opaque vc_session cookie is
// HttpOnly and travels with credentials:"include". State-changing requests
// send the double-submit X-CSRF-Token header. There is no Bearer JWT and no
// /auth/refresh replay chain. 401 clears the local session.

import type { AuthTransport, AuthApiResponse } from "@/api/auth";
import { rememberRequestIdFromResponse } from "@/domain/request-id";

export type RenewResult = "renewed" | "rejected" | "unavailable";

export interface AuthTokenProvider {
  getAccessToken?(): string | null;
  renewAccessToken?(): Promise<RenewResult>;
  onUnauthorized(): void;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE = "vc_csrf";
const CSRF_HEADER = "X-CSRF-Token";

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

export function createAuthenticatedTransport(provider: AuthTokenProvider): AuthTransport {
  async function request(method: string, path: string, body?: unknown): Promise<AuthApiResponse> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
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
    rememberRequestIdFromResponse(response);
    if (response.status === 401) {
      provider.onUnauthorized();
    }
    const json: unknown = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, json };
  }

  return { request };
}
