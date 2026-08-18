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
