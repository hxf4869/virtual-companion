// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it } from "vitest";

import VcTotpCodeInput from "./VcTotpCodeInput.vue";

// VC-R167：uni-h5 useValueSync 对外 update:modelValue 有 100ms 节流；快速
// 重填后存在「DOM 已是新值、父组件仍旧值」的窗口。用「直接设 DOM 值、不
// 派发 input」模拟节流尚未送达，验证 blur 与 uni 原生 confirm 两个时机
// 先按既有规则（ASCII 纯数字 + 6 位截断）同步，再由 confirm 提交。

function inputElement(wrapper: ReturnType<typeof mount>): HTMLInputElement {
  return wrapper.get("input").element as HTMLInputElement;
}

async function setValueWithoutInputEvent(
  wrapper: ReturnType<typeof mount>,
  value: string,
): Promise<void> {
  inputElement(wrapper).value = value;
  await nextTick();
}

describe("VC-R167 VcTotpCodeInput value sync", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("blur 先把字段当前值按既有规则（纯数字+6位截断）同步给父组件", async () => {
    const wrapper = mount(VcTotpCodeInput, {
      props: { modelValue: "111111" },
      attachTo: document.body,
    });
    try {
      await setValueWithoutInputEvent(wrapper, "12a34567b");
      inputElement(wrapper).dispatchEvent(new Event("blur"));
      await nextTick();
      expect((wrapper.emitted("update:modelValue") ?? []).at(-1))
        .toEqual(["123456"]);
      expect(wrapper.emitted("submit")).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });

  it("confirm 先按既有规则同步再提交且只提交一次；keydown.enter 不再抢跑旧码", async () => {
    // 父监听同步记录「submit 时刻观察到的当前值」——不是事后 emitted 终值：
    // 先 submit 后 update 的错误顺序必须被此断言抓住。
    let currentValue = "111111";
    const valueAtSubmit: string[] = [];
    const wrapper = mount(VcTotpCodeInput, {
      props: {
        modelValue: "111111",
        "onUpdate:modelValue": (value: string) => {
          currentValue = value;
        },
        onSubmit: () => {
          valueAtSubmit.push(currentValue);
        },
      },
      attachTo: document.body,
    });
    try {
      await setValueWithoutInputEvent(wrapper, "98 7654x");
      // 旧行为在 keydown.enter 立即 emit submit（早于 uni 原生 confirm，
      // 且此刻父组件仍是节流前的旧码）：修复后该入口删除，仅 confirm 提交。
      inputElement(wrapper).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await nextTick();
      expect(wrapper.emitted("submit")).toBeUndefined();
      expect(valueAtSubmit).toEqual([]);

      inputElement(wrapper).dispatchEvent(
        new CustomEvent("confirm", { detail: { value: "98 7654x" } }),
      );
      await nextTick();
      expect(wrapper.emitted("submit")).toHaveLength(1);
      // 唯一一次提交发生在值同步之后：提交时刻观察到的是新规范化值。
      expect(valueAtSubmit).toEqual(["987654"]);
    } finally {
      wrapper.unmount();
    }
  });
});
