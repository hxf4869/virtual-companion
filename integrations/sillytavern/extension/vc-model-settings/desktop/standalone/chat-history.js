// SX-6: current Go keysets plus complete changes transactions form the script history barrier.
const FULL_LIMIT = 200;
const MAX_REBUILDS = 3;
const MAX_CONFIRM_RACES = 3;
const HISTORY_BYTES = 256 * 1024 * 1024;
const encoder = new TextEncoder();

function historyError(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}
const conflict = () => historyError(409, 'REVISION_CONFLICT', '聊天记录未能校准到一致版本。');
const authorityChanged = () => historyError(409, 'CHAT_AUTHORITY_CHANGED', '聊天存储权威已变化。');
const notFound = () => historyError(404, 'NOT_FOUND_OR_FORBIDDEN', '聊天记录不可访问。');

function revision(value) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw conflict();
    return BigInt(value);
}

function byteBudget() {
    let used = 0;
    return bytes => {
        used += bytes;
        if (used > HISTORY_BYTES) {
            throw historyError(413, 'CHAT_PAYLOAD_TOO_LARGE', '完整聊天记录超过 256 MiB。');
        }
    };
}

function jsonBytes(value) {
    return encoder.encode(JSON.stringify(value)).byteLength;
}

function withSignal(signal, run) {
    signal.throwIfAborted();
    // A transport can finish after cancellation. Release the caller now and ignore that result.
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => {
            signal.throwIfAborted();
            return run();
        }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

async function forEachPair(items, signal, read) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            signal.throwIfAborted();
            const index = next++;
            await read(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(2, items.length) }, worker));
}

class Rebuild extends Error {}

export function createChatHistory(options) {
    return createHistory(options);
}

function createHistory({ chatId, authorityEpoch, request }, sharedBudget) {
    const id = chatId.toLowerCase();
    const path = '/api/v1/chats/' + encodeURIComponent(id);
    let scope = new AbortController();
    let closed = false;
    let fullTask;
    let stable;

    function clear(reason, terminal) {
        stable = undefined;
        closed ||= terminal;
        scope.abort(reason);
        if (!closed) scope = new AbortController();
    }

    async function get(url, signal, { singleMessage = false, canRebuild = false } = {}) {
        try {
            const result = await withSignal(signal, () => request('GET', url, undefined, { signal }));
            signal.throwIfAborted();
            return result;
        } catch (error) {
            signal.throwIfAborted();
            if (error.code === 'CHAT_AUTHORITY_CHANGED' || error.code === 'ACCOUNT_CONTEXT_CHANGED' ||
                error.status === 401 || error.status === 403 || (!singleMessage && error.status === 404)) {
                clear(error, true);
            }
            if (canRebuild && error.status === 410) throw new Rebuild();
            throw error;
        }
    }

    function checkEpoch(value, signal) {
        signal.throwIfAborted();
        if (value === authorityEpoch) return;
        const error = authorityChanged();
        clear(error, true);
        throw error;
    }

    function checkChat(dto, signal) {
        if (!dto) throw conflict();
        checkEpoch(dto.authorityEpoch, signal);
        if (dto.chatId !== id) throw conflict();
    }

    async function messagePage(params, signal) {
        const page = await get(path + '/messages?' + new URLSearchParams(params), signal, { canRebuild: params.view === 'full' });
        checkChat(page, signal);
        if (params.include) {
            checkChat(page.chat, signal);
            if (page.chat.chatRevision !== page.chatRevision ||
                page.chat.metadataRevision !== page.metadataRevision ||
                page.chat.orderRevision !== page.orderRevision) throw conflict();
        }
        if (!Array.isArray(page.items) || page.items.some(message => message.view !== params.view)) throw conflict();
        return page;
    }

    async function loadDisplay({ signal, limit = 50 } = {}) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw conflict();
        const combined = signal ? AbortSignal.any([scope.signal, signal]) : scope.signal;
        const page = await messagePage({ view: 'display', limit, include: 'chat' }, combined);
        combined.throwIfAborted();
        return { chat: page.chat, messages: page.items };
    }

    function cursorFor(cursor, visited) {
        if (!cursor || visited.has(cursor)) throw conflict();
        visited.add(cursor);
        return cursor;
    }

    function record(state, dto, charge, keepExisting = false) {
        // Track DTO size once, including its separator, so sync and cross-chat reads
        // can share byte accounting without serializing a whole history again.
        const bytes = jsonBytes(dto) + 1;
        charge(bytes);
        if (keepExisting && state.entries.has(dto.messageId)) return false;
        state.entries.set(dto.messageId, { dto, bytes });
        return true;
    }

    async function backwards(first, signal, charge, progress) {
        if (first.items.length && !first.afterCursor) throw conflict();
        const state = {
            entries: new Map(),
            ordered: new Set(),
            tail: first.afterCursor,
            pending: new Set(),
            through: revision(first.chatRevision),
            metadata: revision(first.metadataRevision),
            order: revision(first.orderRevision),
        };
        charge(jsonBytes(first.chat));
        const chunks = [];
        const visited = new Set();
        let page = first;
        for (;;) {
            if (revision(page.orderRevision) !== state.order) throw new Rebuild();
            const chunk = [];
            for (const dto of page.items) {
                // Walk newest pages first; keep their newer value if a stable ID overlaps.
                if (record(state, dto, charge, true)) chunk.push(dto.messageId);
            }
            chunks.push(chunk);
            progress('pages', state.entries.size);
            if (!page.hasOlder) break;
            if (!chunk.length) throw conflict();
            page = await messagePage({ view: 'full', limit: FULL_LIMIT, before: cursorFor(page.beforeCursor, visited) }, signal);
        }
        for (const chunk of chunks.reverse()) {
            for (const messageId of chunk) state.ordered.add(messageId);
        }
        return state;
    }

    async function restoreOrder(state, signal, charge, progress) {
        if (!state.pending.size) return;
        if (!state.tail) {
            // A chat that started empty has no boundary to page after.
            const first = await messagePage({ view: 'full', limit: FULL_LIMIT, include: 'chat' }, signal);
            if (revision(first.orderRevision) !== state.order) throw new Rebuild();
            const rebuilt = await backwards(first, signal, charge, progress);
            state.entries = rebuilt.entries;
            state.ordered = rebuilt.ordered;
            state.tail = rebuilt.tail;
            for (const messageId of state.ordered) state.pending.delete(messageId);
            return;
        }

        // position is opaque and changedIds has no presentation order.
        const visited = new Set();
        while (state.pending.size) {
            const page = await messagePage({ view: 'full', limit: FULL_LIMIT, after: cursorFor(state.tail, visited) }, signal);
            if (revision(page.orderRevision) !== state.order) throw new Rebuild();
            const orderedBefore = state.ordered.size;
            for (const dto of page.items) {
                record(state, dto, charge);
                state.ordered.add(dto.messageId);
                state.pending.delete(dto.messageId);
            }
            if (page.items.length) {
                if (!page.afterCursor || visited.has(page.afterCursor)) throw conflict();
                state.tail = page.afterCursor;
            }
            if (!page.hasNewer) break;
            if (state.ordered.size === orderedBefore) throw conflict();
        }
    }

    async function reconcile(state, signal, charge, progress) {
        let confirmRaces = 0;
        let frontier;
        for (;;) {
            const page = await get(path + '/changes?afterRevision=' + state.through, signal, { canRebuild: true });
            checkChat(page, signal);
            const current = revision(page.currentRevision);
            frontier ??= current;
            if (current < frontier || !Array.isArray(page.items)) throw conflict();
            // Observe access revocation before issuing any individual message reads.
            for (const change of page.items) {
                checkEpoch(change.authorityEpoch, signal);
                if (change.deleted) {
                    const error = notFound();
                    clear(error, true);
                    throw error;
                }
            }
            charge(jsonBytes(page));
            for (const change of page.items) {
                const next = revision(change.chatRevision);
                if (next !== state.through + 1n) throw conflict();
                for (const messageId of change.deletedIds) {
                    state.entries.delete(messageId);
                    state.pending.delete(messageId);
                }
                if (change.orderChanged || revision(change.orderRevision) !== state.order) throw new Rebuild();

                await forEachPair(change.changedIds, signal, async messageId => {
                    let dto;
                    try {
                        dto = await get(path + '/messages/' + encodeURIComponent(messageId), signal, { singleMessage: true });
                    } catch (error) {
                        if (error.status !== 404) throw error;
                        state.entries.delete(messageId);
                        state.pending.delete(messageId);
                        return;
                    }
                    signal.throwIfAborted();
                    if (dto.view !== 'full' || dto.messageId !== messageId) throw conflict();
                    record(state, dto, charge);
                    if (!state.ordered.has(messageId)) state.pending.add(messageId);
                });
                state.through = next;
                state.metadata = revision(change.metadataRevision);
            }

            const through = revision(page.throughRevision);
            if (through !== state.through || (page.hasMore ? through >= current || !page.items.length : through !== current)) {
                throw conflict();
            }
            progress('changes', state.entries.size);
            // Bound each catch-up pass by its first observed high-water mark.
            if (state.through < frontier) continue;

            await restoreOrder(state, signal, charge, progress);
            const chat = await get(path, signal);
            checkChat(chat, signal);
            const chatBytes = jsonBytes(chat);
            charge(chatBytes);
            if (revision(chat.orderRevision) !== state.order) throw new Rebuild();
            const latest = revision(chat.chatRevision);
            if (latest > state.through && confirmRaces++ < MAX_CONFIRM_RACES) {
                frontier = latest;
                continue;
            }
            if (latest !== state.through || revision(chat.metadataRevision) !== state.metadata ||
                state.pending.size || chat.messageCount !== state.entries.size) throw conflict();

            const messages = [];
            let bytes = chatBytes;
            for (const messageId of state.ordered) {
                const entry = state.entries.get(messageId);
                if (!entry) continue;
                messages.push(entry.dto);
                bytes += entry.bytes;
            }
            if (messages.length !== state.entries.size) throw conflict();
            return { result: { chat, messages }, entries: state.entries, tail: state.tail, bytes };
        }
    }

    async function loadFull({ signal: callerSignal, onProgress } = {}) {
        const base = stable;
        stable = undefined;
        const previousTask = fullTask;
        const task = new AbortController();
        fullTask = task;
        const signals = [task.signal, scope.signal];
        previousTask?.abort();
        if (callerSignal) signals.push(callerSignal);
        const signal = AbortSignal.any(signals);
        const charge = sharedBudget || byteBudget();
        const progress = (phase, loaded) => {
            signal.throwIfAborted();
            onProgress?.({ phase, loaded });
        };
        const rebuiltFrom = new Set();
        let rebuilds = 0;
        try {
            signal.throwIfAborted();
            let chat = base?.result.chat;
            let state = base && {
                entries: new Map(base.entries),
                ordered: new Set(base.result.messages.map(dto => dto.messageId)),
                pending: new Set(),
                tail: base.tail,
                through: revision(chat.chatRevision),
                metadata: revision(chat.metadataRevision),
                order: revision(chat.orderRevision),
            };
            if (base) charge(base.bytes);
            for (;;) {
                try {
                    if (!state) {
                        const first = await messagePage({ view: 'full', limit: FULL_LIMIT, include: 'chat' }, signal);
                        chat = first.chat;
                        state = await backwards(first, signal, charge, progress);
                    }
                    const confirmed = await reconcile(state, signal, charge, progress);
                    progress('ready', confirmed.result.messages.length);
                    signal.throwIfAborted();
                    stable = confirmed;
                    return stable.result;
                } catch (error) {
                    if (!(error instanceof Rebuild)) throw error;
                    const from = chat && [chat.chatRevision, chat.metadataRevision, chat.orderRevision].join('/');
                    if (!from || rebuiltFrom.has(from) || rebuilds++ >= MAX_REBUILDS) throw conflict();
                    rebuiltFrom.add(from);
                    state = undefined;
                    chat = undefined;
                }
            }
        } catch (error) {
            task.abort(error);
            throw error;
        } finally {
            if (fullTask === task) fullTask = undefined;
        }
    }

    return {
        loadDisplay,
        loadFull,
        sync: loadFull,
        snapshot() {
            if (!stable) throw conflict();
            return stable.result;
        },
        invalidate() { clear(undefined, false); },
        close() { clear(undefined, true); },
    };
}

export async function readChatHistories(chatIds, { authorityEpoch, request, signal, onProgress } = {}) {
    const cancel = new AbortController();
    const combined = signal ? AbortSignal.any([cancel.signal, signal]) : cancel.signal;
    const charge = byteBudget();
    const results = [];
    let completed = 0;
    try {
        combined.throwIfAborted();
        await forEachPair(chatIds, combined, async (chatId, index) => {
            const history = createHistory({ chatId, authorityEpoch, request }, charge);
            try {
                results[index] = await history.loadFull({
                    signal: combined,
                    onProgress: onProgress && (({ phase, loaded }) => {
                        onProgress({ phase, loaded, completed: completed + Number(phase === 'ready'), total: chatIds.length });
                    }),
                });
                completed++;
            } catch (error) {
                cancel.abort(error);
                throw error;
            } finally {
                history.close();
            }
        });
        combined.throwIfAborted();
        return results;
    } finally {
        cancel.abort();
    }
}
