import { afterEach, describe, expect, it, vi } from "vitest";

import { goBack, goTo, switchTabTo, toH5Href } from "./navigate";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared page navigation", () => {
  it("converts uni-app pages to root hash routes and preserves query strings", () => {
    expect(toH5Href("/pages/conversations/conversations")).toBe(
      "/#/pages/conversations/conversations",
    );
    expect(toH5Href("/pages/chat/chat?relationshipId=rel-1")).toBe(
      "/#/pages/chat/chat?relationshipId=rel-1",
    );
    expect(toH5Href("https://example.test/help")).toBe(
      "https://example.test/help",
    );
  });

  it("delegates stack navigation to uni when the runtime API exists", () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });

    goTo("/pages/conversations/conversations");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/conversations/conversations",
    });
  });

  it("delegates top-level navigation to uni redirectTo", () => {
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", { redirectTo });

    switchTabTo("/pages/conversations/conversations");

    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/conversations/conversations",
    });
  });

  it("goes to the fallback page when the uni stack has no parent to pop", () => {
    const navigateBack = vi.fn();
    const redirectTo = vi.fn();
    // uni-h5 真实形态：getCurrentPages 是全局函数，不在 uni 对象上。
    vi.stubGlobal("uni", { navigateBack, redirectTo });
    vi.stubGlobal(
      "getCurrentPages",
      () => [{ route: "pages/companion/companion" }],
    );

    goBack("/pages/account/account");

    expect(navigateBack).not.toHaveBeenCalled();
    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/account/account",
    });
  });

  it("pops the uni stack with navigateBack when a parent page exists", () => {
    const navigateBack = vi.fn();
    const redirectTo = vi.fn();
    vi.stubGlobal("uni", {
      navigateBack,
      redirectTo,
      getCurrentPages: () => [
        { route: "pages/account/account" },
        { route: "pages/companion/companion" },
      ],
    });

    goBack("/pages/account/account");

    expect(navigateBack).toHaveBeenCalledWith({ delta: 1 });
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it("still delegates back navigation when the page stack is unobservable", () => {
    const navigateBack = vi.fn();
    vi.stubGlobal("uni", { navigateBack, redirectTo: vi.fn() });

    goBack("/pages/account/account");

    expect(navigateBack).toHaveBeenCalledWith({ delta: 1 });
  });
});
