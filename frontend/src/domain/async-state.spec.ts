import { describe, expect, it } from "vitest";

import { rememberRequestId } from "./request-id";
import {
  IDLE_ASYNC,
  beginAsync,
  markFailure,
  markPartial,
  markSuccess,
} from "./async-state";

describe("async-state", () => {
  it("starts idle and becomes loading without claiming ready", () => {
    const loading = beginAsync(IDLE_ASYNC);
    expect(loading.status).toBe("loading");
    expect(loading.stale).toBe(false);
  });

  it("keeps previous data as stale when a later load starts", () => {
    const ready = markSuccess();
    const loading = beginAsync(ready);
    expect(loading.status).toBe("loading");
    expect(loading.stale).toBe(true);
  });

  it("records a request id on failure and uses partial when data already exists", () => {
    rememberRequestId("req-async-1");
    const failedFresh = markFailure(IDLE_ASYNC, "memory", false);
    expect(failedFresh.status).toBe("error");
    expect(failedFresh.stale).toBe(false);
    expect(failedFresh.failedDomains).toEqual(["memory"]);
    expect(failedFresh.requestId).toBe("req-async-1");

    const failedExisting = markFailure(markSuccess(), "reminder", true);
    expect(failedExisting.status).toBe("partial");
    expect(failedExisting.stale).toBe(true);
    expect(failedExisting.failedDomains).toContain("reminder");
    rememberRequestId(null);
  });

  it("marks named domains as partial success", () => {
    rememberRequestId("req-async-2");
    const partial = markPartial(["memory"]);
    expect(partial.status).toBe("partial");
    expect(partial.stale).toBe(true);
    expect(partial.failedDomains).toEqual(["memory"]);
    expect(partial.requestId).toBe("req-async-2");
    rememberRequestId(null);
  });
});
