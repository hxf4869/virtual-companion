// TASK-0034: Pinia auth store binding the identity API client to the H5 UI.
//
// The store holds the access/refresh tokens and the server-derived identity
// (accountId == owner_user_id, role) and persists them so a reload restores the
// session. Failure semantics: a confirmed login is the ONLY thing that
// establishes an authenticated session; a non-confirmed result (null) or a
// thrown transport preserves the current state and records an error. A server
// 401 (expired/invalid token) clears the session and redirects to the login
// page -- the client never retries a failed token into a fabricated session.
// Tokens are never written into chat drafts, memory content or model context.

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  login as apiLogin,
  logout as apiLogout,
  refresh as apiRefresh,
  type AuthTokens,
  type AuthTransport,
} from "@/api/auth";

export type AuthErrorCode =
  | "invalid-credentials"
  | "network-failed"
  | "refresh-failed";

const ACCESS_KEY = "vc.accessToken";
const REFRESH_KEY = "vc.refreshToken";
const ACCOUNT_KEY = "vc.accountId";
const ROLE_KEY = "vc.role";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  const s = storage();
  if (!s) return null;
  const value = s.getItem(key);
  return value == null || value === "" ? null : value;
}

function write(key: string, value: string): void {
  const s = storage();
  if (s) s.setItem(key, value);
}

function remove(key: string): void {
  const s = storage();
  if (s) s.removeItem(key);
}

function redirectToLogin(): void {
  try {
    const uniApi = (globalThis as Record<string, unknown>).uni as
      | { redirectTo?: (options: { url: string }) => void }
      | undefined;
    if (uniApi?.redirectTo) {
      uniApi.redirectTo({ url: "/pages/login/login" });
    } else if (typeof location !== "undefined") {
      location.href = "/pages/login/login";
    }
  } catch {
    // Never let the redirect machinery break an auth transition.
  }
}

export const useAuthStore = defineStore("h5-auth", () => {
  const accessToken = ref<string | null>(read(ACCESS_KEY));
  const refreshToken = ref<string | null>(read(REFRESH_KEY));
  const accountId = ref<string | null>(read(ACCOUNT_KEY));
  const role = ref<string | null>(read(ROLE_KEY));
  const error = ref<AuthErrorCode | null>(null);

  const isAuthenticated = computed(() => accessToken.value !== null);

  function persist(tokens: AuthTokens): void {
    accessToken.value = tokens.accessToken;
    refreshToken.value = tokens.refreshToken;
    accountId.value = tokens.accountId;
    role.value = tokens.role;
    write(ACCESS_KEY, tokens.accessToken);
    write(REFRESH_KEY, tokens.refreshToken);
    write(ACCOUNT_KEY, tokens.accountId);
    write(ROLE_KEY, tokens.role);
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
   * Renew the session from the stored refresh token. On success the tokens are
   * rotated in place. A server rejection (null) means the refresh session is no
   * longer valid -- the session is cleared; never a fabricated continuation.
   */
  async function tryRefresh(t: AuthTransport): Promise<boolean> {
    const current = refreshToken.value;
    if (!current) return false;
    error.value = null;
    let tokens: AuthTokens | null;
    try {
      tokens = await apiRefresh(t, current);
    } catch {
      error.value = "refresh-failed";
      return false;
    }
    if (!tokens) {
      clear();
      return false;
    }
    persist(tokens);
    return true;
  }

  /** Revoke the session server-side (best effort) and clear locally. */
  async function logout(t: AuthTransport): Promise<void> {
    const current = refreshToken.value;
    if (current) {
      try {
        await apiLogout(t, current);
      } catch {
        // The local session is cleared regardless; a failed revoke is surfaced
        // nowhere (idempotent logout contract).
      }
    }
    clear();
  }

  /** Clear the session and redirect to the login page (server 401). */
  function onUnauthorized(): void {
    clear();
    redirectToLogin();
  }

  function clear(): void {
    accessToken.value = null;
    refreshToken.value = null;
    accountId.value = null;
    role.value = null;
    error.value = null;
    remove(ACCESS_KEY);
    remove(REFRESH_KEY);
    remove(ACCOUNT_KEY);
    remove(ROLE_KEY);
  }

  return {
    accessToken,
    refreshToken,
    accountId,
    role,
    error,
    isAuthenticated,
    login,
    tryRefresh,
    logout,
    onUnauthorized,
    clear,
  };
});
