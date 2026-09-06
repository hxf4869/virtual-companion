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
  async function request(
    method: string,
    path: string,
    body?: unknown,
    opts?: TransportRequestOptions,
  ): Promise<AuthApiResponse> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
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
        if (response.status === 401) {
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
    if (response.status === 401) {
      provider.onUnauthorized();
    }
    let parseFailed = false;
    const json: unknown = await response.json().catch(() => {
      parseFailed = true;
      return null;
    });
    return { ok: response.ok, status: response.status, json, parseFailed };
  }

  return { request };
}
