// @vitest-environment happy-dom
// VC-R02：中文输入法 Enter 缺陷——IME 组合期间（isComposing 为 true 或遗留
// keyCode 229）的 Enter 不得发送也不得 preventDefault；普通 Enter 发送一次；
// Shift+Enter 保持换行语义（不发送、不 preventDefault）。
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
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

// ---- VC-R115：错误重试按钮的可选文案 ----

function mountComposerWithError(props: { retryLabel?: string } = {}) {
  return mount(VcChatComposer, {
    props: {
      modelValue: "下一条草稿",
      busy: false,
      streaming: false,
      errorText: "没有确认发送结果，点此重试",
      canRetry: true,
      ...props,
    },
  });
}

describe("VcChatComposer 重试文案", () => {
  it("不传 retryLabel 时按钮默认文案为「点此重试」，点击仍 emit retry", async () => {
    const wrapper = mountComposerWithError();
    const retry = wrapper.find('[data-testid="retry"]');

    expect(retry.text()).toBe("点此重试");
    await retry.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    wrapper.unmount();
  });

  it("传 retryLabel 时按钮渲染该文案，点击仍 emit retry", async () => {
    const wrapper = mountComposerWithError({ retryLabel: "重试原消息" });
    const retry = wrapper.find('[data-testid="retry"]');

    expect(retry.text()).toBe("重试原消息");
    await retry.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    wrapper.unmount();
  });
});

// ---- VC-R183：程序性清空的输入控件实例归属 ----
// 真实 H5 中 uni-h5 对 input 发射做 100ms 节流：父级发送后同步清空
// modelValue 时，旧 textarea 实例的尾部发射会携带已发送草稿迟到回写。
// 组件以 key 重建实例作废旧发射归属；此处验证触发边界与焦点语义。

function mountAttachedComposer(extraProps: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const wrapper = mount(VcChatComposer, {
    props: { modelValue: "", busy: false, streaming: false, ...extraProps },
    attachTo: container,
  });
  return { wrapper, container };
}

function fieldOf(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid="message-input"]');
}

describe("VcChatComposer 程序性清空实例归属", () => {
  it("提交入口先同步上报未发射的完整原生输入再 send", async () => {
    // uni 对 input 发射做 100ms 节流：连续输入的尾字符可能尚未进入父级
    // modelValue。提交意图必须等于用户当前看到的完整原生输入——emit send
    // 之前先沿既有 update:modelValue 协议同步完整值。只记录事件类别与长度。
    const events: Array<[string, number]> = [];
    const { wrapper, container } = mountAttachedComposer({
      modelValue: "开头一句",
      "onUpdate:modelValue": (value: string) => events.push(["update", value.length]),
      onSend: () => events.push(["send", -1]),
    });
    try {
      const field = fieldOf(wrapper);
      // 父级模型仍是旧文本；原生字段已被用户补上尾字而 uni 延迟上报
      // （直接写 value、不发 input 事件），随后点击发送。
      (field.element as HTMLTextAreaElement).value = "开头一句加尾字";
      await wrapper.find('[data-testid="send"]').trigger("click");

      const updateIndex = events.findIndex(([kind]) => kind === "update");
      const sendIndex = events.findIndex(([kind]) => kind === "send");
      expect(updateIndex, "send 之前必须先上报完整输入").toBeGreaterThanOrEqual(0);
      expect(sendIndex, "send 必须晚于完整输入上报").toBeGreaterThan(updateIndex);
      expect(events[updateIndex]?.[1], "上报的是含尾字的完整原生长度").toBe("开头一句加尾字".length);
    } finally {
      wrapper.unmount();
      container.remove();
    }
  });

  it("用户自己删空不重建实例", async () => {
    const { wrapper, container } = mountAttachedComposer();
    try {
      const field = fieldOf(wrapper);
      await field.setValue("草稿");
      await wrapper.setProps({ modelValue: "草稿" });
      const before = field.element;

      await field.setValue("");
      await wrapper.setProps({ modelValue: "" });

      expect(fieldOf(wrapper).element).toBe(before);
    } finally {
      wrapper.unmount();
      container.remove();
    }
  });

  it("程序性清空时字段原有焦点在新实例上保留，未聚焦或已被接管时不抢焦点", async () => {
    const { wrapper, container } = mountAttachedComposer();
    try {
      const field = fieldOf(wrapper);
      await field.setValue("草稿");
      await wrapper.setProps({ modelValue: "草稿" });
      (field.element as HTMLTextAreaElement).focus();
      expect(document.activeElement).toBe(field.element);

      await wrapper.setProps({ modelValue: "" });
      await nextTick();
      const fresh = fieldOf(wrapper).element as HTMLTextAreaElement;
      expect(fresh).not.toBe(field.element);
      expect(document.activeElement).toBe(fresh);

      // 字段未聚焦（如按钮点击发送后）程序性清空：不抢焦点。
      fresh.blur();
      expect(document.activeElement).not.toBe(fresh);
      await fieldOf(wrapper).setValue("再写一句");
      await wrapper.setProps({ modelValue: "再写一句" });
      await wrapper.setProps({ modelValue: "" });
      await nextTick();
      expect(document.activeElement).not.toBe(fieldOf(wrapper).element);

      // 焦点已被其他已连接控件接管时程序性清空：不无条件抢回。
      const other = wrapper.find('[data-testid="send"]').element as HTMLButtonElement;
      await fieldOf(wrapper).setValue("第三句");
      await wrapper.setProps({ modelValue: "第三句" });
      other.focus();
      expect(document.activeElement).toBe(other);
      await wrapper.setProps({ modelValue: "" });
      await nextTick();
      expect(document.activeElement).toBe(other);
    } finally {
      wrapper.unmount();
      container.remove();
    }
  });
});
