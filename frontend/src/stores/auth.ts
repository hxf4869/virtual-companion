// G9: Pinia auth store for the opaque cookie session. Memory-only.
// NO token or identity field is ever written to localStorage. The session
// secret lives only in the HttpOnly vc_session cookie. Reload restores via
// GET /auth/sessions. /auth/refresh is RETIRE. A server 401 clears the session
// and redirects.

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  login as apiLogin,
  logout as apiLogout,
  refresh as apiRefresh,
  type AuthTokens,
  type AuthTransport,
} from "@/api/auth";
import { buildLoginHref, hrefFromLocation } from "@/domain/nav-guard";
import { clearLocalSessionCaches } from "@/domain/session-cleanup";

export type AuthErrorCode =
  | "invalid-credentials"
  | "network-failed"
  | "refresh-failed";

export type SessionStatus = "unknown" | "anonymous" | "authenticated";
type RefreshOutcome = "renewed" | "rejected" | "unavailable";

function redirectToLogin(): void {
  const current =
    typeof location !== "undefined"
      ? hrefFromLocation(location)
      : "";
  // S0-18 review-fix (E2E finding): when the login page itself triggers a
  // session-invalidated redirect, a bare re-navigation would REPLACE the
  // already-present ?return=... target with nothing. Stay put instead —
  // the pending return href must survive until the user actually logs in.
  if (current.startsWith("/pages/login/login")) return;
  const url = buildLoginHref(current);
  try {
    const uniApi = (globalThis as Record<string, unknown>).uni as
      | { redirectTo?: (options: { url: string }) => void }
      | undefined;
    if (uniApi?.redirectTo) {
      uniApi.redirectTo({ url });
    } else if (typeof location !== "undefined") {
      location.href = url.startsWith("/pages/") ? `/#${url}` : url;
    }
  } catch {
    // Never let the redirect machinery break an auth transition.
  }
}

export const useAuthStore = defineStore("h5-auth", () => {
  const accessToken = ref<string | null>(null);
  const accountId = ref<string | null>(null);
  const role = ref<string | null>(null);
  const passwordMustChange = ref(false);
  const error = ref<AuthErrorCode | null>(null);
  const settled = ref(false);
  let refreshInFlight: Promise<RefreshOutcome> | null = null;

  const isAuthenticated = computed(
    () => accountId.value !== null || accessToken.value !== null,
  );
  const sessionStatus = computed<SessionStatus>(() => {
    if (accountId.value || accessToken.value) return "authenticated";
    return settled.value ? "anonymous" : "unknown";
  });

  /** Memory-only: never persists tokens to localStorage or any storage. */
  function persist(tokens: AuthTokens): void {
    accessToken.value = "session";
    accountId.value = tokens.accountId;
    role.value = tokens.role;
    passwordMustChange.value = tokens.passwordMustChange;
    settled.value = true;
  }

  function clear(): void {
    const hadSession = accessToken.value !== null;
    accessToken.value = null;
    accountId.value = null;
    role.value = null;
    passwordMustChange.value = false;
    error.value = null;
    settled.value = true;
    if (hadSession) {
      clearLocalSessionCaches();
    }
  }

  /**
   * Coalesce bootstrap, page-mount and 401-replay refreshes. The refresh
   * cookie rotates on every successful request, so concurrent calls can make
   * a perfectly valid session look rejected and clear its local caches.
   */
  async function refreshOnce(t: AuthTransport): Promise<RefreshOutcome> {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      let tokens: AuthTokens | null;
      try {
        tokens = await apiRefresh(t);
      } catch {
        return "unavailable";
      }
      if (!tokens) {
        clear();
        return "rejected";
      }
      persist(tokens);
      return "renewed";
    })();

    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  /** Log in. true only on a confirmed server login; never fakes success. */
  async function login(
    t: AuthTransport,
    username: string,
    password: string,
  ): Promise<boolean> {
    error.value = null;
    let tokens: AuthTokens | null;
    try {
      tokens = await apiLogin(t, username, password);
    } catch {
      error.value = "network-failed";
      return false;
    }
    if (!tokens) {
      error.value = "invalid-credentials";
      return false;
    }
    persist(tokens);
    return true;
  }

  /**
   * Restore identity from the opaque session cookie (GET /auth/sessions).
   * A server rejection clears the session; a network failure does not.
   */
  async function tryRefresh(t: AuthTransport): Promise<boolean> {
    error.value = null;
    const outcome = await refreshOnce(t);
    if (outcome === "unavailable") {
      error.value = "refresh-failed";
      return false;
    }
    return outcome === "renewed";
  }

  /**
   * SESS-REVIVE: one silent renewal for the transport's 401 replay path,
   * three-state so the transport can distinguish a rejected cookie (kick to
   * login) from a network failure (surface session-expired, stay put).
   */
  async function renewAccessToken(
    t: AuthTransport,
  ): Promise<RefreshOutcome> {
    return refreshOnce(t);
  }

  /** Revoke the session server-side (best effort) and clear locally. */
  async function logout(t: AuthTransport): Promise<void> {
    error.value = null;
    try {
      await apiLogout(t);
    } catch {
      // The local session is cleared regardless; a failed revoke is surfaced
      // nowhere (idempotent logout contract).
    }
    clear();
  }

  /** Clear the session and redirect to the login page (server 401). */
  function onUnauthorized(): void {
    clear();
    redirectToLogin();
  }

  return {
    accessToken,
    accountId,
    role,
    passwordMustChange,
    error,
    isAuthenticated,
    sessionStatus,
    login,
    tryRefresh,
    renewAccessToken,
    logout,
    onUnauthorized,
    clear,
  };
});
