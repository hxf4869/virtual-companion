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

function stubFetch(): { calls: { method: string; url: string; body?: unknown }[] } {
  const calls: { method: string; url: string; body?: unknown }[] = [];
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
        return { ok: true, status: 200, json: async () => [ACTIVE] };
      }
      if (url === "/api/v1/relationships/7" && method === "PATCH") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ...ACTIVE, ...(body as object) }),
        };
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
});
