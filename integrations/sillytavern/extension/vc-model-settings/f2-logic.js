export class F2ConflictError extends Error {
    constructor(code = 'VC_REVISION_CONFLICT') {
        super('聊天保存未完成；本页草稿已保留，请复制后重新加载最新版本。');
        this.name = 'F2ConflictError';
        this.code = code;
    }
}

export const characterChatPath = (avatar, file) => `chats/${String(avatar).replace(/\.png$/, '')}/${String(file).replace(/\.jsonl$/, '')}.jsonl`;
export const groupChatPath = (file) => `group chats/${String(file).replace(/\.jsonl$/, '')}.jsonl`;

export function validToken(token) {
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

// Canonical receipts change protected identity only. Text, MVU variables and
// wrapper edits made while the request was in flight stay on the live objects.
function applyCanonicalIdentities(live, sent, canonical) {
    if (!Array.isArray(canonical) || canonical.length !== sent.length) throw new F2ConflictError('VC_SAVE_UNCONFIRMED');
    const copy = (target, remote, keys) => {
        for (const key of keys) {
            if (Object.hasOwn(remote, key)) target[key] = structuredClone(remote[key]);
            else delete target[key];
        }
    };
    const metadata = live[0]?.chat_metadata;
    if (!metadata || !canonical[0]?.chat_metadata) throw new F2ConflictError('VC_SAVE_UNCONFIRMED');
    for (let i = 1; i < sent.length; i++) {
        if (live[i]?.vc_message_id !== sent[i].vc_message_id) throw new F2ConflictError('VC_STALE_SOURCE');
        if ((live[i].swipes?.length || 0) !== (sent[i].swipes?.length || 0)) throw new F2ConflictError('VC_STALE_SOURCE');
    }
    copy(metadata, canonical[0].chat_metadata, ['vc_f2', 'vc_binding', 'vc_branch_root', 'vc_f2_parent']);
    for (let i = 1; i < sent.length; i++) {
        const target = live[i], remote = canonical[i];
        copy(target, remote, ['vc_message_id']);
        const sources = Array.isArray(remote.swipes) && remote.swipes.length
            ? remote.swipes.map((_, index) => index === (remote.swipe_id ?? 0) ? remote.extra?.vc_source : remote.swipe_info?.[index]?.extra?.vc_source)
            : [remote.extra?.vc_source];
        if (!target.extra) target.extra = {};
        if (sources[target.swipe_id ?? 0] !== undefined) target.extra.vc_source = structuredClone(sources[target.swipe_id ?? 0]);
        else delete target.extra.vc_source;
        if (Array.isArray(target.swipes)) for (let j = 0; j < target.swipes.length; j++) {
            target.swipe_info ||= [];
            target.swipe_info[j] ||= {};
            target.swipe_info[j].extra ||= {};
            if (sources[j] !== undefined) target.swipe_info[j].extra.vc_source = structuredClone(sources[j]);
            else delete target.swipe_info[j].extra.vc_source;
        }
    }
}

export function createF2Client({ uuid = () => crypto.randomUUID(), onConflict = () => {},
    getAuthorityEpoch = () => globalThis.document?.querySelector?.('meta[name="vc-chat-authority-epoch"]')?.content } = {}) {
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
        frozen.vc_request_id ||= uuid();
        const authorityEpoch = getAuthorityEpoch();
        if (authorityEpoch !== undefined && authorityEpoch !== '') frozen.vc_authority_epoch ??= authorityEpoch;
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
        const canonicalVersion = source.canonicalVersion || 0;
        const sequence = ++source.sequence;
        const generation = source.epoch;
        const causal = live && active === source && source.token.id === original.id;
        const pending = source.tail.then(async () => {
            if (source.blocked || (source.canonicalVersion || 0) !== canonicalVersion || sources.get(path) !== source || source.epoch !== generation
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
            if (!response.ok) throw new F2ConflictError(result?.code || result?.error?.code || 'VC_SAVE_FAILED');
            if (!validToken(result?.vc_f2) || result.vc_f2.id !== token.id
                || result.vc_f2.revision !== token.revision + 1) {
                throw new F2ConflictError('VC_SAVE_UNCONFIRMED');
            }
            if (result.chat) {
                if (!live || (active === source && sources.get(path) === source)) applyCanonicalIdentities(payload.chat, frozen.chat, result.chat);
                source.canonicalVersion = canonicalVersion + 1;
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

export function mergeInput(current, text) {
    if (!text) return current;
    if (!current) return text;
    if (current === text || current.endsWith(`\n${text}`)) return current;
    return `${current}\n${text}`;
}

let defaultSourceConflict = () => {};

export function setDefaultSourceConflict(handler) {
    defaultSourceConflict = typeof handler === 'function' ? handler : () => {};
}

/** Used by the actual Helper and MVU callbacks, before reading and after every
 * awaited updater. Revision, metadata object, target message and swipe all
 * belong to the captured source; none may be relabelled with a newer source. */
export function createSourceGuard(getContext, { onSettled = () => {}, onConflict = (serialized, error) => defaultSourceConflict(serialized, error) } = {}) {
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
            onConflict(JSON.stringify({ source: JSON.parse(snapshot.draft), ...(result ? { result } : {}) }), error, snapshot);
            throw error;
        }
    }
    return { capture, assert, begin, isSettled };
}

export function createNativeF2IO({ getRequestHeaders, fetchImpl = fetch, client, onConflict = defaultSourceConflict }) {
    const parse = async (response, payload) => {
        let data;
        try { data = await response.json(); } catch { data = null; }
        if (!response.ok) {
            const error = new F2ConflictError(data?.code || 'VC_WRITE_FAILED');
            onConflict(JSON.stringify(payload), error); throw error;
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