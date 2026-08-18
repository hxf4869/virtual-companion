import { describe, expect, it } from "vitest";

import { getIncognitoPref, IncognitoHttpError, updateIncognitoPref, type IncognitoTransport } from "./incognito";

function recorder(response: { ok: boolean; status: number; json: unknown }): {
  transport: IncognitoTransport;
  calls: { method: string; path: string; body?: unknown }[];
} {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  return {
    transport: {
      request: async (method, path, body) => {
        calls.push({ method, path, body });
        return { ...response };
      },
    },
    calls,
  };
}

describe("incognito pref API", () => {
  it("GETs the default and falls back to false on an empty body", async () => {
    const { transport, calls } = recorder({ ok: true, status: 200, json: {} });
    await expect(getIncognitoPref(transport)).resolves.toEqual({ defaultIncognito: false });
    expect(calls).toEqual([{ method: "GET", path: "/api/v1/incognito-pref" }]);
  });

  it("PUTs the default", async () => {
    const { transport, calls } = recorder({
      ok: true,
      status: 200,
      json: { defaultIncognito: true },
    });
    const result = await updateIncognitoPref(transport, true);
    expect(result.defaultIncognito).toBe(true);
    expect(calls[0]).toEqual({
      method: "PUT",
      path: "/api/v1/incognito-pref",
      body: { defaultIncognito: true },
    });
  });

  it("throws on 401", async () => {
    const { transport } = recorder({ ok: false, status: 401, json: null });
    await expect(getIncognitoPref(transport)).rejects.toThrow(IncognitoHttpError);
  });
});
