// @vitest-environment happy-dom
// COMP-CFG (FR-COMP-003) + COMP-PRES (FR-COMP-002): companion settings page
// glue test (behavioral prefs plus gender/avatar presentation).
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CompanionPage from "./companion.vue";
import { DEFAULT_COMPANION_PREFS } from "@/api/relationship";
import { useRelationshipStore } from "@/stores/relationship";

const ACTIVE = {
  relationshipId: "7",
  personaRef: "gentle-listener",
  active: true,
  createdAt: "2026-08-17T00:00:00Z",
  ...DEFAULT_COMPANION_PREFS,
  companionName: "小安",
  replyLength: "SHORT",
};

function stubFetch(options: {
  relationships?: unknown[];
  activationResponse?: { ok: boolean; status: number; json: () => Promise<unknown> };
} = {}): { calls: { method: string; url: string; body?: unknown }[] } {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  let deleted = false;
  let archived = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      calls.push({ method, url, body });
      if (url === "/api/v1/relationships" && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => (deleted ? [] : options.relationships ?? [ACTIVE]),
        };
      }
      if (/^\/api\/v1\/relationships\/[^/]+$/.test(url) && method === "POST") {
        return options.activationResponse ?? {
          ok: true,
          status: 200,
          json: async () => ACTIVE,
        };
      }
      if (url === "/api/v1/relationships/7" && method === "PATCH") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...ACTIVE, ...(body as object) }),
        };
      }
      if (url === "/api/v1/relationships/7/clearance-preview" && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            relationshipId: 7,
            conversationCount: 2,
            memoryCount: 3,
            reminderCount: 1,
          }),
        };
      }
      if (url === "/api/v1/relationships/7/reset" && method === "POST") {
        return { ok: true, status: 200, json: async () => ACTIVE };
      }
      if (url === "/api/v1/relationships/7" && method === "DELETE") {
        deleted = true;
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (url.startsWith("/api/v1/relationships/7/reset") && method === "POST") {
        archived = url.includes("retainImportable=true");
        return { ok: true, status: 200, json: async () => ACTIVE };
      }
      if (url.startsWith("/api/v1/memory-imports") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            personaRef: "gentle-listener",
            acceptedCount: archived ? 2 : 0,
            createdAt: archived ? "2026-08-19T00:00:00Z" : undefined,
          }),
        };
      }
      if (url === "/api/v1/relationships/7/memory-imports" && method === "POST") {
        return { ok: true, status: 200, json: async () => ({ importedCount: 2 }) };
      }
      if (url.startsWith("/api/v1/memory-imports") && method === "DELETE") {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { calls };
}

describe("companion page (FR-COMP-003 / FR-COMP-002)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
  });

  it("loads the current relationship prefs into the form", async () => {
    stubFetch();
    const wrapper = mount(CompanionPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="companion-name"]').element).toHaveProperty("value", "小安");
    expect((wrapper.find('[data-testid="companion-reply-length"]').element as HTMLSelectElement).value).toBe(
      "SHORT",
    );
    expect(wrapper.find('[data-testid="companion-gender-NEUTRAL"]').attributes("checked")).toBe("true");
    expect(
      wrapper.find('[data-testid="companion-avatar-AVATAR_NEUTRAL_01"]').attributes("checked"),
    ).toBe("true");
    wrapper.unmount();
  });

  it("gives every structured preference select an accessible name", async () => {
    stubFetch();
    const wrapper = mount(CompanionPage, { attachTo: document.body });
    await flushPromises();

    const fields = [
      ["companion-reply-length", "回复长度"],
      ["companion-initiative", "主动程度"],
      ["companion-humor", "幽默程度"],
      ["companion-advice", "建议偏好"],
      ["companion-memory-scope", "记忆共享范围"],
    ] as const;

    for (const [testId, label] of fields) {
      expect(wrapper.find(`[data-testid="${testId}"]`).attributes("aria-label")).toBe(label);
    }
    wrapper.unmount();
  });

  it("saves structured prefs through PATCH", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(CompanionPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="companion-name"]').setValue("倾听者");
    await wrapper.find('[data-testid="companion-save"]').trigger("click");
    await flushPromises();

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe("/api/v1/relationships/7");
    expect(patch?.body).toMatchObject({
      companionName: "倾听者",
      replyLength: "SHORT",
      memoryShareScope: "RELATIONSHIP",
      gender: "NEUTRAL",
      avatarRef: "AVATAR_NEUTRAL_01",
    });
    expect(wrapper.find('[data-testid="companion-saved"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("selects gender and the curated avatar follow-up, then saves both", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(CompanionPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="companion-gender-MALE"]').trigger("click");
    expect(wrapper.find('[data-testid="companion-gender-MALE"]').attributes("checked")).toBe("true");
    expect(
      wrapper.find('[data-testid="companion-avatar-AVATAR_MALE_01"]').attributes("checked"),
    ).toBe("true");

    await wrapper.find('[data-testid="companion-save"]').trigger("click");
    await flushPromises();

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toMatchObject({
      gender: "MALE",
      avatarRef: "AVATAR_MALE_01",
    });
    wrapper.unmount();
  });

  it("does not offer a photo upload for the avatar", async () => {
    stubFetch();
    const wrapper = mount(CompanionPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("不支持上传照片");
    wrapper.unmount();
  });

  it("asks the user to pick a relationship when none is active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/v1/relationships") {
          return { ok: true, status: 200, json: async () => [] };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const wrapper = mount(CompanionPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="companion-no-rel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="companion-save"]').exists()).toBe(false);
    expect(useRelationshipStore().current).toBeNull();
    wrapper.unmount();
  });

  it("keeps the current relationship and allows retry when activation is hidden", async () => {
    const { calls } = stubFetch({
      relationships: [
        ACTIVE,
        { ...ACTIVE, relationshipId: "8", active: false, companionName: "另一位伙伴" },
      ],
      activationResponse: { ok: false, status: 404, json: async () => null },
    });
    const wrapper = mount(CompanionPage, { attachTo: document.body });
    await flushPromises();

    const relStore = useRelationshipStore();
    expect(relStore.currentRelationshipId).toBe("7");

    await wrapper.find('[data-testid="relationship-select"]').setValue("8");
    await flushPromises();

    const activationCalls = () =>
      calls.filter((call) => call.method === "POST" && call.url === "/api/v1/relationships/8");
    expect(activationCalls()).toHaveLength(1);
    expect(relStore.currentRelationshipId).toBe("7");
    expect(wrapper.find('[data-testid="companion-action-failed"]').text()).toContain(
      "切换伙伴失败，请重试",
    );
    const restoredSelect = wrapper.find('[data-testid="relationship-select"]');
    expect((restoredSelect.element as HTMLSelectElement).value).toBe("7");
    expect((restoredSelect.element as HTMLSelectElement).disabled).toBe(false);

    await restoredSelect.setValue("8");
    await flushPromises();
    expect(activationCalls()).toHaveLength(2);
    expect(relStore.currentRelationshipId).toBe("7");
    wrapper.unmount();
  });

  it("loads a factual preview and does not write until reset is confirmed", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(CompanionPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="companion-reset-open"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="companion-clearance-preview"]').text()).toContain(
      "将清除 2 个会话和 3 条记忆",
    );
    expect(wrapper.text()).toContain("重置后会保留这个角色及其设置");
    expect(wrapper.text()).not.toMatch(/挽留|难过|再考虑|舍不得|求求/);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/reset"))).toBe(false);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await wrapper.find('[data-testid="companion-reset-confirm"]').trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/relationships/7/reset")).toBe(
      true,
    );
    expect(useRelationshipStore().currentRelationshipId).toBe("7");
    wrapper.unmount();
  });

  it("deletes only after the second confirm and clears the current companion", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(CompanionPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="companion-delete-open"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="companion-clearance-preview"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("删除后会移除这个角色");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await wrapper.find('[data-testid="companion-delete-confirm"]').trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/v1/relationships/7")).toBe(
      true,
    );
    expect(useRelationshipStore().current).toBeNull();
    expect(wrapper.find('[data-testid="companion-no-rel"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("does not expose deferred memory import controls or requests", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(CompanionPage, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.find('[data-testid="retain-importable"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="memory-import-prompt"]').exists()).toBe(false);
    expect(calls.some((c) => c.url.includes("memory-import"))).toBe(false);
    wrapper.unmount();
  });
});
