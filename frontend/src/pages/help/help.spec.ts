// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import HelpPage from "./help.vue";

describe("help page", () => {
  it("states the service boundary without a report or appeal form", () => {
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
    const wrapper = mount(HelpPage, { attachTo: document.body });

    expect(wrapper.find('[data-testid="help-intro"]').text()).toContain("不是真人");
    expect(wrapper.find('[data-testid="help-boundaries"]').text()).toContain("不能替代");
    expect(wrapper.find('[data-testid="help-when"]').text()).toContain("紧急服务");
    expect(wrapper.find('[data-testid="help-reports"]').text()).toContain("尚未接通");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.find('input[type="submit"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/请留下联系方式|提交工单|我们会回电/);
    wrapper.unmount();
  });
});
