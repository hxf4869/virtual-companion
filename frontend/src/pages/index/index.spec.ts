// @vitest-environment happy-dom
// TASK-0204: index page glue test -- internal page entries navigate to the
// existing chat/memory/login routes without changing baseline preflight.
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/baseline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/baseline")>();
  return {
    ...actual,
    fetchBaseline: vi
      .fn()
      .mockRejectedValue(new actual.BaselineRequestError("unreachable", "offline")),
  };
});

import IndexPage from "./index.vue";

function mountPage() {
  return mount(IndexPage, { attachTo: document.body });
}

describe("index page glue (TASK-0204 internal page nav)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", {
      navigateTo: vi.fn(),
    });
  });

  it("renders internal entries for chat, memory, and login", () => {
    const wrapper = mountPage();
    const nav = wrapper.find('[data-testid="alpha-nav"]');
    expect(nav.exists()).toBe(true);
    expect(nav.attributes("role")).toBe("navigation");
    expect(wrapper.find('[data-testid="nav-chat"]').text()).toContain("离线聊天");
    expect(wrapper.find('[data-testid="nav-memory"]').text()).toContain("记忆管理");
    expect(wrapper.find('[data-testid="nav-login"]').text()).toContain("登录");
    wrapper.unmount();
  });

  it("navigates to existing internal pages without calling extra APIs", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();

    await wrapper.find('[data-testid="nav-chat"]').trigger("click");
    await wrapper.find('[data-testid="nav-memory"]').trigger("click");
    await wrapper.find('[data-testid="nav-login"]').trigger("click");

    expect(navigateTo.mock.calls.map((call) => call[0])).toEqual([
      { url: "/pages/chat/chat" },
      { url: "/pages/memory/memory" },
      { url: "/pages/login/login" },
    ]);
    wrapper.unmount();
  });
});
