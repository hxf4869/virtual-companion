// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import AiNoticePage from "./ai-notice.vue";

describe("AI notice page", () => {
  it("identifies assistant output as AI-generated and does not offer a model picker", () => {
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
    const wrapper = mount(AiNoticePage, { attachTo: document.body });

    expect(wrapper.find('[data-testid="ai-notice-intro"]').text()).toContain("AI 生成内容");
    expect(wrapper.find('[data-testid="ai-notice-intro"]').text()).toContain("不是真人");
    expect(wrapper.find('[data-testid="ai-notice-limits"]').text()).toContain("不选择供应商");
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.find("form").exists()).toBe(false);
    wrapper.unmount();
  });
});
