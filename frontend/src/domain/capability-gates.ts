import type { BaselineCapabilities } from "@/api/baseline";

export type CapabilityGateKey = Exclude<keyof BaselineCapabilities, "source">;
export type CapabilityGateState = "closed" | "unverified";

export interface CapabilityGateDefinition {
  key: CapabilityGateKey;
  label: string;
  boundary: string;
}

export interface CapabilityGateView extends CapabilityGateDefinition {
  state: CapabilityGateState;
  statusLabel: string;
}

export const CAPABILITY_GATE_DEFINITIONS: readonly CapabilityGateDefinition[] = [
  {
    key: "publicRegistrationEnabled",
    label: "公开注册",
    boundary: "真实用户入口不开放",
  },
  {
    key: "paymentEnabled",
    label: "真实支付",
    boundary: "支付路径不开放",
  },
  {
    key: "romanceModeEnabled",
    label: "浪漫模式",
    boundary: "浪漫互动不开放",
  },
  {
    key: "voiceEnabled",
    label: "语音能力",
    boundary: "语音交互不开放",
  },
  {
    key: "imageEnabled",
    label: "图片能力",
    boundary: "图片能力不开放",
  },
  {
    key: "websocketEnabled",
    label: "WebSocket",
    boundary: "实时通道不开放",
  },
  {
    key: "betaGenerationEnabledByDefault",
    label: "Beta 默认生成",
    boundary: "不会默认开启生成",
  },
];

export function mapCapabilityGates(
  capabilities: BaselineCapabilities | null,
): CapabilityGateView[] {
  return CAPABILITY_GATE_DEFINITIONS.map((definition) => {
    const isVerifiedClosed =
      capabilities !== null && capabilities[definition.key] === false;

    return {
      ...definition,
      state: isVerifiedClosed ? "closed" : "unverified",
      statusLabel: isVerifiedClosed ? "已验证关闭" : "未验证 · 按关闭处理",
    };
  });
}
