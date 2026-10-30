// UI-P02：角色卡模板来自宿主卡，陪伴实例来自已有 relationships 与 POST /api/v1/st/bindings。
import { fetchRelationships, resolveSTBinding, storyRequest } from './api.js';
import { renderPersonaEditor, saveNativePersona } from './persona.js';
import { confirmAlert } from './ui/alert.js';
import { icon } from './ui/icons.js';
import { readVcUiFlag } from './ui/theme.js';
import { createNav } from './ui/nav.js';
import { NEUTRAL_TINT, tintOf } from './ui/tint.js';
import { openRelationshipVoiceSettings, voiceSettingsAvailable } from './voice-settings.js';
import { popMenu } from './ui/menu.js';

export const IMPORT_FAILED_COPY = '文件不是受支持的角色卡格式，原有角色未发生变动。请核对 JSON / PNG 角色元数据规范。';
export const UNSAVED_INSTANCE_COPY = '当前存在未保存更改，切换实例前请先保存。';

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const ENUMS = {
    replyLength: ['SHORT', 'MEDIUM', 'LONG'],
    initiative: ['LOW', 'MEDIUM', 'HIGH'],
    humor: ['NONE', 'LIGHT', 'WARM'],
    advicePref: ['ASK_FIRST', 'DIRECT', 'RARE'],
    memoryShareScope: ['SESSION', 'RELATIONSHIP'],
    gender: ['FEMALE', 'MALE', 'NEUTRAL'],
    avatarRef: ['AVATAR_FEMALE_01', 'AVATAR_MALE_01', 'AVATAR_NEUTRAL_01'],
};
const AVOID = new Set(['WORK', 'FAMILY', 'HEALTH', 'ROMANCE', 'MONEY', 'POLITICS', 'SUBSTANCE', 'RELIGION']);
const ID = /^[1-9][0-9]{0,18}$/;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function initial(name) {
    const text = String(name || '').replace(/[^\p{L}\p{N}]/gu, '');
    return [...text][0] || '角';
}

export function sanitizeInstanceName(value) {
    const raw = String(value ?? '');
    if ([...raw].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
        return { ok: false, reason: '实例名称最多 32 个字。' };
    }
    const collapsed = raw.trim().replace(/\s+/g, ' ');
    if (!collapsed) return { ok: false, reason: '先填写实例名称。' };
    if ([...collapsed].length > 32) return { ok: false, reason: '实例名称最多 32 个字。' };
    return { ok: true, value: collapsed };
}

export function cardsFromContext(context) {
    const list = Array.isArray(context?.characters) ? context.characters : [];
    return list.filter(Boolean).map((card) => {
        const book = card.data?.character_book?.name;
        const world = card.data?.extensions?.world;
        return {
            characterRef: typeof card.data?.extensions?.vc_character_ref === 'string' ? card.data.extensions.vc_character_ref : '',
            name: card.name || '未命名角色卡',
            description: typeof card.description === 'string' ? card.description : (typeof card.data?.description === 'string' ? card.data.description : ''),
            worldName: typeof book === 'string' ? book : (typeof world === 'string' ? world : ''),
        };
    });
}

function nonEmptyRef(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function bindingsFromContext(context) {
    const binding = context?.chatMetadata?.vc_binding;
    if (binding?.relationshipId == null || binding.relationshipId === '') return [];
    const card = context?.characters?.[context.characterId];
    const stored = nonEmptyRef(binding.characterRef);
    const fromCard = nonEmptyRef(card?.data?.extensions?.vc_character_ref);
    return [{
        relationshipId: String(binding.relationshipId),
        characterRef: stored || fromCard,
        chatIdentity: typeof context?.chatMetadata?.vc_f2?.id === 'string' ? context.chatMetadata.vc_f2.id : '',
        mode: binding.mode || 'COMPANION',
    }];
}

export function inspectCharacterFile(bytes, filename = '') {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (data.length >= 8 && PNG.every((byte, index) => data[index] === byte)) {
        return { ok: pngHasChara(data), format: 'png' };
    }
    const name = String(filename || '');
    const text = new TextDecoder().decode(data);
    if (name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{')) {
        try {
            const parsed = JSON.parse(text);
            const cardName = typeof parsed?.name === 'string' ? parsed.name : parsed?.data?.name;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof cardName === 'string' && cardName.trim()) {
                return { ok: true, format: 'json' };
            }
        } catch {
            return { ok: false, format: '' };
        }
    }
    return { ok: false, format: '' };
}

function pngHasChara(bytes) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        const start = offset + 8;
        const end = start + length;
        if (end + 4 > bytes.length) return false;
        if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
            const chunk = bytes.subarray(start, end);
            const nul = chunk.indexOf(0);
            const keyword = new TextDecoder().decode(nul >= 0 ? chunk.subarray(0, nul) : chunk);
            if (keyword === 'chara') return true;
        }
        offset = end + 4;
    }
    return false;
}

export function instancesFrom(relationships) {
    return (Array.isArray(relationships) ? relationships : [])
        .filter((row) => row?.personaRef === 'st-character')
        .map((row) => ({
            relationshipId: String(row.relationshipId),
            name: row.companionName || '未命名实例',
        }));
}

function prefsBody(relationship, name) {
    const id = String(relationship?.relationshipId ?? '');
    if (!ID.test(id) || typeof relationship?.remindersAllowed !== 'boolean' || !Array.isArray(relationship.avoidTopics)) return null;
    for (const topic of relationship.avoidTopics) {
        if (!AVOID.has(topic)) return null;
    }
    for (const [key, allowed] of Object.entries(ENUMS)) {
        if (!allowed.includes(relationship[key])) return null;
    }
    const address = relationship.userAddressAs;
    if (!(address == null || typeof address === 'string')) return null;
    return {
        companionName: name,
        userAddressAs: address,
        replyLength: relationship.replyLength,
        initiative: relationship.initiative,
        humor: relationship.humor,
        advicePref: relationship.advicePref,
        remindersAllowed: relationship.remindersAllowed,
        memoryShareScope: relationship.memoryShareScope,
        avoidTopics: relationship.avoidTopics,
        gender: relationship.gender,
        avatarRef: relationship.avatarRef,
    };
}

export async function saveInstanceName(relationship, name) {
    const clean = sanitizeInstanceName(name);
    if (!clean.ok) throw Object.assign(new Error(clean.reason), { code: 'INVALID_NAME' });
    const id = String(relationship?.relationshipId ?? '');
    const body = prefsBody(relationship, clean.value);
    if (!body) throw Object.assign(new Error('名称尚未保存'), { code: 'INVALID_NAME' });
    return storyRequest('PATCH', `/api/v1/relationships/${id}`, body);
}

export async function createCompanionInstance({ characterRef, displayName, chatIdentity, mode = 'COMPANION' } = {}) {
    return resolveSTBinding({ characterRef, displayName, chatIdentity, mode });
}

/** SillyTavern 1.19 的 importCharacter 未导出。processDroppedFiles 是会调用它的公开入口。 */
export async function importNativeCharacterFile({
    name = '',
    bytes,
    format,
    getContext,
    loadNative = () => import('/script.js'),
    newRef = () => crypto.randomUUID(),
} = {}) {
    if (typeof getContext !== 'function') throw new Error('no context');
    const kind = format === 'png' ? 'png' : 'json';
    const type = kind === 'png' ? 'image/png' : 'application/json';
    let fileName = String(name || `card.${kind}`);
    if (!fileName.toLowerCase().endsWith(`.${kind}`)) fileName += `.${kind}`;
    const file = new File([bytes], fileName, { type });
    const before = new Set((getContext().characters || []).map((card) => card?.avatar).filter(Boolean));
    const native = await loadNative();
    if (typeof native?.processDroppedFiles !== 'function') throw new Error('native import unavailable');
    await native.processDroppedFiles([file]);
    const ctx = getContext();
    const characters = ctx.characters || [];
    const characterId = characters.findIndex((card) => card?.avatar && !before.has(card.avatar));
    if (characterId < 0) throw new Error('import did not add a character');
    const card = characters[characterId];
    let ref = card?.data?.extensions?.vc_character_ref;
    if (typeof ref !== 'string' || !ref.trim()) {
        ref = newRef();
        if (typeof ctx.writeExtensionField !== 'function') throw new Error('writeExtensionField missing');
        await ctx.writeExtensionField(characterId, 'vc_character_ref', ref);
    }
    const book = card?.data?.character_book?.name;
    const world = card?.data?.extensions?.world;
    const description = typeof card?.description === 'string'
        ? card.description
        : (typeof card?.data?.description === 'string' ? card.data.description : '');
    return {
        characterRef: ref,
        name: card?.name || '未命名角色卡',
        description,
        worldName: typeof book === 'string' ? book : (typeof world === 'string' ? world : ''),
    };
}

export function renderInstancePage(state) {
    const cards = Array.isArray(state.cards) ? state.cards : [];
    const instances = instancesFrom(state.relationships);
    const dirty = state.draftName !== state.savedName && (state.creating || state.selectedRelationshipId);
    const form = state.creating || state.selectedRelationshipId;
    const editing = instances.find((item) => item.relationshipId === state.selectedRelationshipId);
    const editingName = editing?.name || state.savedName || '未命名实例';
    const createClass = instances.length ? 'vc-instance-create' : 'vc-instance-create vc-instance-primary';
    return `<div class="vc-instance-page">
      <header class="vc-instance-bar"><h1>角色</h1><div class="vc-instance-bar-actions"><button type="button" data-action="import">导入角色卡</button><button type="button" data-action="close">关闭</button></div></header>
      ${state.importError ? `<p class="vc-instance-alert" role="alert">${esc(state.importError)}</p>` : ''}
      ${state.loadError ? `<p class="vc-instance-alert" role="alert">${esc(state.loadError)}</p>` : ''}
      <div class="vc-instance-columns">
        <section aria-label="角色卡模板"><h2>角色卡模板</h2>
          ${cards.length ? `<ul class="vc-instance-list">${cards.map((item) => `<li><button type="button" class="vc-instance-template" data-action="select-template" data-ref="${esc(item.characterRef)}" aria-current="${item.characterRef === state.selectedCharacterRef ? 'true' : 'false'}"><span class="vc-instance-avatar" aria-hidden="true">${esc(initial(item.name))}</span><span class="vc-instance-template-copy"><strong>${esc(item.name || '未命名角色卡')}</strong><span class="vc-instance-badge">模板</span>${item.description ? `<span class="vc-instance-secondary">${esc(item.description)}</span>` : ''}${item.worldName ? `<span class="vc-instance-world">关联世界书 · ${esc(item.worldName)}</span>` : ''}</span></button></li>`).join('')}</ul>` : '<p>还没有角色卡模板</p>'}
        </section>
        <div class="vc-instance-main">
          <section aria-label="陪伴实例"><h2>陪伴实例</h2>
            ${instances.length ? `<ul class="vc-instance-list">${instances.map((item) => {
                const current = !state.creating && item.relationshipId === state.selectedRelationshipId;
                return `<li><button type="button" class="vc-instance-choice" data-action="select-instance" data-id="${esc(item.relationshipId)}" aria-current="${current ? 'true' : 'false'}"><span class="vc-instance-avatar" aria-hidden="true">${esc(initial(item.name))}</span><span class="vc-instance-choice-copy"><strong>${esc(item.name)}</strong>${current ? '<span class="vc-instance-badge">正在编辑</span>' : ''}</span></button></li>`;
            }).join('')}</ul>` : '<p>还没有陪伴实例</p>'}
            <button type="button" data-action="create" class="${createClass}">创建实例</button>
          </section>
          ${form ? `<form class="vc-instance-form" data-form="instance"><h2>${state.creating ? '新建实例' : `正在编辑 · ${esc(editingName)}`}</h2><label>实例名称<input name="displayName" value="${esc(state.draftName || '')}" maxlength="64"></label>${dirty ? `<p>${UNSAVED_INSTANCE_COPY}</p>` : ''}${state.nameError ? `<p role="alert">${esc(state.nameError)}</p>` : ''}<div class="vc-instance-form-actions"><button type="button" data-action="cancel-edit">取消</button><button type="submit" class="vc-instance-primary">${state.creating ? '创建实例' : '保存更改'}</button></div></form>` : ''}
        </div>
      </div>
      ${state.unsaved ? `<dialog class="vc-instance-unsaved"><p>${UNSAVED_INSTANCE_COPY}</p><div class="vc-instance-actions"><button type="button" data-action="keep-editing">继续编辑</button><button type="button" data-action="discard">放弃更改</button></div></dialog>` : ''}
    </div>`;
}

export function createInstancePage({
    loadRelationships = fetchRelationships,
    getCards = () => [],
    getBindings = () => [],
    createBinding = createCompanionInstance,
    saveName = saveInstanceName,
    importCard = null,
    newId = () => crypto.randomUUID(),
    onChange = () => {},
} = {}) {
    const state = {
        open: false, cards: [], relationships: [], bindings: [], selectedCharacterRef: '', selectedRelationshipId: '',
        creating: false, draftName: '', savedName: '', importError: '', unsaved: null, nameError: '', loadError: '', busy: false,
    };
    const emit = () => onChange(state);
    const dirty = () => state.draftName !== state.savedName && (state.creating || state.selectedRelationshipId);
    let loadGeneration = 0;
    function applyInstance(id) {
        const row = instancesFrom(state.relationships).find((item) => item.relationshipId === String(id));
        state.creating = false;
        state.unsaved = null;
        state.nameError = '';
        state.selectedRelationshipId = row?.relationshipId || '';
        state.savedName = row?.name && row.name !== '未命名实例' ? row.name : (state.relationships.find((item) => String(item.relationshipId) === String(id))?.companionName || '');
        if (!state.savedName && row) state.savedName = row.name === '未命名实例' ? '' : row.name;
        state.draftName = state.savedName;
    }
    return {
        state,
        async open() {
            const ticket = ++loadGeneration;
            state.open = true;
            state.loadError = '';
            try {
                const [relationships, cards, bindings] = await Promise.all([
                    loadRelationships(), Promise.resolve(getCards()), Promise.resolve(getBindings()),
                ]);
                if (ticket !== loadGeneration) return;
                state.relationships = Array.isArray(relationships) ? relationships : [];
                state.cards = (Array.isArray(cards) ? cards : []).map((item) => ({
                    characterRef: item?.characterRef || '', name: item?.name || '未命名角色卡',
                    description: item?.description || '', worldName: item?.worldName || '',
                }));
                state.bindings = Array.isArray(bindings) ? bindings : [];
                state.selectedCharacterRef = state.cards.find((item) => item.characterRef)?.characterRef || state.cards[0]?.characterRef || '';
                const first = instancesFrom(state.relationships)[0];
                state.creating = false;
                state.unsaved = null;
                state.importError = '';
                state.nameError = '';
                state.selectedRelationshipId = first?.relationshipId || '';
                const source = state.relationships.find((item) => String(item.relationshipId) === state.selectedRelationshipId);
                state.savedName = source?.companionName || '';
                state.draftName = state.savedName;
            } catch {
                if (ticket !== loadGeneration) return;
                state.loadError = '加载失败，请重试。';
            }
            if (ticket !== loadGeneration) return;
            emit();
        },
        setName(value) { state.draftName = String(value ?? ''); emit(); },
        selectInstance(id) {
            if (!state.creating && String(id) === state.selectedRelationshipId) return true;
            if (dirty()) {
                state.unsaved = { type: 'select', id: String(id) };
                emit();
                return false;
            }
            applyInstance(id);
            emit();
            return true;
        },
        selectTemplate(characterRef) {
            state.selectedCharacterRef = String(characterRef || '');
            emit();
        },
        cancelUnsaved() { state.unsaved = null; emit(); },
        confirmDiscard() {
            const pending = state.unsaved;
            state.unsaved = null;
            if (pending?.type === 'select') applyInstance(pending.id);
            else if (pending?.type === 'create') beginCreate();
            else if (pending?.type === 'close') {
                state.creating = false;
                state.draftName = state.savedName;
            }
            emit();
        },
        startCreate() {
            if (dirty()) {
                state.unsaved = { type: 'create' };
                emit();
                return false;
            }
            beginCreate();
            emit();
            return true;
        },
        async save() {
            const clean = sanitizeInstanceName(state.draftName);
            if (!clean.ok) {
                state.nameError = clean.reason;
                emit();
                return;
            }
            if (!state.creating && clean.value === state.savedName) return;
            state.busy = true;
            state.nameError = '';
            emit();
            try {
                if (state.creating) {
                    const card = state.cards.find((item) => item.characterRef === state.selectedCharacterRef) || state.cards[0];
                    if (!card) throw new Error('no-card');
                    if (!card.characterRef) card.characterRef = newId();
                    const created = await createBinding({
                        characterRef: card.characterRef,
                        displayName: clean.value,
                        chatIdentity: newId(),
                        mode: 'COMPANION',
                    });
                    state.relationships = [...state.relationships, {
                        relationshipId: String(created?.relationshipId || ''),
                        personaRef: 'st-character',
                        companionName: clean.value,
                    }];
                    state.creating = false;
                    state.selectedRelationshipId = String(created?.relationshipId || '');
                    state.savedName = clean.value;
                    state.draftName = clean.value;
                } else {
                    const row = state.relationships.find((item) => String(item.relationshipId) === state.selectedRelationshipId);
                    await saveName(row, clean.value);
                    if (row) row.companionName = clean.value;
                    state.savedName = clean.value;
                    state.draftName = clean.value;
                }
                state.nameError = '';
            } catch {
                state.nameError = '名称尚未保存';
            } finally {
                state.busy = false;
                emit();
            }
        },
        async importFile({ name = '', bytes } = {}) {
            const inspected = inspectCharacterFile(bytes, name);
            if (!inspected.ok) {
                state.importError = IMPORT_FAILED_COPY;
                emit();
                return;
            }
            if (typeof importCard !== 'function') {
                state.importError = '';
                emit();
                return;
            }
            try {
                const created = await importCard({ name, format: inspected.format, bytes });
                if (created?.name) {
                    state.cards = [...state.cards, {
                        characterRef: created.characterRef || '',
                        name: created.name,
                        description: created.description || '',
                        worldName: created.worldName || '',
                    }];
                }
                state.importError = '';
            } catch {
                state.importError = IMPORT_FAILED_COPY;
            }
            emit();
        },
    };

    function beginCreate() {
        state.creating = true;
        state.unsaved = null;
        state.nameError = '';
        state.selectedRelationshipId = '';
        state.savedName = '';
        state.draftName = '';
    }
}

function ensureInstanceStyles() {
    if (typeof document === 'undefined' || document.querySelector('link[data-vc-instance]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-vc-instance', '');
    link.href = new URL('./instance.css', import.meta.url).href;
    (document.head || document.documentElement).append(link);
}

export function mountInstancePage(options = {}) {
    ensureInstanceStyles();
    const root = document.createElement('div');
    root.className = 'vcms-root vc-instance-root';
    const dialog = document.createElement('dialog');
    dialog.className = 'vc-instance-dialog';
    dialog.setAttribute('aria-label', '角色');
    root.append(dialog);
    document.body.append(root);
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.json,.png,application/json,image/png';
    file.hidden = true;
    root.append(file);
    let opener = null;
    const page = createInstancePage({
        ...options,
        importCard: options.importCard || ((spec) => importNativeCharacterFile({ ...spec, getContext: options.getContext })),
        onChange(state) {
            if (!dialog.open) return;
            for (const node of document.querySelectorAll('body > .vc-instance-unsaved')) node.remove();
            const active = document.activeElement;
            const field = active?.name;
            const selection = active?.tagName === 'INPUT' ? [active.selectionStart, active.selectionEnd] : null;
            dialog.innerHTML = renderInstancePage(state);
            const unsaved = dialog.querySelector('.vc-instance-unsaved');
            if (unsaved) {
                presentUnsaved(unsaved);
                return;
            }
            if (field) {
                const next = dialog.querySelector(`[name="${field}"]`);
                next?.focus();
                if (selection && next?.setSelectionRange) next.setSelectionRange(...selection);
            }
        },
    });
    function presentUnsaved(unsaved) {
        document.body.append(unsaved);
        unsaved.showModal();
        unsaved.addEventListener('click', (event) => {
            const target = event.target?.closest?.('button');
            if (!target) return;
            if (target.dataset.action === 'keep-editing') dismissUnsaved();
            if (target.dataset.action === 'discard') page.confirmDiscard();
        });
        unsaved.addEventListener('cancel', (event) => {
            event.preventDefault();
            event.stopPropagation();
            dismissUnsaved();
        });
    }
    function focusAfterUnsaved(pending) {
        if (pending?.type === 'select' && pending.id) {
            dialog.querySelector(`[data-action="select-instance"][data-id="${pending.id}"]`)?.focus();
            return;
        }
        const field = dialog.querySelector('[name="displayName"]');
        if (field) field.focus();
        else opener?.focus?.();
    }
    function dismissUnsaved() {
        const pending = page.state.unsaved;
        page.cancelUnsaved();
        focusAfterUnsaved(pending);
    }
    const close = () => {
        if (page.state.busy) return;
        if (page.state.draftName !== page.state.savedName && (page.state.creating || page.state.selectedRelationshipId)) {
            for (const node of document.querySelectorAll('body > .vc-instance-unsaved')) node.remove();
            page.state.unsaved = { type: 'close' };
            page.state.open = true;
            dialog.innerHTML = renderInstancePage(page.state);
            const unsaved = dialog.querySelector('.vc-instance-unsaved');
            if (unsaved) presentUnsaved(unsaved);
            return;
        }
        for (const node of document.querySelectorAll('body > .vc-instance-unsaved')) node.remove();
        dialog.close();
        dialog.innerHTML = '';
        opener?.focus?.();
    };
    dialog.addEventListener('cancel', (event) => {
        if (document.querySelector('.vc-instance-unsaved')?.open) {
            event.preventDefault();
            dismissUnsaved();
            return;
        }
        event.preventDefault();
        close();
    });
    dialog.addEventListener('input', (event) => {
        if (event.target?.name === 'displayName') page.setName(event.target.value);
    });
    dialog.addEventListener('submit', (event) => {
        event.preventDefault();
        void page.save();
    });
    dialog.addEventListener('click', (event) => {
        const target = event.target?.closest?.('button') || (event.target?.tag === 'button' ? event.target : null);
        if (!target || target.disabled) return;
        if (target.dataset?.action === 'close') close();
        if (target.dataset?.action === 'import') file.click();
        if (target.dataset?.action === 'create') page.startCreate();
        if (target.dataset?.action === 'select-template') page.selectTemplate(target.dataset.ref);
        if (target.dataset?.action === 'select-instance') page.selectInstance(target.dataset.id);
        if (target.dataset?.action === 'keep-editing') dismissUnsaved();
        if (target.dataset?.action === 'discard') page.confirmDiscard();
        if (target.dataset?.action === 'cancel-edit') {
            if (page.state.draftName !== page.state.savedName) close();
            else if (page.state.creating) page.confirmDiscard();
        }
    });
    file.addEventListener('change', async () => {
        const chosen = file.files?.[0];
        file.value = '';
        if (!chosen) return;
        const bytes = new Uint8Array(await chosen.arrayBuffer());
        await page.importFile({ name: chosen.name, bytes });
    });
    return {
        open(returnFocusTarget = document.activeElement) {
            if (!dialog.open) {
                opener = returnFocusTarget ?? opener;
                dialog.showModal();
            }
            return page.open();
        },
        close,
        page,
    };
}

function isVcUiOn() {
    try {
        if (globalThis.document?.body?.classList?.contains('vc-ui')) return true;
    } catch {
        /* 文档不可用时只看存储标志。 */
    }
    return readVcUiFlag();
}

function characterModel(state) {
    const cards = (Array.isArray(state.cards) ? state.cards : []).map((card) => ({
        characterRef: card?.characterRef || '',
        name: card?.name || '未命名角色卡',
        description: card?.description || '',
        worldName: card?.worldName || '',
        avatar: typeof card?.avatar === 'string' ? card.avatar : '',
        instances: [],
    }));
    const byRef = new Map();
    for (const card of cards) {
        const ref = nonEmptyRef(card.characterRef);
        if (ref) byRef.set(ref, card);
    }
    const instances = instancesFrom(state.relationships).map((item) => {
        const row = (state.relationships || []).find((rel) => String(rel?.relationshipId) === item.relationshipId) || {};
        return {
            ...item,
            characterRef: nonEmptyRef(row.characterRef),
            lastAt: row.lastChatAt || row.lastMessageAt || '',
            chatIdentity: '',
        };
    });
    const placed = new Set();
    for (const binding of Array.isArray(state.bindings) ? state.bindings : []) {
        const ref = nonEmptyRef(binding?.characterRef);
        const card = ref ? byRef.get(ref) : undefined;
        const inst = instances.find((item) => item.relationshipId === String(binding?.relationshipId ?? ''));
        if (!card || !inst || placed.has(inst.relationshipId)) continue;
        card.instances.push({ ...inst, chatIdentity: typeof binding.chatIdentity === 'string' ? binding.chatIdentity : '' });
        placed.add(inst.relationshipId);
    }
    for (const inst of instances) {
        if (placed.has(inst.relationshipId)) continue;
        const card = inst.characterRef ? byRef.get(inst.characterRef) : undefined;
        if (!card) continue;
        card.instances.push(inst);
        placed.add(inst.relationshipId);
    }
    const loose = instances.filter((item) => !placed.has(item.relationshipId));
    if (loose.length && cards.length === 1) {
        cards[0].instances.push(...loose);
        loose.length = 0;
    }
    return { cards, loose };
}

function formatWhen(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const hm = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (date.toDateString() === now.toDateString()) return hm;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
}

export function safeImageUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^data:image\/(png|jpeg|webp|gif)([;,].*)?$/i.test(raw)) return raw;
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return '';
}

export function characterAvatarSrc(avatar) {
    const safe = safeImageUrl(avatar);
    if (safe) return safe;
    const file = String(avatar ?? '').trim();
    if (!file) return '';
    return `/characters/${file}`;
}

function avatarHtml(name, url, className) {
    const src = characterAvatarSrc(url);
    const face = src
        ? `<img alt="" src="${esc(src)}">`
        : esc(initial(name));
    return `<span class="${className}">${face}</span>`;
}

function descriptionBlock(detail, options) {
    const text = detail?.description;
    if (!text) return '';
    const open = options?.descriptionOpen === true;
    return `<section class="vc-group vc-card-description${open ? ' is-open' : ''}" data-vc-description><p class="vc-card-description-text">${esc(text)}</p><button type="button" class="vc-btn vc-btn-text" data-action="toggle-description" aria-expanded="${open ? 'true' : 'false'}">${open ? '收起' : '展开'}</button></section>`;
}

function instanceRows(items, state) {
    if (!items.length) return '<p>还没有陪伴实例</p>';
    return items.map((item) => {
        const current = !state.creating && item.relationshipId === state.selectedRelationshipId;
        const when = formatWhen(item.lastAt);
        const meta = [
            when ? `<span class="vc-meta vc-num">${esc(when)}</span>` : '',
            current ? '<span class="vc-instance-badge">正在编辑</span>' : '',
        ].filter(Boolean).join('');
        return `<button type="button" class="vc-cell" data-action="select-instance" data-id="${esc(item.relationshipId)}" aria-current="${current ? 'true' : 'false'}"><span class="vc-grow"><strong>${esc(item.name)}</strong>${meta ? `<span class="vc-instance-sub">${meta}</span>` : ''}</span><span class="vc-chevron">${icon('chevron-right', { size: 16 })}</span></button>`;
    }).join('');
}

function nameForm(state) {
    const dirty = state.draftName !== state.savedName && (state.creating || state.selectedRelationshipId);
    return `<form class="vc-instance-form" data-form="instance"><label>实例名称<input name="displayName" value="${esc(state.draftName || '')}" maxlength="64"></label>${dirty ? `<p class="vc-footnote">${UNSAVED_INSTANCE_COPY}</p>` : ''}${state.nameError ? `<p role="alert">${esc(state.nameError)}</p>` : ''}<div class="vc-instance-form-actions"><button type="button" class="vc-btn vc-btn-text" data-action="cancel-edit">取消</button><button type="submit" class="vc-btn vc-btn-fill">${state.creating ? '创建实例' : '保存更改'}</button></div></form>`;
}

export function renderCharactersTab(state, options = {}) {
    const screen = options.screen === 'detail' ? 'detail' : 'list';
    const model = characterModel(state);
    const detail = model.cards.find((card) => card.characterRef === (options.detailRef || '')) || model.cards[0];
    if (options.loading) {
        return `<header class="vc-navbar"><div class="vc-nav-title">角色</div><div class="vc-nav-spacer"></div></header><div class="vc-scroll" aria-busy="true"><h1 class="vc-large-title">角色</h1><div class="vc-roles">${[0, 1, 2, 3].map(() => `<div class="vc-role" aria-hidden="true"><span class="vc-skeleton vc-skeleton-avatar"></span><span class="vc-skeleton vc-skeleton-line"></span><span class="vc-skeleton vc-skeleton-line is-short"></span></div>`).join('')}</div></div>`;
    }
    if (screen === 'detail' && detail) {
        const showForm = state.creating || detail.instances.some((item) => item.relationshipId === state.selectedRelationshipId);
        const count = `${detail.instances.length} 个实例`;
        return `<header class="vc-navbar" style="--vc-nav-p:1"><button type="button" class="vc-circle vc-glass" data-action="back" aria-label="返回">${icon('chevron-left')}</button><h1 class="vc-nav-title" tabindex="-1">${esc(detail.name)}</h1><div class="vc-nav-spacer"></div><button type="button" class="vc-circle vc-glass" data-action="edit-card" aria-label="编辑角色卡">${icon('pencil')}</button></header><div class="vc-scroll"><div class="vc-column"><div class="vc-poster" style="--vc-tint:${NEUTRAL_TINT}" data-tint="${esc(detail.avatar)}">${avatarHtml(detail.name, detail.avatar, 'vc-poster-avatar')}<span class="vc-instance-badge">模板</span><span class="vc-meta">${esc(count)}</span></div>${descriptionBlock(detail, options)}${detail.worldName ? `<div class="vc-group"><div class="vc-cell"><span class="vc-grow"><span class="vc-instance-world">关联世界书 · ${esc(detail.worldName)}</span></span></div></div>` : ''}<div class="vc-group"><button type="button" class="vc-cell" data-action="edit-persona"><span class="vc-grow">人设</span><span class="vc-chevron">${icon('chevron-right', { size: 16 })}</span></button></div>${detail.instances.length && voiceSettingsAvailable() ? `<div class="vc-group"><button type="button" class="vc-cell" data-action="edit-voice"><span class="vc-grow">声音</span><span class="vc-chevron">${icon('chevron-right', {size:16})}</span></button></div>` : ''}<div class="vc-group" aria-label="陪伴实例">${instanceRows(detail.instances, state)}</div>${detail.instances.length && !state.creating ? `<button type="button" class="vc-btn vc-btn-text vc-instance-create" data-action="create">创建实例</button>` : ''}${!detail.instances.length && !showForm ? `<button type="button" class="vc-btn vc-btn-fill vc-instance-create vc-instance-primary" data-action="create">创建实例</button>` : ''}${showForm ? nameForm(state) : ''}${state.importError ? `<p class="vc-instance-alert" role="alert">${esc(state.importError)}</p>` : ''}${state.loadError ? `<p class="vc-instance-alert" role="alert">${esc(state.loadError)}</p>` : ''}</div></div>`;
    }
    const alerts = `${state.importError ? `<p class="vc-instance-alert" role="alert">${esc(state.importError)}</p>` : ''}${state.loadError ? `<p class="vc-instance-alert" role="alert">${esc(state.loadError)}</p><button type="button" class="vc-btn vc-btn-fill" data-action="retry">重试</button>` : ''}`;
    const body = model.cards.length
        ? `<div class="vc-roles">${model.cards.map((card) => `<button type="button" class="vc-role" data-action="select-template" data-ref="${esc(card.characterRef)}" data-tint="${esc(card.avatar)}" style="--vc-tint:${NEUTRAL_TINT}" aria-current="${card.characterRef === state.selectedCharacterRef ? 'true' : 'false'}">${avatarHtml(card.name, card.avatar, 'vc-role-avatar')}<b>${esc(card.name || '未命名角色卡')}</b><span>${card.instances.length} 个实例</span></button>`).join('')}</div>${model.loose.length ? `<div class="vc-group" aria-label="陪伴实例">${instanceRows(model.loose, state)}</div>` : ''}`
        : `<div class="vc-empty">${icon('users-round', { size: 32 })}<p>还没有角色卡模板</p><button type="button" class="vc-btn vc-btn-fill" data-action="import">导入角色卡</button></div>`;
    return `<header class="vc-navbar"><div class="vc-nav-title">角色</div><div class="vc-nav-spacer"></div><button type="button" class="vc-circle vc-glass" data-action="import" aria-label="导入角色卡">${icon('plus')}</button></header><div class="vc-scroll"><div class="vc-column"><h1 class="vc-large-title" tabindex="-1">角色</h1>${alerts}${body}</div></div>`;
}

export function openHostCharacterPanel(doc = globalThis.document) {
    const panel = doc?.getElementById?.('right-nav-panel');
    const iconButton = doc?.getElementById?.('rightNavDrawerIcon');
    const closed = !panel || panel.classList.contains('closedDrawer') || !panel.classList.contains('openDrawer');
    if (iconButton && closed) {
        iconButton.click();
        return true;
    }
    const characters = doc?.getElementById?.('rm_button_characters');
    if (characters) {
        characters.click();
        return true;
    }
    if (!panel) return false;
    panel.classList.remove('closedDrawer');
    panel.classList.add('openDrawer');
    return true;
}

const spriteLoads = new Map();

function hydrateIcons(scope) {
    const doc = scope?.ownerDocument;
    if (!doc || typeof fetch !== 'function') return;
    const groups = new Map();
    for (const use of scope.querySelectorAll('use[href]')) {
        const href = use.getAttribute('href') || '';
        const hash = href.indexOf('#');
        if (hash <= 0) continue;
        const url = href.slice(0, hash);
        const id = href.slice(hash + 1);
        if (!url.endsWith('.svg') || !id) continue;
        if (!groups.has(url)) groups.set(url, []);
        groups.get(url).push({ use, id });
    }
    for (const [url, items] of groups) {
        const task = spriteLoads.get(url) || fetch(url).then((response) => {
            if (!response.ok) throw new Error('sprite');
            return response.text();
        }).then((text) => {
            if (!text.includes('<symbol')) throw new Error('sprite');
            let host = doc.getElementById('vc-icon-sprite');
            if (!host) {
                host = doc.createElement('div');
                host.id = 'vc-icon-sprite';
                host.setAttribute('aria-hidden', 'true');
                host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
                doc.body.append(host);
            }
            if (host.dataset.url !== url) {
                host.innerHTML = text.replace(/<\?xml[\s\S]*?\?>/, '').trim();
                host.dataset.url = url;
            }
            return true;
        }).catch(() => false);
        spriteLoads.set(url, task);
        task.then((ok) => {
            if (!ok) return;
            for (const item of items) {
                if (item.use.isConnected) item.use.setAttribute('href', `#${item.id}`);
            }
        });
    }
}

function applyTints(root) {
    for (const el of root.querySelectorAll('[data-tint]')) {
        const src = el.dataset.tint;
        if (!src) continue;
        tintOf(src).then((value) => {
            if (el.isConnected) el.style.setProperty('--vc-tint', value);
        });
    }
}

function rememberField(root) {
    const active = root.ownerDocument?.activeElement;
    if (!active || !root.contains(active) || active.name !== 'displayName') return null;
    return { name: active.name, start: active.selectionStart, end: active.selectionEnd };
}

function restoreField(root, mark) {
    if (!mark) return;
    const next = root.querySelector(`[name="${mark.name}"]`);
    next?.focus();
    if (mark.start != null && next?.setSelectionRange) next.setSelectionRange(mark.start, mark.end);
}

function attachShellImport(container, root, file) {
    const page = container.closest?.('.vc-shell-page');
    const bar = page?.querySelector?.(':scope > .vc-navbar');
    const doc = container.ownerDocument;
    if (!bar || !doc) return () => {};
    root.classList.add('is-shell-list');
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'vc-circle vc-glass';
    button.dataset.action = 'import';
    button.dataset.vcCharacterImport = '';
    button.setAttribute('aria-label', '导入角色卡');
    button.innerHTML = icon('plus');
    const settings = bar.querySelector('[data-settings]');
    if (settings) bar.insertBefore(button, settings);
    else bar.append(button);
    const onClick = () => file.click();
    button.addEventListener('click', onClick);
    return () => {
        button.removeEventListener('click', onClick);
        button.remove();
    };
}

export function mountCharactersTab(container, options = {}) {
    ensureInstanceStyles();
    if (!isVcUiOn()) return { async refresh() {}, destroy() {} };
    if (!container) throw new Error('mountCharactersTab requires a container');
    const root = container.ownerDocument.createElement('div');
    root.className = 'vc-characters';
    root.setAttribute('aria-label', '角色');
    container.append(root);
    const file = container.ownerDocument.createElement('input');
    file.type = 'file';
    file.accept = '.json,.png,application/json,image/png';
    file.hidden = true;
    root.append(file);
    const releaseImport = attachShellImport(container, root, file);
    const nav = createNav(root);
    const list = container.ownerDocument.createElement('section');
    list.className = 'vc-screen vc-characters-list';
    root.append(list);
    let detailEl = null;
    let personaEl = null;
    let detailRef = '';
    let descriptionOpen = false;
    const avatarByRef = new Map();
    const timeById = new Map();
    let dead = false;
    let suppress = false;
    let alertOpen = false;
    let loading = true;
    const page = createInstancePage({
        ...options,
        importCard: options.importCard || ((spec) => importNativeCharacterFile({ ...spec, getContext: options.getContext })),
        getCards: () => {
            const cards = typeof options.getCards === 'function' ? options.getCards() : [];
            let context;
            try { context = options.getContext?.(); } catch { context = null; }
            const characters = context?.characters || [];
            return (Array.isArray(cards) ? cards : []).map((card) => {
                const raw = characters.find((item) => item?.data?.extensions?.vc_character_ref === card?.characterRef)
                    || characters.find((item) => item?.name && item.name === card?.name);
                const avatar = typeof raw?.avatar === 'string' ? raw.avatar : (card?.avatar || '');
                const url = characterAvatarSrc(avatar);
                if (card?.characterRef) avatarByRef.set(card.characterRef, url);
                return { ...card, avatar: url };
            });
        },
        onChange() {
            if (dead || suppress) return;
            loading = false;
            paint();
            void maybeUnsaved();
        },
    });
    function findInstance(id) {
        const model = characterModel(page.state);
        for (const card of model.cards) {
            const inst = card.instances.find((item) => item.relationshipId === String(id));
            if (inst) return { inst, characterRef: card.characterRef };
        }
        const loose = model.loose.find((item) => item.relationshipId === String(id));
        return loose ? { inst: loose, characterRef: '' } : null;
    }
    function notifyOpen(id) {
        if (typeof options.onOpenInstance !== 'function') return;
        const found = findInstance(id);
        if (!found) return;
        options.onOpenInstance({
            relationshipId: found.inst.relationshipId,
            characterRef: found.characterRef,
            name: found.inst.name,
            chatIdentity: found.inst.chatIdentity || '',
        });
    }
    function decorate(state) {
        return {
            ...state,
            cards: (state.cards || []).map((card) => ({ ...card, avatar: avatarByRef.get(card.characterRef) || card.avatar || '' })),
            relationships: (state.relationships || []).map((row) => ({
                ...row,
                lastChatAt: row.lastChatAt || row.lastMessageAt || timeById.get(String(row.relationshipId)) || '',
            })),
        };
    }
    function readTimes() {
        try {
            const ctx = options.getContext?.();
            const id = ctx?.chatMetadata?.vc_binding?.relationshipId;
            const chat = ctx?.chat;
            const last = Array.isArray(chat) && chat.length ? chat[chat.length - 1] : null;
            const stamp = last?.send_date || last?.timestamp || '';
            if (id && stamp) timeById.set(String(id), String(stamp));
        } catch {
            /* 当前没有可显示的会话时间。 */
        }
    }
    function fill(el, screen) {
        const mark = rememberField(el);
        el.innerHTML = renderCharactersTab(decorate(page.state), { screen, detailRef, loading: screen === 'list' && loading, descriptionOpen: screen === 'detail' && descriptionOpen });
        hydrateIcons(el);
        restoreField(el, mark);
        applyTints(el);
        const scroll = el.querySelector('.vc-scroll');
        const bar = el.querySelector('.vc-navbar');
        if (scroll && bar && !bar.style.getPropertyValue('--vc-nav-p')) {
            scroll.addEventListener('scroll', () => {
                bar.style.setProperty('--vc-nav-p', String(Math.min(1, scroll.scrollTop / 48)));
            }, { passive: true });
        }
    }
    function paint() {
        fill(list, 'list');
        if (detailEl?.isConnected) fill(detailEl, 'detail');
    }
    async function maybeUnsaved() {
        if (!page.state.unsaved || alertOpen || dead) return;
        alertOpen = true;
        const pending = page.state.unsaved;
        const choice = confirmAlert({
            title: '放弃更改？',
            message: UNSAVED_INSTANCE_COPY,
            action: '放弃更改',
            root,
        });
        const stamp = () => {
            const dialog = root.querySelector('.vc-alert');
            dialog?.querySelector('[data-vc-cancel]')?.setAttribute('data-action', 'keep-editing');
            dialog?.querySelector('[data-vc-ok]')?.setAttribute('data-action', 'discard');
        };
        stamp();
        requestAnimationFrame(stamp);
        const ok = await choice;
        alertOpen = false;
        if (dead || !page.state.unsaved) return;
        if (ok) {
            page.confirmDiscard();
            if (pending?.type === 'select') notifyOpen(pending.id);
        } else page.cancelUnsaved();
    }
    function readPersona(ref) {
        let card = null;
        try {
            const ctx = options.getContext?.();
            const characters = ctx?.characters || [];
            card = characters.find((item) => item?.data?.extensions?.vc_character_ref === ref) || null;
        } catch { card = null; }
        const text = (key) => {
            const top = card?.[key];
            const nested = card?.data?.[key];
            if (typeof top === 'string') return top;
            return typeof nested === 'string' ? nested : '';
        };
        return {
            description: text('description'),
            personality: text('personality'),
            scenario: text('scenario'),
            first_mes: text('first_mes'),
            mes_example: text('mes_example'),
        };
    }
    function openPersona(ref) {
        const el = container.ownerDocument.createElement('section');
        el.className = 'vc-screen';
        el.dataset.personaRef = ref;
        el.innerHTML = renderPersonaEditor(readPersona(ref));
        nav.push(el);
        personaEl = el;
    }
    function openDetail(ref, from) {
        if (detailRef !== ref) descriptionOpen = false;
        detailRef = ref;
        suppress = true;
        page.selectTemplate(ref);
        suppress = false;
        if (detailEl?.isConnected && detailEl.dataset.ref === ref) {
            fill(detailEl, 'detail');
            fill(list, 'list');
            root.classList.add('is-detail');
            return;
        }
        const el = container.ownerDocument.createElement('section');
        el.className = 'vc-screen';
        el.dataset.ref = ref;
        fill(el, 'detail');
        const fromAvatar = from?.querySelector?.('.vc-role-avatar img, .vc-role-avatar');
        nav.push(el, {
            fly: fromAvatar ? { from: fromAvatar, to: (node) => node.querySelector('.vc-poster-avatar img, .vc-poster-avatar') } : undefined,
        });
        detailEl = el;
        root.classList.add('is-detail');
        fill(list, 'list');
    }
    async function goBack() {
        const dirty = page.state.draftName !== page.state.savedName && (page.state.creating || page.state.selectedRelationshipId);
        if (dirty) {
            const choice = confirmAlert({
                title: '放弃更改？',
                message: UNSAVED_INSTANCE_COPY,
                action: '放弃更改',
                root,
            });
            const stamp = () => {
                const dialog = root.querySelector('.vc-alert');
                dialog?.querySelector('[data-vc-cancel]')?.setAttribute('data-action', 'keep-editing');
                dialog?.querySelector('[data-vc-ok]')?.setAttribute('data-action', 'discard');
            };
            stamp();
            requestAnimationFrame(stamp);
            const ok = await choice;
            if (!ok || dead) return;
            page.state.draftName = page.state.savedName;
            page.state.creating = false;
            page.state.nameError = '';
            page.state.unsaved = null;
        }
        if (nav.pop()) detailEl = null;
        descriptionOpen = false;
        root.classList.toggle('is-detail', Boolean(detailEl?.isConnected));
    }
    root.addEventListener('click', (event) => {
        const target = event.target?.closest?.('button');
        if (!target || target.disabled || !root.contains(target)) return;
        const action = target.dataset.action;
        if (action === 'import') file.click();
        if (action === 'retry') void refresh();
        if (action === 'select-template') openDetail(target.dataset.ref || '', target);
        if (action === 'back') void goBack();
        if (action === 'toggle-description') {
            descriptionOpen = target.getAttribute('aria-expanded') !== 'true';
            if (detailEl?.isConnected) fill(detailEl, 'detail');
        }
        if (action === 'edit-card') openHostCharacterPanel(root.ownerDocument);
        if (action === 'edit-persona') openPersona(detailRef);
        if(action==='edit-voice'){
            const card=decorate(page.state).cards.find((item)=>item.characterRef===detailRef);
            const instances=card?.instances||[];
            if(instances.length===1)void openRelationshipVoiceSettings(instances[0].relationshipId,{opener:target});
            else if(instances.length>1)popMenu(target,instances.map((item)=>({label:item.name,run:()=>void openRelationshipVoiceSettings(item.relationshipId,{opener:target})})));
        }
        if (action === 'close-persona') {
            nav.pop();
            personaEl = null;
        }
        if (action === 'save-persona' && personaEl) {
            const fields = {};
            for (const area of personaEl.querySelectorAll('[data-persona]')) fields[area.dataset.persona] = area.value;
            const save = options.savePersona || ((ref, next) => saveNativePersona({ getContext: options.getContext, characterRef: ref, fields: next }));
            void save(detailRef, fields).then(() => {
                const card = page.state.cards.find((item) => item.characterRef === detailRef);
                if (card && typeof fields.description === 'string') card.description = fields.description;
                nav.pop();
                personaEl = null;
                paint();
            }).catch(() => {
                const note = personaEl?.querySelector('[data-persona-error]');
                if (note) note.textContent = '没有完成，请重试。';
            });
        }
        if (action === 'edit-name') {
            if (!(page.state.creating || page.state.selectedRelationshipId)) page.startCreate();
            queueMicrotask(() => root.querySelector('[name="displayName"]')?.focus());
        }
        if (action === 'create') page.startCreate();
        if (action === 'select-instance') {
            const id = target.dataset.id;
            if (page.selectInstance(id)) notifyOpen(id);
        }
        if (action === 'cancel-edit') {
            if (page.state.draftName !== page.state.savedName) {
                page.state.unsaved = { type: 'close' };
                void maybeUnsaved();
            } else if (page.state.creating) page.confirmDiscard();
        }
    });
    root.addEventListener('input', (event) => {
        if (event.target?.name === 'displayName') page.setName(event.target.value);
    });
    root.addEventListener('submit', (event) => {
        if (event.target?.dataset?.form !== 'instance') return;
        event.preventDefault();
        void page.save();
    });
    file.addEventListener('change', async () => {
        const chosen = file.files?.[0];
        file.value = '';
        if (!chosen) return;
        const bytes = new Uint8Array(await chosen.arrayBuffer());
        await page.importFile({ name: chosen.name, bytes });
    });
    async function refresh() {
        if (dead) return;
        loading = true;
        suppress = true;
        readTimes();
        paint();
        try {
            await page.open();
            readTimes();
        } finally {
            suppress = false;
            loading = false;
            if (!dead) paint();
        }
    }
    function destroy() {
        dead = true;
        detailEl = null;
        releaseImport();
        root.remove();
    }
    void refresh();
    return { refresh, destroy };
}
