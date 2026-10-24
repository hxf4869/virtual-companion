// G9 / ADR-0007: cookie-session H5 transport. The opaque vc_session cookie is
// HttpOnly and travels with credentials:"include". State-changing requests
// send the double-submit X-CSRF-Token header. There is no Bearer JWT and no
// /auth/refresh replay chain. 401 clears the local session.

import type { AuthTransport, AuthApiResponse } from "@/api/auth";
import { rememberRequestIdFromResponse } from "@/domain/request-id";

export type RenewResult = "renewed" | "rejected" | "unavailable";

/**
 * Per-request options for bounded, non-streaming requests. SSE streams are
 * opened through the realtime transport and must never receive a total-duration
 * timeout: a short deadline would truncate long replies.
 */
export interface TransportRequestOptions {
  /** Abort the request after this many ms; the result is then UNKNOWN. */
  timeoutMs?: number;
  /** When true, a 401 response does not invoke provider.onUnauthorized;
   * the caller owns interpreting the unauthorized result. */
  callerHandlesUnauthorized?: boolean;
  /** VC-R52: when true the request omits X-VC-Expected-Account-ID even when
   * the page knows an account. Reserved for identity discovery
   * (GET /api/v1/auth/session): it must read the current cookie identity
   * without the expected-account precondition, otherwise a page holding a
   * stale account could never discover the newer cookie account (409 loop).
   * VC-R169: the same discovery also omits the expected-session header —
   * the option covers both expected-identity headers. */
  omitExpectedAccount?: boolean;
}

/** A request that exceeded its per-request timeout; the server outcome is unknown. */
export class TransportTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`request timed out after ${timeoutMs}ms`);
    this.name = "TransportTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface AuthTokenProvider {
  getAccessToken?(): string | null;
  renewAccessToken?(): Promise<RenewResult>;
  /** Current session revision; used only for 401 ownership attribution. */
  getSessionRevision?(): number;
  /** VC-R52: account the page currently believes is signed in. Captured once
   * per request entry (with the revision) as the expected-account
   * precondition; never re-read mid-flight and never derived from cookies. */
  getAccountId?(): string | null;
  /** VC-R169: session id the page committed to when its identity was
   * established. REQUIRED so a provider that forgets it fails type-check;
   * captured once per request entry (with the account) as the expected-session
   * precondition; null while the page holds no established identity. */
  getSessionId(): string | null;
  onUnauthorized(): void;
  /** VC-R52: the server rejected the request because the cookie identity no
   * longer matches the page's expected account (precise 409 + body code
   * ACCOUNT_CONTEXT_CHANGED) while the request still owns the current session
   * revision. The response is still returned to the caller unchanged. */
  onAccountContextChanged?(): void;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE = "vc_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const EXPECTED_ACCOUNT_HEADER = "X-VC-Expected-Account-ID";
const EXPECTED_SESSION_HEADER = "X-VC-Expected-Session-ID";
const ACCOUNT_CONTEXT_CHANGED_CODE = "ACCOUNT_CONTEXT_CHANGED";

/** 精确的服务端拒绝形态：HTTP 409 + 错误信封 code === ACCOUNT_CONTEXT_CHANGED。 */
function isAccountContextChangedStatus(status: number, json: unknown): boolean {
  return status === 409
    && Boolean(
      json
        && typeof json === "object"
        && (json as Record<string, unknown>).code === ACCOUNT_CONTEXT_CHANGED_CODE,
    );
}

/**
 * Current double-submit CSRF cookie, or null when there is none. Exported
 * only so a caller can compare the value before and after an awaited user
 * confirmation (VC-R39): the opaque session cookie is HttpOnly, so this is
 * the one credential the page can see rotate when another tab logs in. The
 * value must be held in memory only and never persisted, logged or shown.
 */
export function readCsrfCookie(): string | null {
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
  async function request(
    method: string,
    path: string,
    body?: unknown,
    opts?: TransportRequestOptions,
  ): Promise<AuthApiResponse> {
    // 请求所有权（401 归属）：在每次调用发起时捕获会话代次，而不是在工厂
    // 创建时捕获。A 的在途请求遇 B 新登录后，旧 A 的 401 不得清掉 B 的会话。
    const revision = provider.getSessionRevision?.();
    // VC-R52 期望账号前置条件：与 revision 同一处入口同步捕获一次。绝不
    // 临发前读取当前 Cookie 账号——旧意图必须原样到达服务器，由服务器判定
    // 身份是否已经变化；omitExpectedAccount 只保留给身份发现入口。
    const expectedAccount = opts?.omitExpectedAccount === true
      ? null
      : (provider.getAccountId?.() ?? null);
    // VC-R169: captured once per call entry with the same ownership rules as
    // the account header — never re-read mid-flight.
    const expectedSession = opts?.omitExpectedAccount === true
      ? null
      : provider.getSessionId();
    // 归属成立的期望账号失配拒绝才上报：迟到旧意图（代次已推进）的 409
    // 不得触碰已确立的较新会话。复用 401 的归属判定形态。
    const reportAccountContextChange = (status: number, json: unknown): void => {
      if (
        isAccountContextChangedStatus(status, json)
        && (revision === undefined || provider.getSessionRevision?.() === revision)
      ) {
        provider.onAccountContextChanged?.();
      }
    };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (expectedAccount !== null) {
      headers[EXPECTED_ACCOUNT_HEADER] = expectedAccount;
    }
    if (expectedSession !== null) {
      headers[EXPECTED_SESSION_HEADER] = expectedSession;
    }
    if (STATE_CHANGING_METHODS.has(method)) {
      const csrf = readCsrfCookie();
      if (csrf) {
        headers[CSRF_HEADER] = csrf;
      }
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let response: Response;
    if (opts?.timeoutMs !== undefined) {
      const timeoutMs = opts.timeoutMs;
      const controller = new AbortController();
      let timedOut = false;
      // 缺陷10：定时器覆盖完整请求生命周期——从发起 fetch 到正文读取完成。
      // 服务器发完响应头却不发正文时 response.json() 会永久挂起；超时到点
      // 除中止整个请求外，还唤醒可能在正文阶段挂起的等待，使整个请求以
      // 超时（结果未知）失败。SSE 流走 realtime transport 的裸 fetch，不经
      // 此路径，因此不受总时长限制影响。
      let wakeBody: (() => void) | undefined;
      const bodyGate = new Promise<void>((resolve) => {
        wakeBody = resolve;
      });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        wakeBody?.();
      }, timeoutMs);
      try {
        try {
          response = await fetch(path, {
            method,
            headers,
            credentials: "include",
            body: payload,
            signal: controller.signal,
          });
        } catch (error) {
          if (timedOut) {
            throw new TransportTimeoutError(timeoutMs);
          }
          throw error;
        }
        rememberRequestIdFromResponse(response);
        if (
          response.status === 401 &&
          opts?.callerHandlesUnauthorized !== true &&
          (revision === undefined || provider.getSessionRevision?.() === revision)
        ) {
          provider.onUnauthorized();
        }
        // 正文读取与超时竞争：超时触发（gate 唤醒）或超时中止导致 json()
        // reject 时，都按结果未知的超时错误处理；非超时的解析失败保持既有
        // 语义（parseFailed）。
        const settled = await Promise.race([
          response.json().then(
            (value: unknown) => ({ timedOut: false, value, failed: false }),
            () => ({ timedOut, value: null, failed: true }),
          ),
          bodyGate.then(() => ({ timedOut: true, value: null, failed: true })),
        ]);
        if (settled.timedOut) {
          // timedOut 只能由上方 timer 回调置位。
          throw new TransportTimeoutError(timeoutMs);
        }
        // 响应照常返回给调用方；钩子只负责页面侧的身份 reconcile。
        reportAccountContextChange(response.status, settled.value);
        return {
          ok: response.ok,
          status: response.status,
          json: settled.value,
          parseFailed: settled.failed,
        };
      } finally {
        // 成功/失败/超时各路径都清定时器，无泄漏。
        clearTimeout(timer);
      }
    } else {
      response = await fetch(path, {
        method,
        headers,
        credentials: "include",
        body: payload,
      });
    }
    rememberRequestIdFromResponse(response);
    if (
      response.status === 401 &&
      opts?.callerHandlesUnauthorized !== true &&
      (revision === undefined || provider.getSessionRevision?.() === revision)
    ) {
      provider.onUnauthorized();
    }
    let parseFailed = false;
    const json: unknown = await response.json().catch(() => {
      parseFailed = true;
      return null;
    });
    // 响应照常返回给调用方；钩子只负责页面侧的身份 reconcile。
    reportAccountContextChange(response.status, json);
    return { ok: response.ok, status: response.status, json, parseFailed };
  }

  return { request };
}
