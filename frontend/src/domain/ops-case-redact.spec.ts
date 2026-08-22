import { describe, expect, it } from "vitest";

import { redactOpsCase } from "./ops-case-redact";

describe("redactOpsCase", () => {
  it("keeps public fields and drops body/providerRef/internal notes", () => {
    const row = redactOpsCase({
      id: "3",
      kind: "REPORT",
      sourceOwnerId: "7",
      sourceId: "9",
      status: "OPEN",
      severity: "P2",
      publicNote: "可对用户展示",
      dispositionReason: "",
      openedAt: "2026-08-23T00:00:00Z",
      internalNote: "secret-operator-memo",
      providerRef: "alpha-simulated",
      body: "用户聊天原文",
      note: "举报摘录",
    });
    expect(row).toEqual({
      id: "3",
      kind: "REPORT",
      sourceOwnerId: "7",
      sourceId: "9",
      status: "OPEN",
      severity: "P2",
      slaHours: undefined,
      assigneeAccountId: undefined,
      dispositionReason: "",
      publicNote: "可对用户展示",
      openedAt: "2026-08-23T00:00:00Z",
    });
    expect(JSON.stringify(row)).not.toContain("secret-operator-memo");
    expect(JSON.stringify(row)).not.toContain("alpha-simulated");
    expect(JSON.stringify(row)).not.toContain("用户聊天原文");
    expect(JSON.stringify(row)).not.toContain("举报摘录");
  });

  it("rejects incomplete rows", () => {
    expect(redactOpsCase({ id: "1" })).toBeNull();
  });
});
