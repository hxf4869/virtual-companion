import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { AgeHttpError, type AgeApiResponse, type AgeTransport } from "@/api/age";
import { useAgeStore } from "./age";

function mockTransport(opts: {
  getJson?: unknown;
  getStatus?: number;
  postJson?: unknown;
  postStatus?: number;
}): AgeTransport & { posts: number } {
  let posts = 0;
  return {
    async request(method: string): Promise<AgeApiResponse> {
      if (method === "GET") {
        const status = opts.getStatus ?? 200;
        return { ok: status === 200, status, json: status === 200 ? opts.getJson : null };
      }
      posts += 1;
      const status = opts.postStatus ?? 200;
      return { ok: status === 200, status, json: status === 200 ? opts.postJson : null };
    },
    get posts() {
      return posts;
    },
  } as AgeTransport & { posts: number };
}

describe("useAgeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads the effective state without inventing a verified result", async () => {
    const store = useAgeStore();
    await store.load(mockTransport({ getJson: { ageState: "AGE_UNKNOWN" } }));

    expect(store.ageState).toBe("AGE_UNKNOWN");
    expect(store.canVerify).toBe(true);
    expect(store.blocked).toBe(false);
    expect(store.label).toBe("尚未核验");
  });

  it("updates only after a confirmed verification", async () => {
    const store = useAgeStore();
    await store.load(mockTransport({ getJson: { ageState: "AGE_UNKNOWN" } }));
    const transport = mockTransport({
      postJson: { ageState: "ADULT_VERIFIED", providerRef: "alpha-simulated", verifiedAt: "2026-08-18T00:00:00Z" },
    });

    const ok = await store.runVerification(transport);

    expect(ok).toBe(true);
    expect(store.ageState).toBe("ADULT_VERIFIED");
    expect(store.record.providerRef).toBe("alpha-simulated");
    expect(store.canVerify).toBe(false);
  });

  it("does not POST when the catalog state is blocked", async () => {
    const store = useAgeStore();
    await store.load(mockTransport({ getJson: { ageState: "MINOR_SUSPECTED" } }));
    const transport = mockTransport({
      postJson: { ageState: "ADULT_VERIFIED" },
    });

    const ok = await store.runVerification(transport);

    expect(ok).toBe(false);
    expect(transport.posts).toBe(0);
    expect(store.ageState).toBe("MINOR_SUSPECTED");
    expect(store.blocked).toBe(true);
  });

  it("keeps the previous state when verification fail-closes", async () => {
    const store = useAgeStore();
    await store.load(mockTransport({ getJson: { ageState: "AGE_UNKNOWN" } }));

    await expect(
      store.runVerification(mockTransport({ postStatus: 400 })),
    ).rejects.toBeInstanceOf(AgeHttpError);
    expect(store.ageState).toBe("AGE_UNKNOWN");
  });
});

describe("useAgeStore appeals (AGE-APPEAL)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function appealTransport(opts: {
    appealJson?: unknown;
    appealOk?: boolean;
    listJson?: unknown;
  } = {}): AgeTransport {
    return {
      async request(method: string, path: string): Promise<AgeApiResponse> {
        if (method === "POST" && path === "/api/v1/age/appeal") {
          const ok = opts.appealOk ?? true;
          return { ok, status: ok ? 200 : 400, json: ok ? opts.appealJson : null };
        }
        if (method === "GET" && path === "/api/v1/age/appeals") {
          return { ok: true, status: 200, json: opts.listJson ?? [] };
        }
        return { ok: true, status: 200, json: null };
      },
    };
  }

  it("offers the appeal form only from catalog-appealable states", async () => {
    const store = useAgeStore();
    await store.load(mockTransport({ getJson: { ageState: "ADULT_VERIFICATION_REQUIRED" } }));

    expect(store.canAppeal).toBe(true);
    // ADULT_VERIFICATION_REQUIRED can still run the simulated verification
    // (the catalog path to ADULT_VERIFIED) while an appeal is also offered.
    expect(store.canVerify).toBe(true);

    await store.load(mockTransport({ getJson: { ageState: "AGE_UNKNOWN" } }));
    expect(store.canAppeal).toBe(false);
  });

  it("flips to AGE_APPEAL_PENDING and prepends the appeal on a confirmed submit", async () => {
    const store = useAgeStore();
    await store.load(mockTransport({ getJson: { ageState: "ADULT_VERIFICATION_REQUIRED" } }));

    const ok = await store.submitAppeal(
      appealTransport({
        appealJson: {
          id: 7,
          reason: "判错了",
          status: "SUBMITTED",
          createdAt: "2026-08-19T08:00:00Z",
        },
      }),
      "判错了",
    );

    expect(ok).toBe(true);
    expect(store.ageState).toBe("AGE_APPEAL_PENDING");
    expect(store.appeals).toHaveLength(1);
    expect(store.appeals[0].id).toBe("7");
  });

  it("does not submit from a non-appealable state", async () => {
    const store = useAgeStore();
    await store.load(mockTransport({ getJson: { ageState: "AGE_UNKNOWN" } }));
    const transport = appealTransport();

    const ok = await store.submitAppeal(transport, "判错了");

    expect(ok).toBe(false);
    expect(store.ageState).toBe("AGE_UNKNOWN");
    expect(store.appeals).toHaveLength(0);
  });

  it("keeps the state when the server fail-closes (400)", async () => {
    const store = useAgeStore();
    await store.load(mockTransport({ getJson: { ageState: "ADULT_VERIFICATION_REQUIRED" } }));

    await expect(
      store.submitAppeal(appealTransport({ appealOk: false }), "判错了"),
    ).rejects.toBeInstanceOf(AgeHttpError);
    expect(store.ageState).toBe("ADULT_VERIFICATION_REQUIRED");
    expect(store.appeals).toHaveLength(0);
  });

  it("loads the appeal history and reset clears it (§18.7)", async () => {
    const store = useAgeStore();
    await store.loadAppeals(
      appealTransport({
        listJson: [
          { id: 7, reason: "判错了", status: "SUBMITTED", createdAt: "2026-08-19T08:00:00Z" },
        ],
      }),
    );

    expect(store.appealsLoaded).toBe(true);
    expect(store.appeals).toHaveLength(1);

    store.reset();

    expect(store.appeals).toHaveLength(0);
    expect(store.appealsLoaded).toBe(false);
  });
});
