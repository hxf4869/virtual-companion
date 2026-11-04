import { bindingCoalesceKey, clearOnboardingBinding, coalesceBinding, companionBindingHeld, noteCompanionBound, StaleBindingError, takeOnboardingBinding } from './instance-binding.js';
import {
    F2ConflictError,
    characterChatPath,
    groupChatPath,
    validToken,
    armSilentF2Conflict,
    disarmSilentF2Conflict,
    createF2Client,
    F2_CONFLICT_COPY,
    extractUnsavedUserInput,
    mergeInput,
    setDefaultSourceConflict,
    createSourceGuard,
} from './f2-logic.js';

export {
    F2ConflictError,
    characterChatPath,
    groupChatPath,
    armSilentF2Conflict,
    disarmSilentF2Conflict,
    createF2Client,
    F2_CONFLICT_COPY,
    extractUnsavedUserInput,
    mergeInput,
    createSourceGuard,
};

let kickCompanionImpl = async () => {};

export function kickCompanionBinding() {
    return kickCompanionImpl();
}

let f2Draft = null;
let f2Opener = null;
let f2UserInput = '';
const panelActions = new WeakMap();

/** Rejected snapshot stays in this module closure. It is not written into the DOM. */
export function readF2Draft() {
    return f2Draft;
}

function stContext() {
    try {
        const getContext = globalThis.SillyTavern?.getContext;
        return typeof getContext === 'function' ? getContext() : null;
    } catch {
        return null;
    }
}

function insideNode(node, ancestor) {
    let current = node;
    while (current) {
        if (current === ancestor) return true;
        current = current.parentElement || current.parent || null;
    }
    return false;
}

function readSendBox() {
    return typeof document === 'undefined' ? null : document.querySelector('#send_textarea');
}

function focusSendBox(box) {
    if (!box || typeof box.focus !== 'function') return;
    box.focus();
    const again = () => {
        const current = readSendBox();
        if (current && current === box && typeof current.focus === 'function') current.focus();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(again);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(again);
}

function placeUserInput(text, existing, { focus = false } = {}) {
    const box = readSendBox();
    if (!box || !text) {
        if (focus) focusSendBox(box);
        return;
    }
    const current = existing != null ? String(existing) : String(box.value ?? '');
    box.value = mergeInput(current, text);
    if (focus) focusSendBox(box);
}

function ensureRecall() {
    let button = document.querySelector('#vc-f2-recall');
    if (!button) {
        button = document.createElement('button');
        button.id = 'vc-f2-recall';
        button.type = 'button';
        button.setAttribute('data-action', 'copy-input');
        button.textContent = '复制未保存输入';
        button.hidden = true;
        button.setAttribute('hidden', '');
        button.addEventListener('click', () => { void copyUserInput(); });
        document.body.append(button);
    }
    return button;
}

function showRecall(visible) {
    if (typeof document === 'undefined') return;
    const button = ensureRecall();
    button.hidden = !visible;
    if (visible) button.removeAttribute('hidden');
    else button.setAttribute('hidden', '');
}

async function copyUserInput() {
    const text = f2UserInput;
    if (!text) return;
    const clipboard = globalThis.navigator?.clipboard;
    const write = clipboard?.writeText;
    if (typeof write === 'function') {
        try {
            await write.call(clipboard, text);
            return;
        } catch {
            // Clipboard can be denied. The same text is still placed in the send box.
        }
    }
    placeUserInput(text, undefined, { focus: true });
}

function ensureF2Styles() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    const links = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('link') : [];
    if ([...links].some((node) => node.getAttribute?.('data-vc-chat-shell') != null)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-vc-chat-shell', '');
    const relative = String(import.meta.url).includes('/vc-runtime/')
        ? '../extensions/third-party/vc-model-settings/chat-shell.css'
        : './chat-shell.css';
    link.href = new URL(relative, import.meta.url).href;
    (document.head || document.documentElement).append(link);
}

function closeF2Panel(panel, { focusInput = false } = {}) {
    const actions = panelActions.get(panel);
    if (actions) {
        panel.close(); actions.keep?.();
        if (focusInput) focusSendBox(readSendBox());
        else f2Opener?.focus?.();
        return;
    }
    const existing = String(readSendBox()?.value ?? '');
    panel.close();
    showRecall(Boolean(f2UserInput));
    placeUserInput(f2UserInput, existing, { focus: focusInput });
    if (!focusInput && f2Opener && typeof f2Opener.focus === 'function') f2Opener.focus();
}

function applyLatest(panel, existing) {
    const latest = stContext()?.chat;
    const recovered = Array.isArray(latest) ? extractUnsavedUserInput(f2Draft, latest) : '';
    if (recovered) f2UserInput = recovered;
    if (panel.open) panel.close();
    showRecall(Boolean(f2UserInput));
    placeUserInput(recovered, existing, { focus: true });
}

async function viewLatest(panel) {
    const existing = String(readSendBox()?.value ?? '');
    const reload = stContext()?.reloadCurrentChat;
    if (typeof reload !== 'function') return;
    const chat = stContext()?.chat;
    const originalSplice = Array.isArray(chat) ? chat.splice : null;
    let applied = false;
    const finish = () => {
        if (applied) return;
        applied = true;
        applyLatest(panel, existing);
    };
    // getChat 用 splice 换上新消息后还会 await 渲染。输入必须在这次 splice 返回前写回，
    // 否则页面已经能读到新消息时，草稿还停在重载完成之后。
    if (typeof originalSplice === 'function') {
        chat.splice = function (...args) {
            const result = originalSplice.apply(this, args);
            if (args.length > 2) finish();
            return result;
        };
    }
    try {
        await reload();
    } catch {
        if (applied && !panel.open) panel.showModal();
        return;
    } finally {
        if (typeof originalSplice === 'function') chat.splice = originalSplice;
    }
    finish();
}

/** Keep the rejected snapshot only in the page; never log it or upload it. */
export function showF2Draft(serialized, _error, actions) {
    if (typeof document === 'undefined') return;
    f2Draft = typeof serialized === 'string' ? serialized : '';
    f2UserInput = extractUnsavedUserInput(f2Draft);
    ensureF2Styles();
    let panel = document.querySelector('#vc-f2-conflict');
    const active = document.activeElement;
    if (!panel || !insideNode(active, panel)) f2Opener = active;
    if (!panel) {
        panel = document.createElement('dialog');
        panel.id = 'vc-f2-conflict';
        panel.setAttribute('aria-labelledby', 'vc-f2-title');
        const wrap = document.createElement('div');
        wrap.className = 'vc-f2-panel';
        const heading = document.createElement('h2');
        heading.id = 'vc-f2-title';
        heading.textContent = '对话已更新';
        const note = document.createElement('p');
        note.setAttribute('role', 'alert');
        note.textContent = F2_CONFLICT_COPY;
        const actions = document.createElement('div');
        actions.className = 'vc-f2-actions';
        const latest = document.createElement('button');
        latest.type = 'button';
        latest.setAttribute('data-action', 'view-latest');
        latest.textContent = '查看最新';
        latest.addEventListener('click', () => {
            const actions = panelActions.get(panel);
            if (actions) { panel.close(); void actions.latest(); }
            else void viewLatest(panel);
        });
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.setAttribute('data-action', 'keep-draft');
        keep.textContent = '保留草稿';
        keep.addEventListener('click', () => closeF2Panel(panel, { focusInput: true }));
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.setAttribute('data-action', 'copy-input');
        copy.textContent = '复制';
        copy.addEventListener('click', () => {
            const actions = panelActions.get(panel);
            if (actions) void actions.copy();
            else void copyUserInput();
        });
        actions.append(latest, keep, copy);
        wrap.append(heading, note, actions);
        panel.append(wrap);
        panel.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeF2Panel(panel);
        });
        document.body.append(panel);
    }
    if (actions) panelActions.set(panel, actions); else panelActions.delete(panel);
    showRecall(false);
    presentConflict(panel);
    if (!panel.open) panel.showModal();
}

function nodeParent(node) {
    return node?.parentElement || node?.parent || null;
}

function prependNode(parent, node) {
    if (!parent || !node) return;
    if (typeof parent.prepend === 'function') {
        parent.prepend(node);
        return;
    }
    const first = parent.children?.[0];
    if (first && Array.isArray(parent.children)) {
        node.parent = parent;
        parent.children.unshift(node);
        return;
    }
    parent.append(node);
}

function replaceNode(target, node) {
    const parent = nodeParent(target);
    if (!parent) return;
    if (typeof target.replaceWith === 'function') {
        target.replaceWith(node);
        return;
    }
    const index = parent.children.indexOf(target);
    node.parent = parent;
    if (index >= 0) parent.children.splice(index, 1, node);
    else parent.children.push(node);
    target.parent = null;
}

function moveNode(parent, node) {
    const old = nodeParent(node);
    if (old && old !== parent && Array.isArray(old.children)) {
        const index = old.children.indexOf(node);
        if (index >= 0) old.children.splice(index, 1);
    }
    parent.append(node);
}

/** vc-ui 下把既有三个动作收成 sheet：上「我的草稿」，下「最新版本」。不写入草稿正文。 */
function presentConflict(panel) {
    if (!document.body?.classList?.contains('vc-ui') || !panel || panel.querySelector('[data-vc-draft]')) return;
    panel.classList.add('vc-sheet');
    const wrap = panel.querySelector('.vc-f2-panel') || panel;
    if (!wrap.querySelector('.vc-sheet-grab')) {
        const grab = document.createElement('div');
        grab.className = 'vc-sheet-grab';
        prependNode(wrap, grab);
    }
    const heading = panel.querySelector('#vc-f2-title');
    if (heading && !heading.parentElement?.classList?.contains('vc-sheet-head') && !heading.parent?.classList?.contains('vc-sheet-head')) {
        const head = document.createElement('div');
        head.className = 'vc-sheet-head';
        const parent = nodeParent(heading);
        if (parent) {
            if (typeof heading.replaceWith === 'function') heading.replaceWith(head);
            else replaceNode(heading, head);
            head.append(heading);
        }
    }
    const actions = panel.querySelector('.vc-f2-actions');
    const latest = panel.querySelector('[data-action="view-latest"]');
    const keep = panel.querySelector('[data-action="keep-draft"]');
    const copy = panel.querySelector('[data-action="copy-input"]');
    if (!actions || !latest || !keep || !copy) return;
    const stack = document.createElement('div');
    stack.className = 'vc-f2-stack';
    const draft = document.createElement('section');
    draft.setAttribute('data-vc-draft', '');
    const draftTitle = document.createElement('h3');
    draftTitle.textContent = '我的草稿';
    draft.append(draftTitle);
    moveNode(draft, keep);
    moveNode(draft, copy);
    const fresh = document.createElement('section');
    fresh.setAttribute('data-vc-latest', '');
    const freshTitle = document.createElement('h3');
    freshTitle.textContent = '最新版本';
    fresh.append(freshTitle);
    moveNode(fresh, latest);
    stack.append(draft, fresh);
    replaceNode(actions, stack);
}

export const vcF2 = createF2Client({ onConflict: showF2Draft });

/** Explicit native operations capture their baseline before the first await.
 * A background chat may be read once; an already observed chat never silently
 * borrows the latest server revision. */
export function createNativeF2IO({ getRequestHeaders, fetchImpl = fetch, client = vcF2 }) {
    const parse = async (response, payload) => {
        let data;
        try { data = await response.json(); } catch { data = null; }
        if (!response.ok) {
            const error = new F2ConflictError(data?.code || 'VC_WRITE_FAILED');
            showF2Draft(JSON.stringify(payload), error); throw error;
        }
        return data;
    };
    async function baseline({ avatar, file, isGroup = false }) {
        const path = isGroup ? groupChatPath(file) : characterChatPath(avatar, file);
        if (client.known(path)) return client.expected(path);
        const body = isGroup ? { id: String(file).replace(/\.jsonl$/, '') }
            : { avatar_url: avatar, file_name: String(file).replace(/\.jsonl$/, '') };
        const data = await parse(await fetchImpl(isGroup ? '/api/chats/group/get' : '/api/chats/get', {
            method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(body),
        }), body);
        const token = data?.[0]?.chat_metadata?.vc_f2;
        if (!validToken(token)) throw new F2ConflictError('VC_REVISION_REQUIRED');
        client.remember(path, token);
        return structuredClone(token);
    }
    async function baselines(targets) {
        return Promise.all(targets.map(async (target) => ({
            path: target.isGroup ? groupChatPath(target.file) : characterChatPath(target.avatar, target.file),
            expected: await baseline(target),
        })));
    }
    return { baseline, baselines, parse };
}

setDefaultSourceConflict((serialized, error) => showF2Draft(serialized, error));

/** The extension calls this once; native CHAT_CHANGED is the only subscription.
 * Binding failures never write metadata, and groups only participate in F2. */
export async function installInstanceBinding({ getContext, resolveBinding, writeExtensionField, captureSessionContext, reconcileSources, onSourceStatus = () => {} }) {
    await captureSessionContext();
    const cardWrites = new WeakMap();
    const source = () => {
        const c = getContext();
        const card = c.characters?.[c.characterId];
        if (c.groupId || !card || !c.chatMetadata?.vc_f2) return null;
        return { chatIdentity: c.chatMetadata.vc_f2.id, characterRef: card.data?.extensions?.vc_character_ref,
            mode: c.chatMetadata.vc_binding?.mode || 'COMPANION' };
    };
    function liveBinding() {
        const c = getContext();
        const card = c.characters?.[c.characterId];
        return {
            metadata: c.chatMetadata,
            card,
            chatId: c.chatId,
            groupId: c.groupId || null,
            characterId: c.characterId,
            identity: c.chatMetadata?.vc_f2?.id,
            mode: c.chatMetadata?.vc_binding?.mode || 'COMPANION',
        };
    }
    function sameBinding(left, right) {
        return Boolean(left && right)
            && left.metadata === right.metadata
            && left.card === right.card
            && left.chatId === right.chatId
            && left.groupId === right.groupId
            && String(left.characterId) === String(right.characterId)
            && left.identity === right.identity
            && left.mode === right.mode;
    }
    function applyOnboardingBinding() {
        const c = getContext();
        const card = c.characters?.[c.characterId];
        const pending = takeOnboardingBinding(card?.data?.extensions?.vc_character_ref || '');
        const metadata = c.chatMetadata;
        if (!pending || !metadata?.vc_f2?.id) return;
        if (metadata.vc_binding?.relationshipId && String(metadata.vc_binding.relationshipId) !== String(pending.binding.relationshipId)) return;
        metadata.vc_binding = {
            ...pending.binding,
            chatIdentity: metadata.vc_f2.id,
            mode: pending.binding.mode || metadata.vc_binding?.mode || 'COMPANION',
        };
        clearOnboardingBinding();
    }
    async function ensureBound() {
        if (companionBindingHeld()) return;
        applyOnboardingBinding();
        const c = getContext();
        const card = c.characters?.[c.characterId];
        if (c.groupId || !card || !c.chatMetadata?.vc_f2) return;
        const key = bindingCoalesceKey({
            chatIdentity: c.chatMetadata.vc_f2.id,
            characterRef: card.data?.extensions?.vc_character_ref || `pending:${c.characterId}`,
            mode: c.chatMetadata.vc_binding?.mode || 'COMPANION',
            relationshipId: c.chatMetadata.vc_binding?.relationshipId || null,
        });
        return coalesceBinding(key, () => ensureBoundOnce());
    }
    async function ensureBoundOnce() {
        const started = liveBinding();
        if (started.groupId || !started.card || !started.metadata?.vc_f2) return;
        const metadata = started.metadata;
        const card = started.card;
        let write = cardWrites.get(card);
        if (!write && !card.data?.extensions?.vc_character_ref) {
            const ref = crypto.randomUUID();
            write = Promise.resolve().then(() => writeExtensionField(started.characterId, 'vc_character_ref', ref));
            cardWrites.set(card, write);
        }
        if (write) await write;
        if (!sameBinding(started, liveBinding())) throw new StaleBindingError();
        const current = source();
        if (!current?.characterRef) throw new F2ConflictError('VC_CHARACTER_REF_UNCONFIRMED');
        if (current.chatIdentity !== started.identity || current.mode !== started.mode) throw new StaleBindingError();
        const existing = metadata.vc_binding;
        const displayName = Array.from(card.name || '').slice(0, 32).join('');
        const snapshot = { ...current, relationshipId: existing?.relationshipId || null, displayName };
        const result = await resolveBinding(snapshot);
        const live = liveBinding();
        if (!sameBinding(started, live)) throw new StaleBindingError();
        if (result?.chatIdentity && result.chatIdentity !== live.identity) throw new StaleBindingError();
        if (result?.mode && result.mode !== live.mode) throw new StaleBindingError();
        if (JSON.stringify(existing) !== JSON.stringify(result)) {
            metadata.vc_binding = result;
            await getContext().saveChat();
        }
        noteCompanionBound(globalThis.document);
        return result;
    }
    const reconcileCurrent = async () => {
        const current = source();
        if (!current || !reconcileSources) return;
        try {
            const states = await reconcileSources([current.chatIdentity]);
            if (source()?.chatIdentity === current.chatIdentity) onSourceStatus(states);
            return states;
        } catch (error) {
            if (source()?.chatIdentity === current.chatIdentity) onSourceStatus([{ chatIdentity: current.chatIdentity, state: 'UNAVAILABLE' }]);
            throw error;
        }
    };
    vcF2.setSourceObserver(async (token) => {
        if (!reconcileSources) return;
        const states = await reconcileSources([token.id]);
        if (source()?.chatIdentity === token.id) onSourceStatus(states);
    });
    const attemptBind = async () => {
        try {
            return await ensureBound();
        } catch (error) {
            if (error instanceof StaleBindingError) return null;
            showF2Draft(JSON.stringify({ chat_metadata: getContext().chatMetadata, chat: getContext().chat }), error);
            throw error;
        }
    };
    const changed = async () => {
        await attemptBind();
        const meta = getContext().chatMetadata;
        if (meta?.vc_f2?.id && !meta.vc_binding?.conversationId) await attemptBind();
        await reconcileCurrent().catch(() => {});
    };
    kickCompanionImpl = changed;
    const c = getContext(); c.eventSource.on(c.eventTypes.CHAT_CHANGED, changed);
    globalThis.addEventListener?.('online', () => { void changed().catch(() => {}); });
    await changed();
    return { ensureBound, reconcileCurrent };
}
