// S0-21: shared idle/loading/ready/partial/error. Failures keep previous data
// and never look like an empty success.

import { lastRequestId } from "./request-id";

export type AsyncStatus = "idle" | "loading" | "ready" | "partial" | "error";

export interface AsyncState {
  status: AsyncStatus;
  stale: boolean;
  failedDomains: string[];
  requestId: string | null;
}

export const IDLE_ASYNC: AsyncState = {
  status: "idle",
  stale: false,
  failedDomains: [],
  requestId: null,
};

export function beginAsync(prev: AsyncState): AsyncState {
  return {
    ...prev,
    status: "loading",
    stale: prev.status === "ready" || prev.status === "partial",
  };
}

export function markSuccess(): AsyncState {
  return {
    status: "ready",
    stale: false,
    failedDomains: [],
    requestId: lastRequestId(),
  };
}

export function markFailure(
  prev: AsyncState,
  domain: string,
  hadExistingData: boolean,
): AsyncState {
  const failedDomains = [...new Set([...prev.failedDomains, domain])];
  return {
    status: hadExistingData ? "partial" : "error",
    stale: hadExistingData,
    failedDomains,
    requestId: lastRequestId(),
  };
}

export function markPartial(failedDomains: string[]): AsyncState {
  return {
    status: "partial",
    stale: true,
    failedDomains: [...failedDomains],
    requestId: lastRequestId(),
  };
}
