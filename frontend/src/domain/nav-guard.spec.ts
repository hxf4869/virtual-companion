import { describe, expect, it } from "vitest";

import {
  OPERATOR_ROLES,
  applyInterceptorUrl,
  buildLoginHref,
  classifyPage,
  hrefFromLocation,
  installNavigationGuards,
  normalizeInternalHref,
  parseReturnHref,
  resolveAdmissionGate,
  resolvePostLoginHref,
  shouldRenderPageData,
  type GateSnapshot,
} from "./nav-guard";

const AUTHED: GateSnapshot = {
  session: "authenticated",
  role: "USER",
  ageKnown: true,
  ageLoadFailed: false,
  ageState: "ADULT_VERIFIED",
  consentKnown: true,
  consentLoadFailed: false,
  grantedTypes: ["SERVICE_TERMS", "PRIVACY_POLICY", "AI_CONTENT_NOTICE"],
};

const ANON: GateSnapshot = {
  ...AUTHED,
  session: "anonymous",
  role: null,
  ageKnown: false,
  consentKnown: false,
  grantedTypes: [],
};

describe("classifyPage", () => {
  it("classifies the public/login/age/consent/admin/protected matrix", () => {
    expect(classifyPage("/pages/index/index")).toBe("public");
    expect(classifyPage("/pages/help/help")).toBe("public");
    expect(classifyPage("/pages/login/login")).toBe("login");
    expect(classifyPage("/pages/age/age")).toBe("age");
    expect(classifyPage("/pages/consent/consent")).toBe("consent");
    expect(classifyPage("/pages/admin/admin")).toBe("admin");
    expect(classifyPage("/pages/ops/ops")).toBe("admin");
    expect(classifyPage("/pages/chat/chat")).toBe("protected");
    expect(classifyPage("/pages/memory/memory")).toBe("protected");
    expect(classifyPage("/pages/export/export")).toBe("protected");
  });
});

describe("normalizeInternalHref + login return", () => {
  it("keeps path and query and rejects open redirects", () => {
    expect(
      normalizeInternalHref("/pages/chat/chat?relationshipId=7&conversationId=11"),
    ).toBe("/pages/chat/chat?relationshipId=7&conversationId=11");
    expect(normalizeInternalHref("https://evil.example/pages/chat/chat")).toBeNull();
    expect(normalizeInternalHref("//evil.example/pages/chat/chat")).toBeNull();
    expect(normalizeInternalHref("/pages/login/login")).toBeNull();
    expect(normalizeInternalHref("/not-a-page")).toBeNull();
  });

  it("round-trips the original path and query through the login href", () => {
    const original = "/pages/export/export?after=9";
    const login = buildLoginHref(original);
    expect(login.startsWith("/pages/login/login?return=")).toBe(true);
    expect(parseReturnHref(login)).toBe(original);
  });

  it("peels hash-router re-encoding without allowing a nested open redirect", () => {
    expect(
      parseReturnHref(
        "/pages/login/login?return=%252Fpages%252Fmemory%252Fmemory%253FrelationshipId%253D7",
      ),
    ).toBe("/pages/memory/memory?relationshipId=7");
    expect(
      parseReturnHref(
        "/pages/login/login?return=https%253A%252F%252Fevil.example%252Fpages%252Fchat%252Fchat",
      ),
    ).toBeNull();
  });

  it("does not attach a return to public pages", () => {
    expect(buildLoginHref("/pages/index/index")).toBe("/pages/login/login");
    expect(buildLoginHref("/pages/help/help")).toBe("/pages/login/login");
  });

  it("reads hash-mode H5 locations used by uni-app", () => {
    expect(
      hrefFromLocation({
        pathname: "/",
        search: "",
        hash: "#/pages/chat/chat?relationshipId=7",
      }),
    ).toBe("/pages/chat/chat?relationshipId=7");
    expect(
      hrefFromLocation({
        pathname: "/pages/memory/memory",
        search: "?relationshipId=3",
        hash: "",
      }),
    ).toBe("/pages/memory/memory?relationshipId=3");
  });
});

describe("resolveAdmissionGate", () => {
  it("is unknown until the session and required reads resolve", () => {
    expect(resolveAdmissionGate({ ...AUTHED, session: "unknown" })).toBe("unknown");
    expect(resolveAdmissionGate({ ...AUTHED, ageKnown: false })).toBe("unknown");
    expect(resolveAdmissionGate({ ...AUTHED, consentKnown: false })).toBe("unknown");
  });

  it("does not show ready when age or consent reads fail", () => {
    expect(resolveAdmissionGate({ ...AUTHED, ageLoadFailed: true, ageKnown: false })).toBe(
      "unknown",
    );
    expect(
      resolveAdmissionGate({ ...AUTHED, consentLoadFailed: true, consentKnown: false }),
    ).toBe("unknown");
  });

  it("blocks anonymous visitors and unmet age/consent, and is ready only when all known gates pass", () => {
    expect(resolveAdmissionGate(ANON)).toBe("blocked");
    expect(resolveAdmissionGate({ ...AUTHED, ageState: "AGE_UNKNOWN" })).toBe("blocked");
    expect(resolveAdmissionGate({ ...AUTHED, grantedTypes: ["SERVICE_TERMS"] })).toBe(
      "blocked",
    );
    expect(resolveAdmissionGate(AUTHED)).toBe("ready");
  });
});

describe("applyInterceptorUrl", () => {
  it("sends unauthenticated chat/memory/export visits to login with the full return", () => {
    expect(applyInterceptorUrl("/pages/chat/chat?relationshipId=7", ANON)).toBe(
      buildLoginHref("/pages/chat/chat?relationshipId=7"),
    );
    expect(applyInterceptorUrl("/pages/memory/memory?relationshipId=7", ANON)).toBe(
      buildLoginHref("/pages/memory/memory?relationshipId=7"),
    );
    expect(applyInterceptorUrl("/pages/export/export", ANON)).toBe(
      buildLoginHref("/pages/export/export"),
    );
  });

  it("does not bounce while the session is still unknown", () => {
    expect(
      applyInterceptorUrl("/pages/chat/chat?relationshipId=7", {
        ...ANON,
        session: "unknown",
      }),
    ).toBe("/pages/chat/chat?relationshipId=7");
  });

  it("leaves public and login pages alone for anonymous visitors", () => {
    expect(applyInterceptorUrl("/pages/index/index", ANON)).toBe("/pages/index/index");
    expect(applyInterceptorUrl("/pages/login/login", ANON)).toBe("/pages/login/login");
    expect(applyInterceptorUrl("/pages/help/help", ANON)).toBe("/pages/help/help");
  });

  it("sends anonymous admin/ops visitors to login with return, but does not redirect an authenticated USER", () => {
    expect(applyInterceptorUrl("/pages/admin/admin", ANON)).toBe(
      buildLoginHref("/pages/admin/admin"),
    );
    expect(applyInterceptorUrl("/pages/ops/ops", AUTHED)).toBe("/pages/ops/ops");
  });

  it("forces temporary-password sessions to the account password flow", () => {
    const reset = { ...AUTHED, passwordMustChange: true };
    expect(applyInterceptorUrl("/pages/chat/chat", reset)).toBe(
      "/pages/account/account?passwordChange=required",
    );
    expect(applyInterceptorUrl("/pages/index/index", reset)).toBe(
      "/pages/account/account?passwordChange=required",
    );
    expect(applyInterceptorUrl("/pages/account/account?passwordChange=required", reset)).toBe(
      "/pages/account/account?passwordChange=required",
    );
    expect(shouldRenderPageData("/pages/chat/chat", reset)).toBe(false);
    expect(shouldRenderPageData("/pages/account/account", reset)).toBe(true);
  });
});

describe("shouldRenderPageData", () => {
  it("hides admin/ops data from ordinary users and from unresolved sessions", () => {
    expect(shouldRenderPageData("/pages/admin/admin", AUTHED)).toBe(false);
    expect(shouldRenderPageData("/pages/ops/ops", { ...AUTHED, session: "unknown" })).toBe(
      false,
    );
    expect(shouldRenderPageData("/pages/admin/admin", { ...AUTHED, role: "ADMIN" })).toBe(
      true,
    );
    expect(
      shouldRenderPageData("/pages/admin/admin", {
        ...AUTHED,
        role: "SAFETY_REVIEWER",
      }),
    ).toBe(true);
    expect(OPERATOR_ROLES.has("OPS_VIEWER")).toBe(true);
  });
});

describe("resolvePostLoginHref", () => {
  it("restores the captured return href after login, else falls back", () => {
    expect(
      resolvePostLoginHref("/pages/login/login?return=%2Fpages%2Fchat%2Fchat%3FrelationshipId%3D7", {
        fallback: "/pages/index/index",
      }),
    ).toBe("/pages/chat/chat?relationshipId=7");
    expect(
      resolvePostLoginHref("/pages/login/login", { fallback: "/pages/index/index" }),
    ).toBe("/pages/index/index");
  });
});

describe("installNavigationGuards", () => {
  it("rewrites navigateTo/redirectTo/reLaunch/switchTab through the same decision", () => {
    const interceptors = new Map<string, { invoke: (args: { url: string }) => void }>();
    installNavigationGuards({
      addInterceptor: (name, hooks) => {
        interceptors.set(name, hooks);
      },
      getSnapshot: () => ANON,
    });
    expect([...interceptors.keys()].sort()).toEqual(
      ["navigateTo", "redirectTo", "reLaunch", "switchTab"].sort(),
    );
    const args = { url: "/pages/memory/memory?relationshipId=4" };
    interceptors.get("navigateTo")?.invoke(args);
    expect(args.url).toBe(buildLoginHref("/pages/memory/memory?relationshipId=4"));
  });
});
