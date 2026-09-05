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

  it("redirects the initial home route to login after anonymous discovery", async () => {
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
    expect(locationStub.href).toBe(
      "/#/pages/login/login?return=%2Fpages%2Findex%2Findex",
    );
  });

  it("keeps the full protected hash href when the location fallback redirects", async () => {
    rejectAnonymousSession();
    const locationStub = {
      pathname: "/",
      search: "",
      hash: "#/pages/chat/chat?relationshipId=7&conversationId=11",
      href: "http://localhost/#/pages/chat/chat?relationshipId=7&conversationId=11",
    };
    vi.stubGlobal("location", locationStub);

    bootstrapAuthSession();

    await vi.waitFor(() => {
      expect(locationStub.href).toBe(
        "/#/pages/login/login?return=%2Fpages%2Fchat%2Fchat%3FrelationshipId%3D7%26conversationId%3D11",
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
