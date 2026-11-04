// W07: the named ST extension prompt is transient, never written into a chat.
import {
    MEMORY_PROMPT,
    CORE_PROMPT,
    MEMORY_INTERCEPTOR,
    MEMORY_QUIET_COPY,
    MEMORY_NOTICE_EVENT,
    MEMORY_NOTE,
    memoryBlock,
    coreMemoryBlock,
    splitMemoryFacts,
    memorySettings,
    createMemoryInjection as createMemoryInjectionCore,
} from './memory-injection-logic.js';

export {
    MEMORY_PROMPT,
    CORE_PROMPT,
    MEMORY_INTERCEPTOR,
    MEMORY_QUIET_COPY,
    MEMORY_NOTICE_EVENT,
    MEMORY_NOTE,
    memoryBlock,
    coreMemoryBlock,
    splitMemoryFacts,
    memorySettings,
};

export function createMemoryInjection({ getContext, recall, ensureBinding, onStatus = () => {}, onNotice = () => {} }) {
    const emitNotice = (text) => {
        const next = String(text || '');
        onNotice(next);
        const doc = globalThis.document;
        if (!doc) return;
        const detail = { detail: { text: next } };
        try {
            if (typeof doc.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                doc.dispatchEvent(new CustomEvent(MEMORY_NOTICE_EVENT, detail));
            }
        } catch {
            /* 非浏览器文档没有标准事件。 */
        }
        try {
            if (typeof doc.body?.dispatch === 'function') doc.body.dispatch(MEMORY_NOTICE_EVENT, detail);
            else if (typeof doc.body?.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                doc.body.dispatchEvent(new CustomEvent(MEMORY_NOTICE_EVENT, detail));
            }
        } catch {
            /* 同上。 */
        }
    };
    return createMemoryInjectionCore({ getContext, recall, ensureBinding, onStatus, onNotice: emitNotice });
}

export function mountMemoryControls({ getContext, reset, document: doc = document }) {
    const section = doc.createElement('div');
    section.id = 'vc-memory-controls';
    section.className = 'extension_container vc-memory-controls';
    section.innerHTML =
        '<label class="vc-memory-toggle"><input type="checkbox" data-memory-enabled>长期记忆</label>' +
        '<label>召回预算 <input type="number" data-memory-budget min="128" max="2048" step="128" inputmode="numeric"> token</label>' +
        '<span data-memory-status role="status" aria-live="polite"></span>';
    const enabled = section.querySelector('[data-memory-enabled]');
    const budget = section.querySelector('[data-memory-budget]');
    const settings = memorySettings(getContext());
    enabled.checked = settings.enabled;
    budget.value = String(settings.budgetTokens);
    const save = () => {
        if (!budget.checkValidity()) {
            budget.reportValidity();
            return;
        }
        const context = getContext();
        context.extensionSettings.vc_memory = { enabled: enabled.checked, budgetTokens: Number(budget.value) };
        context.saveSettingsDebounced();
        reset();
        section.querySelector('[data-memory-status]').textContent = '';
    };
    enabled.addEventListener('change', save);
    budget.addEventListener('change', save);
    doc.querySelector('#extensions_settings2')?.append(section);
    return (message) => {
        section.querySelector('[data-memory-status]').textContent = message;
    };
}
