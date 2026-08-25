// @vitest-environment happy-dom
// TASK-0204: index page glue test -- internal page entries navigate to the
// existing chat/memory/login routes without changing baseline preflight.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installH5A11yShims } from "@/platform/h5-a11y";
import { useAuthStore } from "@/stores/auth";
import { useRelationshipStore } from "@/stores/relationship";

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

const ACTIVE_RELATIONSHIP = {
  relationshipId: "rel-index-1",
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-15T00:00:00Z",
};

function stubRelationshipFetch(relationships: unknown[] = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/relationships") {
        return { ok: true, status: 200, json: async () => relationships };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

describe("index page glue (TASK-0204 internal page nav)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", {
      navigateTo: vi.fn(),
    });
    stubRelationshipFetch();
  });

  it("NEXT-STEP: an authenticated session with no companion points to create one", async () => {
    stubRelationshipFetch([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url === "/api/v1/age/state") {
          return { ok: true, status: 200, json: async () => ({ ageState: "ADULT_VERIFIED" }) };
        }
        if (url === "/api/v1/consents") {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { consentId: "1", consentType: "SERVICE_TERMS", version: "2026-08", granted: true, grantedAt: "t" },
              { consentId: "2", consentType: "PRIVACY_POLICY", version: "2026-08", granted: true, grantedAt: "t" },
              { consentId: "3", consentType: "AI_CONTENT_NOTICE", version: "2026-08", granted: true, grantedAt: "t" },
            ],
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "USER";
    const wrapper = mountPage();
    await flushPromises();
    const step = wrapper.find('[data-testid="next-step"]');
    expect(step.exists()).toBe(true);
    expect(step.text()).toContain("还没有角色");
    await wrapper.find('[data-testid="next-step-go"]').trigger("click");
    const navigateTo = (globalThis as { uni?: { navigateTo: ReturnType<typeof vi.fn> } }).uni?.navigateTo;
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/chat/chat" });
    wrapper.unmount();
  });

  it("NEXT-STEP: unverified age comes before creating a companion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/age/state") {
          return { ok: true, status: 200, json: async () => ({ ageState: "AGE_UNKNOWN" }) };
        }
        if (url === "/api/v1/consents") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [] };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "USER";
    const wrapper = mountPage();
    await flushPromises();
    const step = wrapper.find('[data-testid="next-step"]');
    expect(step.text()).toContain("成年核验");
    await wrapper.find('[data-testid="next-step-go"]').trigger("click");
    const navigateTo = (globalThis as { uni?: { navigateTo: ReturnType<typeof vi.fn> } }).uni?.navigateTo;
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/age/age" });
    wrapper.unmount();
  });

  it("NEXT-STEP: missing required consents go to the consent page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/age/state") {
          return { ok: true, status: 200, json: async () => ({ ageState: "ADULT_VERIFIED" }) };
        }
        if (url === "/api/v1/consents") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [] };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "USER";
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.find('[data-testid="next-step"]').text()).toContain("协议");
    await wrapper.find('[data-testid="next-step-go"]').trigger("click");
    const navigateTo = (globalThis as { uni?: { navigateTo: ReturnType<typeof vi.fn> } }).uni?.navigateTo;
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/consent/consent" });
    wrapper.unmount();
  });

  it("S0-18: a failed age read does not display ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/age/state") {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        if (url === "/api/v1/consents") {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { consentId: "1", consentType: "SERVICE_TERMS", version: "2026-08", granted: true, grantedAt: "t" },
              { consentId: "2", consentType: "PRIVACY_POLICY", version: "2026-08", granted: true, grantedAt: "t" },
              { consentId: "3", consentType: "AI_CONTENT_NOTICE", version: "2026-08", granted: true, grantedAt: "t" },
            ],
          };
        }
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [ACTIVE_RELATIONSHIP] };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "USER";
    const wrapper = mountPage();
    await flushPromises();
    const gate = wrapper.find('[data-testid="admission-gate"]');
    expect(gate.exists()).toBe(true);
    expect(gate.attributes("data-state")).toBe("unknown");
    expect(wrapper.find('[data-testid="next-step"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders internal entries for chat, memory, and login", () => {
    const wrapper = mountPage();
    const nav = wrapper.find('[data-testid="alpha-nav"]');
    expect(nav.exists()).toBe(true);
    expect(nav.attributes("role")).toBe("navigation");
    expect(wrapper.find('[data-testid="nav-chat"]').text()).toContain("离线聊天");
    expect(wrapper.find('[data-testid="nav-conversations"]').text()).toContain("会话列表");
    expect(wrapper.find('[data-testid="nav-memory"]').text()).toContain("记忆管理");
    expect(wrapper.find('[data-testid="nav-age"]').text()).toContain("成年核验");
    expect(wrapper.find('[data-testid="nav-data"]').text()).toContain("我的数据");
    expect(wrapper.find('[data-testid="nav-help"]').text()).toContain("帮助与安全支持");
    expect(wrapper.find('[data-testid="nav-report"]').text()).toContain("举报和申诉");
    expect(wrapper.find('[data-testid="nav-ai-notice"]').text()).toContain("模型与 AI 标识");
    expect(wrapper.find('[data-testid="nav-health"]').text()).toContain("使用时长");
    expect(wrapper.find('[data-testid="nav-incognito"]').text()).toContain("无痕模式");
    expect(wrapper.find('[data-testid="nav-login"]').text()).toContain("登录");
    expect(wrapper.find('[data-testid="nav-account"]').text()).toContain("账号与注销");
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

  it("carries current relationship id to memory after load", async () => {
    stubRelationshipFetch([ACTIVE_RELATIONSHIP]);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const createSpy = vi.spyOn(relStore, "create");

    await wrapper.find('[data-testid="nav-memory"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/memory/memory?relationshipId=rel-index-1",
    });
    expect(activateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps a bare memory path when there is no current relationship", async () => {
    stubRelationshipFetch([]);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="nav-memory"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/memory/memory" });
    wrapper.unmount();
  });

  it("carries current relationship id to chat after load", async () => {
    stubRelationshipFetch([ACTIVE_RELATIONSHIP]);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");
    const createSpy = vi.spyOn(relStore, "create");

    await wrapper.find('[data-testid="nav-chat"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/chat/chat?relationshipId=rel-index-1",
    });
    expect(activateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps a bare chat path when there is no current relationship", async () => {
    stubRelationshipFetch([]);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="nav-chat"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/chat/chat" });
    wrapper.unmount();
  });

  it("carries current relationship id to the conversation list after load", async () => {
    stubRelationshipFetch([ACTIVE_RELATIONSHIP]);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="nav-conversations"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/conversations/conversations?relationshipId=rel-index-1",
    });
    wrapper.unmount();
  });

  it("keeps a bare conversation-list path when there is no current relationship", async () => {
    stubRelationshipFetch([]);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="nav-conversations"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/conversations/conversations" });
    wrapper.unmount();
  });

  it("shows the current relationship id after a successful load", async () => {
    stubRelationshipFetch([ACTIVE_RELATIONSHIP]);
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");

    const status = wrapper.find('[data-testid="current-relationship"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("当前关系：温和倾听者");
    expect(activateSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows an empty current-relationship copy when none is selected", async () => {
    stubRelationshipFetch([]);
    const wrapper = mountPage();
    await flushPromises();

    const status = wrapper.find('[data-testid="current-relationship"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("还没有当前关系。");
    wrapper.unmount();
  });

  it("shows a relationship load error without changing preflight or calling activate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/relationships") {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    const relStore = useRelationshipStore();
    const activateSpy = vi.spyOn(relStore, "activate");

    const err = wrapper.find('[data-testid="relationship-load-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain("关系列表加载失败。");
    expect(wrapper.find('[data-testid="current-relationship"]').exists()).toBe(false);
    expect(wrapper.find(".connection").exists()).toBe(true);
    expect(activateSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  // ---- ADMIN-UI: admin-only account management entry ----

  it("renders the account management entry only for ADMIN sessions", async () => {
    const auth = useAuthStore();
    // SESS-REVIVE: an authenticated session (accessToken set) skips the mount
    // refresh, so the ADMIN role survives to the assertion.
    auth.accessToken = "a-token";
    auth.role = "ADMIN";
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="nav-admin"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="nav-admin"]').text()).toContain("账户管理");
    expect(wrapper.find('[data-testid="nav-ops"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="nav-ops"]').text()).toContain("运行与合规");
    wrapper.unmount();
  });

  it("hides the account management entry for non-admin sessions", () => {
    const auth = useAuthStore();
    auth.role = "USER";
    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="nav-admin"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="nav-ops"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("navigates to the admin page from the account management entry", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const auth = useAuthStore();
    // SESS-REVIVE: authenticated session skips the mount refresh.
    auth.accessToken = "a-token";
    auth.role = "ADMIN";
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="nav-admin"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/admin/admin" });
    wrapper.unmount();
  });

  it("navigates to the ops page from the run-and-compliance entry", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    auth.role = "ADMIN";
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="nav-ops"]').trigger("click");

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/ops/ops" });
    wrapper.unmount();
  });

  // ---- VERSION-UI: build identity stamp ----

  it("renders the build version stamp when baseline and version respond", async () => {
    const baselineModule = await import("@/api/baseline");
    const fetchBaselineMock = baselineModule.fetchBaseline as ReturnType<typeof vi.fn>;
    fetchBaselineMock.mockResolvedValueOnce({
      application: "virtual-companion",
      phase: "TECHNICAL_ALPHA",
      transport: "HTTP_SSE",
      technology: {
        javaVersion: "25",
        springBootVersion: "4.1.0",
        springAiVersion: "1.0.0",
        springModulithVersion: "1.4.0",
      },
      catalogs: {
        source: "specs/generated/catalog.snapshot.json",
        riskLevels: [],
        generationStates: [],
        memoryScopes: [],
        modelProtocols: [],
        serviceModes: [],
      },
      capabilities: {
        source: "specs/generated/catalog.snapshot.json#sources/product-scope.yaml/document",
        publicRegistrationEnabled: false,
        paymentEnabled: false,
        romanceModeEnabled: false,
        voiceEnabled: false,
        imageEnabled: false,
        websocketEnabled: false,
        betaGenerationEnabledByDefault: false,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/version") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: "0.1.0", commit: "abc123" }),
          };
        }
        return { ok: true, status: 200, json: async () => [] };
      }),
    );
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    const wrapper = mountPage();
    await flushPromises();
    await flushPromises();

    const labels = wrapper.findAll(".stamp-item__label").map((node) => node.text());
    expect(labels).toContain("VERSION");
    expect(labels).toContain("COMMIT");
    const values = wrapper.findAll(".stamp-item__value").map((node) => node.text());
    expect(values).toContain("0.1.0");
    expect(values).toContain("abc123");
    wrapper.unmount();
  });

  // ---- ACCT-DELETE (FR-AUTH-004) + DOGFOOD-08: deletion needs server-side
  // ---- current-password re-authentication on the account page. ----

  it("deletion entry navigates to the account page without deleting in place", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="delete-account-open"]').trigger("click");
    await flushPromises();

    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/account/account" });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/auth/account"))).toBe(
      false,
    );
    wrapper.unmount();
  });
});

// ---- DOGFOOD-STABILIZATION-05 缺陷四：index 两个操作按钮的键盘长按重复激活 ----
// 页面真实组件级测试：mount 整个 index 页（happy-dom 下模板 <button> 渲染为
// 原生按钮），安装与 main.ts 相同的全局 h5-a11y 状态机后派发真实
// KeyboardEvent。长按 = 一次 repeat=false keydown + 多次 repeat=true keydown；
// 断言按钮动作（retryLoad / toggleTechnicalDetails）各自只发生一次。
describe("index 操作按钮键盘长按语义（DOGFOOD-STABILIZATION-05 缺陷四）", () => {
  // 与 h5-a11y.spec.ts 相同的模块级单例语义：整个文件只安装一次。
  beforeAll(() => {
    installH5A11yShims();
  });

  // 本 describe 位于外层 glue 块之外，这里复制其 mount 前置条件。
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", {
      navigateTo: vi.fn(),
    });
    stubRelationshipFetch();
  });

  function keydown(target: Element, key: string, repeat = false): void {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        repeat,
      }),
    );
  }

  function keyup(target: Element, key: string): void {
    target.dispatchEvent(
      new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }),
    );
  }

  async function baselineMock() {
    const baselineModule = await import("@/api/baseline");
    return baselineModule.fetchBaseline as ReturnType<typeof vi.fn>;
  }

  /** 与 VERSION-UI 用例同构的成功基线：让 state 进入 ready，技术详情按钮
   *  的 toggle 守卫（state === "ready"）才会放行动作。 */
  const READY_BASELINE = {
    application: "virtual-companion",
    phase: "TECHNICAL_ALPHA",
    transport: "HTTP_SSE",
    technology: {
      javaVersion: "25",
      springBootVersion: "4.1.0",
      springAiVersion: "1.0.0",
      springModulithVersion: "1.4.0",
    },
    catalogs: {
      source: "specs/generated/catalog.snapshot.json",
      riskLevels: [],
      generationStates: [],
      memoryScopes: [],
      modelProtocols: [],
      serviceModes: [],
    },
    capabilities: {
      source:
        "specs/generated/catalog.snapshot.json#sources/product-scope.yaml/document",
      publicRegistrationEnabled: false,
      paymentEnabled: false,
      romanceModeEnabled: false,
      voiceEnabled: false,
      imageEnabled: false,
      websocketEnabled: false,
      betaGenerationEnabledByDefault: false,
    },
  };

  it("retry 按钮：Enter 首次 keydown 激活一次重新校验，长按 repeat 不再触发", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const fetchBaselineMock = await baselineMock();
    fetchBaselineMock.mockClear();
    const retry = wrapper.find(".retry").element;

    keydown(retry, "Enter");
    await flushPromises();
    expect(fetchBaselineMock).toHaveBeenCalledTimes(1);

    // 模拟系统长按 repeat。每次 repeat 之间 flush：本地预检早已落定（真实
    // 长按下 OS repeat 间隔远大于该耗时，state 已离开 loading），页面上
    // 旧的 keydown 处理器此时会逐次再次触发 retryLoad。
    for (let i = 0; i < 3; i += 1) {
      keydown(retry, "Enter", true);
      await flushPromises();
    }
    expect(fetchBaselineMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("retry 按钮：Space 长按期间（含全部 repeat keydown）零激活，keyup 恰好补发一次", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const fetchBaselineMock = await baselineMock();
    fetchBaselineMock.mockClear();
    const retry = wrapper.find(".retry").element;

    keydown(retry, " ");
    for (let i = 0; i < 4; i += 1) {
      keydown(retry, " ", true);
      await flushPromises();
    }
    expect(fetchBaselineMock).not.toHaveBeenCalled();

    keyup(retry, " ");
    await flushPromises();
    expect(fetchBaselineMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("技术详情按钮：Enter 首次 keydown 展开一次，长按 repeat 不再翻转收起", async () => {
    const fetchBaselineMock = await baselineMock();
    fetchBaselineMock.mockResolvedValueOnce(READY_BASELINE);
    const wrapper = mountPage();
    await flushPromises();
    const toggle = wrapper.find("#technical-detail-toggle");
    expect(toggle.attributes("aria-disabled")).toBe("false");
    expect(toggle.attributes("aria-expanded")).toBe("false");

    keydown(toggle.element, "Enter");
    await flushPromises();
    expect(toggle.attributes("aria-expanded")).toBe("true");

    // 3 次 repeat 若仍走旧的 keydown 处理器（共 4 次翻转），会回到 false。
    for (let i = 0; i < 3; i += 1) {
      keydown(toggle.element, "Enter", true);
      await flushPromises();
    }
    expect(toggle.attributes("aria-expanded")).toBe("true");
    wrapper.unmount();
  });

  it("技术详情按钮：Space 长按期间保持收起，keyup 恰好展开一次", async () => {
    const fetchBaselineMock = await baselineMock();
    fetchBaselineMock.mockResolvedValueOnce(READY_BASELINE);
    const wrapper = mountPage();
    await flushPromises();
    const toggle = wrapper.find("#technical-detail-toggle");

    keydown(toggle.element, " ");
    for (let i = 0; i < 4; i += 1) {
      keydown(toggle.element, " ", true);
      await flushPromises();
    }
    // 按住期间（1 次首按 + 4 次 repeat）不得激活：旧的 keydown 处理器会
    // 翻转 5 次（奇数）而显示展开。
    expect(toggle.attributes("aria-expanded")).toBe("false");

    keyup(toggle.element, " ");
    await flushPromises();
    expect(toggle.attributes("aria-expanded")).toBe("true");
    wrapper.unmount();
  });
});
