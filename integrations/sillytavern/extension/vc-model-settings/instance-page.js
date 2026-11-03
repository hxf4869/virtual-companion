// UI-P02：角色卡模板来自宿主卡，陪伴实例来自已有 relationships 与 POST /api/v1/st/bindings。
import { fetchRelationships, resolveSTBinding, storyRequest } from './api.js';
import { saveNativePersona } from './persona.js';
import { confirmAlert } from './ui/alert.js';
import { iconSpriteUrl } from './ui/icons.js';
import { readVcUiFlag } from './ui/theme.js';
import { createNav } from './ui/nav.js';
import { tintOf } from './ui/tint.js';
import { mountCharactersView, mountInstanceContentsView, mountPersonaView } from './desktop/build/index.js';
import { openRelationshipVoiceSettings, voiceSettingsAvailable } from './voice-settings.js';
import { popMenu } from './ui/menu.js';
import { desktopLayout } from './desktop/presentation.js';

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

export function instanceLabel(item, items) {
    const same = items.filter((row) => row.name === item.name);
    if (same.length < 2) return item.name;
    return `${item.name} ${same.findIndex((row) => row.relationshipId === item.relationshipId) + 1}`;
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
    let dead = false;
    const emit = () => { if (!dead) onChange(state); };
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
            if (dead || state.busy) return;
            const ticket = ++loadGeneration;
            state.open = true;
            state.loadError = '';
            try {
                const [relationships, cards, bindings] = await Promise.all([
                    loadRelationships(), Promise.resolve(getCards()), Promise.resolve(getBindings()),
                ]);
                if (dead || ticket !== loadGeneration) return;
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
                if (dead || ticket !== loadGeneration) return;
                state.loadError = '加载失败，请重试。';
            }
            if (dead || ticket !== loadGeneration) return;
            emit();
        },
        destroy() { dead = true; loadGeneration++; },
        setName(value) { if (dead || state.busy) return; state.draftName = String(value ?? ''); emit(); },
        selectInstance(id) {
            if (dead || state.busy) return false;
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
            if (dead || state.busy) return;
            state.selectedCharacterRef = String(characterRef || '');
            emit();
        },
        cancelUnsaved() { if (dead || state.busy) return; state.unsaved = null; emit(); },
        confirmDiscard() {
            if (dead || state.busy) return;
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
            if (dead || state.busy) return false;
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
            if (dead || state.busy) return;
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
                    if (dead) return;
                    state.relationships = [...state.relationships, {
                        relationshipId: String(created?.relationshipId || ''),
                        characterRef: card.characterRef,
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
                    if (dead) return;
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
            if (dead || state.busy) return;
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
                if (dead) return;
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
    const file = document.createElement('input');
    file.type = 'file'; file.accept = '.json,.png,application/json,image/png'; file.hidden = true;
    root.append(dialog, file); document.body.append(root);
    let opener = null, view = null, dead = false;
    const page = createInstancePage({
        ...options,
        importCard: options.importCard || (spec => importNativeCharacterFile({ ...spec, getContext: options.getContext })),
        onChange() { if (!dead && dialog.open) paint(); },
    });
    function paint() {
        const props = characterViewProps(page.state, { events: { action, name: value => page.setName(value), save: () => void page.save() } });
        if (view) view.update(props); else view = mountInstanceContentsView(dialog, props);
    }
    function dismissUnsaved() {
        const pending = page.state.unsaved;
        page.cancelUnsaved();
        if (pending?.type === 'select') dialog.querySelector(`[data-action="select-instance"][data-id="${pending.id}"]`)?.focus();
        else (dialog.querySelector('[name="displayName"]') || opener)?.focus?.();
    }
    function close() {
        if (dead || page.state.busy) return;
        if (page.state.draftName !== page.state.savedName && (page.state.creating || page.state.selectedRelationshipId)) {
            page.state.unsaved = { type: 'close' }; paint(); return;
        }
        view?.unmount(); view = null;
        dialog.close(); page.state.open = false;
        opener?.focus?.();
    }
    function action(action, target) {
        if (dead || page.state.busy) return;
        if (action === 'close') close();
        if (action === 'import') file.click();
        if (action === 'create') page.startCreate();
        if (action === 'select-template') page.selectTemplate(target.dataset.ref);
        if (action === 'select-instance') page.selectInstance(target.dataset.id);
        if (action === 'keep-editing') dismissUnsaved();
        if (action === 'discard') { const pending = page.state.unsaved; page.confirmDiscard(); if (pending?.type === 'close') close(); }
        if (action === 'cancel-edit') {
            if (page.state.draftName !== page.state.savedName) close();
            else if (page.state.creating) { page.state.unsaved = { type: 'close' }; page.confirmDiscard(); }
        }
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    file.addEventListener('change', async () => {
        const chosen = file.files?.[0]; file.value = '';
        if (chosen && !dead) await page.importFile({ name: chosen.name, bytes: new Uint8Array(await chosen.arrayBuffer()) });
    });
    return {
        open(returnFocusTarget = document.activeElement) {
            if (dead) return;
            if (!dialog.open) { opener = returnFocusTarget ?? opener; dialog.showModal(); }
            return page.open();
        }, close, page,
        destroy() { if (dead) return; dead = true; page.destroy(); view?.unmount(); view = null; dialog.close(); root.remove(); },
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
    const instanceOrder = new Map(instances.map((item, index) => [item.relationshipId, index]));
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
    for (const card of cards) card.instances.sort((a, b) => instanceOrder.get(a.relationshipId) - instanceOrder.get(b.relationshipId));
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

// 数据关联、作用域与名称规则仍属于原控制器；React 仅消费此视图数据。
export function characterViewProps(state, options = {}) {
    const model = characterModel(state);
    const rows = items => items.map(item => ({ ...item, label: instanceLabel(item, items), when: formatWhen(item.lastAt) }));
    return {
        state, cards: model.cards.map(card => ({ ...card, avatar: characterAvatarSrc(card.avatar), instances: rows(card.instances) })),
        loose: rows(model.loose), instances: rows(instancesFrom(state.relationships)),
        sprite: iconSpriteUrl(), unsavedCopy: UNSAVED_INSTANCE_COPY, readTint: tintOf, ...options,
    };
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

function attachShellImport(container, root, file) {
    const shell = container.closest?.('#vc-shell');
    if (!shell?.registerCharacterImport) return () => {};
    root.classList.add('is-shell-list');
    return shell.registerCharacterImport(() => file.click());
}

export function mountCharactersTab(container, options = {}) {
    ensureInstanceStyles();
    if (!isVcUiOn()) return { async refresh() {}, destroy() {} };
    if (!container) throw new Error('mountCharactersTab requires a container');
    const doc = container.ownerDocument, root = doc.createElement('div');
    root.className = 'vc-characters vc-desktop-characters'; root.setAttribute('aria-label', '角色'); container.append(root);
    const file = doc.createElement('input');
    file.type = 'file'; file.accept = '.json,.png,application/json,image/png'; file.hidden = true; root.append(file);
    const releaseImport = attachShellImport(container, root, file);
    const views = new Map();
    const removeView = el => { views.get(el)?.unmount(); views.delete(el); };
    const nav = createNav(root, { stacked: () => !desktopLayout(), onRemove: removeView });
    const list = doc.createElement('section'); list.className = 'vc-screen vc-characters-list'; root.append(list);
    let detailEl = null, personaEl = null, detailRef = '', descriptionOpen = false;
    let dead = false, suppress = false, alertOpen = false, loading = true, query = '', personaBusy = false;
    let desktop = desktopLayout();
    const avatarByRef = new Map(), timeById = new Map();
    const page = createInstancePage({
        ...options,
        importCard: options.importCard || (spec => importNativeCharacterFile({ ...spec, getContext: options.getContext })),
        getCards() {
            const cards = options.getCards?.() || [];
            let context; try { context = options.getContext?.(); } catch { context = null; }
            return (Array.isArray(cards) ? cards : []).map(card => {
                const raw = context?.characters?.find(item => item?.data?.extensions?.vc_character_ref === card?.characterRef)
                    || context?.characters?.find(item => item?.name && item.name === card?.name);
                const avatar = characterAvatarSrc(typeof raw?.avatar === 'string' ? raw.avatar : card?.avatar || '');
                if (card?.characterRef) avatarByRef.set(card.characterRef, avatar);
                return { ...card, avatar };
            });
        },
        onChange() { if (!dead && !suppress) { loading = false; paint(); void maybeUnsaved(); } },
    });
    const dirty = () => page.state.draftName !== page.state.savedName && Boolean(page.state.creating || page.state.selectedRelationshipId);
    function findInstance(id) {
        const model = characterModel(page.state);
        for (const card of model.cards) {
            const inst = card.instances.find(item => item.relationshipId === String(id));
            if (inst) return { inst, characterRef: card.characterRef };
        }
        const inst = model.loose.find(item => item.relationshipId === String(id));
        return inst ? { inst, characterRef: '' } : null;
    }
    function notifyOpen(id) {
        const found = findInstance(id);
        if (found && !dead) options.onOpenInstance?.({ relationshipId: found.inst.relationshipId, characterRef: found.characterRef, name: found.inst.name, chatIdentity: found.inst.chatIdentity || '' });
    }
    function readTimes() {
        try {
            const ctx = options.getContext?.(), chat = ctx?.chat, id = ctx?.chatMetadata?.vc_binding?.relationshipId;
            const last = Array.isArray(chat) ? chat.at(-1) : null, stamp = last?.send_date || last?.timestamp || '';
            if (id && stamp) timeById.set(String(id), String(stamp));
        } catch { /* 当前没有可显示的会话时间。 */ }
    }
    function fill(el, screen) {
        const state = { ...page.state,
            cards: page.state.cards.map(card => ({ ...card, avatar: avatarByRef.get(card.characterRef) || card.avatar || '' })),
            relationships: page.state.relationships.map(row => ({ ...row, lastChatAt: row.lastChatAt || row.lastMessageAt || timeById.get(String(row.relationshipId)) || '' })),
        };
        const props = characterViewProps(state, {
            screen, detailRef, loading: screen === 'list' && loading, descriptionOpen: screen === 'detail' && descriptionOpen,
            desktop, query, voiceAvailable: voiceSettingsAvailable(),
            events: { action: (action, trigger) => { if (!dead && !el.inert) onAction(action, trigger); }, name: value => { if (!dead && !el.inert) page.setName(value); }, save: () => { if (!dead && !el.inert) void page.save(); } },
            search: value => { if (!dead) { query = value; fill(list, 'list'); } },
        });
        const view = views.get(el);
        if (view) view.update(props); else views.set(el, mountCharactersView(el, props));
    }
    function paint() { if (dead) return; fill(list, 'list'); if (detailEl?.isConnected) fill(detailEl, 'detail'); }
    async function maybeUnsaved() {
        if (!page.state.unsaved || alertOpen || dead) return;
        alertOpen = true;
        const pending = page.state.unsaved;
        const ok = await confirmAlert({ title: '放弃更改？', message: UNSAVED_INSTANCE_COPY, action: '放弃更改', root });
        alertOpen = false;
        if (dead || !page.state.unsaved) return;
        if (ok) { page.confirmDiscard(); if (pending?.type === 'select') notifyOpen(pending.id); }
        else page.cancelUnsaved();
    }
    function readPersona(ref) {
        let card; try { card = options.getContext?.()?.characters?.find(item => item?.data?.extensions?.vc_character_ref === ref); } catch { card = null; }
        return Object.fromEntries(['description', 'personality', 'scenario', 'first_mes', 'mes_example'].map(key => [key, typeof card?.[key] === 'string' ? card[key] : typeof card?.data?.[key] === 'string' ? card.data[key] : '']));
    }
    function openPersona(ref) {
        if (personaEl || page.state.busy || dead) return;
        const el = doc.createElement('section'); el.className = 'vc-screen vc-character-persona'; el.dataset.personaRef = ref;
        const fields = readPersona(ref);
        const back = () => { if (dead || personaBusy) return; nav.pop(); personaEl = null; list.inert = false; };
        const props = { fields, busy: false, error: '', sprite: iconSpriteUrl(), back, save: async fields => {
            if (dead || personaBusy || personaEl !== el) return;
            personaBusy = true; props.busy = true; props.error = ''; view.update(props);
            const save = options.savePersona || ((ref, next) => saveNativePersona({ getContext: options.getContext, characterRef: ref, fields: next }));
            try {
                await save(ref, fields);
                if (dead || personaEl !== el) return;
                const card = page.state.cards.find(item => item.characterRef === ref);
                if (card && typeof fields.description === 'string') card.description = fields.description;
                personaBusy = false; back(); paint();
            } catch {
                if (!dead && personaEl === el) { props.error = '没有完成，请重试。'; }
            } finally {
                personaBusy = false;
                if (!dead && personaEl === el) { props.busy = false; view.update(props); }
            }
        } };
        const view = mountPersonaView(el, props); views.set(el, view);
        nav.push(el); personaEl = el; list.inert = desktop;
    }
    async function openDetail(ref, from) {
        if (personaEl || page.state.busy || dead) return;
        if (detailEl?.isConnected && detailRef !== ref) { await goBack(); if (detailEl?.isConnected || dead) return; }
        if (detailRef !== ref) descriptionOpen = false;
        detailRef = ref;
        suppress = true; page.selectTemplate(ref); suppress = false;
        if (detailEl?.isConnected && detailEl.dataset.ref === ref) { fill(detailEl, 'detail'); fill(list, 'list'); root.classList.add('is-detail'); return; }
        const el = doc.createElement('section'); el.className = 'vc-screen vc-character-detail'; el.dataset.ref = ref; fill(el, 'detail');
        const fromAvatar = from?.querySelector?.('.vc-role-avatar img, .vc-role-avatar');
        nav.push(el, { fly: fromAvatar ? { from: fromAvatar, to: node => node.querySelector('.vc-poster-avatar img, .vc-poster-avatar') } : undefined });
        detailEl = el; root.classList.add('is-detail'); fill(list, 'list');
    }
    async function goBack() {
        if (dead || page.state.busy || personaEl || alertOpen) return;
        if (dirty()) {
            alertOpen = true;
            const ok = await confirmAlert({ title: '放弃更改？', message: UNSAVED_INSTANCE_COPY, action: '放弃更改', root });
            alertOpen = false;
            if (!ok || dead) return;
            page.state.draftName = page.state.savedName; page.state.creating = false; page.state.nameError = ''; page.state.unsaved = null;
        }
        if (nav.pop()) detailEl = null;
        descriptionOpen = false; root.classList.toggle('is-detail', Boolean(detailEl?.isConnected));
    }
    function onAction(action, target) {
        if (dead || page.state.busy) return;
        if (action === 'import') file.click();
        if (action === 'retry') void refresh();
        if (action === 'select-template') void openDetail(target.dataset.ref || '', target);
        if (action === 'back') void goBack();
        if (action === 'toggle-description') { descriptionOpen = !descriptionOpen; if (detailEl?.isConnected) fill(detailEl, 'detail'); }
        if (action === 'edit-card') openHostCharacterPanel(doc);
        if (action === 'edit-persona') openPersona(detailRef);
        if (action === 'edit-voice') {
            const instances = characterModel(page.state).cards.find(item => item.characterRef === detailRef)?.instances || [];
            if (instances.length === 1) void openRelationshipVoiceSettings(instances[0].relationshipId, { opener: target });
            else if (instances.length > 1) popMenu(target, instances.map(item => ({ label: instanceLabel(item, instances), run: () => void openRelationshipVoiceSettings(item.relationshipId, { opener: target }) })));
        }
        if (action === 'edit-name') { if (!(page.state.creating || page.state.selectedRelationshipId)) page.startCreate(); queueMicrotask(() => root.querySelector('[name="displayName"]')?.focus()); }
        if (action === 'create') page.startCreate();
        if (action === 'select-instance') { if (page.selectInstance(target.dataset.id)) notifyOpen(target.dataset.id); }
        if (action === 'cancel-edit') {
            if (dirty()) { page.state.unsaved = { type: 'close' }; void maybeUnsaved(); }
            else if (page.state.creating) { page.state.unsaved = { type: 'close' }; page.confirmDiscard(); }
        }
    }
    file.addEventListener('change', async () => {
        const chosen = file.files?.[0]; file.value = '';
        if (chosen && !dead) await page.importFile({ name: chosen.name, bytes: new Uint8Array(await chosen.arrayBuffer()) });
    });
    const resize = () => {
        const next = desktopLayout(); if (next === desktop || dead) return;
        desktop = next; nav.syncLayout(); list.inert = Boolean(personaEl && desktop); paint();
    };
    globalThis.addEventListener('resize', resize);
    async function refresh() {
        if (dead || page.state.busy || dirty() || personaEl) return;
        loading = true; suppress = true; readTimes(); paint();
        try { await page.open(); readTimes(); }
        finally { suppress = false; loading = false; if (!dead) paint(); }
    }
    function destroy() {
        if (dead) return;
        dead = true; page.destroy(); globalThis.removeEventListener('resize', resize);
        for (const el of views.keys()) removeView(el);
        detailEl = null; personaEl = null; releaseImport(); root.remove();
    }
    void refresh(); return { refresh, destroy };
}
