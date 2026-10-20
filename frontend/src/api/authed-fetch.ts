// G9: realtime fetch wrapper. Cookie session + CSRF; no Bearer JWT and no
// silent refresh replay. A 401 signs the caller out.

import type { RenewResult } from "@/api/transport";
import { rememberRequestIdFromResponse } from "@/domain/request-id";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE = "vc_csrf";
const CSRF_HEADER = "X-CSRF-Token";

export interface AuthedFetchSession {
  renewAccessToken?(): Promise<RenewResult>;
  // Session generation counter; used only for request ownership (401 attribution).
  getSessionRevision?(): number;
  onUnauthorized(): void;
}

function readCsrfCookie(): string | null {
  try {
    if (typeof document === "undefined") {
      return null;
    }
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`),
    );
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function createAuthedFetch(
  _getAccessToken: () => string | null,
  session?: AuthedFetchSession,
): typeof fetch {
  return async function authed(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Capture the session revision per call so a 401 from a stale request
    // (issued before a later login) is not attributed to the new session.
    const revision = session?.getSessionRevision?.();
    const headers = new Headers(init?.headers);
    const method = (init?.method ?? "GET").toUpperCase();
    if (STATE_CHANGING_METHODS.has(method)) {
      const csrf = readCsrfCookie();
      if (csrf) {
        headers.set(CSRF_HEADER, csrf);
      }
    }
    const response = await fetch(input, { ...init, headers, credentials: "include" });
    rememberRequestIdFromResponse(response);
    if (response.status === 401) {
      if (revision === undefined || session?.getSessionRevision?.() === revision) {
        session?.onUnauthorized();
      }
    }
    return response;
  };
}
