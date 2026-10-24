// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it } from "vitest";

import VcAuthField from "./VcAuthField.vue";

// VC-R166：uni-h5 useValueSync 对外 update:modelValue 有 100ms 节流
// （原始 input 只同步内部 state）。程序化快速重填后存在真实窗口：
// 字段 DOM 已是新值、父组件 modelValue 仍旧值。用「直接设 DOM 值、
// 不派发 input」模拟节流尚未送达的场景，验证组件在 blur 与 uni 原生
// confirm 两个时机先同步值再提交。

function mountField(modelValue = "old-value") {
  return mount(VcAuthField, {
    props: {
      modelValue,
      fieldId: "vc-r166-field",
      label: "密码",
      kind: "password",
    },
    attachTo: document.body,
  });
}

function inputElement(wrapper: ReturnType<typeof mountField>): HTMLInputElement {
  return wrapper.get("input").element as HTMLInputElement;
}

async function setValueWithoutInputEvent(
  wrapper: ReturnType<typeof mountField>,
  value: string,
): Promise<void> {
  inputElement(wrapper).value = value;
  await nextTick();
}

describe("VC-R166 VcAuthField value sync", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("blur 先把字段当前值同步给父组件（节流尚未送达时）", async () => {
    const wrapper = mountField();
    try {
      await setValueWithoutInputEvent(wrapper, "new-value");
      inputElement(wrapper).dispatchEvent(new Event("blur"));
      await nextTick();
      expect((wrapper.emitted("update:modelValue") ?? []).at(-1))
        .toEqual(["new-value"]);
    } finally {
      wrapper.unmount();
    }
  });

  it("confirm 先从事件值同步再提交且只提交一次；keydown.enter 不再抢跑旧值", async () => {
    // 父监听同步记录「submit 时刻观察到的当前值」——不是事后 emitted 终值：
    // 先 submit 后 update 的错误顺序必须被此断言抓住。
    let currentValue = "old-value";
    const valueAtSubmit: string[] = [];
    const wrapper = mount(VcAuthField, {
      props: {
        modelValue: "old-value",
        fieldId: "vc-r166-field",
        label: "密码",
        kind: "password",
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
      await setValueWithoutInputEvent(wrapper, "new-value");
      // 旧行为在 keydown.enter 立即 emit submit（早于 uni 原生 confirm，
      // 且此刻父组件仍是节流前的旧值）：修复后该入口删除，仅 confirm 提交。
      inputElement(wrapper).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await nextTick();
      expect(wrapper.emitted("submit")).toBeUndefined();
      expect(valueAtSubmit).toEqual([]);

      inputElement(wrapper).dispatchEvent(
        new CustomEvent("confirm", { detail: { value: "new-value" } }),
      );
      await nextTick();
      expect(wrapper.emitted("submit")).toHaveLength(1);
      // 唯一一次提交发生在值同步之后：提交时刻观察到的是新值。
      expect(valueAtSubmit).toEqual(["new-value"]);
    } finally {
      wrapper.unmount();
    }
  });
});
