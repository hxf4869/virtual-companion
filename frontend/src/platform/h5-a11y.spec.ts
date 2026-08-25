// @vitest-environment happy-dom
// DOGFOOD-STABILIZATION-02 缺陷 6：uni-button disabled 态的键盘/读屏语义
// 回归。uni-h5 把 disabled 渲染为 <uni-button> 上的布尔 attribute（渲染
// 函数 useBooleanAttr，class 不参与），这里用真实 DOM attribute 增删驱动
// MutationObserver，验证全局修补的禁用同步与 Enter/Space 激活拦截。
// DOGFOOD-STABILIZATION-03 缺陷 F 追加：shim 只恢复自己写入的
// aria-disabled/tabindex（作者显式值优先）、重复 Space 的幂等拦截。
// DOGFOOD-STABILIZATION-04 缺陷 F 追加：enabled 按钮长按 Space 的
// repeat 多激活回归（keydown 只 arm、keyup 单次补发、focusout 取消）。
import { beforeAll, describe, expect, it, vi } from "vitest";

import { installH5A11yShims } from "./h5-a11y";

function createUniButton(disabled = false): HTMLElement {
  const el = document.createElement("uni-button");
  if (disabled) el.setAttribute("disabled", "");
  document.body.appendChild(el);
  return el;
}

/** MutationObserver 回调在微任务里执行，一个宏任务拍即可重放修补。 */
async function waitForPatch(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// 模块级 installed 单例与真实页面一致：整个文件只安装一次，后续用例靠
// MutationObserver 覆盖动态变化。
beforeAll(() => {
  installH5A11yShims();
});

describe("uni-button disabled 修补（DOGFOOD-STABILIZATION-02）", () => {
  it("disabled uni-button 初始修补后 aria-disabled=true 且移出 tab 序", async () => {
    const button = createUniButton(true);
    await waitForPatch();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(button.getAttribute("role")).toBe("button");
  });

  it("无 disabled 的按钮保持 tabindex=0 且不声明 aria-disabled", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.getAttribute("tabindex")).toBe("0");
  });

  it("disabled→enabled 动态切换后恢复 tabindex=0 并移除 aria-disabled", async () => {
    const button = createUniButton(true);
    await waitForPatch();
    expect(button.getAttribute("tabindex")).toBe("-1");

    button.removeAttribute("disabled");
    await waitForPatch();
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.getAttribute("tabindex")).toBe("0");
  });

  it("enabled→disabled 动态切换后压回 tabindex=-1 并声明 aria-disabled", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    expect(button.getAttribute("tabindex")).toBe("0");

    button.setAttribute("disabled", "");
    await waitForPatch();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
  });

  it("作者显式声明的非 -1 tabindex 在 enabled 态不被覆盖", async () => {
    const button = createUniButton(false);
    button.setAttribute("tabindex", "2");
    await waitForPatch();
    expect(button.getAttribute("tabindex")).toBe("2");
  });
});

describe("uni-button Enter/Space 激活拦截（DOGFOOD-STABILIZATION-02）", () => {
  function pressKey(target: Element, key: string): void {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  }

  // 04 缺陷 F 后 Space 改为 keydown arm + keyup 补发，完整激活需 keyup。
  function releaseKey(target: Element, key: string): void {
    target.dispatchEvent(
      new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }),
    );
  }

  it("Enter 与 Space 在 disabled 按钮上不触发 click，enabled 后各触发一次", async () => {
    const button = createUniButton(true);
    await waitForPatch();
    const clicks = vi.fn();
    button.addEventListener("click", clicks);

    pressKey(button, "Enter");
    pressKey(button, " ");
    releaseKey(button, " ");
    expect(clicks).not.toHaveBeenCalled();

    button.removeAttribute("disabled");
    await waitForPatch();
    pressKey(button, "Enter");
    expect(clicks).toHaveBeenCalledTimes(1);
    pressKey(button, " ");
    releaseKey(button, " ");
    expect(clicks).toHaveBeenCalledTimes(2);
  });

  it("重复 Space keydown 在 disabled 按钮上幂等拦截，enabled 后单次激活一次", async () => {
    const button = createUniButton(true);
    await waitForPatch();
    const clicks = vi.fn();
    button.addEventListener("click", clicks);

    for (let i = 0; i < 5; i += 1) {
      pressKey(button, " ");
    }
    releaseKey(button, " ");
    expect(clicks).not.toHaveBeenCalled();

    button.removeAttribute("disabled");
    await waitForPatch();
    pressKey(button, " ");
    releaseKey(button, " ");
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("仅 aria-disabled=true（无 disabled attribute）的按钮同样不激活", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    // aria-disabled 是状态同步的输出而非输入（否则修补自锁，见
    // isUniButtonDisabled 注释），这里只验证激活拦截认这路补充信号。
    button.setAttribute("aria-disabled", "true");
    const clicks = vi.fn();
    button.addEventListener("click", clicks);
    pressKey(button, "Enter");
    pressKey(button, " ");
    releaseKey(button, " ");
    expect(clicks).not.toHaveBeenCalled();
  });
});

describe("shim 属性所有权（DOGFOOD-STABILIZATION-03 缺陷 F）", () => {
  /** 作者显式属性必须在初始 patch 之前落在元素上：patch 由 appendChild 的
   *  childList 变更触发，之后的写入不经过 shim（attributeFilter 不含这两个
   *  属性），测不到“初始语义不被清除”。 */
  function createAuthoredUniButton(
    attrs: Record<string, string | undefined>,
  ): HTMLElement {
    const el = document.createElement("uni-button");
    for (const [name, value] of Object.entries(attrs)) {
      if (value !== undefined) el.setAttribute(name, value);
    }
    document.body.appendChild(el);
    return el;
  }

  it("作者显式 aria-disabled=true 的按钮 shim 不清除它", async () => {
    const button = createAuthoredUniButton({ "aria-disabled": "true" });
    await waitForPatch();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // 作者未声明 tabindex：保持“enabled 补 0”语义。
    expect(button.getAttribute("tabindex")).toBe("0");
  });

  it("作者显式 tabindex=-1 保持 -1，不被补 0 覆盖", async () => {
    const button = createAuthoredUniButton({ tabindex: "-1" });
    await waitForPatch();
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(button.hasAttribute("aria-disabled")).toBe(false);
  });

  it("disabled↔enabled 往返后 shim 状态正确且作者的显式 aria-disabled=true 不被覆盖", async () => {
    const button = createAuthoredUniButton({
      disabled: "",
      "aria-disabled": "true",
    });
    await waitForPatch();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");

    button.removeAttribute("disabled");
    await waitForPatch();
    // 作者的显式 aria-disabled=true 必须原样保留；tabindex 作者未声明 → 0。
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("0");

    // 第二轮往返仍以作者显式值为准。
    button.setAttribute("disabled", "");
    await waitForPatch();
    expect(button.getAttribute("tabindex")).toBe("-1");
    button.removeAttribute("disabled");
    await waitForPatch();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("0");
  });

  it("disabled↔enabled 往返后作者的显式 tabindex=-1 被恢复而非改成 0", async () => {
    const button = createAuthoredUniButton({ tabindex: "-1" });
    await waitForPatch();
    expect(button.getAttribute("tabindex")).toBe("-1");

    button.setAttribute("disabled", "");
    await waitForPatch();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");

    button.removeAttribute("disabled");
    await waitForPatch();
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.getAttribute("tabindex")).toBe("-1");

    // 再来一轮：shim 写入的 aria-disabled 增删不得污染作者的 tabindex。
    button.setAttribute("disabled", "");
    await waitForPatch();
    button.removeAttribute("disabled");
    await waitForPatch();
    expect(button.getAttribute("tabindex")).toBe("-1");
  });
});

describe("uni-button Space 原生激活语义（DOGFOOD-STABILIZATION-04 缺陷 F）", () => {
  function pressKey(target: Element, key: string, repeat = false): void {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        repeat,
      }),
    );
  }

  function releaseKey(target: Element, key: string): void {
    target.dispatchEvent(
      new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }),
    );
  }

  function dispatchFocusOut(target: Element): void {
    target.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }

  it("enabled 按钮长按 Space：repeat keydown 一律不激活，keyup 恰好补发一次 click", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    const clicks = vi.fn();
    button.addEventListener("click", clicks);

    pressKey(button, " ");
    for (let i = 0; i < 5; i += 1) {
      pressKey(button, " ", true);
    }
    // 按住期间（首次 keydown 与全部 repeat keydown）零激活。
    expect(clicks).not.toHaveBeenCalled();
    releaseKey(button, " ");
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("只有 repeat=true 的 Space keydown（无首次按下）不 arm，keyup 也不激活", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    const clicks = vi.fn();
    button.addEventListener("click", clicks);

    for (let i = 0; i < 5; i += 1) {
      pressKey(button, " ", true);
    }
    releaseKey(button, " ");
    expect(clicks).not.toHaveBeenCalled();
  });

  it("armed 后按钮失焦（focusout）取消 arm，keyup 不激活", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    const clicks = vi.fn();
    button.addEventListener("click", clicks);

    pressKey(button, " ");
    dispatchFocusOut(button);
    releaseKey(button, " ");
    expect(clicks).not.toHaveBeenCalled();
  });

  it("其他元素的 focusout 不取消 armed 按钮", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    const clicks = vi.fn();
    button.addEventListener("click", clicks);
    const other = document.createElement("div");
    document.body.appendChild(other);

    pressKey(button, " ");
    dispatchFocusOut(other);
    releaseKey(button, " ");
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("armed 后按钮变为 disabled，keyup 再次判定禁用而不激活", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    const clicks = vi.fn();
    button.addEventListener("click", clicks);

    pressKey(button, " ");
    button.setAttribute("disabled", "");
    releaseKey(button, " ");
    expect(clicks).not.toHaveBeenCalled();
  });

  it("armed 期间按下其他键不取消 arm，keyup 仍激活一次", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    const clicks = vi.fn();
    button.addEventListener("click", clicks);

    pressKey(button, " ");
    pressKey(button, "ArrowDown");
    releaseKey(button, " ");
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("Enter 保持 keydown 单次激活，repeat keydown 不再激活", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    const clicks = vi.fn();
    button.addEventListener("click", clicks);

    pressKey(button, "Enter");
    expect(clicks).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i += 1) {
      pressKey(button, "Enter", true);
    }
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("未 arm 时的 Space keyup 不激活", async () => {
    const button = createUniButton(false);
    await waitForPatch();
    const clicks = vi.fn();
    button.addEventListener("click", clicks);

    releaseKey(button, " ");
    expect(clicks).not.toHaveBeenCalled();
  });
});
