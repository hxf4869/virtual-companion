import type {
  AdvicePref,
  AvoidTopic,
  HumorLevel,
  Initiative,
  ReplyLength,
} from "@/api/relationship";

export interface PrefOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

// 后端枚举（backend/internal/httpapi/catalog.go）→ 消费者可读中文标签。
// memoryShareScope / gender / avatarRef 不在本页呈现：保存时原样回传服务端当前值。
export const REPLY_LENGTH_OPTIONS: readonly PrefOption<ReplyLength>[] = [
  { value: "SHORT", label: "简短一些" },
  { value: "MEDIUM", label: "长短适中" },
  { value: "LONG", label: "可以聊得细" },
];

export const INITIATIVE_OPTIONS: readonly PrefOption<Initiative>[] = [
  { value: "LOW", label: "安静陪伴" },
  { value: "MEDIUM", label: "偶尔主动" },
  { value: "HIGH", label: "常常主动" },
];

export const HUMOR_OPTIONS: readonly PrefOption<HumorLevel>[] = [
  { value: "NONE", label: "少开玩笑" },
  { value: "LIGHT", label: "偶尔幽默" },
  { value: "WARM", label: "温暖幽默" },
];

export const ADVICE_PREF_OPTIONS: readonly PrefOption<AdvicePref>[] = [
  { value: "ASK_FIRST", label: "先问我再建议" },
  { value: "DIRECT", label: "直接给建议" },
  { value: "RARE", label: "少给建议" },
];

export const AVOID_TOPIC_OPTIONS: readonly PrefOption<AvoidTopic>[] = [
  { value: "WORK", label: "工作" },
  { value: "FAMILY", label: "家庭" },
  { value: "HEALTH", label: "健康" },
  { value: "ROMANCE", label: "感情" },
  { value: "MONEY", label: "金钱" },
  { value: "POLITICS", label: "时政" },
  { value: "SUBSTANCE", label: "烟酒" },
  { value: "RELIGION", label: "宗教" },
];

export function labelOf<T extends string>(
  options: readonly PrefOption<T>[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
