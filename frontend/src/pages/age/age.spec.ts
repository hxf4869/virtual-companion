// @vitest-environment happy-dom
// AGE-UI (FR-AUTH-002): adult-verification page glue. Fetch is stubbed;
// assertions drive the shipped page and store, not a parallel client.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AgePage from "./age.vue";
import { useAgeStore } from "@/stores/age";

function stubFetch(opts?: {
  state?: string;
  verifyStatus?: number;
  getStatus?: number;
  appealStatus?: number;
}): { calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = [];
  const state = opts?.state ?? "AGE_UNKNOWN";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url === "/api/v1/age/state" && method === "GET") {
        const status = opts?.getStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () =>
            status === 200
              ? {
                  ageState: state,
                  providerRef: state === "ADULT_VERIFIED" ? "alpha-simulated" : null,
                  verifiedAt: state === "ADULT_VERIFIED" ? "2026-08-18T00:00:00Z" : null,
                }
              : null,
        };
      }
      if (url === "/api/v1/age/verification" && method === "POST") {
        const status = opts?.verifyStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () =>
            status === 200
              ? {
                  ageState: "ADULT_VERIFIED",
                  providerRef: "alpha-simulated",
                  verifiedAt: "2026-08-18T00:00:00Z",
                }
              : { code: "INVALID_REQUEST" },
        };
      }
      if (url === "/api/v1/age/appeal" && method === "POST") {
        const status = opts?.appealStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () =>
            status === 200
              ? {
                  id: 7,
                  reason: "核验结果有误，我是成年人",
                  status: "SUBMITTED",
                  createdAt: "2026-08-19T08:00:00Z",
                }
              : { code: "INVALID_REQUEST" },
        };
      }
      if (url === "/api/v1/age/appeals" && method === "GET") {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { calls };
}

describe("age page (FR-AUTH-002)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
  });

  it("renders the admission shell (header + back) — 回归：漏注册会让页面无壳", async () => {
    stubFetch({ state: "AGE_UNKNOWN" });
    const wrapper = mount(AgePage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="page-header"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="page-back"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("loads the current age state and offers simulated verification", async () => {
    stubFetch({ state: "AGE_UNKNOWN" });
    const wrapper = mount(AgePage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="age-state-label"]').text()).toBe("尚未核验");
    expect(wrapper.find('[data-testid="age-state-code"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="age-verify"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("不保存身份证件");
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/我已成年/);
    wrapper.unmount();
  });

  it("posts verification only after the user clicks, then shows the verified state", async () => {
    const { calls } = stubFetch({ state: "AGE_UNKNOWN" });
    const wrapper = mount(AgePage, { attachTo: document.body });
    await flushPromises();

    expect(calls.some((c) => c.url === "/api/v1/age/verification")).toBe(false);

    await wrapper.find('[data-testid="age-verify"]').trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/age/verification")).toBe(
      true,
    );
    expect(useAgeStore().ageState).toBe("ADULT_VERIFIED");
    expect(wrapper.find('[data-testid="age-verified"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="age-verify"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("alpha-simulated");
    wrapper.unmount();
  });

  it("S0-22: ordinary age UI hides providerRef and shows a friendly method", async () => {
    stubFetch({ state: "ADULT_VERIFIED" });
    const wrapper = mount(AgePage, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.find('[data-testid="age-provider"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("alpha-simulated");
    expect(wrapper.find('[data-testid="age-method"]').text()).toContain("模拟核验");
    wrapper.unmount();
  });

  it("does not offer verification for a fail-closed minor state but offers the appeal", async () => {
    const { calls } = stubFetch({ state: "MINOR_SUSPECTED" });
    const wrapper = mount(AgePage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="age-blocked"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="age-verify"]').exists()).toBe(false);
    // AGE-APPEAL: an appealable state gets the submission form; the page
    // never rewrites the verdict itself.
    expect(wrapper.find('[data-testid="age-appeal-form"]').exists()).toBe(true);
    expect(calls.some((c) => c.url === "/api/v1/age/verification")).toBe(false);
    wrapper.unmount();
  });

  it("AGE-APPEAL: submits an appeal after the user writes the reason and flips to 申诉处理中", async () => {
    stubFetch({ state: "ADULT_VERIFICATION_REQUIRED" });
    const wrapper = mount(AgePage, { attachTo: document.body });
    await flushPromises();

    const submit = wrapper.find('[data-testid="age-appeal-submit"]');
    expect(submit.exists()).toBe(true);
    expect((submit.element as HTMLButtonElement).disabled).toBe(true);

    await wrapper.find('[data-testid="age-appeal-reason"]').setValue("核验结果有误，我是成年人");
    await submit.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="age-appeal-ok"]').exists()).toBe(true);
    expect(useAgeStore().ageState).toBe("AGE_APPEAL_PENDING");
    expect(wrapper.find('[data-testid="age-appeal-pending"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("AGE-APPEAL: a rejected submission keeps the state and never fakes success", async () => {
    stubFetch({ state: "ADULT_VERIFICATION_REQUIRED" });
    const wrapper = mount(AgePage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="age-appeal-reason"]').setValue("再试一次");
    // Fail the next POST /age/appeal with 400 (catalog fail-closed).
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => ({
      ok: false,
      status: 400,
      json: async () => ({ code: "INVALID_REQUEST" }),
      url: typeof input === "string" ? input : input.toString(),
    }));
    await wrapper.find('[data-testid="age-appeal-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="age-appeal-rejected"]').exists()).toBe(true);
    expect(useAgeStore().ageState).toBe("ADULT_VERIFICATION_REQUIRED");
    wrapper.unmount();
  });

  it("shows a load failure without inventing a verified state", async () => {
    stubFetch({ getStatus: 500 });
    const wrapper = mount(AgePage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="age-load-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="age-verify"]').exists()).toBe(false);
    expect(useAgeStore().ageState).toBe("AGE_UNKNOWN");
    wrapper.unmount();
  });
});
