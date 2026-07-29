import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BaselineRequestError,
  CAPABILITY_SOURCE,
  fetchBaseline,
  type BaselineFailureKind,
  type BaselinePayload,
} from "@/api/baseline";
import { useBaselineStore } from "@/stores/baseline";

vi.mock("@/api/baseline", async () => {
  const actual =
    await vi.importActual<typeof import("@/api/baseline")>("@/api/baseline");

  return {
    ...actual,
    fetchBaseline: vi.fn(),
  };
});

const mockedFetchBaseline = vi.mocked(fetchBaseline);

function validPayload(): BaselinePayload {
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

describe("useBaselineStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("publishes ready only after a verified payload", async () => {
    mockedFetchBaseline.mockResolvedValueOnce(validPayload());
    const store = useBaselineStore();

    await store.load();

    expect(store.state).toBe("ready");
    expect(store.baseline?.phase).toBe("TECHNICAL_ALPHA");
    expect(store.errorKind).toBeNull();
    expect(store.verifiedGateCount).toBe(7);
    expect(store.capabilityGates.every((gate) => gate.state === "closed")).toBe(
      true,
    );
  });

  it("clears stale success data as soon as a retry starts", async () => {
    mockedFetchBaseline.mockResolvedValueOnce(validPayload());
    const store = useBaselineStore();
    await store.load();

    let rejectRetry: (reason: BaselineRequestError) => void = () => undefined;
    mockedFetchBaseline.mockReturnValueOnce(
      new Promise<BaselinePayload>((_resolve, reject) => {
        rejectRetry = reject;
      }),
    );

    const retry = store.load();

    expect(store.state).toBe("loading");
    expect(store.baseline).toBeNull();
    expect(store.baselineText).toBe("");
    expect(store.errorKind).toBeNull();
    expect(store.verifiedGateCount).toBe(0);
    expect(
      store.capabilityGates.every((gate) => gate.state === "unverified"),
    ).toBe(true);

    rejectRetry(new BaselineRequestError("timeout", "timed out"));
    await retry;

    expect(store.state).toBe("error");
    expect(store.errorKind).toBe("timeout");
    expect(store.baseline).toBeNull();
    expect(store.verifiedGateCount).toBe(0);
  });

  it.each<BaselineFailureKind>([
    "timeout",
    "unreachable",
    "http",
    "invalid-response",
  ])("exposes %s without retaining a payload", async (kind) => {
    mockedFetchBaseline.mockRejectedValueOnce(
      new BaselineRequestError(
        kind,
        `failure:${kind}`,
        kind === "http" ? 500 : null,
      ),
    );
    const store = useBaselineStore();

    await store.load();

    expect(store.state).toBe("error");
    expect(store.errorKind).toBe(kind);
    expect(store.errorMessage).toBe(`failure:${kind}`);
    expect(store.baseline).toBeNull();
    expect(store.verifiedGateCount).toBe(0);
  });

  it("fails closed for an unknown thrown value", async () => {
    mockedFetchBaseline.mockRejectedValueOnce("unexpected");
    const store = useBaselineStore();

    await store.load();

    expect(store.state).toBe("error");
    expect(store.errorKind).toBe("invalid-response");
    expect(store.baseline).toBeNull();
    expect(store.verifiedGateCount).toBe(0);
  });
});
