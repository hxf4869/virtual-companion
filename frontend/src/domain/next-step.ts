// §8.1 first-run: login → age → required consents → companion → chat.
// Missing age/consent readings do not invent a blocker.

export const REQUIRED_CONSENT_TYPES = [
  "SERVICE_TERMS",
  "PRIVACY_POLICY",
  "AI_CONTENT_NOTICE",
] as const;

export type NextStepKind = "login" | "age" | "consent" | "companion" | "ready";

export interface NextStep {
  kind: NextStepKind;
  href: string;
  copy: string;
  action: string;
}

export interface NextStepInput {
  authenticated: boolean;
  ageKnown: boolean;
  ageState: string | null;
  consentKnown: boolean;
  grantedTypes: ReadonlyArray<string>;
  hasCompanion: boolean;
}

export function resolveNextStep(input: NextStepInput): NextStep {
  if (!input.authenticated) {
    return {
      kind: "login",
      href: "/pages/login/login",
      copy: "先登录内部账号",
      action: "去登录",
    };
  }
  if (input.ageKnown && input.ageState !== "ADULT_VERIFIED") {
    return {
      kind: "age",
      href: "/pages/age/age",
      copy: "还没有完成成年核验",
      action: "去核验",
    };
  }
  if (input.consentKnown) {
    const granted = new Set(input.grantedTypes);
    const missing = REQUIRED_CONSENT_TYPES.some((type) => !granted.has(type));
    if (missing) {
      return {
        kind: "consent",
        href: "/pages/consent/consent",
        copy: "还需要确认服务协议和隐私说明",
        action: "去确认",
      };
    }
  }
  if (!input.hasCompanion) {
    return {
      kind: "companion",
      // 前端产品化重构：唯一的关系创建流程落在陪伴设置页；聊天空态只
      // 跳转到这里，不再复制一套创建表单。
      href: "/pages/companion/companion",
      copy: "还没有陪伴，先创建一个",
      action: "去创建",
    };
  }
  return {
    kind: "ready",
    href: "/pages/chat/chat",
    copy: "可以继续上次的对话",
    action: "去聊天",
  };
}
