// 没有陪伴实例时的首次引导。完成后用角色卡 V2 走宿主导入，再建实例并打开聊天。
import { listConsents } from './api.js';
import { armOnboardingBinding, holdCompanionBinding, noteCompanionBound } from './instance-binding.js';
import { consentOutstanding } from './consent.js';
import { buildCharacterCard, ensureCompanionStyles, GENDERS, RELATIONS, STYLE_OPTIONS } from './persona.js';
import { icon } from './ui/icons.js';

export { noteCompanionBound };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function relationshipRows(relationships) {
    if (Array.isArray(relationships)) return relationships;
    if (Array.isArray(relationships?.items)) return relationships.items;
    if (Array.isArray(relationships?.relationships)) return relationships.relationships;
    return [];
}

export function shouldOfferOnboarding(relationships) {
    return !relationshipRows(relationships).some((row) => (row?.personaRef || row?.persona_ref) === 'st-character');
}

export function bindOnboardingDismiss(doc = globalThis.document) {
    const target = doc?.body || doc;
    if (!target?.addEventListener || target.getAttribute?.('data-vc-onboarding-dismiss') === 'on') return;
    target.setAttribute?.('data-vc-onboarding-dismiss', 'on');
    target.addEventListener('vc-st-bound', () => {
        doc?.querySelector?.('.vc-onboarding')?.remove?.();
    });
}

function choiceMark(on) {
    if (!on) return '';
    return `<span class="vc-choice-mark" aria-hidden="true">${icon('check', { size: 22 })}</span>`;
}

function choice(name, value, current) {
    const pressed = value === current;
    return `<button type="button" class="vc-cell vc-choice" data-choice="${name}" data-value="${esc(value)}" aria-pressed="${pressed ? 'true' : 'false'}"><span class="vc-grow">${esc(value)}</span>${choiceMark(pressed)}</button>`;
}

export function renderOnboarding(state = {}) {
    const styles = new Set(Array.isArray(state.styles) ? state.styles : STYLE_OPTIONS);
    const styleButtons = STYLE_OPTIONS.map((item) => {
        const on = styles.has(item);
        return `<button type="button" class="vc-cell vc-choice" data-style="${esc(item)}" aria-pressed="${on ? 'true' : 'false'}"><span class="vc-grow">${esc(item)}</span>${choiceMark(on)}</button>`;
    }).join('');
    return `<div class="vc-onboarding-body"><div class="vc-column">
      <h1 class="vc-large-title" tabindex="-1">给 TA 起个名字</h1>
      <div class="vc-group"><label class="vc-cell"><input name="name" aria-label="给 TA 起个名字" placeholder="比如：小满" value="${esc(state.name || '')}" maxlength="32"></label></div>
      <h2 class="vc-group-title">你们是什么关系</h2>
      <div class="vc-group" role="radiogroup" aria-label="你们是什么关系">${RELATIONS.map((item) => choice('relation', item, state.relation || '好朋友')).join('')}</div>
      <h2 class="vc-group-title">TA 是</h2>
      <div class="vc-group" role="radiogroup" aria-label="TA 是">${GENDERS.map((item) => choice('gender', item, state.gender || '女生')).join('')}</div>
      <h2 class="vc-group-title">说话风格</h2>
      <div class="vc-group">${styleButtons}</div>
      ${state.error ? `<p role="alert">${esc(state.error)}</p>` : ''}
    </div></div>
    <button type="button" class="vc-btn vc-btn-fill" data-action="finish-onboarding">开始聊天</button>`;
}

export async function finishOnboarding(choices, {
    importCard,
    createBinding,
    openChat,
    newId = () => crypto.randomUUID(),
} = {}) {
    const name = String(choices?.name || '').trim();
    if (!name) {
        const error = new Error('empty');
        error.code = 'EMPTY_NAME';
        throw error;
    }
    const card = buildCharacterCard({
        name,
        relation: choices.relation || '好朋友',
        gender: choices.gender || '女生',
        styles: Array.isArray(choices.styles) ? choices.styles : [],
    });
    const bytes = new TextEncoder().encode(JSON.stringify(card));
    holdCompanionBinding(true);
    let imported;
    let chatIdentity;
    let binding;
    try {
        imported = await importCard({ name: `${name}.json`, bytes, format: 'json' });
        chatIdentity = newId();
        binding = await createBinding({
            characterRef: imported.characterRef,
            displayName: name,
            chatIdentity,
            mode: 'COMPANION',
        });
        armOnboardingBinding({ characterRef: imported.characterRef, chatIdentity, binding });
    } finally {
        holdCompanionBinding(false);
    }
    await openChat?.({ characterRef: imported.characterRef, chatIdentity, binding });
    return { card, imported, binding, chatIdentity };
}

export function mountOnboarding(doc, deps) {
    ensureCompanionStyles(doc);
    const host = doc.createElement('dialog');
    host.className = 'vc-onboarding';
    host.addEventListener('cancel', (event) => event.preventDefault());
    host.setAttribute('aria-label', '给 TA 起个名字');
    const state = {
        name: '',
        relation: '好朋友',
        gender: '女生',
        styles: [...STYLE_OPTIONS],
        error: '',
        busy: false,
    };
    const paint = () => { host.innerHTML = renderOnboarding(state); };
    const readName = () => {
        const input = host.querySelector('[name="name"]');
        if (input) state.name = input.value;
    };
    paint();
    host.addEventListener('input', (event) => {
        if (event.target?.name === 'name') state.name = event.target.value;
    });
    host.addEventListener('click', (event) => {
        const button = event.target?.closest?.('button');
        if (!button || !host.contains(button) || state.busy) return;
        readName();
        if (button.dataset.choice === 'relation') state.relation = button.dataset.value;
        if (button.dataset.choice === 'gender') state.gender = button.dataset.value;
        if (button.dataset.style) {
            const value = button.dataset.style;
            const next = new Set(state.styles);
            if (next.has(value)) next.delete(value);
            else next.add(value);
            state.styles = [...next];
        }
        if (button.dataset.choice || button.dataset.style) {
            paint();
            return;
        }
        if (button.dataset.action !== 'finish-onboarding') return;
        state.busy = true;
        state.error = '';
        paint();
        finishOnboarding(state, deps).then(() => {
            host.remove();
        }).catch((error) => {
            state.busy = false;
            state.error = error?.code === 'EMPTY_NAME' ? '' : '没有完成，请重试。';
            paint();
        });
    });
    (doc.body || doc.documentElement).append(host);
    const started = Date.now();
    const openHost = () => {
        if (!host.isConnected || host.open) return;
        const blocked = [...(doc.querySelectorAll?.('dialog[open]') || [])].some((el) => el !== host);
        if (blocked && Date.now() - started < 30000) {
            doc.defaultView?.setTimeout(openHost, 200);
            return;
        }
        try { host.showModal(); } catch { try { host.show(); } catch { /* 已经打开。 */ } }
        if ((doc.body || doc)?.getAttribute?.('data-vc-st-bound') === '1') host.remove();
    };
    openHost();
    host.querySelector('[name="name"]')?.focus?.();
    return host;
}

async function waitForConsent(doc) {
    let records = null;
    try { records = await listConsents(); } catch { records = null; }
    if (!Array.isArray(records) || consentOutstanding(records).length === 0) return;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        const dialog = doc.getElementById?.('vc-consent');
        if (!dialog) {
            try {
                records = await listConsents();
            } catch {
                return;
            }
            if (!Array.isArray(records) || consentOutstanding(records).length === 0) return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

export async function maybeStartOnboarding(deps = {}) {
    if (typeof deps.readUi === 'function' && !deps.readUi()) return null;
    const doc = deps.document || globalThis.document;
    bindOnboardingDismiss(doc);
    if (!doc?.body || doc.querySelector?.('.vc-onboarding')) return null;
    let rows = [];
    try {
        rows = await deps.loadRelationships?.();
    } catch {
        return null;
    }
    if (!shouldOfferOnboarding(rows)) return null;
    await waitForConsent(doc);
    try {
        rows = await deps.loadRelationships?.();
    } catch {
        rows = [];
    }
    if (!shouldOfferOnboarding(rows) || doc.querySelector?.('.vc-onboarding')) return null;
    if (doc.body?.getAttribute?.('data-vc-st-bound') === '1') return null;
    return mountOnboarding(doc, deps);
}
