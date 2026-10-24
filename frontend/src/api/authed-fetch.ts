// G9: realtime fetch wrapper. Cookie session + CSRF; no Bearer JWT and no
// silent refresh replay. A 401 signs the caller out.

import type { RenewResult } from "@/api/transport";
import { rememberRequestIdFromResponse } from "@/domain/request-id";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE = "vc_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const EXPECTED_ACCOUNT_HEADER = "X-VC-Expected-Account-ID";
const EXPECTED_SESSION_HEADER = "X-VC-Expected-Session-ID";
const ACCOUNT_CONTEXT_CHANGED_CODE = "ACCOUNT_CONTEXT_CHANGED";

export interface AuthedFetchSession {
  renewAccessToken?(): Promise<RenewResult>;
  // Session generation counter; used only for request ownership (401 attribution).
  getSessionRevision?(): number;
  // VC-R52: account the page currently believes is signed in; captured once per
  // call entry and sent as the expected-account precondition header.
  getAccountId?(): string | null;
  // VC-R169: session id the page committed to; REQUIRED on the session object
  // so a caller that forgets it fails type-check. Captured once per call
  // entry and sent as the expected-session precondition header.
  getSessionId(): string | null;
  onUnauthorized(): void;
  // VC-R52: precise 409 + body code ACCOUNT_CONTEXT_CHANGED that still owns the
  // current session revision. The response is returned to the caller unchanged.
  onAccountContextChanged?(): void;
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
    // VC-R52: expected-account precondition, captured once per call entry with
    // the revision; never re-read from cookies mid-flight.
    const expectedAccount = session?.getAccountId?.() ?? null;
    // VC-R169: captured once per call entry, with the account header.
    const expectedSession = session?.getSessionId() ?? null;
    const headers = new Headers(init?.headers);
    const method = (init?.method ?? "GET").toUpperCase();
    if (expectedAccount !== null) {
      headers.set(EXPECTED_ACCOUNT_HEADER, expectedAccount);
    }
    if (expectedSession !== null) {
      headers.set(EXPECTED_SESSION_HEADER, expectedSession);
    }
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
    // VC-R52: precise 409 + body code ACCOUNT_CONTEXT_CHANGED, gated by the
    // same revision ownership as the 401 path. Only the failed 409 envelope is
    // inspected through a clone; successful (stream) bodies are never cloned
    // or read here, and the caller keeps the original response untouched.
    if (response.status === 409) {
      try {
        const envelope = await response.clone().json().catch(() => null);
        if (
          envelope
          && typeof envelope === "object"
          && (envelope as Record<string, unknown>).code === ACCOUNT_CONTEXT_CHANGED_CODE
          && (revision === undefined || session?.getSessionRevision?.() === revision)
        ) {
          session?.onAccountContextChanged?.();
        }
      } catch {
        // 检查失败只放弃钩子上报，绝不断掉调用方拿到的响应。
      }
    }
    return response;
  };
}
