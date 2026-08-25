// DOGFOOD-09（ADR-0006 §1.4）：uni-app h5 框架层可访问性缺口的全局 DOM 修补。
//
// 实测缺口（框架渲染函数硬编码内部节点属性，不透传页面模板上的语义属性，
// 见 node_modules/@dcloudio/uni-h5 的 Input/Button/PageHead 实现）：
// 1. <uni-input>/<uni-textarea> 把 aria-label 留在包装自定义元素上，内部
//    原生 <input>/<textarea> 没有任何可访问名称，VoiceOver/TalkBack 聚焦
//    原生输入框时读不到字段名。
// 2. <uni-button> 是无 tabindex 的自定义元素：键盘 Tab 不可达，也不内建
//    Enter/Space 激活；disabled 态只渲染 attribute，不声明 aria-disabled，
//    读屏与键盘修补都感知不到禁用。
// 3. <uni-page-head> 导航栏无 landmark 语义，其可见文本落在任何 region 之外。
//
// 修补经 MutationObserver 覆盖路由切换与动态渲染；模块必须可在无 DOM 的
// 单测环境安全导入。

let installed = false;

/** 把包装元素上的 aria-label 同步到内部原生输入框（axe label 规则与
 *  读屏都只认 input/textarea 元素自身的可访问名称）。 */
function patchInputWrapper(wrapper: Element): void {
  const label = wrapper.getAttribute("aria-label");
  const inner = wrapper.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );
  if (!inner) return;
  if (label === null) {
    if (inner.hasAttribute("aria-label")) {
      inner.removeAttribute("aria-label");
    }
    return;
  }
  if (inner.getAttribute("aria-label") !== label) {
    inner.setAttribute("aria-label", label);
  }
}

/** uni-button 状态同步的权威禁用信号。实测 uni-h5 的 button 渲染函数把
 *  disabled 作为布尔 attribute 直接落在 <uni-button> 元素上
 *  （useBooleanAttr → mergeProps，class 不参与，App.vue 的
 *  uni-button[disabled] 样式选择器同源），因此不观察 class（hover 等
 *  样式类噪音会淹没真正需要重放的语义变化）。aria-disabled 只是本修补
 *  的输出，绝不能反过来当同步输入——否则修补自己声明的 aria-disabled
 *  会让禁用态永远无法恢复。 */
function isUniButtonDisabled(button: Element): boolean {
  return button.hasAttribute("disabled");
}

/** 激活拦截的禁用判定：disabled attribute 之外，模板透传的
 *  aria-disabled="true"（含任何来源的声明）同样视为禁用。原生 <button>
 *  （组件级单测环境，见 onKeydown 选择器说明）沿用同一判定。 */
function isUniButtonDisabledForActivation(button: Element): boolean {
  return (
    isUniButtonDisabled(button) ||
    button.getAttribute("aria-disabled") === "true"
  );
}

/** uni-button 补齐键盘可达性（tabindex）与按钮语义（role），并同步禁用态：
 *  disabled 时声明 aria-disabled 并移出 tab 序，恢复 enabled 时还原。
 *  Vue patch 只管理渲染函数声明的属性，手动补的属性在元素重建前稳定，
 *  重建由 MutationObserver 重新覆盖。 */
interface OwnedButtonState {
  /** shim 接管 aria-disabled 前，作者显式声明的值（null = 作者未声明）。 */
  authorAriaDisabled: string | null;
  /** shim 接管 tabindex 前，作者显式声明的值（undefined = 作者未声明）。 */
  authorTabindex: string | undefined;
}

/** DOGFOOD-STABILIZATION-03 缺陷 F：shim 语义所有权。恢复/清理只允许作用于
 *  shim 自己写入的属性——作者（页面代码）显式声明的 aria-disabled（如初始
 *  "true"）与 tabindex（如 "-1"）必须原样保留。接管 disabled 语义时记下
 *  作者原值，enabled 时按原值交还；作者在 shim 持有期间改写的值（不再是
 *  shim 写入的 "true"/"-1"）视为最新作者意图，同样不覆盖。 */
const ownedButtons = new WeakMap<Element, OwnedButtonState>();

function patchUniButton(button: Element): void {
  if (!button.hasAttribute("role")) {
    button.setAttribute("role", "button");
  }
  if (isUniButtonDisabled(button)) {
    if (!ownedButtons.has(button)) {
      ownedButtons.set(button, {
        authorAriaDisabled: button.getAttribute("aria-disabled"),
        authorTabindex: button.hasAttribute("tabindex")
          ? (button.getAttribute("tabindex") as string)
          : undefined,
      });
    }
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("tabindex", "-1");
    return;
  }
  const owned = ownedButtons.get(button);
  if (owned) {
    // enabled：只交还 shim 自己写入的属性。当前值已不是 shim 写入的
    // "true"/"-1" 时说明作者在持有期间改写过，尊重作者值不动它。
    if (button.getAttribute("aria-disabled") === "true") {
      if (owned.authorAriaDisabled === null) {
        button.removeAttribute("aria-disabled");
      } else {
        button.setAttribute("aria-disabled", owned.authorAriaDisabled);
      }
    }
    if (button.getAttribute("tabindex") === "-1") {
      if (owned.authorTabindex === undefined) {
        // 作者原本未声明 tabindex：维持“enabled 补 0”的键盘可达语义。
        button.setAttribute("tabindex", "0");
      } else {
        button.setAttribute("tabindex", owned.authorTabindex);
      }
    }
    ownedButtons.delete(button);
    return;
  }
  // 从未接管的 enabled 按钮：作者显式声明的 aria-disabled 与 tabindex（含
  // "-1"）都不是 shim 的输出，原样保留；仅缺失 tabindex 时补 0。
  if (!button.hasAttribute("tabindex")) {
    button.setAttribute("tabindex", "0");
  }
}

/** uni-page-head 就是页面横幅（标题 + 返回按钮），声明 banner landmark。 */
function patchPageHead(head: Element): void {
  head.setAttribute("role", "banner");
}

function patchElement(el: Element): void {
  const tag = el.tagName.toLowerCase();
  if (tag === "uni-input" || tag === "uni-textarea") {
    patchInputWrapper(el);
  } else if (tag === "uni-button") {
    patchUniButton(el);
  } else if (tag === "uni-page-head") {
    patchPageHead(el);
  }
}

function patchSubtree(root: Element): void {
  patchElement(root);
  root
    .querySelectorAll("uni-input, uni-textarea, uni-button, uni-page-head")
    .forEach(patchElement);
}

/** Space 激活的 armed 目标：keydown 只记录，keyup 才补发 click，对齐原生
 *  按钮“按住不重复激活、松开恰好激活一次”的语义（DOGFOOD-STABILIZATION-04
 *  缺陷 F：此前每次 repeat keydown 都直接 click，一次长按多次激活）。 */
let armedSpaceButton: HTMLElement | null = null;

/** Enter/Space 激活：自定义元素不内建键盘激活，这里把按键转成 click。
 *  页面模板自己处理过（@keydown.enter.prevent 之类已 preventDefault）时
 *  不再代发，避免双触发；Space 的默认滚动行为必须拦截。
 *  - Enter：单次 keydown（repeat 忽略）即激活，同原生按钮。
 *  - Space：keydown 只 preventDefault 并 arm（repeat 一律忽略，但默认
 *    滚动仍需逐次拦截），keyup 时 armed 且按钮仍 enabled 才补发一次。
 *  选择器同时匹配原生 <button>：组件级单测只挂 @vitejs/plugin-vue（无
 *  uni 插件），页面模板里的 <button> 渲染为原生按钮而非 uni-button，
 *  页面级测试必须与真实 h5 走同一份状态机；真实浏览器里原生按钮由
 *  keydown 阶段的 preventDefault 抑制内建激活，不会双触发。
 *  DOGFOOD-STABILIZATION-05 缺陷四：页面模板不得再挂按钮级
 *  @keydown.enter/@keydown.space 处理器——它们在每次 repeat keydown 上
 *  直接执行动作，绕过本状态机的 repeat 防抖（长按多次激活）。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLElement>("uni-button, button");
  if (!button || isUniButtonDisabledForActivation(button)) return;
  event.preventDefault();
  if (event.key === "Enter") {
    if (!event.repeat) button.click();
    return;
  }
  if (!event.repeat) {
    armedSpaceButton = button;
  }
}

/** Space keyup：消费 arm 并补发一次 click。armed 为空、页面已处理过该
 *  keyup（defaultPrevented）、或按钮在按住期间变为禁用时都不激活。 */
function onKeyup(event: KeyboardEvent): void {
  if (event.key !== " ") return;
  const button = armedSpaceButton;
  armedSpaceButton = null;
  if (!button) return;
  if (event.defaultPrevented) return;
  if (isUniButtonDisabledForActivation(button)) return;
  button.click();
}

/** arm 的失焦取消：focus 离开 armed 按钮（或其内部节点）即取消，避免
 *  松开时激活一个用户已经离开的按钮；其他元素的失焦不影响。 */
function onButtonFocusOut(event: FocusEvent): void {
  const button = armedSpaceButton;
  if (!button) return;
  const target = event.target;
  if (target instanceof Node && button.contains(target)) {
    armedSpaceButton = null;
  }
}

function start(root: HTMLElement): void {
  patchSubtree(root);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        // aria-label 增删时重放该元素（含其内部输入框）的名称同步；
        // disabled 增删时重放 uni-button 的禁用语义（tabindex/aria-disabled）。
        if (mutation.target instanceof Element) {
          patchElement(mutation.target);
        }
        continue;
      }
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) {
          patchSubtree(node);
        }
      });
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    // disabled 与 aria-label 一样是 Vue 渲染函数直接管理的 attribute（见
    // isUniButtonDisabled 的实测说明），无需为它观察 class。
    attributeFilter: ["aria-label", "disabled"],
  });
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("keyup", onKeyup);
  // focusout 用 capture：与 keydown/keyup 同挂在 document 上，focus 从
  // armed 按钮移走时立即取消 arm（blur 不冒泡，focusout 冒泡，capture 最稳）。
  document.addEventListener("focusout", onButtonFocusOut, true);
}

export function installH5A11yShims(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  if (document.body) {
    start(document.body);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.body) start(document.body);
    });
  }
}
