// @vitest-environment happy-dom
// Shell 行为测试（Phase 1）：四入口底栏渲染与切换、活动 tab 高亮、匿名
// 隐藏、二级页返回、Internal Shell 与消费者底栏隔离、main landmark 与
// 一级标题语义。
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";

import BottomNav from "./BottomNav.vue";
import ConsumerShell from "./ConsumerShell.vue";
import InternalShell from "./InternalShell.vue";
import PageHeader from "./PageHeader.vue";

function stubUni(overrides: Record<string, unknown> = {}) {
  const navigateTo = vi.fn();
  const redirectTo = vi.fn();
  const navigateBack = vi.fn();
  vi.stubGlobal("uni", { navigateTo, redirectTo, navigateBack, ...overrides });
  return { navigateTo, redirectTo, navigateBack };
}

function loginAs(role = "USER") {
  const auth = useAuthStore();
  auth.accessToken = "a-token";
  auth.role = role;
  return auth;
}

describe("BottomNav", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders exactly four tabs in IA order with labels", () => {
    const wrapper = mount(BottomNav, { props: { active: "home" } });
    const items = wrapper.findAll(".vc-bottom-nav__item");
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.text())).toEqual([
      "首页",
      "对话",
      "记忆",
      "我的",
    ]);
    expect(wrapper.attributes("role")).toBe("navigation");
    expect(wrapper.attributes("aria-label")).toBe("主导航");
    wrapper.unmount();
  });

  it("marks the active tab with aria-current only", () => {
    const wrapper = mount(BottomNav, { props: { active: "memory" } });
    const currents = wrapper.findAll('[aria-current="page"]');
    expect(currents).toHaveLength(1);
    expect(currents[0].attributes("data-testid")).toBe("tab-memory");
    wrapper.unmount();
  });

  it("switches tabs via uni.redirectTo (guarded navigation, no stack growth)", async () => {
    const { redirectTo } = stubUni();
    const wrapper = mount(BottomNav, { props: { active: "home" } });
    await wrapper.find('[data-testid="tab-chats"]').trigger("click");
    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/conversations/conversations",
    });
    wrapper.unmount();
  });
});

describe("PageHeader", () => {
  it("renders the title as a level-1 heading inside a banner", () => {
    const wrapper = mount(PageHeader, {
      props: { title: "记忆" },
    });
    expect(wrapper.attributes("role")).toBe("banner");
    const heading = wrapper.find('[role="heading"]');
    expect(heading.attributes("aria-level")).toBe("1");
    expect(heading.text()).toBe("记忆");
    expect(wrapper.find('[data-testid="page-back"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("goes back through uni.navigateBack when asked", async () => {
    const { navigateBack } = stubUni();
    const wrapper = mount(PageHeader, {
      props: { title: "记忆详情", showBack: true },
    });
    await wrapper.find('[data-testid="page-back"]').trigger("click");
    expect(navigateBack).toHaveBeenCalledWith({ delta: 1 });
    wrapper.unmount();
  });
});

describe("ConsumerShell", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("tab root: header title from the navigation model, no back, bottom nav with active tab", () => {
    stubUni();
    loginAs();
    const wrapper = mount(ConsumerShell, {
      props: { route: "/pages/memory/memory" },
      slots: { default: "<p>content</p>" },
    });
    expect(wrapper.find('[data-testid="page-header"]').exists()).toBe(true);
    const heading = wrapper.find('[role="heading"]');
    expect(heading.text()).toBe("记忆");
    expect(wrapper.find('[data-testid="page-back"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="consumer-tabbar"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="tab-memory"]').attributes("aria-current"),
    ).toBe("page");
    expect(wrapper.find('[role="main"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("sub page: shows back, falls back to its tab root, keeps the tab active", () => {
    stubUni();
    loginAs();
    const wrapper = mount(ConsumerShell, {
      props: { route: "/pages/reminder/reminder" },
    });
    expect(wrapper.find('[data-testid="page-back"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="tab-me"]').attributes("aria-current"),
    ).toBe("page");
    wrapper.unmount();
  });

  it("hides the bottom nav for anonymous sessions", () => {
    stubUni();
    const wrapper = mount(ConsumerShell, {
      props: { route: "/pages/index/index" },
    });
    expect(wrapper.find('[data-testid="consumer-tabbar"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("throws on an unknown route (model is the only truth)", () => {
    stubUni();
    expect(() =>
      mount(ConsumerShell, { props: { route: "/pages/nope/nope" } }),
    ).toThrow(/unknown route/);
  });
});

describe("InternalShell", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders internal chrome: back-to-home, no consumer bottom nav", async () => {
    stubUni();
    const { navigateBack } = stubUni();
    const wrapper = mount(InternalShell, {
      props: { route: "/pages/ops/ops" },
      slots: { default: "<p>ops</p>" },
    });
    // eyebrow（kicker 式小字）已按 craft-floor 移除；标题即唯一头部文本。
    expect(wrapper.find('[data-testid="page-header-eyebrow"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="page-back"]').attributes("aria-label")).toBe(
      "返回首页",
    );
    await wrapper.find('[data-testid="page-back"]').trigger("click");
    expect(navigateBack).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="consumer-tabbar"]').exists()).toBe(false);
    expect(wrapper.find('[role="main"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("rejects non-internal routes", () => {
    stubUni();
    expect(() =>
      mount(InternalShell, { props: { route: "/pages/memory/memory" } }),
    ).toThrow(/not an internal route/);
  });
});
