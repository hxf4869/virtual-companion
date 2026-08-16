// CONSENT (FR-AUTH-003): store unit tests — loads only mutate on confirmed
// API results; failed grants/revokes never fake state.
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ConsentHttpError,
  type ConsentRecord,
  type ConsentTransport,
} from "@/api/consent";
import { CONSENT_OPTIONS, useConsentStore } from "@/stores/consent";

const TERMS: ConsentRecord = {
  consentId: "12",
  consentType: "SERVICE_TERMS",
  version: "2026-08",
  granted: true,
  grantedAt: "2026-08-15T08:00:00Z",
};

const TRAINING: ConsentRecord = {
  consentId: "13",
  consentType: "MODEL_TRAINING",
  version: "2026-08",
  granted: false,
  grantedAt: "2026-08-15T09:00:00Z",
};

function mockTransport(
  opts: { listJson?: unknown; putOk?: boolean; putJson?: unknown } = {},
): ConsentTransport {
  return {
    async request(
      method: string,
    ): Promise<{ ok: boolean; status: number; json: unknown }> {
      if (method === "GET") {
        return { ok: true, status: 200, json: opts.listJson ?? [] };
      }
      const ok = opts.putOk ?? true;
      return { ok, status: ok ? 200 : 500, json: ok ? (opts.putJson ?? TRAINING) : null };
    },
  };
}

describe("useConsentStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("catalogues all eight consent types with the training-withdrawal note", () => {
    expect(CONSENT_OPTIONS).toHaveLength(8);
    expect(CONSENT_OPTIONS.map((o) => o.type)).toEqual([
      "SERVICE_TERMS",
      "PRIVACY_POLICY",
      "AI_CONTENT_NOTICE",
      "THIRD_PARTY_MODEL_PROCESSING",
      "SENSITIVE_DATA_PROCESSING",
      "EMERGENCY_CONTACT",
      "MODEL_TRAINING",
      "PUSH_NOTIFICATION",
    ]);
    expect(CONSENT_OPTIONS.find((o) => o.type === "MODEL_TRAINING")?.note).toContain(
      "撤回不影响基本聊天",
    );
  });

  it("loads the effective records and resolves granted state", async () => {
    const store = useConsentStore();
    await store.load(mockTransport({ listJson: [TERMS, TRAINING] }));

    expect(store.records).toHaveLength(2);
    expect(store.grantedFor("SERVICE_TERMS")).toBe(true);
    expect(store.grantedFor("MODEL_TRAINING")).toBe(false);
    expect(store.grantedFor("PUSH_NOTIFICATION")).toBeUndefined();
  });

  it("replaces the effective row and records lastAction only on a confirmed result", async () => {
    const store = useConsentStore();
    await store.load(mockTransport({ listJson: [TRAINING] }));

    const confirmed: ConsentRecord = {
      ...TRAINING,
      granted: true,
      grantedAt: "2026-08-16T10:00:00Z",
    };
    expect(
      await store.setConsent(
        mockTransport({ putJson: confirmed }),
        "MODEL_TRAINING",
        "2026-08",
        true,
      ),
    ).toBe(true);

    expect(store.records).toHaveLength(1);
    expect(store.grantedFor("MODEL_TRAINING")).toBe(true);
    expect(store.lastAction).toEqual({ type: "MODEL_TRAINING", granted: true });
  });

  it("rejects a failed grant without faking state", async () => {
    const store = useConsentStore();
    await store.load(mockTransport({ listJson: [TRAINING] }));

    await expect(
      store.setConsent(mockTransport({ putOk: false }), "MODEL_TRAINING", "2026-08", true),
    ).rejects.toBeInstanceOf(ConsentHttpError);

    expect(store.grantedFor("MODEL_TRAINING")).toBe(false);
    expect(store.busy).toBe(false);
  });

  it("returns false when the confirmed body cannot be parsed and keeps rows", async () => {
    const store = useConsentStore();
    await store.load(mockTransport({ listJson: [TRAINING] }));

    expect(
      await store.setConsent(
        mockTransport({ putJson: { consentId: 1 } }),
        "MODEL_TRAINING",
        "2026-08",
        true,
      ),
    ).toBe(false);
    expect(store.grantedFor("MODEL_TRAINING")).toBe(false);
    expect(store.lastAction).toBeNull();
  });

  it("flags load failures and keeps rows empty", async () => {
    const store = useConsentStore();
    const failing: ConsentTransport = {
      async request() {
        return { ok: false, status: 500, json: null };
      },
    };

    await store.load(failing);

    expect(store.loadFailed).toBe(true);
    expect(store.records).toHaveLength(0);
  });
});
