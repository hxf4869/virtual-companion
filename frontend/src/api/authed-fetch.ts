// TASK-0186: Authenticated fetch wrapper for the realtime transport. The
// realtime transport (realtime-transport.ts) accepts a `fetchImpl?` injection
// parameter. By passing the wrapper returned here, every realtime HTTP call
// (ticket mint POST, resume stream GET, snapshot GET) carries the same Bearer
// token, CSRF header and credentials policy as the shared authenticated
// transport (api/transport.ts), without modifying realtime-transport.ts itself.
//
// The long-lived access token stays in the Authorization header only — it is
// never written to localStorage, never placed in a URL query, and never mixed
// into the realtime ticket secret (which is a 45s single-use credential carried
// in the resume query per the realtime-contract h5Security rules).
//
// RT-REVIVE: with a session attached, a 401 first tries one silent refresh
// (from the HttpOnly cookie) and replays the request, mirroring the REST
// transport's SESS-REVIVE behavior. A rejected refresh signs the caller out
// (the remaining 401 then surfaces as not-found/forbidden at the realtime
// layer); an unavailable refresh leaves the original response untouched.

import type { RenewResult } from "@/api/transport";
import { rememberRequestIdFromResponse } from "@/domain/request-id";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE = "vc_csrf";
const CSRF_HEADER = "X-CSRF-Token";

/** Session hooks for the RT-REVIVE silent-refresh behavior (optional). */
export interface AuthedFetchSession {
  renewAccessToken?(): Promise<RenewResult>;
  onUnauthorized(): void;
}

/** Read the double-submit CSRF cookie (non-HttpOnly, JS-readable by design). */
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

/**
 * Build a fetch-compatible function that attaches the current access token,
 * sends session cookies (credentials:"include") and injects the CSRF token on
 * state-changing methods. Intended as the `fetchImpl` argument to
 * createBrowserRealtimeDeps.
 *
 * RT-REVIVE: when {@code session.renewAccessToken} is provided, a 401 response
 * triggers one silent refresh and a single replay; the replay itself never
 * renews again (no recursion, and the refresh endpoint lives behind the REST
 * transport, never this wrapper).
 */
export function createAuthedFetch(
  getAccessToken: () => string | null,
  session?: AuthedFetchSession,
): typeof fetch {
  async function authed(
    input: RequestInfo | URL,
    init?: RequestInit,
    isReplay = false,
  ): Promise<Response> {
    const headers = new Headers(init?.headers);
    const token = getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const method = (init?.method ?? "GET").toUpperCase();
    if (STATE_CHANGING_METHODS.has(method)) {
      const csrf = readCsrfCookie();
      if (csrf) {
        headers.set(CSRF_HEADER, csrf);
      }
    }
    const response = await fetch(input, { ...init, headers, credentials: "include" });
    rememberRequestIdFromResponse(response);

    if (response.status === 401 && !isReplay && session?.renewAccessToken) {
      const outcome = await session.renewAccessToken();
      if (outcome === "renewed") {
        return authed(input, init, true);
      }
      if (outcome === "rejected") {
        session.onUnauthorized();
      }
      // unavailable: no refresh happened; the original 401 flows back and the
      // realtime layer maps it to its existence-hidden outcome.
    }
    return response;
  }

  return (input: RequestInfo | URL, init?: RequestInit) => authed(input, init, false);
}
