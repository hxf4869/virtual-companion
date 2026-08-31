// @vitest-environment happy-dom
// 首页（关系首页）行为测试：匿名登录入口、线性准入下一步（成年/同意/创建
// 陪伴）、当前陪伴呈现与"继续聊聊"深链、窄摘要导航（会话/记忆携带
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
  authFails?: boolean | (() => boolean);
  authSessions?: unknown[];
  relationships?: unknown[];
  ageState?: string;
  ageFails?: boolean | (() => boolean);
  consentFails?: boolean;
  consents?: unknown[];
  conversations?: unknown[];
  memories?: unknown[];
  fail?: { conversations?: boolean; memories?: boolean };
} = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input.toString() : input.toString();
    if (url === "/api/v1/auth/sessions") {
      const authFails = typeof options.authFails === "function"
        ? options.authFails()
        : options.authFails;
      if (authFails) throw new TypeError("offline");
      if (options.authSessions === undefined) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ code: "AUTHENTICATION_REQUIRED" }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => options.authSessions,
      };
    }
    if (/\/relationships\/[^/]+\/memories/.test(url)) {
      if (options.fail?.memories) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => options.memories ?? [] };
    }
    if (url.startsWith("/api/v1/conversations")) {
      if (options.fail?.conversations) {
        throw new TypeError("offline");
      }
      return { ok: true, status: 200, json: async () => options.conversations ?? [] };
    }
    if (url === "/api/v1/relationships") {
      return { ok: true, status: 200, json: async () => options.relationships ?? [] };
    }
    if (url === "/api/v1/age/state") {
      const ageFails = typeof options.ageFails === "function"
        ? options.ageFails()
        : options.ageFails;
      if (ageFails) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ageState: options.ageState ?? "ADULT_VERIFIED" }),
      };
    }
    if (url === "/api/v1/consents") {
      if (options.consentFails) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
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
    // 真实契约：匿名 GET /auth/sessions 返回 401，但公开首页不得跳登录。
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-hero"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="home-login"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="consumer-tabbar"]').exists()).toBe(false);
    const redirectTo = (globalThis as { uni?: { redirectTo?: ReturnType<typeof vi.fn> } }).uni
      ?.redirectTo;
    expect(redirectTo).not.toHaveBeenCalled();
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

  it("会话恢复失败时结束等待并提供可恢复入口", async () => {
    let authFails = true;
    stubFetch({
      authFails: () => authFails,
      authSessions: [{
        id: "session-1",
        createdAt: "2026-08-31T00:00:00Z",
        expiresAt: "2026-09-01T00:00:00Z",
        current: true,
        accountId: "7",
        role: "USER",
        passwordMustChange: false,
      }],
      relationships: [ACTIVE_RELATIONSHIP],
    });
    const wrapper = mountPage();
    await flushPromises();

    const pending = wrapper.find('[data-testid="home-pending"]');
    expect(pending.attributes("data-state")).toBe("error");
    expect(pending.attributes("role")).toBe("alert");
    expect(pending.text()).toContain("暂时无法确认登录状态");
    expect(wrapper.find('[data-testid="session-retry"]').text()).toBe("重新检查");

    authFails = false;
    await wrapper.find('[data-testid="session-retry"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="home-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(true);
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

  it("age 读数失败时显示可恢复错误，重新检查成功后继续", async () => {
    let ageFails = true;
    stubFetch({ ageFails: () => ageFails, relationships: [ACTIVE_RELATIONSHIP] });
    login();
    const wrapper = mountPage();
    await flushPromises();

    const gate = wrapper.find('[data-testid="admission-gate"]');
    expect(gate.exists()).toBe(true);
    expect(gate.attributes("data-state")).toBe("error");
    expect(gate.text()).toContain("读取失败");
    expect(wrapper.find('[data-testid="admission-retry"]').text()).toBe("重新检查");
    expect(wrapper.find('[data-testid="next-step"]').exists()).toBe(false);

    ageFails = false;
    await wrapper.find('[data-testid="admission-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="admission-gate"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="home-continue-chat"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("同意记录读取失败时同样提供重新检查，不停在无操作等待态", async () => {
    stubFetch({ consentFails: true, relationships: [ACTIVE_RELATIONSHIP] });
    login();
    const wrapper = mountPage();
    await flushPromises();

    const gate = wrapper.find('[data-testid="admission-gate"]');
    expect(gate.attributes("data-state")).toBe("error");
    expect(gate.attributes("role")).toBe("alert");
    expect(gate.text()).toContain("同意记录读取失败");
    expect(wrapper.find('[data-testid="admission-retry"]').exists()).toBe(true);
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

  it("全局 uni 导航不可用时仍进入 H5 hash 路由", async () => {
    stubFetch({ relationships: [ACTIVE_RELATIONSHIP] });
    login();
    vi.stubGlobal("uni", undefined);
    const locationStub = { href: "" };
    vi.stubGlobal("location", locationStub);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="home-continue-chat"]').trigger("click");

    expect(locationStub.href).toBe("/#/pages/chat/chat?relationshipId=rel-index-1");
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
    expect(wrapper.find('[data-testid="home-row-reminder"]').exists()).toBe(false);
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

  it("会话路失败时只标记会话行，记忆不受污染", async () => {
    stubFetch({
      relationships: [ACTIVE_RELATIONSHIP],
      conversations: [],
      memories: [
        { memoryId: "m1", scope: "RELATIONSHIP", status: "PENDING_CONFIRMATION", summary: "s" },
      ],
      fail: { conversations: true },
    });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(
      wrapper.find('[data-testid="home-latest-conversation"]').text(),
    ).toContain("加载失败，点开可重试");
    expect(
      wrapper.find('[data-testid="home-row-conversations"]').attributes("data-state"),
    ).toBe("error");
    expect(wrapper.find('[data-testid="home-pending-memory"]').text()).toContain(
      "1 条记忆等你确认",
    );
    expect(wrapper.find('[data-testid="home-next-reminder"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("记忆路失败时不冒充空成功，会话照常成功", async () => {
    stubFetch({
      relationships: [ACTIVE_RELATIONSHIP],
      conversations: [
        {
          conversationId: "conv-9",
          relationshipId: "rel-index-1",
          lastMessagePreview: "上次聊到一半的事",
        },
      ],
      fail: { memories: true },
    });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="home-pending-memory"]').text()).toContain(
      "加载失败，点开可重试",
    );
    expect(
      wrapper.find('[data-testid="home-row-memory"]').attributes("data-state"),
    ).toBe("error");
    expect(
      wrapper.find('[data-testid="home-latest-conversation"]').text(),
    ).toContain("上次聊到一半的事");
    expect(wrapper.find('[data-testid="home-next-reminder"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("失败但保留旧数据时显示旧值并标注较早数据（stale）", async () => {
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
        { memoryId: "m1", scope: "RELATIONSHIP", status: "PENDING_CONFIRMATION", summary: "s" },
      ],
    });
    login();
    const wrapper = mountPage();
    await flushPromises();

    // 第二轮全部失败：旧值保留并标注"较早数据"，不冒充成功也不误报空。
    stubFetch({
      relationships: [ACTIVE_RELATIONSHIP],
      fail: { conversations: true, memories: true },
    });
    await (wrapper.vm as unknown as { loadSummaries: () => Promise<void> }).loadSummaries();
    await flushPromises();

    expect(
      wrapper.find('[data-testid="home-latest-conversation"]').text(),
    ).toContain("上次聊到一半的事（较早数据）");
    expect(
      wrapper.find('[data-testid="home-row-conversations"]').attributes("data-state"),
    ).toBe("stale");
    expect(wrapper.find('[data-testid="home-pending-memory"]').text()).toContain(
      "1 条记忆等你确认（较早数据）",
    );
    wrapper.unmount();
  });

  it("会话摘要取整页中最大 id 为最新，不取升序第一条", async () => {
    stubFetch({
      relationships: [ACTIVE_RELATIONSHIP],
      conversations: [
        {
          conversationId: "101",
          relationshipId: "rel-index-1",
          lastMessagePreview: "很早的一次对话",
        },
        {
          conversationId: "37",
          relationshipId: "rel-index-1",
          lastMessagePreview: "中间的一次对话",
        },
        {
          conversationId: "205",
          relationshipId: "rel-index-1",
          lastMessagePreview: "最新一次对话",
        },
      ],
    });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(
      wrapper.find('[data-testid="home-latest-conversation"]').text(),
    ).toContain("最新一次对话");
    wrapper.unmount();
  });

  it("会话整页未取尽时不误称最近，退化为计数", async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      conversationId: String(i + 1),
      relationshipId: "rel-index-1",
      lastMessagePreview: `第 ${i + 1} 个会话`,
    }));
    stubFetch({
      relationships: [ACTIVE_RELATIONSHIP],
      conversations: fullPage,
    });
    login();
    const wrapper = mountPage();
    await flushPromises();

    expect(
      wrapper.find('[data-testid="home-latest-conversation"]').text(),
    ).toContain("50+ 个会话");
    expect(
      wrapper.find('[data-testid="home-latest-conversation"]').text(),
    ).not.toContain("第 50 个会话");
    wrapper.unmount();
  });
});
