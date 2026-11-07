import { documentEqual, documentValue } from '../../settings-documents.js';

const PROTECTED = new Set(['vc_f2', 'vc_binding', 'vc_branch_root', 'vc_source', 'vc_message_id']);
const TIMES = ['send_date', 'gen_started', 'gen_finished'];
const MIRRORED = ['extra', ...TIMES];
const CANDIDATE_FIELDS = new Set(['mes', ...MIRRORED, 'variables', 'swipes', 'swipe_id', 'swipe_info']);
const SWIPE_FIELDS = new Set(['swipes', 'swipe_id', 'swipe_info']);
const BAD_PATH_KEYS = new Set(['', '__proto__', 'prototype', 'constructor']);
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const MAX_COUNT = 100;
const MAX_BYTES = 8 * 1024 * 1024;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stateTree = key => key === 'variables' || key === 'stat_data' || key === 'display_data' || key.startsWith('vc_story');
const keysOf = (before, after) => new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
const sourceId = data => data?.extra?.vc_source?.id;

function fail(code = 'CHAT_INVALID_OPERATION') {
    throw Object.assign(new Error(code), { code });
}

function identity(value) {
    if (typeof value !== 'string' || !UUID.test(value)) fail();
    return value.toLowerCase();
}

function sharedData(data) {
    return Object.fromEntries(Object.entries(data).filter(([key]) => !CANDIDATE_FIELDS.has(key)));
}

// Keep server-owned values even when an edit replaces their ancestor. A missing
// baseline means this is new data and must carry no protected identities.
function preserveProtected(before, after) {
    if (documentEqual(before, after) || (!object(before) && !object(after))) return after;
    const old = object(before) ? before : {};
    const next = object(after) ? after : {};
    const entries = [];
    for (const key of keysOf(old, next)) {
        const oldValue = Object.hasOwn(old, key) ? old[key] : undefined;
        const nextValue = Object.hasOwn(next, key) ? next[key] : undefined;
        const value = PROTECTED.has(key) ? oldValue : preserveProtected(oldValue, nextValue);
        if (value !== undefined) entries.push([key, value]);
    }
    return object(after) || entries.length ? Object.fromEntries(entries) : after;
}

function fieldChanges(before, input, { candidate = false } = {}) {
    const after = preserveProtected(before, input);
    const changes = [];
    function visit(old, next, path) {
        if (documentEqual(old, next)) return;
        const key = path.at(-1);
        if (object(old) && object(next) && !stateTree(key ?? '')) {
            const keys = [...keysOf(old, next)].filter(key => !PROTECTED.has(key) &&
                !documentEqual(Object.hasOwn(old, key) ? old[key] : undefined, Object.hasOwn(next, key) ? next[key] : undefined));
            if (!keys.some(key => BAD_PATH_KEYS.has(key))) {
                for (const key of keys) {
                    visit(Object.hasOwn(old, key) ? old[key] : undefined,
                        Object.hasOwn(next, key) ? next[key] : undefined, [...path, key]);
                }
                return;
            }
        }
        if (!path.length || (candidate && SWIPE_FIELDS.has(path[0]))) fail();
        changes.push({ path, before: documentValue(before, path), after: documentValue(after, path) });
    }
    visit(before, after, []);
    return changes;
}

// If the selected top-level projection stayed unchanged, a script may have
// edited only the swipe mirror. Otherwise the selected display value is used.
function selectedField(top, mirror, priorTop, prior) {
    if (!prior) return top === undefined ? mirror : top;
    return documentEqual(top, priorTop) ? mirror : top;
}

function candidateViews(message, prior, uuid, writeIdentities) {
    const texts = message.swipes ?? [message.mes];
    const selected = message.swipe_id ?? 0;
    const info = message.swipe_info ?? [];
    const rawVariables = message.variables;
    if (!Array.isArray(texts) || !texts.length || !texts.every(text => typeof text === 'string') ||
        !Number.isInteger(selected) || selected < 0 || selected >= texts.length ||
        !Array.isArray(info) || info.length > texts.length ||
        (Array.isArray(rawVariables) ? rawVariables.length > texts.length : rawVariables !== undefined && !object(rawVariables))) fail();
    const variableKeys = object(rawVariables) ? Object.keys(rawVariables) : [];
    const indexMap = variableKeys.length && variableKeys.every(key => /^(0|[1-9]\d*)$/.test(key) && BigInt(key) < BigInt(texts.length));
    const variables = object(rawVariables) && !indexMap ? [rawVariables] : rawVariables;

    const initial = new Map(prior?.candidates.map(candidate => [candidate.candidateId, candidate.data]));
    const used = new Set();
    const topId = sourceId(message)?.toLowerCase?.();
    const wrapperIds = prior ? info.map(entry => {
        const id = sourceId(entry);
        return id == null ? undefined : identity(id);
    }) : [];
    const topExtra = preserveProtected(undefined, object(message.extra) ? message.extra : {});
    const oldTopExtra = preserveProtected(undefined, prior?.data.extra);
    const views = Array.from(texts, (text, index) => {
        if (typeof text !== 'string') fail(); // Sparse swipes do not describe valid candidates.
        const entry = info[index];
        if (entry !== undefined && entry !== null && !object(entry)) fail();
        const current = index === selected;
        const candidateId = prior ? wrapperIds[index] ??
            identity(current && topId && !wrapperIds.includes(topId) ? topId : uuid()) : undefined;
        if (prior && used.has(candidateId)) fail();
        used.add(candidateId);

        const old = initial.get(candidateId);
        const data = { ...entry, mes: current ? selectedField(message.mes ?? text, text, prior?.data.mes, prior) : text };
        for (const key of TIMES) {
            const value = current ? selectedField(message[key], entry?.[key], prior?.data[key], prior) : entry?.[key];
            if (value === undefined) delete data[key];
            else data[key] = value;
        }
        if (typeof data.mes !== 'string') fail();
        // A retry stamps an ID onto a selected projection. Compare only its
        // writable content so that writeback cannot change the retry payload.
        let extra = entry?.extra;
        if (current && (prior ? !documentEqual(topExtra, oldTopExtra) : message.extra !== undefined)) extra = message.extra;
        if (object(extra)) data.extra = extra;
        else if (prior) data.extra = {};
        else delete data.extra;
        delete data.variables;
        // The full Go projection uses null for missing entries whenever any
        // candidate has variables. Only the typed candidate distinguishes them.
        const value = variables?.[index];
        if (value !== undefined && !(value === null && old && !Object.hasOwn(old, 'variables'))) data.variables = value;
        const normalized = preserveProtected(old, data);

        if (prior && wrapperIds[index] === undefined) {
            writeIdentities.push(() => {
                message.swipe_info ??= [];
                const wrapper = message.swipe_info[index] ??= {};
                if (!object(wrapper.extra)) wrapper.extra = {};
                wrapper.extra.vc_source = { ...wrapper.extra.vc_source, id: candidateId };
                if (current) {
                    if (!object(message.extra)) message.extra = {};
                    message.extra.vc_source = { ...message.extra.vc_source, id: candidateId };
                }
            });
        }
        return { candidateId, data: normalized };
    });
    return { selected, views };
}

function newMessageEntry(message, clientMessageId) {
    const { selected, views } = candidateViews(message);
    const active = views[selected].data;
    const data = { ...preserveProtected(undefined, sharedData(message)), mes: active.mes };
    const variables = {};
    data.swipes = views.map(({ data }) => data.mes);
    data.swipe_id = selected;
    data.swipe_info = views.map(({ data }, index) => {
        const { mes, variables: value, ...wrapper } = data;
        if (value !== undefined) variables[index] = value;
        return wrapper;
    });
    for (const key of MIRRORED) {
        if (!Object.hasOwn(active, key)) continue;
        // Go inherits a top-level send_date into every alternate that lacks
        // it. The active wrapper already carries its own date.
        if (key === 'send_date' && views.some(({ data }) => !Object.hasOwn(data, key))) continue;
        data[key] = active[key];
    }
    if (Object.keys(variables).length) data.variables = variables;
    return { clientMessageId, data };
}

function messageOperations(operations, prior, message, uuid, writeIdentities) {
    if (documentEqual(prior.data, message)) return;
    const { selected, views } = candidateViews(message, prior, uuid, writeIdentities);
    const { messageId, messageRevision, selectedCandidateId } = prior;
    const chosen = views[selected].candidateId;
    const originals = new Map(prior.candidates.map(candidate => [candidate.candidateId, candidate.data]));
    const nextIds = new Set(views.map(view => view.candidateId));
    const retained = prior.candidates.map(candidate => candidate.candidateId).filter(id => nextIds.has(id));
    const added = views.filter(view => !originals.has(view.candidateId));
    if (!documentEqual([...retained, ...added.map(view => view.candidateId)], [...nextIds])) fail();

    function edit(target, changes) {
        if (changes.length) operations.push({ kind: 'edit', target, preconditions: { baseRevision: messageRevision }, payload: { changes } });
    }
    edit({ messageId }, fieldChanges(sharedData(prior.data), sharedData(message)));
    for (const { candidateId, data } of views) {
        if (originals.has(candidateId)) edit({ messageId, candidateId }, fieldChanges(originals.get(candidateId), data, { candidate: true }));
    }
    for (const candidate of added) {
        operations.push({ kind: 'addSwipe', target: { messageId }, preconditions: { messageRevision }, payload: { candidate } });
    }

    const preconditions = { messageRevision, selectedCandidateId };
    for (const { candidateId } of prior.candidates) {
        if (!nextIds.has(candidateId)) {
            operations.push({ kind: 'removeSwipe', target: { messageId, candidateId }, preconditions,
                payload: { replacementCandidateId: candidateId === selectedCandidateId ? chosen : null } });
        }
    }
    if (chosen !== selectedCandidateId && nextIds.has(selectedCandidateId)) {
        operations.push({ kind: 'selectSwipe', target: { messageId, candidateId: chosen }, preconditions, payload: null });
    }
}

function reorderOperations(operations, prior, retained, orderRevision) {
    const nextIndex = new Map(retained.map((id, index) => [id, index]));
    let offset = 0;
    let interval = [];
    function flush() {
        const wanted = retained.slice(offset, offset + interval.length);
        // A Go reorder interval cannot include a row deleted in this batch.
        if (interval.some(id => nextIndex.get(id) < offset || nextIndex.get(id) >= offset + interval.length)) fail();
        offset += interval.length;
        let first = 0;
        let last = interval.length - 1;
        while (first <= last && interval[first] === wanted[first]) first++;
        while (last > first && interval[last] === wanted[last]) last--;
        if (first < last) {
            operations.push({ kind: 'reorder', target: { firstMessageId: interval[first], lastMessageId: interval[last] },
                preconditions: { orderRevision }, payload: { messageIds: wanted.slice(first, last + 1) } });
        }
        interval = [];
    }
    for (const { messageId } of prior) {
        if (nextIndex.has(messageId)) interval.push(messageId);
        else flush();
    }
    flush();
}

export function buildChatOperations(base, next, { uuid = () => crypto.randomUUID(), generation } = {}) {
    const { chat, messages } = base;
    if (messages.length !== chat.messageCount || messages.some(message => message.view !== 'full') ||
        !object(next.header) || !object(next.metadata) || (next.title !== undefined && typeof next.title !== 'string')) fail();
    const originals = new Map(messages.map(message => [message.messageId, message]));
    const operations = [];
    const retained = [];
    const inserts = [];
    let pending = [];
    let newMessageCount = 0;
    const seen = new Set();
    const writeIdentities = [];

    for (const message of next.messages) {
        if (!object(message)) fail();
        const messageId = identity(message.vc_message_id ?? uuid());
        if (seen.has(messageId)) fail();
        seen.add(messageId);
        const prior = originals.get(messageId);
        if (prior) {
            if (pending.length) {
                if (generation != null) fail();
                inserts.push({ kind: 'insert', target: { beforeMessageId: messageId },
                    preconditions: { orderRevision: chat.orderRevision }, payload: { messages: pending } });
                pending = [];
            }
            retained.push(messageId);
            messageOperations(operations, prior, message, uuid, writeIdentities);
        } else {
            newMessageCount++;
            if (newMessageCount > MAX_COUNT) fail();
            pending.push(newMessageEntry(message, messageId));
            if (message.vc_message_id === undefined || message.vc_message_id === null) {
                writeIdentities.push(() => { message.vc_message_id = messageId; });
            }
        }
    }
    for (const { messageId, messageRevision } of messages) {
        if (!seen.has(messageId)) operations.push({ kind: 'delete', target: { messageId }, preconditions: { messageRevision }, payload: null });
    }
    reorderOperations(operations, messages, retained, chat.orderRevision);
    const changes = fieldChanges({ title: chat.title, header: chat.header, metadata: chat.metadata },
        { title: next.title ?? chat.title, header: next.header, metadata: next.metadata });
    if (changes.length) operations.push({ kind: 'metadata', target: {}, preconditions: { baseRevision: chat.metadataRevision }, payload: { changes } });
    // Insert anchors are ordered by the desired survivors after any reorder.
    operations.push(...inserts);
    if (pending.length) operations.push({ kind: 'append', target: {}, preconditions: {}, payload: { messages: pending } });

    if (operations.length > MAX_COUNT) fail();
    if (!operations.length) return { operations };
    // requestId is always a UUID, so a placeholder has the exact wire length.
    const serialized = JSON.stringify({ requestId: '00000000-0000-0000-0000-000000000000',
        authorityEpoch: chat.authorityEpoch, operations, generation });
    if (new TextEncoder().encode(serialized).length > MAX_BYTES) fail('CHAT_PAYLOAD_TOO_LARGE');
    for (const writeIdentity of writeIdentities) writeIdentity();
    return { operations };
}
