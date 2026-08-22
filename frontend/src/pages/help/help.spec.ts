// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import HelpPage from "./help.vue";

describe("help page", () => {
  it("states the service boundary without a report or appeal form inline", () => {
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
    const wrapper = mount(HelpPage, { attachTo: document.body });

    expect(wrapper.find('[data-testid="help-intro"]').text()).toContain("不是真人");
    expect(wrapper.find('[data-testid="help-boundaries"]').text()).toContain("不能替代");
    expect(wrapper.find('[data-testid="help-when"]').text()).toContain("紧急服务");
    // The intake itself lives on the report page; help stays read-only.
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.find('input[type="submit"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/请留下联系方式|提交工单|我们会回电/);
    wrapper.unmount();
  });

  it("S0-05: routes to the real report intake and drops the stale not-connected claim", async () => {
    const navigateTo = vi.fn();
    vi.stubGlobal("uni", { navigateTo });
    const wrapper = mount(HelpPage, { attachTo: document.body });

    const reports = wrapper.find('[data-testid="help-reports"]');
    expect(reports.text()).not.toContain("尚未接通");
    expect(reports.text()).toContain("如实显示");
    expect(reports.text()).toContain("处理状态");

    const nav = wrapper.find('[data-testid="nav-report"]');
    expect(nav.exists()).toBe(true);
    await nav.trigger("click");
    expect(navigateTo).toHaveBeenCalledWith({ url: "/pages/report/report" });

    // Boundaries stay: no invented hotline, ticket numbers or SLA promises.
    expect(wrapper.text()).not.toMatch(/工单号|回电|客服热线|24 小时内/);
    wrapper.unmount();
  });
});
