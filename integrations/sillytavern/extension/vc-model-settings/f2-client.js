import { createInstanceBinding, StaleBindingError } from './instance-binding.js';

export class F2ConflictError extends Error {
    constructor(code = 'VC_REVISION_CONFLICT') {
        super('聊天保存未完成；本页草稿已保留，请复制后重新加载最新版本。');
        this.name = 'F2ConflictError';
        this.code = code;
    }
}

export const characterChatPath = (avatar, file) => `chats/${String(avatar).replace(/\.png$/, '')}/${String(file).replace(/\.jsonl$/, '')}.jsonl`;
export const groupChatPath = (file) => `group chats/${String(file).replace(/\.jsonl$/, '')}.jsonl`;

function validToken(token) {
    return typeof token?.id === 'string' && token.id.length > 0
        && Number.isSafeInteger(token.revision) && token.revision >= 0;
}

/** Queue only snapshots captured from one live load. Detached snapshots keep
 * their original token: they cannot borrow a later ACK to overwrite history. */
let silentArmed = false;

/** 下一次 save 同步消费。投影补写用来避免原生保存路径弹出冲突框。 */
export function armSilentF2Conflict() { silentArmed = true; }
export function disarmSilentF2Conflict() { silentArmed = false; }

function consumeSilent(options) {
    const armed = silentArmed;
    silentArmed = false;
    return options?.conflict === 'silent' || armed;
}

export function createF2Client({ uuid = () => crypto.randomUUID(), onConflict = () => {} } = {}) {
    const sources = new Map();
    const observed = new Map();
    let active = null;
    let epoch = 0;
    let prepareSource;
    let observeSource;

    const ensureMetadata = (metadata) => {
        if (!metadata.vc_f2) metadata.vc_f2 = { id: uuid(), revision: 0 };
        if (!validToken(metadata.vc_f2)) throw new F2ConflictError('VC_REVISION_REQUIRED');
        return structuredClone(metadata.vc_f2);
    };
    const remember = (path, token) => {
        if (validToken(token)) observed.set(path, structuredClone(token));
    };
    function loaded(path, metadata) {
        const token = ensureMetadata(metadata);
        const source = { path, token, epoch: ++epoch, initialRevision: token.revision,
            sequence: 0, committedSequence: 0, tail: Promise.resolve(), blocked: false };
        sources.set(path, source);
        active = source;
        remember(path, token);
        return token;
    }
    function leave() { active = null; epoch++; }
    function expected(path) {
        const token = active?.path === path ? active.token : observed.get(path);
        if (!validToken(token)) throw new F2ConflictError('VC_REVISION_REQUIRED');
        return structuredClone(token);
    }
    function branchMetadata(metadata) {
        const parent = ensureMetadata(metadata);
        return { vc_f2: { id: uuid(), revision: 0 }, vc_f2_parent: parent,
            ...(metadata.vc_binding?.relationshipId ? { vc_binding: {
                relationshipId: metadata.vc_binding.relationshipId,
                mode: metadata.vc_binding.mode || 'COMPANION',
            } } : {}) };
    }
    function save(path, payload, options = {}) {
        const silent = consumeSilent(options);
        const { live = false, send, apply = () => {} } = options;
        // This clone and serialization run synchronously, before compression,
        // queue waits or network IO can observe a different chat/swipe.
        if (prepareSource) prepareSource(payload.chat);
        const frozen = structuredClone(payload);
        const original = frozen.chat?.[0]?.chat_metadata?.vc_f2;
        const serialized = JSON.stringify(frozen);
        if (!validToken(original)) {
            const error = new F2ConflictError('VC_REVISION_REQUIRED');
            if (!silent) onConflict(serialized, error);
            return Promise.reject(error);
        }
        let source = sources.get(path);
        if (!source) {
            source = { path, token: structuredClone(original), epoch: ++epoch,
                initialRevision: original.revision, sequence: 0, committedSequence: 0,
                tail: Promise.resolve(), blocked: false };
            sources.set(path, source);
        }
        const sequence = ++source.sequence;
        const generation = source.epoch;
        const causal = live && active === source && source.token.id === original.id;
        const pending = source.tail.then(async () => {
            if (source.blocked || sources.get(path) !== source || source.epoch !== generation
                || (live && active !== source)) throw new F2ConflictError('VC_STALE_SOURCE');
            let token = original;
            if (source.token.revision !== original.revision || source.token.id !== original.id) {
                if (!causal || source.token.id !== original.id || sequence <= source.committedSequence
                    || original.revision < source.initialRevision || original.revision > source.token.revision) {
                    throw new F2ConflictError('VC_STALE_SOURCE');
                }
                // Only our earlier queue item ACK establishes this causal step.
                if (source.committedSequence === 0) throw new F2ConflictError('VC_STALE_SOURCE');
                token = source.token;
            }
            const body = JSON.parse(serialized);
            body.chat[0].chat_metadata.vc_f2 = structuredClone(token);
            const response = await send(JSON.stringify(body));
            const result = await response.json();
            if (!response.ok) throw new F2ConflictError(result?.code || 'VC_SAVE_FAILED');
            if (!validToken(result?.vc_f2) || result.vc_f2.id !== token.id
                || result.vc_f2.revision !== token.revision + 1) {
                throw new F2ConflictError('VC_SAVE_UNCONFIRMED');
            }
            source.token = structuredClone(result.vc_f2);
            source.committedSequence = sequence;
            remember(path, source.token);
            if (active === source && sources.get(path) === source) apply(structuredClone(source.token));
            // Observation accelerates reconciliation, but cannot turn a persisted
            // chat into a failed save. Retrieval and job completion also read back.
            if (observeSource && body.chat[0].chat_metadata.vc_binding) {
                void Promise.resolve().then(() => observeSource(structuredClone(source.token))).catch(() => {});
            }
            return result;
        }).catch((error) => {
            source.blocked = true;
            const failure = error instanceof F2ConflictError ? error : new F2ConflictError('VC_SAVE_UNCONFIRMED');
            if (!silent) onConflict(serialized, failure);
            throw failure;
        });
        source.tail = pending.catch(() => {}); // queue bookkeeping; caller still receives the rejection
        return pending;
    }
    return { loaded, leave, expected, remember, ensureMetadata, branchMetadata, save,
        known: (path) => observed.has(path),
        setSourcePreparer: (prepare) => { prepareSource = prepare; },
        setSourceObserver: (observe) => { observeSource = observe; },
    };
}

export const F2_CONFLICT_COPY = '这段对话已在另一处更新。你的输入已保留，请加载最新内容后继续。';

let f2Draft = null;
let f2Opener = null;
let f2UserInput = '';

/** Rejected snapshot stays in this module closure. It is not written into the DOM. */
export function readF2Draft() {
    return f2Draft;
}

const MESSAGE_KEYS = ['chat', 'messages', 'message', 'source'];

function collectMessages(value, out = [], seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return out;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) collectMessages(item, out, seen);
        return out;
    }
    if (typeof value.mes === 'string') out.push(value);
    for (const key of MESSAGE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(value, key)) collectMessages(value[key], out, seen);
    }
    return out;
}

function isUserMessage(message) {
    return message?.is_user === true || message?.role === 'user';
}

function usableMessages(value) {
    return collectMessages(value).filter((message) => message.is_system !== true && message.mes.length > 0);
}

/** Texts present in the rejected snapshot. With a latest chat, only those the latest does not already have. */
export function extractUnsavedUserInput(serialized, latest) {
    let data = serialized;
    if (typeof serialized === 'string') {
        if (!serialized) return '';
        try { data = JSON.parse(serialized); } catch { return ''; }
    }
    const local = usableMessages(data);
    if (latest === undefined || latest === null) {
        const user = local.filter(isUserMessage);
        return (user.length ? user : local).map((message) => message.mes).join('\n');
    }
    const counts = new Map();
    for (const message of usableMessages(latest)) counts.set(message.mes, (counts.get(message.mes) || 0) + 1);
    const missing = [];
    for (const message of local) {
        const left = counts.get(message.mes) || 0;
        if (left > 0) counts.set(message.mes, left - 1);
        else missing.push(message.mes);
    }
    return missing.join('\n');
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

function mergeInput(current, text) {
    if (!text) return current;
    if (!current) return text;
    if (current === text || current.endsWith(`\n${text}`)) return current;
    return `${current}\n${text}`;
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
    const existing = String(readSendBox()?.value ?? '');
    panel.close();
    showRecall(Boolean(f2UserInput));
    placeUserInput(f2UserInput, existing, { focus: focusInput });
    if (!focusInput && f2Opener && typeof f2Opener.focus === 'function') f2Opener.focus();
}

async function viewLatest(panel) {
    const existing = String(readSendBox()?.value ?? '');
    const reload = stContext()?.reloadCurrentChat;
    if (typeof reload !== 'function') return;
    try {
        await reload();
    } catch {
        return;
    }
    const latest = stContext()?.chat;
    const recovered = Array.isArray(latest) ? extractUnsavedUserInput(f2Draft, latest) : '';
    if (recovered) f2UserInput = recovered;
    panel.close();
    showRecall(Boolean(f2UserInput));
    placeUserInput(recovered, existing, { focus: true });
}

/** Keep the rejected snapshot only in the page; never log it or upload it. */
export function showF2Draft(serialized) {
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
        latest.addEventListener('click', () => { void viewLatest(panel); });
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.setAttribute('data-action', 'keep-draft');
        keep.textContent = '保留草稿';
        keep.addEventListener('click', () => closeF2Panel(panel, { focusInput: true }));
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.setAttribute('data-action', 'copy-input');
        copy.textContent = '复制';
        copy.addEventListener('click', () => { void copyUserInput(); });
        actions.append(latest, keep, copy);
        wrap.append(heading, note, actions);
        panel.append(wrap);
        panel.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeF2Panel(panel);
        });
        document.body.append(panel);
    }
    showRecall(false);
    if (!panel.open) panel.showModal();
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

/** Used by the actual Helper and MVU callbacks, before reading and after every
 * awaited updater. Revision, metadata object, target message and swipe all
 * belong to the captured source; none may be relabelled with a newer source. */
export function createSourceGuard(getContext, { onSettled = () => {} } = {}) {
    const pending = new Set();
    const failed = new WeakSet();
    function begin(messageId) {
        const snapshot = capture(messageId), entry = { metadata: snapshot.metadata, message: snapshot.message };
        pending.add(entry);
        let finished = false;
        return (success = true) => {
            if (finished) return;
            finished = true;
            pending.delete(entry);
            if (entry.message) { if (success) failed.delete(entry.message); else failed.add(entry.message); }
            const c = getContext();
            if (success && entry.metadata === c.chatMetadata && c.chat.includes(entry.message) && isSettled()) onSettled();
        };
    }
    function isSettled() {
        const c = getContext();
        return !c.chat.some((m) => failed.has(m))
            && ![...pending].some((p) => p.metadata === c.chatMetadata && c.chat.includes(p.message));
    }
    function capture(messageId) {
        const c = getContext();
        const index = messageId === undefined || messageId === 'latest'
            ? c.chat.findLastIndex((m) => !m.is_system)
            : messageId < 0 ? c.chat.length + messageId : messageId;
        const message = c.chat[index];
        return { metadata: c.chatMetadata, token: structuredClone(c.chatMetadata?.vc_f2),
            chatId: c.chatId, groupId: c.groupId, characterId: c.characterId,
            index, message, swipeId: message?.swipe_id ?? 0, length: c.chat.length,
            text: message?.mes, variables: JSON.stringify(message?.variables),
            chatVariables: JSON.stringify(c.chatMetadata?.variables),
            draft: JSON.stringify({ chat_metadata: c.chatMetadata, message }),
        };
    }
    function assert(snapshot, result) {
        const c = getContext(), token = c.chatMetadata?.vc_f2;
        if (c.chatMetadata !== snapshot.metadata || c.chatId !== snapshot.chatId || c.groupId !== snapshot.groupId
            || c.characterId !== snapshot.characterId || token?.id !== snapshot.token?.id || token?.revision !== snapshot.token?.revision
            || c.chat[snapshot.index] !== snapshot.message || (c.chat[snapshot.index]?.swipe_id ?? 0) !== snapshot.swipeId
            || c.chat.length !== snapshot.length || c.chat[snapshot.index]?.mes !== snapshot.text
            || JSON.stringify(c.chat[snapshot.index]?.variables) !== snapshot.variables
            || JSON.stringify(c.chatMetadata?.variables) !== snapshot.chatVariables) {
            const error = new F2ConflictError('VC_STALE_SOURCE');
            showF2Draft(JSON.stringify({ source: JSON.parse(snapshot.draft), ...(result ? { result } : {}) }), error);
            throw error;
        }
    }
    return { capture, assert, begin, isSettled };
}

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
    const binding = createInstanceBinding({ resolveBinding, getSource: source });
    async function ensureBound() {
        const c = getContext();
        const card = c.characters?.[c.characterId];
        if (c.groupId || !card || !c.chatMetadata?.vc_f2) return;
        const metadata = c.chatMetadata;
        let write = cardWrites.get(card);
        if (!write && !card.data?.extensions?.vc_character_ref) {
            const ref = crypto.randomUUID();
            write = Promise.resolve().then(() => writeExtensionField(c.characterId, 'vc_character_ref', ref));
            cardWrites.set(card, write);
        }
        if (write) await write;
        if (getContext().chatMetadata !== metadata || getContext().characters?.[getContext().characterId] !== card) throw new StaleBindingError();
        const current = source();
        if (!current?.characterRef) throw new F2ConflictError('VC_CHARACTER_REF_UNCONFIRMED');
        const existing = metadata.vc_binding;
        const displayName = Array.from(card.name || '').slice(0, 32).join('');
        const result = await binding.ensure({ ...current, relationshipId: existing?.relationshipId || null, displayName });
        if (getContext().chatMetadata !== metadata) throw new StaleBindingError();
        if (JSON.stringify(existing) !== JSON.stringify(result)) {
            metadata.vc_binding = result;
            await getContext().saveChat();
        }
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
    const changed = () => ensureBound().catch((error) => {
        if (error instanceof StaleBindingError) return;
        showF2Draft(JSON.stringify({ chat_metadata: getContext().chatMetadata, chat: getContext().chat }), error);
        throw error;
    }).then(() => reconcileCurrent().catch(() => {}));
    const c = getContext(); c.eventSource.on(c.eventTypes.CHAT_CHANGED, changed);
    globalThis.addEventListener?.('online', () => { void changed().catch(() => {}); });
    await changed();
    return { ensureBound, reconcileCurrent };
}
