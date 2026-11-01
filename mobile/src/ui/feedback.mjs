// 全局反馈：确认框（一句标题 + 一句后果 + 两个按钮，安全动作默认焦点）与单实例提示条（DESIGN.md §3.2、§9）。
import { reactive } from 'vue';

export const feedback = reactive({ alert: null, toast: null });
let toastTimer = 0;

export function confirmAlert({ title, message = '', action, danger = true, cancel = '取消' }) {
    return new Promise((resolve) => {
        feedback.alert = { title, message, action, danger, cancel, resolve: (ok) => { feedback.alert = null; resolve(ok); } };
    });
}

export function showToast(text, { error = false } = {}) {
    clearTimeout(toastTimer);
    feedback.toast = { text, error };
    if (!error) toastTimer = setTimeout(() => { feedback.toast = null; }, 1800);
}

export function dismissToast() { clearTimeout(toastTimer); feedback.toast = null; }
