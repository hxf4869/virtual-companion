import { afterEach, describe, expect, it, vi } from "vitest";

import { goTo, switchTabTo, toH5Href } from "./navigate";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared page navigation", () => {
  it("converts uni-app pages to root hash routes and preserves query strings", () => {
    expect(toH5Href("/pages/companion/companion")).toBe(
      "/#/pages/companion/companion",
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

    goTo("/pages/companion/companion");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/companion/companion",
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
});
