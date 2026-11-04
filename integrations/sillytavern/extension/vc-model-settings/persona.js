// 人设与全局拟人规则。文案来自 docs/planning/2026-10-30-companion-copy.md，原样使用。
import { icon } from './ui/icons.js';
import { openSheet } from './ui/sheet.js';
import { PLANNER_KEY } from './reply-planner.js';
import {
    STYLE_NOTE,
    DEFAULT_GLOBAL_RULES,
    RULES_KEY,
    readGlobalRules,
    moodGuidance,
    MES_EXAMPLE,
    RELATIONS,
    GENDERS,
    STYLE_OPTIONS,
    pronounFor,
    restoreDefaultRules,
    buildCharacterCard,
} from './instance-logic.js';

export {
    STYLE_NOTE,
    DEFAULT_GLOBAL_RULES,
    readGlobalRules,
    moodGuidance,
    MES_EXAMPLE,
    RELATIONS,
    GENDERS,
    STYLE_OPTIONS,
    pronounFor,
    restoreDefaultRules,
    buildCharacterCard,
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function renderCompanionStyle(text, { plannerEnabled = false } = {}) {
    return `<div data-planner-row><div class="vc-group"><div class="vc-cell"><span class="vc-grow">先想再说</span><button type="button" class="vc-switch" role="switch" aria-label="先想再说" aria-describedby="vc-planner-cost" aria-checked="${plannerEnabled?'true':'false'}" data-action="toggle-planner"><span></span></button></div></div><p class="vc-footnote" id="vc-planner-cost">可能增加一次模型用量。</p></div><label class="vc-style-rule"><textarea data-field="rules" aria-label="陪伴风格">${esc(text)}</textarea></label><button type="button" class="vc-btn vc-btn-text" data-action="restore-rules">恢复默认</button>`;
}

export function fitStyleField(area) {
    if (!area?.style) return;
    area.style.height = 'auto';
    area.style.maxHeight = 'none';
    area.style.overflow = 'hidden';
    const content = Number(area.scrollHeight) || 0;
    const page = typeof area.closest === 'function' ? area.closest('.vc-style-page') : null;
    const scroller = page?.parentElement;
    const button = page?.querySelector?.('[data-action="restore-rules"]');
    const buttonHeight = Number(button?.offsetHeight) || 0;
    const plannerHeight = Number(page?.querySelector?.('[data-planner-row]')?.offsetHeight) || 0;
    const scrollerHeight = Number(scroller?.clientHeight) || 0;
    const room = scrollerHeight > 0 ? Math.max(0, scrollerHeight - buttonHeight - plannerHeight) : Number(area.parentElement?.clientHeight) || 0;
    const next = Math.max(content, room);
    if (next > 0) area.style.height = `${next}px`;
}

export function ensureCompanionStyles(doc = globalThis.document) {
    if (!doc?.getElementById || doc.getElementById('vc-companion-persona-css')) return;
    const link = doc.createElement('link');
    link.id = 'vc-companion-persona-css';
    link.rel = 'stylesheet';
    link.href = new URL('./companion-persona.css', import.meta.url).href;
    (doc.head || doc.documentElement).append(link);
}

export function openCompanionStyle({ getContext, opener, document: doc = globalThis.document } = {}) {
    ensureCompanionStyles(doc);
    const context = typeof getContext === 'function' ? getContext() : { extensionSettings: {} };
    if (!context.extensionSettings || typeof context.extensionSettings !== 'object') context.extensionSettings = {};
    const box = doc.createElement('div');
    box.className = 'vc-column vc-style-page';
    box.innerHTML = renderCompanionStyle(readGlobalRules(context.extensionSettings), { plannerEnabled: context.extensionSettings[PLANNER_KEY] === true });
    const view = doc.defaultView || globalThis;
    let fit = () => {};
    const sheet = openSheet({
        title: '陪伴风格',
        large: true,
        body: box,
        opener,
        root: doc.body,
        onDone: () => view.removeEventListener?.('resize', fit),
    });
    const area = box.querySelector('[data-field="rules"]');
    fit = () => fitStyleField(area);
    view.addEventListener?.('resize', fit);
    const planner = box.querySelector('[data-action="toggle-planner"]');
    planner?.addEventListener('click', () => {
        context.extensionSettings[PLANNER_KEY] = planner.getAttribute('aria-checked') !== 'true';
        planner.setAttribute('aria-checked', String(context.extensionSettings[PLANNER_KEY]));
        context.saveSettingsDebounced?.();
    });
    area?.addEventListener('input', () => {
        context.extensionSettings[RULES_KEY] = area.value;
        context.saveSettingsDebounced?.();
        fit();
    });
    box.querySelector('[data-action="restore-rules"]')?.addEventListener('click', () => {
        restoreDefaultRules(context.extensionSettings);
        context.extensionSettings[PLANNER_KEY] = false;
        planner?.setAttribute('aria-checked', 'false');
        context.saveSettingsDebounced?.();
        if (area) area.value = DEFAULT_GLOBAL_RULES;
        fit();
    });
    if (typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(() => view.requestAnimationFrame(fit));
    else fit();
    return sheet;
}

export async function saveNativePersona({ getContext, characterRef, fields, fetchImpl = globalThis.fetch, headers = {} } = {}) {
    const ctx = typeof getContext === 'function' ? getContext() : {};
    const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
    const card = characters.find((item) => item?.data?.extensions?.vc_character_ref === characterRef);
    if (!card) throw new Error('missing card');
    const changes = {};
    for (const key of ['description', 'personality', 'scenario', 'first_mes', 'mes_example']) {
        changes[key] = String(fields?.[key] ?? '');
    }
    // ST 的整卡 edit 会重新生成其他字段；原生单卡 merge 只原子修改这五项。
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Content-Type', 'application/json');
    const response = await fetchImpl('/api/characters/merge-attributes', {
        method: 'POST', headers: requestHeaders,
        body: JSON.stringify({ avatar: String(card.avatar || ''), ...changes, data: changes }),
    });
    if (!response?.ok) throw new Error('save failed');
    Object.assign(card, changes);
    card.data = { ...(card.data || {}), ...changes };
    return card.data;
}
