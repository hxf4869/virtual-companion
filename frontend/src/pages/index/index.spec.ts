// @vitest-environment happy-dom
// 首页（关系首页）行为测试：匿名登录入口、线性准入下一步（成年/同意/创建
// 陪伴）、当前陪伴呈现与"继续聊聊"深链、窄摘要导航（会话/记忆/提醒携带
// relationshipId）、关系加载失败重试、普通用户不可见内部入口。
// 旧边界台的 alpha-nav/基线预检断言已随 IA 迁移（预检在 ops，入口在我的）。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/stores/auth";
import { useRelationshipStore } from "@/stores/relationship";

import IndexPage from "./index.vue";

const ACTIVE_RELATIONSHIP = {
  relationshipId: "rel-index-1",
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-15T00:00:00Z",
};

const GRANTED_CONSENTS = [
  { consentId: "1", consentType: "SERVICE_TERMS", version: "2026-08", granted: true, grantedAt: "t" },
  { consentId: "2", consentType: "PRIVACY_POLICY", version: "2026-08", granted: true, grantedAt: "t" },
  { consentId: "3", consentType: "AI_CONTENT_NOTICE", version: "2026-08", granted: true, grantedAt: "t" },
];

function stubFetch(options: {
  relationships?: unknown[];
  ageState?: string;
  ageFails?: boolean;
  consents?: unknown[];
  conversations?: unknown[];
  memories?: unknown[];
  reminders?: unknown[];
} = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (/\/relationships\/[^/]+\/reminders$/.test(url)) {
      return { ok: true, status: 200, json: async () => options.reminders ?? [] };
    }
    if (/\/relationships\/[^/]+\/memories/.test(url)) {
      return { ok: true, status: 200, json: async () => options.memories ?? [] };
    }
    if (url.startsWith("/api/v1/conversations")) {
      return { ok: true, status: 200, json: async () => options.conversations ?? [] };
    }
    if (url === "/api/v1/relationships") {
      return { ok: true, status: 200, json: async () => options.relationships ?? [] };
    }
    if (url === "/api/v1/age/state") {
      if (options.ageFails) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ageState: options.ageState ?? "ADULT_VERIFIED" }),
      };
    }
    if (url === "/api/v1/consents") {
      return { ok: true, status: 200, json: async () => options.consents ?? GRANTED_CONSENTS };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mountPage() {
  return mount(IndexPage, { attachTo: document.body });
}

function navigateTo(): ReturnType<typeof vi.fn> {
  const nav = (globalThis as { uni?: { navigateTo?: ReturnType<typeof vi.fn> } }).uni
    ?.navigateTo;
  return nav ?? vi.fn();
}

describe("首页：匿名与会话未知", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn(), redirectTo: vi.fn() });
  });

  it("匿名访客看到登录主入口，不渲染四入口底栏", async () => {
    stubFetch();
    // 不注入 token：mount 内 tryRefresh 落定后被拒绝 → anonymous。
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-hero"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="home-login"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="consumer-tabbar"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("会话未知时如实等待，不显示任何准入结论", () => {
    stubFetch();
    const wrapper = mountPage();
    // tryRefresh 尚未落定（settled=false）：unknown 分支必须可见且无结论。
    expect(wrapper.find('[data-testid="home-pending"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="next-step"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-login"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("首页：线性准入（服务端 next-step 为真源）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn(), redirectTo: vi.fn() });
  });

  function login() {
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "USER";
  }

  it("未成年核验先于一切，去核验指向成年状态页", async () => {
    stubFetch({ ageState: "AGE_UNKNOWN", consents: [], relationships: [] });
    login();
    const wrapper = mountPage();
    await flushPromises();

    const step = wrapper.find('[data-testid="next-step"]');
    expect(step.exists()).toBe(true);
    expect(step.text()).toContain("成年核验");
    await wrapper.find('[data-testid="next-step-go"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({ url: "/pages/age/age" });
    wrapper.unmount();
  });

  it("缺必要同意时去确认，指向同意管理页", async () => {
    stubFetch({ consents: [], relationships: [] });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="next-step"]').text()).toContain("协议");
    await wrapper.find('[data-testid="next-step-go"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({ url: "/pages/consent/consent" });
    wrapper.unmount();
  });

  it("准入通过但没有陪伴时，主动作进入统一创建流程（陪伴设置页）", async () => {
    stubFetch({ relationships: [] });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-hero"]').text()).toContain("还没有陪伴");
    await wrapper.find('[data-testid="home-create-companion"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({
      url: "/pages/companion/companion",
    });
    wrapper.unmount();
  });

  it("age 读数失败时保持 unknown，不显示就绪也不编造下一步", async () => {
    stubFetch({ ageFails: true, relationships: [ACTIVE_RELATIONSHIP] });
    login();
    const wrapper = mountPage();
    await flushPromises();

    const gate = wrapper.find('[data-testid="admission-gate"]');
    expect(gate.exists()).toBe(true);
    expect(gate.attributes("data-state")).toBe("unknown");
    expect(wrapper.find('[data-testid="next-step"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("首页：关系就绪后的主任务与摘要", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn(), redirectTo: vi.fn() });
  });

  function login() {
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "USER";
  }

  it("展示当前陪伴，继续聊聊携带 relationshipId 打开聊天", async () => {
    stubFetch({ relationships: [ACTIVE_RELATIONSHIP] });
    login();
    const wrapper = mountPage();
    await flushPromises();

    const hero = wrapper.find('[data-testid="current-relationship"]');
    expect(hero.exists()).toBe(true);
    expect(hero.text()).toContain("温和倾听者");
    await wrapper.find('[data-testid="home-continue-chat"]').trigger("click");
    expect(navigateTo()).toHaveBeenCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-index-1",
    });
    wrapper.unmount();
  });

  it("摘要行导航到会话/记忆/提醒并携带 relationshipId", async () => {
    stubFetch({
      relationships: [ACTIVE_RELATIONSHIP],
      conversations: [
        {
          conversationId: "conv-9",
          relationshipId: "rel-index-1",
          lastMessagePreview: "上次聊到一半的事",
        },
      ],
      memories: [
        {
          memoryId: "m1",
          scope: "RELATIONSHIP",
          status: "PENDING_CONFIRMATION",
          summary: "s",
        },
      ],
    });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(
      wrapper.find('[data-testid="home-latest-conversation"]').text(),
    ).toContain("上次聊到一半的事");
    expect(wrapper.find('[data-testid="home-pending-memory"]').text()).toContain(
      "1 条记忆等你确认",
    );

    await wrapper.find('[data-testid="home-row-conversations"]').trigger("click");
    expect(navigateTo()).toHaveBeenLastCalledWith({
      url: "/pages/conversations/conversations?relationshipId=rel-index-1",
    });
    await wrapper.find('[data-testid="home-row-memory"]').trigger("click");
    expect(navigateTo()).toHaveBeenLastCalledWith({
      url: "/pages/memory/memory?relationshipId=rel-index-1",
    });
    await wrapper.find('[data-testid="home-row-reminder"]').trigger("click");
    expect(navigateTo()).toHaveBeenLastCalledWith({
      url: "/pages/reminder/reminder?relationshipId=rel-index-1",
    });
    wrapper.unmount();
  });

  it("已登录会话渲染四入口底栏且首页 tab 高亮", async () => {
    stubFetch({ relationships: [ACTIVE_RELATIONSHIP] });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="consumer-tabbar"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="tab-home"]').attributes("aria-current"),
    ).toBe("page");
    wrapper.unmount();
  });

  it("普通用户与 ADMIN 都看不到内部入口（ops/admin 已移出首页）", async () => {
    stubFetch({ relationships: [ACTIVE_RELATIONSHIP] });
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "ADMIN";
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="nav-admin"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="nav-ops"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("内部管理");
    expect(wrapper.text()).not.toContain("运行与合规");
    wrapper.unmount();
  });

  it("关系列表加载失败时给出重试，不激活任何主动作", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/relationships") {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      if (url === "/api/v1/age/state") {
        return { ok: true, status: 200, json: async () => ({ ageState: "ADULT_VERIFIED" }) };
      }
      if (url === "/api/v1/consents") {
        return { ok: true, status: 200, json: async () => GRANTED_CONSENTS };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchMock);
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "USER";
    const wrapper = mountPage();
    await flushPromises();

    const err = wrapper.find('[data-testid="relationship-load-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain("关系列表加载失败。");
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(false);

    // 重试成功后进入正常首屏。
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/relationships") {
        return { ok: true, status: 200, json: async () => [ACTIVE_RELATIONSHIP] };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    await wrapper.find('[data-testid="relationship-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("摘要任一路径失败时如实提示，不把失败渲染成空成功", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/relationships") {
        return { ok: true, status: 200, json: async () => [ACTIVE_RELATIONSHIP] };
      }
      if (url === "/api/v1/age/state") {
        return { ok: true, status: 200, json: async () => ({ ageState: "ADULT_VERIFIED" }) };
      }
      if (url === "/api/v1/consents") {
        return { ok: true, status: 200, json: async () => GRANTED_CONSENTS };
      }
      if (url.startsWith("/api/v1/conversations")) {
        throw new TypeError("offline");
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchMock);
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "USER";
    const wrapper = mountPage();
    await flushPromises();

    // 摘要失败态经 allSettled 落定后触发重渲染；用 waitFor 等待而非假设同步可见。
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="home-latest-conversation"]').text(),
      ).toContain("加载失败"),
    );
    wrapper.unmount();
  });
});
