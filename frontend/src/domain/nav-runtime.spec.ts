import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapAuthSession, enforceAppRoute } from "./nav-runtime";
import { useAuthStore } from "@/stores/auth";

describe("enforceAppRoute", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function rejectAnonymousSession(): void {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ code: "AUTHENTICATION_REQUIRED" }),
    })));
  }

  it("keeps a public hash route after anonymous session discovery returns 401", async () => {
    rejectAnonymousSession();
    const locationStub = {
      pathname: "/",
      search: "",
      hash: "#/pages/index/index",
      href: "http://localhost/#/pages/index/index",
    };
    vi.stubGlobal("location", locationStub);

    bootstrapAuthSession();

    await vi.waitFor(() => expect(useAuthStore().sessionStatus).toBe("anonymous"));
    expect(locationStub.href).toBe("http://localhost/#/pages/index/index");
  });

  it("keeps the full protected hash href when the location fallback redirects", async () => {
    rejectAnonymousSession();
    const locationStub = {
      pathname: "/",
      search: "",
      hash: "#/pages/memory/memory?relationshipId=7",
      href: "http://localhost/#/pages/memory/memory?relationshipId=7",
    };
    vi.stubGlobal("location", locationStub);

    bootstrapAuthSession();

    await vi.waitFor(() => {
      expect(locationStub.href).toBe(
        "/#/pages/login/login?return=%2Fpages%2Fmemory%2Fmemory%3FrelationshipId%3D7",
      );
    });
  });

  it("still enforces an already-settled anonymous protected route", async () => {
    const auth = useAuthStore();
    await auth.tryRefresh({
      request: vi.fn(async () => ({ ok: false, status: 401, json: null })),
    });
    const locationStub = {
      pathname: "/",
      search: "",
      hash: "#/pages/chat/chat",
      href: "http://localhost/#/pages/chat/chat",
    };
    vi.stubGlobal("location", locationStub);

    enforceAppRoute();

    expect(locationStub.href).toContain("/#/pages/login/login?return=");
  });
});
