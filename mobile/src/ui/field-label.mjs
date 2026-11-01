// uni-input/uni-textarea 把透传属性挂在外层；名称必须落在真正的输入控件上。
const labels = new WeakMap();
export function labelNativeField(el) {
    const input = el.matches('input,textarea') ? el : el.querySelector('input,textarea');
    if (!input) return;
    const label = el.getAttribute('aria-label') || labels.get(el) || el.closest('uni-label,label')?.textContent?.trim();
    if (label) { labels.set(el, label); input.setAttribute('aria-label', label); }
    if (input !== el) el.removeAttribute('aria-label');
}
export const fieldLabel = { mounted: labelNativeField, updated: labelNativeField };
