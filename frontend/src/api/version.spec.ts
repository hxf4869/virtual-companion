// VERSION-UI: typed client tests for GET /api/v1/version (OpenAPI
// getVersion). Verifies the response mapping (version required, commit
// optional) and that any transport failure degrades to null.
import { describe, expect, it } from "vitest";

import { fetchVersion, VERSION_ENDPOINT } from "@/api/version";
import type { AuthTransport } from "@/api/auth";

function transportWith(result: { ok: boolean; status: number; json: unknown }): AuthTransport {
  return {
    request: async () => result,
  };
}

describe("fetchVersion", () => {
  it("maps the version and commit fields", async () => {
    const t = transportWith({
      ok: true,
      status: 200,
      json: { version: "0.1.0", commit: "abc123" },
    });

    expect(await fetchVersion(t)).toEqual({ version: "0.1.0", commit: "abc123" });
  });

  it("defaults a missing commit to the empty string", async () => {
    const t = transportWith({ ok: true, status: 200, json: { version: "0.1.0" } });

    expect(await fetchVersion(t)).toEqual({ version: "0.1.0", commit: "" });
  });

  it("degrades to null on a non-OK response", async () => {
    const t = transportWith({ ok: false, status: 503, json: null });

    expect(await fetchVersion(t)).toBeNull();
  });

  it("degrades to null on an invalid payload", async () => {
    const t = transportWith({ ok: true, status: 200, json: { nope: true } });

    expect(await fetchVersion(t)).toBeNull();
  });

  it("requests the contract endpoint via GET", async () => {
    let seen: { method: string; path: string } | null = null;
    const t: AuthTransport = {
      request: async (method, path) => {
        seen = { method, path };
        return { ok: true, status: 200, json: { version: "0.1.0" } };
      },
    };

    await fetchVersion(t);

    expect(seen).toEqual({ method: "GET", path: VERSION_ENDPOINT });
  });
});
