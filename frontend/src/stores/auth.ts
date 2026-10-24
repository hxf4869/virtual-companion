// Cookie-session authentication state.
// NO token or identity field is ever written to localStorage.
// Account identity, auth challenges and first-use recovery codes are memory-only.

import { getUniApi } from "@/platform/uni-api";
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
    const uniApi = getUniApi() as
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
  // VC-R12: 身份归属代次，由新凭据提交（登录/挑战完成的 persist）、不同已知
  // 账号交接的 session 读回（R09 缓存清理同款条件）与 clear() 推进。login()
  // 入口对 refreshEpoch 的推进只是登录「意图」（作废在途恢复探测），同一会话
  // 的 GET /auth/session 读回也只是读取——两者都不构成新凭据；logout 只让位
  // 给已确立的较新会话，故以本代次为判据。
  let credentialEpoch = 0;
  let refreshInFlight: { epoch: number; promise: Promise<RefreshOutcome> } | null = null;

  const isAuthenticated = computed(() => accountId.value !== null);
  const sessionStatus = computed<SessionStatus>(() => {
    if (accountId.value) return "authenticated";
    return settled.value ? "anonymous" : "unknown";
  });

  function persist(identity: AuthSessionIdentity, newCredential = false): void {
    // Committing an identity is itself a generation boundary: any probe already
    // in flight describes the previous session and must not roll this one back.
    refreshEpoch++;
    // VC-R12: 只有新登录/挑战完成（newCredential）或不同已知账号交接（与下方
    // R09 缓存清理同款条件）才推进身份归属代次；对当前同一会话的读回
    // （accountId 不变）不构成新凭据，不得让挂起的旧登出让位。
    if (newCredential || (accountId.value !== null && accountId.value !== identity.accountId)) {
      credentialEpoch++;
    }
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
    credentialEpoch++;
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
      persist(result, true);
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
    persist(completed, true);
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

  /**
   * VC-R52 期望账号失配恢复：transport 归属成立的精确 409 +
   * ACCOUNT_CONTEXT_CHANGED 后调用（共享 cookie jar 下另一 Tab 换号，本 Tab
   * 的本地身份已不可信）。先【同步】clear()——仅本地：推进
   * refreshEpoch/credentialEpoch，作废换 Cookie 前已在途的身份探测（迟到旧
   * 探测结果按既有代次判据丢弃，tryRefresh 不会被它合并而恢复不到新账号）
   * 与旧动作的迟到收尾归属，并清共享私有缓存；绝不调用服务端 logout，不
   * 撤销任何会话。随后以 omit 头的 GET /auth/session 读取当前 Cookie 身份：
   * clear 已推进代次，tryRefresh 必然开启全新的 in-flight 探测。
   */
  async function reconcileAccountContext(t: AuthTransport): Promise<boolean> {
    clear();
    return tryRefresh(t);
  }

  async function renewAccessToken(t: AuthTransport): Promise<RefreshOutcome> {
    return refreshOnce(t);
  }

  /** Ordinary logout preserves the independent 90-day trusted-device cookie. */
  async function logout(t: AuthTransport): Promise<boolean> {
    error.value = null;
    const epoch = credentialEpoch;
    let revoked = false;
    try {
      revoked = await apiLogout(t);
    } catch {
      revoked = false;
    }
    // VC-R12: 迟到的旧登出只让位给已确立的较新会话。判据用身份归属代次
    // （credentialEpoch）：login() 入口的代次推进只是登录「意图」，登出挂起
    // 期间一次失败登录（未 persist）不算新凭据；同会话 GET /auth/session 读回
    // （accountId 不变）同样只是读取——两者都不得让旧登出跳过本地清理，否则
    // 已登录用户退不出去。只有新登录/挑战完成的 persist、不同已知账号交接的
    // 读回与 clear() 推进该代次；同 ID 重新登录经 persist 推进，因此判据也
    // 覆盖账号相同的 credential 代次切换，无需账号比较。返回 true 表示本次
    // 调用拥有本地清理并已执行；false 表示已让位给较新会话，未触碰任何状态。
    // 401/409 的 transport 身份交接（onUnauthorized / onAccountContextChanged）
    // 已先经 clear() 推进代次，因此让位判定先于失败判定，原保护不受影响。
    if (epoch !== credentialEpoch) return false;
    // VC-R164: 归属成立但服务端未确认撤销（HTTP 非 ok / 网络失败；后端 503
    // 时 cookie/会话仍有效）：清本地会谎称已退出、刷新即恢复会话。保留身份，
    // 以普通内部异常交由 UI 呈现可重试提示；不暴露原始错误。
    if (!revoked) throw new Error("logout result could not be confirmed");
    clear();
    return true;
  }

  function onUnauthorized(): void {
    clear();
    redirectToLogin();
  }

  /**
   * VC-R10: read-only session generation, for request ownership only. A 401
   * from a request that started in an older generation describes a session
   * this store no longer holds and must not sign the newer one out. It is a
   * plain counter, never a secret, never persisted, and never appears in the
   * UI, a URL, a header or a log.
   */
  function getSessionRevision(): number {
    return refreshEpoch;
  }

  /**
   * VC-R15: read-only credential-ownership epoch, for stale-success yield
   * checks only (e.g. a late password-change 200). It advances only when a
   * genuinely newer credential is committed — a login/challenge persist with
   * newCredential, a known-account handover readback — or on clear(); a failed
   * login attempt (login entry) and a same-session readback never advance it.
   * Like getSessionRevision it is a plain ownership counter: never a secret,
   * never persisted, and never exposed to the UI, a URL, a header or a log.
   */
  function getCredentialEpoch(): number {
    return credentialEpoch;
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
    reconcileAccountContext,
    renewAccessToken,
    logout,
    onUnauthorized,
    getSessionRevision,
    getCredentialEpoch,
    clear,
  };
});

function mapRequestError(caught: unknown): AuthErrorCode {
  if (!(caught instanceof AuthHttpError)) return "network-failed";
  if (caught.serverCode === "AUTH_CHALLENGE_UNAVAILABLE") return "challenge-unavailable";
  if (caught.status === 429) return "rate-limited";
  return "service-unavailable";
}
