import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { enforceAppRoute } from "./nav-runtime";
import { useAuthStore } from "@/stores/auth";

describe("enforceAppRoute", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", undefined);
  });

  it("keeps the full protected hash href when the location fallback redirects", async () => {
    const auth = useAuthStore();
    await auth.tryRefresh({
      request: vi.fn(async () => ({
        ok: false,
        status: 401,
        json: { code: "AUTHENTICATION_REQUIRED" },
      })),
    });
    const locationStub = {
      pathname: "/",
      search: "",
      hash: "#/pages/memory/memory?relationshipId=7",
      href: "http://localhost/#/pages/memory/memory?relationshipId=7",
    };
    vi.stubGlobal("location", locationStub);

    enforceAppRoute();

    expect(locationStub.href).toBe(
      "/#/pages/login/login?return=%2Fpages%2Fmemory%2Fmemory%3FrelationshipId%3D7",
    );
  });
});
