// UI-P02：角色卡模板来自宿主卡，陪伴实例来自已有 relationships 与 POST /api/v1/st/bindings。
import {
    instancesFrom,
    safeImageUrl,
    IMPORT_FAILED_COPY,
    UNSAVED_INSTANCE_COPY,
    sanitizeInstanceName,
    cardsFromContext,
    bindingsFromContext,
    pngHasChara,
    inspectCharacterFile,
    instanceLabel,
    prefsBody,
    saveInstanceName,
    createCompanionInstance,
    createInstancePage,
    characterModel,
    formatWhen,
    characterAvatarSrc,
} from './instance-logic.js';
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

export {
    instancesFrom,
    safeImageUrl,
    IMPORT_FAILED_COPY,
    UNSAVED_INSTANCE_COPY,
    sanitizeInstanceName,
    cardsFromContext,
    bindingsFromContext,
    pngHasChara,
    inspectCharacterFile,
    instanceLabel,
    prefsBody,
    saveInstanceName,
    createCompanionInstance,
    createInstancePage,
    characterModel,
    formatWhen,
    characterAvatarSrc,
};

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
        async getCards() {
            const cards = await options.getCards?.() || [];
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
        if (action === 'edit-card') {
            if (options.onEditCard) options.onEditCard(detailRef);
            else openHostCharacterPanel(doc);
        }
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
