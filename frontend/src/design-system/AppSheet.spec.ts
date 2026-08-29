// @vitest-environment happy-dom
// MODAL-FOCUS (P1-7)：AppSheet 完整模态焦点管理——焦点移入、Tab 焦点圈、
// Escape 关闭、关闭归还焦点、遮罩与明确关闭按钮保留。
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AppSheet from "./AppSheet.vue";

function mountSheet(open = false) {
  const trigger = document.createElement("button");
  trigger.textContent = "打开";
  document.body.appendChild(trigger);
  trigger.focus();

  const wrapper = mount(AppSheet, {
    props: { open, title: "更多操作" },
    slots: {
      default:
        '<button type="button" data-testid="sheet-a">动作 A</button>' +
        '<button type="button" data-testid="sheet-b">动作 B</button>',
    },
    attachTo: document.body,
  });
  return { wrapper, trigger };
}

function key(target: Element, key: string, shift = false): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("AppSheet modal focus", () => {
  it("打开时焦点移入对话框（首个可聚焦元素）", async () => {
    const { wrapper, trigger } = mountSheet(false);
    await wrapper.setProps({ open: true });
    await flushPromises();

    const panel = wrapper.find('[data-testid="app-sheet-panel"]').element;
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(trigger);
    wrapper.unmount();
    trigger.remove();
  });

  it("Tab 在对话框边界循环，不逃逸到遮罩后的页面", async () => {
    const { wrapper, trigger } = mountSheet(true);
    await flushPromises();

    const panel = wrapper.find('[data-testid="app-sheet-panel"]').element;
    const closeBtn = wrapper.find('[data-testid="app-sheet-close"]').element;
    const b = wrapper.find('[data-testid="sheet-b"]').element;

    // 焦点在最后一个可聚焦元素上按 Tab：圈回首元素（关闭按钮）。
    (b as HTMLElement).focus();
    key(panel, "Tab");
    expect(document.activeElement).toBe(closeBtn);
    expect(document.activeElement).not.toBe(trigger);

    // 焦点在首元素上按 Shift+Tab：圈回最后一个。
    (closeBtn as HTMLElement).focus();
    key(panel, "Tab", true);
    expect(document.activeElement).toBe(b);

    // 焦点意外落在对话框外时按 Tab：拉回首元素，不落在页面内容。
    trigger.focus();
    key(panel, "Tab");
    expect(document.activeElement).toBe(closeBtn);
    wrapper.unmount();
    trigger.remove();
  });

  it("Escape 关闭且关闭后焦点归还触发按钮", async () => {
    const { wrapper, trigger } = mountSheet(true);
    await flushPromises();

    const panel = wrapper.find('[data-testid="app-sheet-panel"]').element;
    key(panel, "Escape");
    await wrapper.setProps({ open: false });
    await flushPromises();

    expect(wrapper.emitted("close")).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
    trigger.remove();
  });

  it("点击遮罩与明确关闭按钮都会发出 close", async () => {
    const { wrapper, trigger } = mountSheet(true);
    await flushPromises();

    await wrapper.find(".vc-sheet__scrim").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.find('[data-testid="app-sheet-close"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(2);
    wrapper.unmount();
    trigger.remove();
  });

  it("关闭后再次打开仍正确移入焦点（循环使用）", async () => {
    const { wrapper, trigger } = mountSheet(true);
    await flushPromises();
    await wrapper.setProps({ open: false });
    await flushPromises();
    expect(document.activeElement).toBe(trigger);

    await wrapper.setProps({ open: true });
    await flushPromises();
    const panel = wrapper.find('[data-testid="app-sheet-panel"]').element;
    expect(panel.contains(document.activeElement)).toBe(true);
    wrapper.unmount();
    trigger.remove();
  });
});
