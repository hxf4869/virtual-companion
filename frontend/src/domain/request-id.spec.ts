import { beforeEach, describe, expect, it } from "vitest";

import {
  lastRequestId,
  rememberRequestId,
  rememberRequestIdFromResponse,
  requestIdLabel,
} from "./request-id";

describe("request-id display (FR-CHAT-001)", () => {
  beforeEach(() => {
    rememberRequestId(null);
  });

  it("remembers a non-empty X-Request-Id from a response header", () => {
    rememberRequestIdFromResponse({
      headers: { get: (name: string) => (name === "X-Request-Id" ? "req-abc" : null) },
    });
    expect(lastRequestId()).toBe("req-abc");
    expect(requestIdLabel()).toBe("请求号 req-abc");
  });

  it("ignores missing or blank headers and keeps the previous id", () => {
    rememberRequestId("keep-me");
    rememberRequestIdFromResponse({ headers: { get: () => "  " } });
    rememberRequestIdFromResponse({});
    expect(lastRequestId()).toBe("keep-me");
  });
});
