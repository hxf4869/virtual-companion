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
  resolvePostLoginHref,
  shouldRenderPageData,
  type GateSnapshot,
} from "./nav-guard";

const AUTHED: GateSnapshot = {
  session: "authenticated",
  role: "USER",
};

const ANON: GateSnapshot = {
  session: "anonymous",
  role: null,
};

describe("classifyPage", () => {
  it("classifies only login, admin and protected product pages", () => {
    expect(classifyPage("/pages/login/login")).toBe("login");
    expect(classifyPage("/pages/admin/admin")).toBe("admin");
    expect(classifyPage("/pages/admin-accounts/admin-accounts")).toBe("admin");
    expect(classifyPage("/pages/admin-models/admin-models")).toBe("admin");
    expect(classifyPage("/pages/admin-routing/admin-routing")).toBe("admin");
    expect(classifyPage("/pages/admin-system/admin-system")).toBe("admin");
    expect(classifyPage("/pages/index/index")).toBe("protected");
    expect(classifyPage("/pages/chat/chat")).toBe("protected");
  });
});

describe("login return", () => {
  it("round-trips a current internal path and rejects open redirects", () => {
    const original = "/pages/chat/chat?relationshipId=7&conversationId=11";
    expect(parseReturnHref(buildLoginHref(original))).toBe(original);
    expect(normalizeInternalHref("https://evil.example/pages/chat/chat")).toBeNull();
    expect(normalizeInternalHref("//evil.example/pages/chat/chat")).toBeNull();
    expect(normalizeInternalHref("/pages/login/login")).toBeNull();
    expect(normalizeInternalHref("/not-a-page")).toBeNull();
  });

  it("peels hash-router re-encoding without allowing a nested open redirect", () => {
    expect(parseReturnHref(
      "/pages/login/login?return=%252Fpages%252Fchat%252Fchat%253FconversationId%253D7",
    )).toBe("/pages/chat/chat?conversationId=7");
    expect(parseReturnHref(
      "/pages/login/login?return=https%253A%252F%252Fevil.example%252Fpages%252Fchat%252Fchat",
    )).toBeNull();
  });

  it("restores the return target or uses the supplied fallback", () => {
    expect(resolvePostLoginHref(
      "/pages/login/login?return=%2Fpages%2Fchat%2Fchat",
      { fallback: "/pages/index/index" },
    )).toBe("/pages/chat/chat");
    expect(resolvePostLoginHref(
      "/pages/login/login",
      { fallback: "/pages/index/index" },
    )).toBe("/pages/index/index");
  });

  it("reads uni-app hash-mode locations", () => {
    expect(hrefFromLocation({
      pathname: "/",
      search: "",
      hash: "#/pages/chat/chat?relationshipId=7",
    })).toBe("/pages/chat/chat?relationshipId=7");
  });
});

describe("route decisions", () => {
  it("sends every anonymous product page to login with its return target", () => {
    for (const href of [
      "/pages/index/index",
      "/pages/chat/chat?relationshipId=7",
      "/pages/account/account",
      "/pages/admin/admin",
    ]) {
      expect(applyInterceptorUrl(href, ANON)).toBe(buildLoginHref(href));
    }
    expect(applyInterceptorUrl("/pages/login/login", ANON)).toBe("/pages/login/login");
  });

  it("does not redirect while session discovery is unresolved", () => {
    expect(applyInterceptorUrl("/pages/index/index", {
      session: "unknown",
      role: null,
    })).toBe("/pages/index/index");
  });

  it("forces a temporary-password session to the account password form", () => {
    const reset = { ...AUTHED, passwordMustChange: true };
    expect(applyInterceptorUrl("/pages/chat/chat", reset)).toBe(
      "/pages/account/account?passwordChange=required",
    );
    expect(applyInterceptorUrl(
      "/pages/account/account?passwordChange=required",
      reset,
    )).toBe("/pages/account/account?passwordChange=required");
    expect(shouldRenderPageData("/pages/chat/chat", reset)).toBe(false);
    expect(shouldRenderPageData("/pages/account/account", reset)).toBe(true);
  });

  it("renders admin data only for an authenticated ADMIN", () => {
    expect(shouldRenderPageData("/pages/admin/admin", AUTHED)).toBe(false);
    expect(shouldRenderPageData("/pages/admin/admin", {
      ...AUTHED,
      role: "ADMIN",
    })).toBe(true);
    expect(shouldRenderPageData("/pages/admin-routing/admin-routing", {
      ...AUTHED,
      role: "SAFETY_REVIEWER",
    })).toBe(false);
    expect(OPERATOR_ROLES.has("OPS_VIEWER")).toBe(true);
  });

  it("installs the same guard on every uni navigation method", () => {
    const interceptors = new Map<string, { invoke: (args: { url: string }) => void }>();
    installNavigationGuards({
      addInterceptor: (name, hooks) => interceptors.set(name, hooks),
      getSnapshot: () => ANON,
    });
    expect([...interceptors.keys()].sort()).toEqual(
      ["navigateTo", "redirectTo", "reLaunch", "switchTab"].sort(),
    );
    const args = { url: "/pages/chat/chat?conversationId=4" };
    interceptors.get("navigateTo")?.invoke(args);
    expect(args.url).toBe(buildLoginHref("/pages/chat/chat?conversationId=4"));
  });
});
