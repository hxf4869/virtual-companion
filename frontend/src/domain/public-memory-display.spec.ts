import { describe, expect, it } from "vitest";

import { publicMemoryScopeLabel, publicMemoryStatusLabel } from "./public-memory-display";

describe("public memory display", () => {
  it("maps approved codes to friendly labels", () => {
    expect(publicMemoryScopeLabel("RELATIONSHIP")).toBe("当前角色专属");
    expect(publicMemoryScopeLabel("SESSION")).toBe("当前会话");
    expect(publicMemoryStatusLabel("ACCEPTED")).toBe("已保存");
    expect(publicMemoryStatusLabel("PENDING_CONFIRMATION")).toBe("待确认");
  });

  it("never echoes an unknown internal code", () => {
    expect(publicMemoryScopeLabel("INTERNAL_SCOPE_X")).toBe("其他范围");
    expect(publicMemoryStatusLabel("INTERNAL_STATUS_X")).toBe("其他状态");
  });
});
