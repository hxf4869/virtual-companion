// @vitest-environment happy-dom
// REPORT-BE (FR-DATA-001 / §20.15): report & complaint intake page glue. Fetch
// is stubbed; assertions drive the shipped page and store, not a parallel
// client. No invented ticket numbers, SLA promises or hotline role-play.
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ReportPage from "./report.vue";
import { useAuthStore } from "@/stores/auth";
import { useReportStore } from "@/stores/report";

const REPORT_JSON = {
  id: 5,
  messageId: null,
  reason: "UNSAFE_CONTENT",
  note: "让我不安",
  status: "SUBMITTED",
  createdAt: "2026-08-19T08:00:00Z",
};

function stubFetch(opts: { listJson?: unknown; createStatus?: number } = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url === "/api/v1/reports" && method === "GET") {
        return { ok: true, status: 200, json: async () => opts.listJson ?? [REPORT_JSON] };
      }
      if (url === "/api/v1/reports" && method === "POST") {
        const status = opts.createStatus ?? 200;
        return {
          ok: status === 200,
          status,
          json: async () => (status === 200 ? { ...REPORT_JSON, messageId: "10" } : null),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
  return { calls };
}

describe("report page (REPORT-BE)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
    const auth = useAuthStore();
    auth.accessToken = "test-token";
    auth.accountId = "42";
    auth.role = "USER";
  });

  it("renders the intake form and the caller's report history", async () => {
    stubFetch({ listJson: [REPORT_JSON] });
    const wrapper = mount(ReportPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="report-reason-UNSAFE_CONTENT"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="report-note"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="report-submit"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="report-row-5"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="report-status-5"]').text()).toContain("等待人工处理");
    expect(wrapper.text()).not.toMatch(/工单号|回电|客服热线|24 小时内/);
    wrapper.unmount();
  });

  it("submits only after a reason and a non-empty note, then shows the row", async () => {
    const { calls } = stubFetch();
    const wrapper = mount(ReportPage, { attachTo: document.body });
    await flushPromises();

    const submit = wrapper.find('[data-testid="report-submit"]');
    expect((submit.element as HTMLButtonElement).disabled).toBe(true);

    await wrapper.find('[data-testid="report-note"]').setValue("这条回复让我不安");
    await wrapper.find('[data-testid="report-reason-UNSAFE_CONTENT"]').trigger("click");
    await submit.trigger("click");
    await flushPromises();

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/reports")).toBe(true);
    expect(wrapper.find('[data-testid="report-submit-ok"]').exists()).toBe(true);
    expect(useReportStore().reports[0].id).toBe("5");
    wrapper.unmount();
  });

  it("a rejected create never appends a row and says so plainly", async () => {
    stubFetch({ createStatus: 400 });
    const wrapper = mount(ReportPage, { attachTo: document.body });
    await flushPromises();

    await wrapper.find('[data-testid="report-note"]').setValue("描述");
    await wrapper.find('[data-testid="report-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="report-submit-rejected"]').exists()).toBe(true);
    expect(useReportStore().reports).toHaveLength(1); // the seeded history row only
    wrapper.unmount();
  });

  it("shows a load failure for the history without faking rows", async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 500, json: async () => null }));
    vi.stubGlobal("fetch", failing);
    const wrapper = mount(ReportPage, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[data-testid="report-load-failed"]').exists()).toBe(true);
    expect(useReportStore().loaded).toBe(false);
    wrapper.unmount();
  });
});
