// Cookie-session authentication state.
// NO token or identity field is ever written to localStorage.
// Account identity, auth challenges and first-use recovery codes are memory-only.

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  AuthHttpError,
  confirmAuthenticator as apiConfirmAuthenticator,
  getAuthenticatorSetup as apiGetAuthenticatorSetup,
  getRegistrationStatus as apiGetRegistrationStatus,
  login as apiLogin,
  logout as apiLogout,
  refresh as apiRefresh,
  verifyAuthenticatorCode as apiVerifyAuthenticatorCode,
  verifyRecoveryCode as apiVerifyRecoveryCode,
  type AuthChallengeComplete,
  type AuthLoginResult,
  type AuthNextStep,
  type AuthSessionIdentity,
  type AuthSessionProbe,
  type AuthenticatorSetup,
  type AuthTransport,
} from "@/api/auth";
import { buildLoginHref, hrefFromLocation } from "@/domain/nav-guard";
import { clearLocalSessionCaches } from "@/domain/session-cleanup";

export type AuthErrorCode =
  | "invalid-credentials"
  | "invalid-code"
  | "challenge-unavailable"
  | "rate-limited"
  | "network-failed"
  | "service-unavailable"
  | "refresh-failed";

export type SessionStatus = "unknown" | "anonymous" | "authenticated";
export type AuthFlowStep = "LOGIN" | AuthNextStep;
type RefreshOutcome = "renewed" | "rejected" | "unavailable";

function redirectToLogin(): void {
  const current = typeof location !== "undefined" ? hrefFromLocation(location) : "";
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
    // Navigation must never break an auth transition.
  }
}

export const useAuthStore = defineStore("h5-auth", () => {
  // accessToken remains as a compatibility signal for transports that have not
  // yet been rewritten. It is always the literal "session", never a secret.
  const accessToken = ref<string | null>(null);
  const accountId = ref<string | null>(null);
  const email = ref<string | null>(null);
  const role = ref<string | null>(null);
  const passwordMustChange = ref(false);
  const authenticatorEnabled = ref(false);
  const error = ref<AuthErrorCode | null>(null);
  const settled = ref(false);

  const nextStep = ref<AuthFlowStep>("LOGIN");
  const challengeId = ref<string | null>(null);
  const challengeExpiresAt = ref<string | null>(null);
  const authenticatorSetup = ref<AuthenticatorSetup | null>(null);
  const recoveryCodes = ref<string[]>([]);
  const registrationEnabled = ref(false);
  // VC-R08: every clear()/login() bumps the generation so a stale refresh
  // result can never assert anything about the newer session state.
  let refreshEpoch = 0;
  let refreshInFlight: { epoch: number; promise: Promise<RefreshOutcome> } | null = null;

  const isAuthenticated = computed(() => accountId.value !== null);
  const sessionStatus = computed<SessionStatus>(() => {
    if (accountId.value) return "authenticated";
    return settled.value ? "anonymous" : "unknown";
  });

  function persist(identity: AuthSessionIdentity): void {
    // Committing an identity is itself a generation boundary: any probe already
    // in flight describes the previous session and must not roll this one back.
    refreshEpoch++;
    // VC-R09: a handover between two different known accounts must drop the
    // previous account's shared caches; a same-account recovery keeps them.
    if (accountId.value !== null && accountId.value !== identity.accountId) {
      clearLocalSessionCaches();
    }
    accessToken.value = "session";
    accountId.value = identity.accountId;
    email.value = identity.email ?? null;
    role.value = identity.role;
    passwordMustChange.value = identity.passwordMustChange;
    authenticatorEnabled.value = identity.authenticatorEnabled;
    nextStep.value = "ACTIVE";
    challengeId.value = null;
    challengeExpiresAt.value = null;
    authenticatorSetup.value = null;
    settled.value = true;
  }

  function resetLoginFlow(): void {
    nextStep.value = "LOGIN";
    challengeId.value = null;
    challengeExpiresAt.value = null;
    authenticatorSetup.value = null;
    recoveryCodes.value = [];
    error.value = null;
  }

  function clear(): void {
    refreshEpoch++;
    const hadSession = accountId.value !== null || accessToken.value !== null;
    accessToken.value = null;
    accountId.value = null;
    email.value = null;
    role.value = null;
    passwordMustChange.value = false;
    authenticatorEnabled.value = false;
    settled.value = true;
    resetLoginFlow();
    if (hadSession) clearLocalSessionCaches();
  }

  async function loadRegistrationStatus(t: AuthTransport): Promise<boolean> {
    try {
      registrationEnabled.value = await apiGetRegistrationStatus(t);
    } catch {
      registrationEnabled.value = false;
    }
    return registrationEnabled.value;
  }

  async function refreshOnce(t: AuthTransport): Promise<RefreshOutcome> {
    if (refreshInFlight && refreshInFlight.epoch === refreshEpoch) {
      return refreshInFlight.promise;
    }

    const epoch = refreshEpoch;
    const promise = (async (): Promise<RefreshOutcome> => {
      let probe: AuthSessionProbe;
      try {
        probe = await apiRefresh(t);
      } catch {
        return "unavailable";
      }
      // A result from an invalidated generation says nothing about the current
      // session: never persist, clear or otherwise touch state with it.
      if (epoch !== refreshEpoch) return "unavailable";
      if (probe.status === "authenticated") {
        persist(probe.identity);
        recoveryCodes.value = [];
        return "renewed";
      }
      if (probe.status === "anonymous") {
        clear();
        return "rejected";
      }
      return "unavailable";
    })();

    refreshInFlight = { epoch, promise };
    try {
      return await promise;
    } finally {
      // Only the owning request may drop the in-flight slot; a stale finally
      // must not erase a newer generation's request.
      if (refreshInFlight?.promise === promise) {
        refreshInFlight = null;
      }
    }
  }

  /** Submit the first login step and retain only the server-selected route. */
  async function login(
    t: AuthTransport,
    account: string,
    password: string,
  ): Promise<AuthFlowStep | null> {
    // A new login attempt invalidates any in-flight session recovery, whether
    // it ends ACTIVE or in a challenge.
    refreshEpoch++;
    resetLoginFlow();
    let result: AuthLoginResult | null;
    try {
      result = await apiLogin(t, account.trim().toLowerCase(), password);
    } catch (caught) {
      error.value = mapRequestError(caught);
      return null;
    }
    if (!result) {
      error.value = "invalid-credentials";
      return null;
    }
    applyLoginResult(result);
    return nextStep.value;
  }

  function applyLoginResult(result: AuthLoginResult): void {
    nextStep.value = result.nextStep;
    error.value = null;
    recoveryCodes.value = [];
    if (result.nextStep === "ACTIVE") {
      persist(result);
      return;
    }
    if (result.nextStep === "TOTP_REQUIRED" || result.nextStep === "AUTHENTICATOR_SETUP_REQUIRED") {
      challengeId.value = result.challengeId;
      challengeExpiresAt.value = result.expiresAt;
    }
  }

  async function loadAuthenticatorSetup(t: AuthTransport): Promise<boolean> {
    error.value = null;
    const id = challengeId.value;
    if (nextStep.value !== "AUTHENTICATOR_SETUP_REQUIRED" || !id) {
      error.value = "challenge-unavailable";
      return false;
    }
    try {
      const setup = await apiGetAuthenticatorSetup(t, id);
      if (!setup) {
        error.value = "challenge-unavailable";
        return false;
      }
      authenticatorSetup.value = setup;
      return true;
    } catch (caught) {
      error.value = mapRequestError(caught);
      return false;
    }
  }

  async function confirmAuthenticator(
    t: AuthTransport,
    code: string,
    trustDevice: boolean,
  ): Promise<boolean> {
    return completeChallenge(t, "AUTHENTICATOR_SETUP_REQUIRED", code, trustDevice, apiConfirmAuthenticator);
  }

  async function verifyAuthenticatorCode(
    t: AuthTransport,
    code: string,
    trustDevice: boolean,
  ): Promise<boolean> {
    return completeChallenge(t, "TOTP_REQUIRED", code, trustDevice, apiVerifyAuthenticatorCode);
  }

  async function verifyRecoveryCode(
    t: AuthTransport,
    code: string,
    trustDevice: boolean,
  ): Promise<boolean> {
    return completeChallenge(t, "TOTP_REQUIRED", code, trustDevice, apiVerifyRecoveryCode);
  }

  async function completeChallenge(
    t: AuthTransport,
    requiredStep: "TOTP_REQUIRED" | "AUTHENTICATOR_SETUP_REQUIRED",
    code: string,
    trustDevice: boolean,
    request: (
      transport: AuthTransport,
      challenge: string,
      value: string,
      trusted: boolean,
    ) => Promise<AuthChallengeComplete | null>,
  ): Promise<boolean> {
    error.value = null;
    const id = challengeId.value;
    if (nextStep.value !== requiredStep || !id) {
      error.value = "challenge-unavailable";
      return false;
    }
    let completed: AuthChallengeComplete | null;
    try {
      completed = await request(t, id, code.trim(), trustDevice);
    } catch (caught) {
      error.value = mapRequestError(caught);
      return false;
    }
    if (!completed) {
      error.value = "invalid-code";
      return false;
    }
    const codes = completed.recoveryCodes;
    persist(completed);
    recoveryCodes.value = codes;
    return true;
  }

  async function tryRefresh(t: AuthTransport): Promise<boolean> {
    error.value = null;
    const epoch = refreshEpoch;
    const outcome = await refreshOnce(t);
    // A renewal is this caller's own success even when a later transition has
    // already moved the generation on; only the error commit stays gated.
    if (outcome === "renewed") return true;
    if (outcome === "unavailable" && epoch === refreshEpoch) {
      error.value = "refresh-failed";
    }
    return false;
  }

  async function renewAccessToken(t: AuthTransport): Promise<RefreshOutcome> {
    return refreshOnce(t);
  }

  /** Ordinary logout preserves the independent 90-day trusted-device cookie. */
  async function logout(t: AuthTransport): Promise<void> {
    error.value = null;
    try {
      await apiLogout(t);
    } catch {
      // Best effort: local identity still clears when the network is unavailable.
    }
    clear();
  }

  function onUnauthorized(): void {
    clear();
    redirectToLogin();
  }

  return {
    accessToken,
    accountId,
    email,
    role,
    passwordMustChange,
    authenticatorEnabled,
    error,
    isAuthenticated,
    sessionStatus,
    nextStep,
    challengeId,
    challengeExpiresAt,
    authenticatorSetup,
    recoveryCodes,
    registrationEnabled,
    loadRegistrationStatus,
    login,
    loadAuthenticatorSetup,
    confirmAuthenticator,
    verifyAuthenticatorCode,
    verifyRecoveryCode,
    resetLoginFlow,
    tryRefresh,
    renewAccessToken,
    logout,
    onUnauthorized,
    clear,
  };
});

function mapRequestError(caught: unknown): AuthErrorCode {
  if (!(caught instanceof AuthHttpError)) return "network-failed";
  if (caught.serverCode === "AUTH_CHALLENGE_UNAVAILABLE") return "challenge-unavailable";
  if (caught.status === 429) return "rate-limited";
  return "service-unavailable";
}
