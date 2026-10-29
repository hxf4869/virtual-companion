// UI-P02：角色卡模板来自宿主卡，陪伴实例来自已有 relationships 与 POST /api/v1/st/bindings。
import { fetchRelationships, resolveSTBinding, storyRequest } from './api.js';

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

export function bindingsFromContext(context) {
    const binding = context?.chatMetadata?.vc_binding;
    if (binding?.relationshipId == null || binding.relationshipId === '') return [];
    const card = context?.characters?.[context.characterId];
    return [{
        relationshipId: String(binding.relationshipId),
        characterRef: typeof card?.data?.extensions?.vc_character_ref === 'string' ? card.data.extensions.vc_character_ref : '',
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
            state.open = true;
            state.loadError = '';
            try {
                const [relationships, cards, bindings] = await Promise.all([
                    loadRelationships(), Promise.resolve(getCards()), Promise.resolve(getBindings()),
                ]);
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
                state.loadError = '加载失败，请重试。';
            }
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
                const created = await importCard({ name, format: inspected.format });
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
