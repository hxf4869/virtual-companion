// @vitest-environment happy-dom
// REPORT-PAGE: dedicated report/appeal page. Ticket API is not wired.
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import ReportPage from "./report.vue";

describe("report page", () => {
  it("states that tickets are not wired and offers no form", () => {
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
    const wrapper = mount(ReportPage, { attachTo: document.body });

    expect(wrapper.find('[data-testid="report-status"]').text()).toContain("尚未接通");
    expect(wrapper.find('[data-testid="report-status"]').text()).toContain("表单");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.find('input[type="submit"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/请留下联系方式|提交工单|我们会回电/);
    wrapper.unmount();
  });
});
