import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BASELINE_ENDPOINT,
  BASELINE_TIMEOUT_MS,
  BaselineRequestError,
  CAPABILITY_SOURCE,
  fetchBaseline,
  parseBaselinePayload,
} from "@/api/baseline";

interface RequestCallbacks {
  url: string;
  method: string;
  timeout: number;
  success: (response: { statusCode: number; data: unknown }) => void;
  fail: (error: { errMsg: string }) => void;
}

function validPayload(): Record<string, unknown> {
  return {
    application: "virtual-companion-runtime",
    phase: "TECHNICAL_ALPHA",
    transport: "HTTP_SSE",
    technology: {
      javaVersion: "25",
      springBootVersion: "4.1.0",
      springAiVersion: "2.0.0",
      springModulithVersion: "2.1.0",
    },
    catalogs: {
      source: "specs/generated/java",
      riskLevels: ["LOW"],
      generationStates: ["CREATED"],
      memoryScopes: ["SESSION"],
      modelProtocols: ["OPENAI_COMPATIBLE"],
      serviceModes: ["ZERO_LLM"],
    },
    capabilities: {
      source: CAPABILITY_SOURCE,
      publicRegistrationEnabled: false,
      paymentEnabled: false,
      romanceModeEnabled: false,
      voiceEnabled: false,
      imageEnabled: false,
      websocketEnabled: false,
      betaGenerationEnabledByDefault: false,
    },
  };
}

function capabilitiesOf(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.capabilities as Record<string, unknown>;
}

function expectInvalidResponse(payload: unknown): void {
  try {
    parseBaselinePayload(payload);
    throw new Error("expected parseBaselinePayload to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(BaselineRequestError);
    expect(error).toMatchObject({ kind: "invalid-response" });
  }
}

describe("parseBaselinePayload", () => {
  it("accepts and whitelists the Technical Alpha projection", () => {
    const payload = validPayload();
    payload.unexpectedRootField = "discard me";
    capabilitiesOf(payload).unexpectedCapability = false;

    const parsed = parseBaselinePayload(payload);

    expect(parsed.phase).toBe("TECHNICAL_ALPHA");
    expect(parsed.transport).toBe("HTTP_SSE");
    expect(parsed.capabilities).toEqual({
      source: CAPABILITY_SOURCE,
      publicRegistrationEnabled: false,
      paymentEnabled: false,
      romanceModeEnabled: false,
      voiceEnabled: false,
      imageEnabled: false,
      websocketEnabled: false,
      betaGenerationEnabledByDefault: false,
    });
    expect(parsed).not.toHaveProperty("unexpectedRootField");
    expect(parsed.capabilities).not.toHaveProperty("unexpectedCapability");
  });

  it.each([
    "publicRegistrationEnabled",
    "paymentEnabled",
    "romanceModeEnabled",
    "voiceEnabled",
    "imageEnabled",
    "websocketEnabled",
    "betaGenerationEnabledByDefault",
  ])("rejects a missing %s gate", (key) => {
    const payload = validPayload();
    delete capabilitiesOf(payload)[key];

    expectInvalidResponse(payload);
  });

  it("rejects a non-boolean gate", () => {
    const payload = validPayload();
    capabilitiesOf(payload).voiceEnabled = "false";

    expectInvalidResponse(payload);
  });

  it("rejects an unexpectedly enabled gate", () => {
    const payload = validPayload();
    capabilitiesOf(payload).paymentEnabled = true;

    expectInvalidResponse(payload);
  });

  it.each([
    ["phase", "CONTROLLED_BETA"],
    ["transport", "WEBSOCKET"],
  ])("rejects a drifted %s", (field, value) => {
    const payload = validPayload();
    payload[field] = value;

    expectInvalidResponse(payload);
  });

  it("rejects a different capability source", () => {
    const payload = validPayload();
    capabilitiesOf(payload).source = "handwritten";

    expectInvalidResponse(payload);
  });
});

describe("fetchBaseline", () => {
  const request = vi.fn<(options: RequestCallbacks) => void>();

  beforeEach(() => {
    vi.stubGlobal("uni", { request });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the internal endpoint and resolves a verified response", async () => {
    request.mockImplementationOnce((options) => {
      expect(options.url).toBe(BASELINE_ENDPOINT);
      expect(options.method).toBe("GET");
      expect(options.timeout).toBe(BASELINE_TIMEOUT_MS);
      options.success({ statusCode: 200, data: validPayload() });
    });

    await expect(fetchBaseline()).resolves.toMatchObject({
      phase: "TECHNICAL_ALPHA",
      transport: "HTTP_SSE",
    });
  });

  it("exposes non-2xx responses as http failures", async () => {
    request.mockImplementationOnce((options) => {
      options.success({ statusCode: 503, data: { message: "offline" } });
    });

    await expect(fetchBaseline()).rejects.toMatchObject({
      kind: "http",
      statusCode: 503,
    });
  });

  it("exposes request timeouts separately", async () => {
    request.mockImplementationOnce((options) => {
      options.fail({ errMsg: "request:fail timeout" });
    });

    await expect(fetchBaseline()).rejects.toMatchObject({
      kind: "timeout",
      statusCode: null,
    });
  });

  it("exposes other network failures as unreachable", async () => {
    request.mockImplementationOnce((options) => {
      options.fail({ errMsg: "request:fail connection refused" });
    });

    await expect(fetchBaseline()).rejects.toMatchObject({
      kind: "unreachable",
      statusCode: null,
    });
  });

  it("exposes malformed 2xx data as invalid-response", async () => {
    request.mockImplementationOnce((options) => {
      options.success({ statusCode: 200, data: { phase: "TECHNICAL_ALPHA" } });
    });

    await expect(fetchBaseline()).rejects.toMatchObject({
      kind: "invalid-response",
      statusCode: null,
    });
  });
});
