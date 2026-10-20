// @vitest-environment happy-dom
// VC-R02：中文输入法 Enter 缺陷——IME 组合期间（isComposing 为 true 或遗留
// keyCode 229）的 Enter 不得发送也不得 preventDefault；普通 Enter 发送一次；
// Shift+Enter 保持换行语义（不发送、不 preventDefault）。
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import VcChatComposer from "./VcChatComposer.vue";

interface EnterOptions {
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

// happy-dom 的 KeyboardEvent 构造器不接受 keyCode/isComposing 之外的
// legacy 初始化键，keyCode 统一用 Object.defineProperty 补在实例上。
function enterEvent(options: EnterOptions = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: options.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "keyCode", {
    value: options.keyCode ?? 13,
  });
  if (options.isComposing !== undefined) {
    Object.defineProperty(event, "isComposing", {
      value: options.isComposing,
    });
  }
  return event;
}

function mountComposer() {
  return mount(VcChatComposer, {
    props: {
      modelValue: "半成品候选文本",
      busy: false,
      streaming: false,
    },
  });
}

function pressEnter(options?: EnterOptions) {
  const wrapper = mountComposer();
  const event = enterEvent(options);
  wrapper.find('[data-testid="message-input"]').element.dispatchEvent(event);
  return { wrapper, event };
}

describe("VcChatComposer IME Enter 防护", () => {
  it("isComposing 为 true 的 Enter 不发送且不 preventDefault", () => {
    const { wrapper, event } = pressEnter({ isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.emitted("send")).toBeUndefined();
    wrapper.unmount();
  });

  it("keyCode 为 229 的 Enter 不发送且不 preventDefault", () => {
    const { wrapper, event } = pressEnter({ keyCode: 229 });

    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.emitted("send")).toBeUndefined();
    wrapper.unmount();
  });

  it("普通 Enter 恰好发送一次且 preventDefault", () => {
    const { wrapper, event } = pressEnter();

    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted("send")).toHaveLength(1);
    wrapper.unmount();
  });

  it("Shift+Enter 不发送且不 preventDefault（保持换行）", () => {
    const { wrapper, event } = pressEnter({ shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.emitted("send")).toBeUndefined();
    wrapper.unmount();
  });
});
