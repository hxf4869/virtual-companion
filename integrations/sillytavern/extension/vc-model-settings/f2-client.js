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
export function createF2Client({ uuid = () => crypto.randomUUID(), onConflict = () => {} } = {}) {
    const sources = new Map();
    const observed = new Map();
    let active = null;
    let epoch = 0;

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
    function save(path, payload, { live = false, send, apply = () => {} } = {}) {
        // This clone and serialization run synchronously, before compression,
        // queue waits or network IO can observe a different chat/swipe.
        const frozen = structuredClone(payload);
        const original = frozen.chat?.[0]?.chat_metadata?.vc_f2;
        const serialized = JSON.stringify(frozen);
        if (!validToken(original)) {
            const error = new F2ConflictError('VC_REVISION_REQUIRED');
            onConflict(serialized, error);
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
            return result;
        }).catch((error) => {
            source.blocked = true;
            const failure = error instanceof F2ConflictError ? error : new F2ConflictError('VC_SAVE_UNCONFIRMED');
            onConflict(serialized, failure);
            throw failure;
        });
        source.tail = pending.catch(() => {}); // queue bookkeeping; caller still receives the rejection
        return pending;
    }
    return { loaded, leave, expected, remember, ensureMetadata, branchMetadata, save,
        known: (path) => observed.has(path),
    };
}

/** Keep the rejected snapshot only in the page; never log it or upload it. */
export function showF2Draft(serialized, error) {
    if (typeof document === 'undefined') return;
    let panel = document.querySelector('#vc-f2-conflict');
    if (!panel) {
        panel = document.createElement('dialog'); panel.id = 'vc-f2-conflict';
        panel.style.cssText = 'width:min(720px,94vw);max-height:85dvh;overflow:auto;color:var(--SmartThemeBodyColor,#eff3fa);background:var(--SmartThemeBlurTintColor,#1c222c);border:1px solid var(--SmartThemeBorderColor,#394453);border-radius:12px;padding:20px';
        const heading = document.createElement('h2'); heading.textContent = '聊天未保存';
        const note = document.createElement('p'); note.dataset.f2Note = 'true'; note.setAttribute('role', 'alert');
        const draft = document.createElement('textarea'); draft.readOnly = true; draft.setAttribute('aria-label', '保留的聊天草稿');
        draft.style.cssText = 'width:100%;min-height:220px;font-size:16px';
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制草稿';
        copy.addEventListener('click', async () => { await navigator.clipboard.writeText(draft.value); copy.textContent = '已复制'; });
        const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = '重新加载最新版本';
        reload.addEventListener('click', () => location.reload());
        const close = document.createElement('button'); close.type = 'button'; close.textContent = '继续查看本页'; close.addEventListener('click', () => panel.close());
        for (const button of [copy, reload, close]) button.style.cssText = 'min-height:44px;margin:8px 8px 0 0';
        panel.append(heading, note, draft, copy, reload, close); document.body.append(panel);
    }
    panel.querySelector('[data-f2-note]').textContent = error.message;
    panel.querySelector('textarea').value = serialized;
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
export function createSourceGuard(getContext) {
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
    return { capture, assert };
}

/** The extension calls this once; native CHAT_CHANGED is the only subscription.
 * Binding failures never write metadata, and groups only participate in F2. */
export async function installInstanceBinding({ getContext, resolveBinding, writeExtensionField, captureSessionContext }) {
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
        if (existing?.chatIdentity === current.chatIdentity && existing.characterRef === current.characterRef
            && existing.mode === current.mode && typeof existing.relationshipId === 'string' && typeof existing.conversationId === 'string') return existing;
        const result = await binding.ensure({ ...current, relationshipId: existing?.relationshipId || null,
            displayName: Array.from(card.name || '').slice(0, 32).join('') });
        if (getContext().chatMetadata !== metadata) throw new StaleBindingError();
        metadata.vc_binding = result;
        await getContext().saveChat();
        return result;
    }
    const changed = () => ensureBound().catch((error) => {
        if (error instanceof StaleBindingError) return;
        showF2Draft(JSON.stringify({ chat_metadata: getContext().chatMetadata, chat: getContext().chat }), error);
        throw error;
    });
    const c = getContext(); c.eventSource.on(c.eventTypes.CHAT_CHANGED, changed);
    await changed();
    return { ensureBound };
}
