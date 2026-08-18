import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import type { IncognitoTransport } from "@/api/incognito";
import { useIncognitoStore } from "./incognito";

function transport(opts: { get?: boolean; put?: boolean; failGet?: boolean }): IncognitoTransport {
  return {
    async request(method: string) {
      if (method === "GET") {
        if (opts.failGet) return { ok: false, status: 500, json: null };
        return { ok: true, status: 200, json: { defaultIncognito: opts.get === true } };
      }
      return { ok: true, status: 200, json: { defaultIncognito: opts.put === true } };
    },
  };
}

describe("useIncognitoStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads false by default and updates only after PUT", async () => {
    const store = useIncognitoStore();
    await store.load(transport({ get: false }));
    expect(store.defaultIncognito).toBe(false);
    expect(store.label).toContain("默认不无痕");

    await store.save(transport({ put: true }), true);
    expect(store.defaultIncognito).toBe(true);
    expect(store.label).toContain("默认无痕");
  });

  it("marks loadFailed without inventing true", async () => {
    const store = useIncognitoStore();
    await store.load(transport({ failGet: true }));
    expect(store.loadFailed).toBe(true);
    expect(store.defaultIncognito).toBe(false);
  });
});
