import { describe, expect, it } from "vitest";

import {
  CAPABILITY_SOURCE,
  type BaselineCapabilities,
} from "@/api/baseline";
import {
  CAPABILITY_GATE_DEFINITIONS,
  mapCapabilityGates,
} from "@/domain/capability-gates";

function closedCapabilities(): BaselineCapabilities {
  return {
    source: CAPABILITY_SOURCE,
    publicRegistrationEnabled: false,
    paymentEnabled: false,
    romanceModeEnabled: false,
    voiceEnabled: false,
    imageEnabled: false,
    websocketEnabled: false,
    betaGenerationEnabledByDefault: false,
  };
}

describe("mapCapabilityGates", () => {
  it("maps the seven verified false values to closed cards", () => {
    const gates = mapCapabilityGates(closedCapabilities());

    expect(gates).toHaveLength(7);
    expect(gates.every((gate) => gate.state === "closed")).toBe(true);
    expect(gates.every((gate) => gate.statusLabel === "已验证关闭")).toBe(true);
    expect(gates.map((gate) => gate.label)).toEqual([
      "公开注册",
      "真实支付",
      "浪漫模式",
      "语音能力",
      "图片能力",
      "WebSocket",
      "Beta 默认生成",
    ]);
  });

  it("keeps every card unverified and closed by policy without a payload", () => {
    const gates = mapCapabilityGates(null);

    expect(gates).toHaveLength(7);
    expect(gates.every((gate) => gate.state === "unverified")).toBe(true);
    expect(
      gates.every((gate) => gate.statusLabel === "未验证 · 按关闭处理"),
    ).toBe(true);
  });

  it("does not mutate the canonical definitions", () => {
    const before = JSON.stringify(CAPABILITY_GATE_DEFINITIONS);

    mapCapabilityGates(closedCapabilities());

    expect(JSON.stringify(CAPABILITY_GATE_DEFINITIONS)).toBe(before);
  });
});
