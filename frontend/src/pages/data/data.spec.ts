// @vitest-environment happy-dom
// DATA-VIEW (FR-DATA-001): overview page glue. Fetch is stubbed; the page
// must drive the shipped store and list clients.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DataPage from "./data.vue";
import { useAuthStore } from "@/stores/auth";
import { DEFAULT_COMPANION_PREFS } from "@/api/relationship";

function stubFetch(fail = false): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (fail && !url.includes("/auth/sessions")) {
        return { ok: false, status: 500, json: async () => null };
      }
      if (url === "/api/v1/relationships") {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { relationshipId: 7, personaRef: "gentle-listener", active: true, ...DEFAULT_COMPANION_PREFS, companionName: "小安" },
          ],
        };
      }
      if (url === "/api/v1/conversations") {
        return {
          ok: true,
          status: 200,
          json: async () => [{ conversationId: 11, relationshipId: 7, createdAt: "2026-08-18T00:00:00Z", title: "夜聊" }],
        };
      }
      if (url === "/api/v1/relationships/7/memories") {
        return {
          ok: true,
          status: 200,
          json: async () => [{ memoryId: "3", scope: "RELATIONSHIP", summary: "喜欢安静的晚上", status: "ACCEPTED" }],
        };
      }
      if (url === "/api/v1/consents") {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              consentId: 1,
              consentType: "SERVICE_TERMS",
              version: "2026-08",
              granted: true,
              grantedAt: "2026-08-18T00:00:00Z",
            },
          ],
        };
      }
      if (url === "/api/v1/service-mode") {
        return { ok: true, status: 200, json: async () => ({ mode: "ZERO_LLM", summary: "当前为无生成模型的受限服务" }) };
      }
      if (url === "/api/v1/reports") {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 5,
              messageId: null,
              reason: "PRIVACY_OR_DATA",
              note: "导出不完整",
              status: "SUBMITTED",
              createdAt: "2026-08-19T08:00:00Z",
            },
          ],
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { calls };
}

describe("data page (FR-DATA-001)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
    const auth = useAuthStore();
    auth.accessToken = "test-token";
    auth.accountId = "42";
    auth.role = "USER";
  });

  it("renders stored domains from the real list APIs", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(DataPage, { attachTo: document.body });
    await flushPromises();

    expect(calls).toContain("/api/v1/relationships");
    expect(calls).toContain("/api/v1/conversations");
    expect(calls).toContain("/api/v1/relationships/7/memories");
    expect(calls).not.toContain("/api/v1/relationships/7/reminders");
    expect(calls).toContain("/api/v1/consents");
    expect(calls).toContain("/api/v1/service-mode");
    const accountSummary = wrapper.find('[data-testid="data-account"]').text();
    expect(accountSummary).toContain("账号与安全");
    expect(accountSummary).toContain("查看账号、安全与登录设置");
    expect(accountSummary).not.toContain("42");
    expect(accountSummary).not.toContain("USER");
    expect(wrapper.find('[data-testid="data-relationships"]').text()).toContain("小安");
    expect(wrapper.find('[data-testid="data-conversations"]').text()).toContain("夜聊");
    expect(wrapper.find('[data-testid="data-memories"]').text()).toContain("喜欢安静的晚上");
    expect(wrapper.find('[data-testid="data-reminders"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="data-consents"]').text()).toContain("用户服务协议");
    expect(wrapper.find('[data-testid="data-model"]').text()).toContain("无生成模型");
    // P2（round3）：模型模式原值（ZERO_LLM/FULL_AI）不再渲染，只保留可读 summary。
    expect(wrapper.find('[data-testid="data-model"]').text()).not.toContain("ZERO_LLM");
    expect(wrapper.find('[data-testid="data-model"]').text()).not.toContain("FULL_AI");
    // REPORT-BE: the appeal-status section reads the real intake list.
    expect(calls).toContain("/api/v1/reports");
    expect(wrapper.find('[data-testid="data-appeals"]').text()).toContain("隐私与数据权利");
    expect(wrapper.find('[data-testid="data-appeals"]').text()).toContain("已提交，等待人工处理");
    wrapper.unmount();
  });

  it("does not expose the internal account role in the overview", async () => {
    stubFetch();
    useAuthStore().role = "OPS_VIEWER";
    const wrapper = mount(DataPage, { attachTo: document.body });
    await flushPromises();

    const accountSummary = wrapper.find('[data-testid="data-account"]').text();
    expect(accountSummary).toContain("查看账号、安全与登录设置");
    expect(accountSummary).not.toContain("运维观察员");
    expect(accountSummary).not.toContain("OPS_VIEWER");
    wrapper.unmount();
  });

  it("DATA-JUMP: stored rows open the matching existing pages", async () => {
    stubFetch();
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mount(DataPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="data-open-account"]').trigger("click");
    await wrapper.find('[data-testid="data-open-companion"]').trigger("click");
    await wrapper.find('[data-testid="data-open-conversation"]').trigger("click");
    await wrapper.find('[data-testid="data-open-memory"]').trigger("click");
    await wrapper.find('[data-testid="data-open-consent"]').trigger("click");
    await wrapper.find('[data-testid="data-open-ai-notice"]').trigger("click");
    await wrapper.find('[data-testid="data-open-report"]').trigger("click");

    expect(navigateTo.mock.calls.map((call) => call[0])).toEqual([
      { url: "/pages/account/account" },
      { url: "/pages/companion/companion?relationshipId=7" },
      { url: "/pages/chat/chat?relationshipId=7&conversationId=11" },
      { url: "/pages/memory-detail/memory-detail?relationshipId=7&memoryId=3" },
      { url: "/pages/consent/consent" },
      { url: "/pages/ai-notice/ai-notice" },
      { url: "/pages/report/report" },
    ]);
    wrapper.unmount();
  });

  it("S0-21: a memory domain failure does not render as empty memory data", async () => {
    stubFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/relationships/7/memories") {
          return { ok: false, status: 500, json: async () => null };
        }
        if (url === "/api/v1/relationships") {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { relationshipId: 7, personaRef: "gentle-listener", active: true, ...DEFAULT_COMPANION_PREFS, companionName: "小安" },
            ],
          };
        }
        if (url === "/api/v1/conversations") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url === "/api/v1/consents") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (url === "/api/v1/service-mode") {
          return { ok: true, status: 200, json: async () => ({ mode: "ZERO_LLM", summary: "受限" }) };
        }
        if (url === "/api/v1/reports") {
          return { ok: true, status: 200, json: async () => [] };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mount(DataPage, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.find('[data-testid="data-partial"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="data-memories"]').text()).not.toContain("没有记忆记录");
    wrapper.unmount();
  });

  it("shows the load failure without inventing rows", async () => {
    stubFetch(true);
    const wrapper = mount(DataPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="data-load-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="data-relationships"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
