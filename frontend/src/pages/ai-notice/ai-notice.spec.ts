// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AiNoticePage from "./ai-notice.vue";

describe("AI notice page", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("identifies assistant output as AI-generated and does not offer a model picker", () => {
    vi.stubGlobal("uni", { navigateTo: vi.fn() });
    const wrapper = mount(AiNoticePage, { attachTo: document.body });

    expect(wrapper.find('[data-testid="ai-notice-intro"]').text()).toContain("AI 生成内容");
    expect(wrapper.find('[data-testid="ai-notice-intro"]').text()).toContain("不是真人");
    expect(wrapper.find('[data-testid="ai-notice-limits"]').text()).toContain("不选择供应商");
    // P2（round4）：服务模式以中文描述呈现，消费者页面不出现机器枚举原值。
    expect(wrapper.text()).toContain("全功能生成或零模型值守");
    expect(wrapper.text()).not.toContain("FULL_AI");
    expect(wrapper.text()).not.toContain("ZERO_LLM");
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.find("form").exists()).toBe(false);
    wrapper.unmount();
  });
});
