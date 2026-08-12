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

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE = "vc_csrf";
const CSRF_HEADER = "X-CSRF-Token";

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
 */
export function createAuthedFetch(
  getAccessToken: () => string | null,
): typeof fetch {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
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
    return fetch(input, { ...init, headers, credentials: "include" });
  };
}
