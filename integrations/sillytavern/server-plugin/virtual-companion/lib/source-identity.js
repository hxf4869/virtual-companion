// Browser + Node shared source identity rules. JSONL remains authoritative.
// Source revision covers the selected text, speaker and MVU snapshot; it is
// independent of a chat header save and never uses a filename/array index as ID.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const eventIdPattern = /^[A-Za-z0-9_.:-]{1,128}$/;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validId = (v) => typeof v === 'string' && uuidPattern.test(v);
function inboxEventId(source) {
    const id = source?.inbox_event_id;
    return typeof id === 'string' && eventIdPattern.test(id) ? id : '';
}
const selectedIndex = (message) => Array.isArray(message.swipes) && message.swipes.length
    ? Math.max(0, Math.min(message.swipes.length - 1, Number.isInteger(message.swipe_id) ? message.swipe_id : 0)) : 0;
function candidates(message) {
    const index = selectedIndex(message);
    if (!object(message.extra)) message.extra = {};
    if (!Array.isArray(message.swipes) || !message.swipes.length) return [{ extra: message.extra, index: 0, text: String(message.mes ?? '') }];
    if (!Array.isArray(message.swipe_info)) message.swipe_info = [];
    const extras = new Set([message.extra]);
    return message.swipes.map((text, i) => {
        if (!object(message.swipe_info[i])) message.swipe_info[i] = {};
        if (!object(message.swipe_info[i].extra)) message.swipe_info[i].extra = {};
        if (i !== index && extras.has(message.swipe_info[i].extra)) message.swipe_info[i].extra = structuredClone(message.swipe_info[i].extra);
        // Native/Helper merge operations expect separate value objects here.
        // Sharing the live extra lets an upstream merge create a self-cycle.
        if (message.swipe_info[i] === message.extra) message.swipe_info[i] = { extra: structuredClone(message.extra) };
        if (i === index && message.swipe_info[i].extra === message.extra) message.swipe_info[i].extra = structuredClone(message.extra);
        extras.add(message.swipe_info[i].extra);
        return { extra: i === index ? message.extra : message.swipe_info[i].extra, index: i, text: i === index ? String(message.mes ?? '') : String(text ?? '') };
    });
}

/** Called synchronously before a browser save is cloned/queued. New IDs stay on
 * the live messages, so a later save does not mint identities for the same row. */
export function prepareSourceIdentities(chat, { settled, sourceTimezone, uuid = () => crypto.randomUUID() } = {}) {
    if (!Array.isArray(chat)) return;
    const messages = new Set();
    for (const message of chat.slice(1)) {
        if (!object(message)) continue;
        if (!validId(message.vc_message_id) || messages.has(message.vc_message_id)) message.vc_message_id = uuid();
        messages.add(message.vc_message_id);
        const swipes = new Set();
        for (const candidate of candidates(message)) {
            let source = candidate.extra.vc_source;
            if (!object(source)) source = {};
            if (!validId(source.id) || swipes.has(source.id)) {
                const sent = message.swipe_info?.[candidate.index]?.send_date ?? message.send_date;
                const kept = inboxEventId(source);
                source = { id: uuid(), sourceTimestamp: sourceInstant(sent), sourceTimezone: validTimezone(sourceTimezone) };
                if (kept) source.inbox_event_id = kept;
            }
            swipes.add(source.id);
            candidate.extra.vc_source = source;
            if (settled !== undefined) source.settled = settled === true;
            if (Array.isArray(message.swipes) && candidate.index === selectedIndex(message)) message.swipe_info[candidate.index].extra.vc_source = structuredClone(source);
        }
    }
}
function sourceInstant(value) {
    // Only absolute instants are interpreted. Legacy local dates keep an unknown
    // timezone instead of acquiring whichever zone this process happens to use.
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function validTimezone(value) {
    if (typeof value !== 'string' || !value) return '';
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; } catch { return ''; }
}
function signature(message, candidate) {
    return JSON.stringify({ text: candidate.text, name: message.name, user: Boolean(message.is_user),
        hidden: Boolean(message.is_system), type: candidate.extra.type,
        noMemory: Boolean(candidate.extra.no_memory), variables: message.variables?.[candidate.index] });
}
function previousSources(chat) {
    const result = new Map();
    for (const message of (chat || []).slice(1)) {
        if (!object(message) || !validId(message.vc_message_id)) continue;
        for (const candidate of candidates(message)) {
            const source = candidate.extra.vc_source;
            if (source !== undefined && (!object(source) || !validId(source.id) || !Number.isSafeInteger(source.revision) || source.revision < 1)) throw new Error('Saved source identity is invalid');
            if (validId(source?.id) && Number.isSafeInteger(source.revision) && source.revision >= 1) {
                result.set(`${message.vc_message_id}/${source.id}`, { source, signature: signature(message, candidate), time: sourceTime(source) });
            }
        }
    }
    return result;
}

/** Storage computes revisions from the actual previous JSONL, ignoring any
 * browser-supplied revision. Caller holds the same F2 commit lock. */
export function reconcileSourceIdentities(chat, previous = []) {
    const before = JSON.stringify(chat);
    const old = previousSources(structuredClone(previous));
    prepareSourceIdentities(chat);
    for (const message of chat.slice(1)) {
        for (const candidate of candidates(message)) {
            const source = candidate.extra.vc_source;
            const existing = old.get(`${message.vc_message_id}/${source.id}`);
            const time = sourceTime(source);
            const changed = !existing || existing.signature !== signature(message, candidate) || JSON.stringify(existing.time) !== JSON.stringify(time);
            const revision = !existing ? 1 : existing.source.revision + (changed ? 1 : 0);
            if (!Number.isSafeInteger(revision)) throw new Error('Source revision limit reached');
            const eventId = inboxEventId(source) || inboxEventId(existing?.source);
            candidate.extra.vc_source = { id: source.id, revision, settled: source.settled === true, ...time };
            if (eventId) candidate.extra.vc_source.inbox_event_id = eventId;
            if (Array.isArray(message.swipes) && candidate.index === selectedIndex(message)) message.swipe_info[candidate.index].extra.vc_source = structuredClone(candidate.extra.vc_source);
        }
    }
    return JSON.stringify(chat) !== before;
}
function sourceTime(source) {
    return { sourceTimestamp: sourceInstant(source.sourceTimestamp), sourceTimezone: validTimezone(source.sourceTimezone) };
}

/** Read only selected candidates; deselected swipes are retained in JSONL but
 * cannot remain eligible evidence. Never return internal source metadata as text. */
export function sourceMessages(chat) {
    return chat.slice(1).map((message) => {
        const candidate = candidates(message)[selectedIndex(message)];
        const source = candidate.extra.vc_source;
        const row = { messageId: message.vc_message_id, candidateId: source.id, revision: source.revision,
            role: message.is_user ? 'user' : message.is_system ? 'system' : 'assistant',
            text: candidate.text, settled: source.settled === true,
            eligible: !message.is_system && !candidate.extra.no_memory, ...sourceTime(source),
        };
        const eventId = inboxEventId(source);
        if (eventId) row.inboxEventId = eventId;
        return row;
    });
}
