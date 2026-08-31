import { describe, expect, it } from "vitest";

import { resolveNextStep } from "./next-step";

const READY = {
  authenticated: true,
  ageKnown: true,
  ageState: "ADULT_VERIFIED",
  consentKnown: true,
  grantedTypes: [
    "SERVICE_TERMS",
    "PRIVACY_POLICY",
    "AI_CONTENT_NOTICE",
    "THIRD_PARTY_MODEL_PROCESSING",
    "SENSITIVE_DATA_PROCESSING",
  ],
  hasCompanion: true,
} as const;

describe("resolveNextStep (§8.1 first-run)", () => {
  it("sends an anonymous visitor to login", () => {
    const step = resolveNextStep({ ...READY, authenticated: false });
    expect(step.kind).toBe("login");
    expect(step.href).toBe("/pages/login/login");
  });

  it("asks for adult verification before consents or a companion", () => {
    const step = resolveNextStep({
      ...READY,
      ageState: "AGE_UNKNOWN",
      hasCompanion: false,
      grantedTypes: [],
    });
    expect(step.kind).toBe("age");
    expect(step.href).toBe("/pages/age/age");
    expect(step.copy).toContain("成年核验");
  });

  it("skips age when the age endpoint did not confirm a reading", () => {
    const step = resolveNextStep({
      ...READY,
      ageKnown: false,
      ageState: "AGE_UNKNOWN",
      hasCompanion: false,
    });
    expect(step.kind).toBe("companion");
  });

  it("asks for the required service consents after age is verified", () => {
    const step = resolveNextStep({
      ...READY,
      grantedTypes: ["SERVICE_TERMS"],
    });
    expect(step.kind).toBe("consent");
    expect(step.href).toBe("/pages/consent/consent");
    expect(step.copy).toContain("协议");
  });

  it("keeps the consent step until model and sensitive-data processing are granted", () => {
    const step = resolveNextStep({
      ...READY,
      grantedTypes: ["SERVICE_TERMS", "PRIVACY_POLICY", "AI_CONTENT_NOTICE"],
    });

    expect(step.kind).toBe("consent");
    expect(step.copy).toContain("模型处理");
  });

  it("points to the unified companion creation flow when no companion exists", () => {
    const step = resolveNextStep({ ...READY, hasCompanion: false });
    expect(step.kind).toBe("companion");
    expect(step.href).toBe("/pages/companion/companion");
    expect(step.copy).toContain("还没有陪伴");
  });

  it("offers to resume chat when the first-run checklist is complete", () => {
    const step = resolveNextStep(READY);
    expect(step.kind).toBe("ready");
    expect(step.href).toBe("/pages/chat/chat");
  });
});
