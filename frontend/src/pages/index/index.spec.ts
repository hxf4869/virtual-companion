// @vitest-environment happy-dom
// TASK-0204: index page glue test -- internal page entries navigate to the
// existing chat/memory/login routes without changing baseline preflight.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("renders internal entries for chat, memory, and login", () => {
    const wrapper = mountPage();
    const nav = wrapper.find('[data-testid="alpha-nav"]');
    expect(nav.exists()).toBe(true);
    expect(nav.attributes("role")).toBe("navigation");
    expect(wrapper.find('[data-testid="nav-chat"]').text()).toContain("离线聊天");
    expect(wrapper.find('[data-testid="nav-memory"]').text()).toContain("记忆管理");
    expect(wrapper.find('[data-testid="nav-age"]').text()).toContain("成年核验");
    expect(wrapper.find('[data-testid="nav-data"]').text()).toContain("我的数据");
    expect(wrapper.find('[data-testid="nav-help"]').text()).toContain("帮助与安全支持");
    expect(wrapper.find('[data-testid="nav-ai-notice"]').text()).toContain("模型与 AI 标识");
    expect(wrapper.find('[data-testid="nav-health"]').text()).toContain("使用时长");
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
    wrapper.unmount();
  });

  it("hides the account management entry for non-admin sessions", () => {
    const auth = useAuthStore();
    auth.role = "USER";
    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="nav-admin"]').exists()).toBe(false);
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

  // ---- ACCT-DELETE (FR-AUTH-004): self-service deletion danger zone ----

  it("two-step deletion confirms, deletes, clears the session and routes to login", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/v1/auth/account" && (init?.method ?? "GET") === "DELETE") {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const auth = useAuthStore();
    auth.accessToken = "a-token";
    const wrapper = mountPage();
    await flushPromises();

    // First step: no confirm panel until the danger zone is opened.
    expect(wrapper.find('[data-testid="delete-account-confirm"]').exists()).toBe(false);
    await wrapper.find('[data-testid="delete-account-open"]').trigger("click");
    expect(wrapper.find('[data-testid="delete-account-confirm"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("合规审计日志无法立即清除");

    // Second step: confirm deletes and clears the local session.
    await wrapper.find('[data-testid="delete-account-confirm-btn"]').trigger("click");
    await flushPromises();

    const deleteCall = fetchMock.mock.calls.find(
      (call) => String(call[0]) === "/api/v1/auth/account",
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]?.method).toBe("DELETE");
    expect(auth.accessToken).toBeNull();
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/login/login" });
    wrapper.unmount();
  });

  it("cancel closes the deletion confirm panel without calling the API", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="delete-account-open"]').trigger("click");
    expect(wrapper.find('[data-testid="delete-account-confirm"]').exists()).toBe(true);

    await wrapper.find('[data-testid="delete-account-cancel"]').trigger("click");

    expect(wrapper.find('[data-testid="delete-account-confirm"]').exists()).toBe(false);
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/auth/account")),
    ).toBe(false);
    wrapper.unmount();
  });

  it("a failed deletion keeps the panel open and shows the error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/auth/account" && (init?.method ?? "GET") === "DELETE") {
          return { ok: false, status: 500, json: async () => null };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mountPage();
    await flushPromises();

    await wrapper.find('[data-testid="delete-account-open"]').trigger("click");
    await wrapper.find('[data-testid="delete-account-confirm-btn"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="delete-account-confirm"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="delete-account-error"]').text()).toContain("未获确认");
    wrapper.unmount();
  });
});
