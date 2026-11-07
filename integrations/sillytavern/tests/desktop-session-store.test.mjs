import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopClient } from '../extension/vc-model-settings/desktop/standalone/client.js';
import { createStoredChatStore, storedChatRecords } from '../extension/vc-model-settings/desktop/standalone/chat-store.js';
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const doc = { cookie: 'vc_csrf=go-csrf', querySelector: selector => ({ content: selector.includes('account') ? '1' : '2' }) };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const deferred = () => Promise.withResolvers();
function row(n, text = 'synthetic') {
    const extra = { vc_source: { id: id(n + 100), revision: 1, generation: 1, settled: true } };
    const wrapper = { extra, unknownWrapper: { keep: true } };
    return { messageId: id(n), messageRevision: '1', view: 'full', position: String(n),
        selectedCandidateId: id(n + 100), candidateCount: 1, candidates: [{ candidateId: id(n + 100), data: { ...structuredClone(wrapper), mes: text } }],
        data: { vc_message_id: id(n), name: 'synthetic', is_user: true, mes: text, swipes: [text], swipe_id: 0, swipe_info: [structuredClone(wrapper)], extra: structuredClone(extra) } };
}
function fixture({ onWrite, onRead, initialMessages } = {}) {
    let chat = { chatId: id(900), authorityEpoch: '8', chatRevision: '1', orderRevision: '1', metadataRevision: '1',
        branchRoot: id(900), header: { vc_binding: { mode: 'STORY' } }, metadata: {}, title: 'synthetic', messageCount: 1 };
    let messages = initialMessages ?? [row(1)];
    chat.messageCount = messages.length;
    const requests = [], changes = [];
    const store = createStoredChatStore({ chatId: chat.chatId, authorityEpoch: '8', getStorage: () => ({ mode: 'GO', authorityEpoch: '8' }),
        request: async (method, path, body) => {
            requests.push({ method, path, body });
            if (method === 'POST') return onWrite(body, { chat: structuredClone(chat), messages: structuredClone(messages) });
            await onRead?.(path);
            const url = new URL(path, 'https://synthetic.invalid');
            if (url.pathname.endsWith('/changes')) return { chatId: chat.chatId, authorityEpoch: '8', currentRevision: chat.chatRevision,
                throughRevision: chat.chatRevision, hasMore: false, items: changes.filter(change => BigInt(change.chatRevision) > BigInt(url.searchParams.get('afterRevision'))) };
            if (url.pathname.endsWith('/messages')) return { chatId: chat.chatId, authorityEpoch: '8', chatRevision: chat.chatRevision,
                metadataRevision: chat.metadataRevision, orderRevision: chat.orderRevision, chat: structuredClone(chat),
                items: structuredClone(url.searchParams.has('after') ? messages.slice(1) : messages), afterCursor: 'last-' + chat.chatRevision, beforeCursor: 'first', hasNewer: false, hasOlder: false };
            if (url.pathname.includes('/messages/')) return structuredClone(messages.find(message => url.pathname.endsWith(message.messageId)));
            return structuredClone(chat);
        } });
    return { store, requests, appendRemote() {
        messages.push(row(2, 'concurrent tail')); chat = { ...chat, messageCount: 2, chatRevision: '2' };
        changes.push({ authorityEpoch: '8', chatRevision: '2', metadataRevision: '1', orderRevision: '1', changedIds: [id(2)], deletedIds: [], orderChanged: false });
    } };
}
const nextOf = snapshot => { const [head, ...messages] = storedChatRecords(snapshot); const { chat_metadata: metadata, ...header } = head; return { header, metadata, messages }; };
const ack = (chat, messages) => ({ chatId: chat.chatId, authorityEpoch: '8', chatRevision: '2', metadataRevision: '1', orderRevision: '1', changed: messages, deletedIds: [], deleted: false });

test('client requires a verified hint, keeps HTML identity and sends independent CSRF and generation scope', async () => {
    const requests = [];
    let session = { accountId: '1', sessionId: '2', chatStorage: { mode: 'GO', authorityEpoch: '8' } };
    const client = createDesktopClient({ document: doc, fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return url === '/csrf-token' ? json({ token: 'st-csrf' }) : url.startsWith('/auth/') ? json(session) : json({});
    } });
    assert.throws(() => client.getChatStorage());
    await client.initialize();
    await client.chatRequest('POST', '/api/v1/chats', {});
    assert.deepEqual(requests.at(-1).options.headers, { 'Content-Type': 'application/json', 'X-CSRF-Token': 'st-csrf',
        'X-VC-CSRF-Token': 'go-csrf', 'X-VC-Expected-Account-ID': '1', 'X-VC-Expected-Session-ID': '2' });
    const generation = { generationRunId: id(3) };
    await client.generate({ url: '/generate', body: { model: 'synthetic' } }, { generation });
    assert.equal(requests.at(-1).options.headers['X-VC-Stored-Chat-Generation'], JSON.stringify(generation));
    assert.equal(requests.at(-1).options.body, '{"model":"synthetic"}');
    session = { ...session, accountId: '3' };
    await assert.rejects(client.refreshChatStorage(), { code: 'ACCOUNT_CONTEXT_CHANGED' });
    assert.equal(client.identity.accountId, '1');
    assert.equal(client.getChatStorage().mode, 'GO');
});

test('missing/503 hint never defaults to ST and authority conflict refreshes without replay', async () => {
    let fail = true, writes = 0;
    const client = createDesktopClient({ document: doc, fetchImpl: async url => {
        if (url === '/csrf-token') return json({ token: 'st' });
        if (url.startsWith('/auth/')) return fail ? json({}, 503) : json({ accountId: '1', sessionId: '2', chatStorage: { mode: writes ? 'FROZEN' : 'GO', authorityEpoch: writes ? '9' : '8' } });
        writes++; return json({ code: 'CHAT_AUTHORITY_CHANGED' }, 409);
    } });
    await assert.rejects(client.initialize(), { status: 503 });
    assert.throws(() => client.getChatStorage());
    fail = false; await client.initialize();
    await assert.rejects(client.chatRequest('POST', '/api/v1/chats', {}), { code: 'CHAT_AUTHORITY_CHANGED' });
    assert.equal(writes, 1); assert.equal(client.getChatStorage().mode, 'FROZEN');
    await assert.rejects(client.chatRequest('POST', '/api/v1/chats', {}), { code: 'CHAT_AUTHORITY_CHANGED' });
    assert.equal(writes, 1);
});

test('ACK preserves local edits and their submitted before-values, including unknown swipe wrappers', async () => {
    const gate = deferred(), entered = deferred();
    const f = fixture({ onWrite: async (body, { chat, messages }) => {
        entered.resolve(body); await gate.promise;
        const updated = row(1, 'submitted'); updated.messageRevision = '2';
        updated.data.name = 'remote name';
        return ack(chat, [updated]);
    } });
    const next = nextOf(await f.store.loadFull());
    assert.equal(next.metadata.vc_binding.mode, 'STORY');
    next.messages[0].mes = next.messages[0].swipes[0] = 'submitted';
    const pending = f.store.save(next); await entered.promise;
    next.messages[0].mes = next.messages[0].swipes[0] = 'new local';
    next.messages[0].name = 'local name';
    gate.resolve(); await pending;
    assert.equal(next.messages[0].mes, 'new local');
    assert.equal(next.messages[0].name, 'local name');
    assert.deepEqual(next.messages[0].swipe_info[0].unknownWrapper, { keep: true });
    assert.equal(f.store.snapshot().messages[0].data.mes, 'submitted');
    assert.equal(f.store.snapshot().messages[0].data.name, 'synthetic');
    await assert.rejects(f.store.sync(next), { code: 'REVISION_CONFLICT' });
});

test('generation barrier reads changes independently of a higher save ACK revision', async () => {
    const f = fixture({ onWrite: async (body, { chat, messages }) => { f.appendRemote(); return ack(chat, [messages[0]]); } });
    const next = nextOf(await f.store.loadFull());
    next.messages[0].name = 'new';
    await f.store.save(next);
    const full = await f.store.sync(next);
    assert.equal(full.messages.length, 2);
    assert.ok(f.requests.some(request => request.path.endsWith('/changes?afterRevision=1')));
    assert.equal(f.store.generation(full.messages[0].data).chatRevision, '2');
});

import { createDesktopSession } from '../extension/vc-model-settings/desktop/standalone/session.js';
import { EventEmitter } from '../extension/vc-model-settings/desktop/standalone/engine/events.js';
import { event_types } from '../extension/vc-model-settings/desktop/standalone/engine/st/events.js';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';
import { Window } from 'happy-dom';
const window = new Window({ url: 'http://localhost' });
globalThis.localStorage = window.localStorage;
test.after(() => window.happyDOM.close());
function sessionFixture({ readResponse, prepare, saveError, helper, initialMessages, firstMessage } = {}) {
    const card = { avatar: 'synthetic.png', name: 'synthetic', data: { extensions: { vc_character_ref: 'synthetic-ref' } } };
    const context = { characters: [card], chat: [], chatMetadata: {}, extensionPrompts: {}, eventSource: new EventEmitter(), eventTypes: event_types };
    const chat = { chatId: id(900), authorityEpoch: '8', chatRevision: '1', orderRevision: '1', metadataRevision: '1',
        branchRoot: id(900), characterRef: 'synthetic-ref', conversationId: '1', relationshipId: '1',
        header: { vc_binding: { mode: 'COMPANION' } }, metadata: { integrity: 'synthetic' }, title: 'synthetic', messageCount: 2 };
    const assistant = row(2, 'old assistant'); assistant.data.is_user = false;
    let full = { chat, messages: initialMessages ?? [row(1, 'old user'), assistant] }, seq = 20;
    chat.messageCount = full.messages.length;
    const saves = [], generations = [], states = [], helperScopes = [];
    const canonical = message => {
        message.vc_message_id ||= id(++seq);
        const candidates = (message.swipes || [message.mes]).map((text, index) => {
            message.swipe_info ||= [];
            const wrapper = message.swipe_info[index] ||= { extra: {} };
            wrapper.extra ||= {};
            wrapper.extra.vc_source ||= { id: id(++seq), revision: 1, generation: 1, settled: true };
            if (index === (message.swipe_id || 0)) message.extra = structuredClone(wrapper.extra);
            return { candidateId: wrapper.extra.vc_source.id, data: { ...structuredClone(wrapper), mes: text } };
        });
        return { messageId: message.vc_message_id, messageRevision: '1', view: 'full', position: String(seq),
            selectedCandidateId: candidates[message.swipe_id || 0].candidateId, candidates, data: structuredClone(message) };
    };
    const store = { chatId: chat.chatId, authorityEpoch: '8', close() {}, snapshot: () => structuredClone(full),
        sync: async () => structuredClone(full),
        generation: input => ({ chatId: chat.chatId, authorityEpoch: '8', chatRevision: full.chat.chatRevision,
            requestId: id(++seq), generationRunId: id(++seq), inputMessageId: input.vc_message_id,
            inputCandidateId: full.messages.find(message => message.messageId === input.vc_message_id).selectedCandidateId }),
        async save(next, options) {
            saves.push({ next: structuredClone(next), options: structuredClone(options) });
            if (saveError) await saveError(next, options, saves);
            full = { chat: { ...full.chat, header: structuredClone(next.header), metadata: structuredClone(next.metadata),
                messageCount: next.messages.length, chatRevision: String(Number(full.chat.chatRevision) + 1) }, messages: next.messages.map(canonical) };
            next.metadata.vc_f2 = { id: chat.chatId, revision: full.chat.chatRevision };
        } };
    const client = { headers: () => ({}), getChatStorage: () => ({ mode: 'GO', authorityEpoch: '8' }),
        request: async path => path === '/api/avatars/get' ? [] : structuredClone(card),
        raw: () => { throw new Error('old ST write'); }, post: () => { throw new Error('unexpected post'); },
        settingsChanged: () => false, saveSettings: async () => {},
        async generate(packet, options) { generations.push(options.generation); return new Response('{}'); } };
    const engine = { settings: { username: 'synthetic user', user_avatar: '', power_user: { personas: {}, persona_descriptions: {} }, oai_settings: {} },
        bindContext() {}, settingsForSave() { return this.settings; },
        userMessage: async text => ({ message: { name: 'user', mes: text, is_user: true, extra: {} } }),
        firstMessage,
        prepare: prepare || (async () => ({ body: {} })), cleanResponse: text => text,
        generateHelper: async (params, options) => { helperScopes.push(options.generation); return helper ? helper(params, options) : 'helper'; } };
    const result = text => ({ text, state: { reasoning: '' }, toolCalls: [], swipes: [], finishReason: 'stop' });
    const session = createDesktopSession({ client, context, engine, prepareSourceIdentities,
        choosePersona: async () => '', reconcileSources: async () => [], onChange: value => states.push(value),
        readResponse: readResponse || (async (response, { onUpdate }) => { const value = result('new assistant'); onUpdate(value); return value; }) });
    return { session, store, context, engine, saves, generations, states, helperScopes, result,
        open: () => session.activate({ avatar: card.avatar, file: chat.chatId }, storedChatRecords(full), { chatStore: store }) };
}

test('Go send shares saved user scope with nested Helper and commits exactly one settled terminal', async () => {
    const f = sessionFixture(); await f.open();
    f.context.eventSource.on(event_types.MESSAGE_SENT, async () => {
        const { scope, release } = f.context.captureHelperScope();
        try { await f.context.generateHelper('generate', { generation_id: 'synthetic-helper', max_chat_history: 1 }, scope); } finally { release(); }
    });
    assert.equal(await f.session.send('new user'), true);
    const terminal = f.saves.filter(save => save.options.generation);
    assert.equal(terminal.length, 1); assert.equal(terminal[0].options.generation.state, 'settled');
    assert.deepEqual(f.helperScopes[0], f.generations[0]);
    assert.equal(f.generations[0].inputMessageId, f.context.chat.at(-2).vc_message_id);
    assert.equal(f.context.chat.at(-1).mes, 'new assistant');
});

test('Go regenerate keeps old reply persisted until same terminal transaction deletes and appends', async () => {
    const started = deferred(), resume = deferred();
    const f = sessionFixture({ prepare: async () => { started.resolve(); await resume.promise; return { body: {} }; } });
    await f.open(); const pending = f.session.regenerate(); await started.promise;
    assert.ok(f.saves.every(save => save.next.messages.some(message => message.mes === 'old assistant')));
    resume.resolve(); assert.equal(await pending, true);
    const terminal = f.saves.filter(save => save.options.generation);
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0].next.messages.some(message => message.mes === 'old assistant'), false);
    assert.equal(f.generations[0].inputMessageId, id(1));
});

test('Go zero-output stop ignores late tokens and final callbacks without terminal save', async () => {
    const started = deferred(); let onUpdate, finish;
    const f = sessionFixture({ readResponse: async (response, options) => {
        onUpdate = options.onUpdate; started.resolve(); return new Promise(resolve => { finish = resolve; });
    } });
    await f.open(); let callbacks = 0;
    f.context.eventSource.on(event_types.MESSAGE_RECEIVED, () => callbacks++);
    const pending = f.session.send('new user'); await started.promise;
    const stopping = f.session.stop();
    onUpdate(f.result('late token')); finish(f.result('late final'));
    await stopping; assert.equal(await pending, false);
    assert.equal(f.saves.filter(save => save.options.generation).length, 0);
    assert.equal(callbacks, 0); assert.equal(f.context.chat.at(-1).mes, 'new user');
});

test('Go partial stop persists only received prefix as aborted and rejects late final', async () => {
    const started = deferred(); let onUpdate, finish;
    const f = sessionFixture({ readResponse: async (response, options) => {
        onUpdate = options.onUpdate; onUpdate(f.result('partial')); started.resolve();
        return new Promise(resolve => { finish = resolve; });
    } });
    await f.open(); const pending = f.session.send('new user'); await started.promise;
    const stopping = f.session.stop(); onUpdate(f.result('partial plus late')); finish(f.result('late final'));
    await stopping; await pending;
    const terminal = f.saves.filter(save => save.options.generation);
    assert.equal(terminal.length, 1); assert.equal(terminal[0].options.generation.state, 'aborted');
    assert.equal(terminal[0].next.messages.at(-1).mes, 'partial');
});

test('Go fenced terminal keeps full draft and never follows with ordinary save', async () => {
    const f = sessionFixture({ saveError: async (next, { generation }) => {
        if (generation) throw Object.assign(new Error('fenced'), { code: 'CHAT_GENERATION_FENCED', status: 409 });
    } });
    await f.open(); assert.equal(await f.session.send('new user'), false);
    assert.equal(f.saves.filter(save => save.options.generation).length, 1);
    assert.equal(f.saves.at(-1).options.generation.state, 'settled');
    assert.equal(f.states.at(-1).conflict, true);
    assert.match(await f.session.copyRejected(), /new assistant/);
    assert.equal(f.context.chat.at(-1).extra.finish_reason, 'stop');
});

test('Go nested Helper insert is ordinary, excludes generated output, then fences parent terminal', async () => {
    let inserted = false;
    const f = sessionFixture({ saveError: async (next, { generation }) => {
        if (!generation && next.messages.some(message => message.mes === 'helper insert')) inserted = true;
        if (generation && inserted) throw Object.assign(new Error('fenced'), { code: 'CHAT_GENERATION_FENCED', status: 409 });
    } });
    await f.open();
    f.context.eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        assert.equal(await f.context.mutateChatMessages(f.context.chatMetadata, messages => {
            messages.splice(1, 0, { name: 'helper', is_user: true, mes: 'helper insert', extra: {} });
        }, { structural: true, refresh: [] }), true);
    });
    assert.equal(await f.session.send('new user'), false);
    const ordinary = f.saves.find(save => !save.options.generation && save.next.messages.some(message => message.mes === 'helper insert'));
    assert.ok(ordinary); assert.equal(ordinary.next.messages.some(message => message.mes === 'new assistant'), false);
    assert.equal(f.saves.filter(save => save.options.generation).length, 1);
    assert.match(await f.session.copyRejected(), /new assistant/);
});

test('Go recent reads keyset summaries and resource-only cards without old chat routes', async () => {
    const calls = [];
    const client = createDesktopClient({ document: doc, fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url === '/csrf-token') return json({ token: 'st' });
        if (url.startsWith('/auth/')) return json({ accountId: '1', sessionId: '2', chatStorage: { mode: 'GO', authorityEpoch: '8' } });
        if (url === '/api/characters/all' || url === '/api/characters/get') {
            assert.equal(JSON.parse(options.body).vc_resource_only, true);
            return json([{ avatar: 'synthetic.png', data: { extensions: { vc_character_ref: 'synthetic-ref' } } }]);
        }
        assert.match(url, /\/go\/api\/v1\/chats\?/);
        const second = url.includes('cursor=');
        return json({ authorityEpoch: '8', nextCursor: second ? null : 'next', items: [
            { chatId: id(second ? 902 : 901), characterRef: 'synthetic-ref', relationshipId: '1', conversationId: '2', messageCount: 4, updatedAt: '2026-11-07T00:00:00Z', chatRevision: '3' },
        ] });
    } });
    await client.initialize(); const rows = await client.recent();
    assert.equal(rows.length, 2); assert.equal(rows[0].file_id, id(901));
    assert.equal(rows[0].avatar, 'synthetic.png'); assert.equal(rows[0].chat_metadata.vc_binding.relationshipId, '1');
    await client.request('/api/characters/get', { avatar_url: 'synthetic.png' });
    assert.equal(calls.some(call => call.url.startsWith('/api/chats')), false);
});

test('append ACK writes canonical candidate mapping into live message and a second save is a no-op', async () => {
    const f = fixture({ onWrite: async (body, { chat }) => {
        const inserted = body.operations.find(operation => operation.kind === 'append').payload.messages[0];
        const added = row(7, inserted.data.mes);
        added.messageId = added.data.vc_message_id = inserted.clientMessageId;
        return ack(chat, [added]);
    } });
    const next = nextOf(await f.store.loadFull());
    next.messages.push({ name: 'synthetic', is_user: true, mes: 'new user', extra: {} });
    await f.store.save(next);
    assert.equal(next.messages.at(-1).extra.vc_source.id, id(107));
    assert.equal(next.messages.at(-1).swipe_info[0].extra.vc_source.id, id(107));
    await f.store.save(next);
    assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
});

test('metadata and header ACK do not raise an unsubmitted field baseline', async () => {
    const entered = deferred(), finish = deferred();
    const f = fixture({ onWrite: async (body, { chat }) => {
        entered.resolve(); await finish.promise;
        return { ...ack(chat, []), metadataRevision: '2', chat: { ...chat, metadataRevision: '2', chatRevision: '2',
            header: { ...chat.header, serverField: true }, metadata: { sent: 1, concurrent: 'server' } } };
    } });
    const next = nextOf(await f.store.loadFull());
    next.metadata.sent = 1; const pending = f.store.save(next); await entered.promise;
    next.metadata.concurrent = 'local'; finish.resolve(); await pending;
    assert.equal(next.header.serverField, true);
    assert.equal(next.metadata.concurrent, 'local');
    assert.equal(Object.hasOwn(f.store.snapshot().chat.metadata, 'concurrent'), false);
    await assert.rejects(f.store.sync(next), { code: 'REVISION_CONFLICT' });
});

test('failed write latches the store and queued saves never replay an unknown outcome', async () => {
    const f = fixture({ onWrite: async () => { throw Object.assign(new Error('offline'), { status: 503 }); } });
    const next = nextOf(await f.store.loadFull()); next.messages[0].mes = 'edit';
    const first = f.store.save(next), second = f.store.save(next);
    await assert.rejects(first, { status: 503 }); await assert.rejects(second, { status: 503 });
    assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
});

test('continue scopes to saved assistant candidate; swipe scopes to its preceding user', async () => {
    const continued = sessionFixture(); await continued.open();
    assert.equal(await continued.session.continue(), true);
    assert.equal(continued.generations[0].inputMessageId, id(2));
    assert.equal(continued.generations[0].inputCandidateId, id(102));
    const swiped = sessionFixture(); await swiped.open();
    assert.equal(await swiped.session.swipe(1, 1), true);
    assert.equal(swiped.generations[0].inputMessageId, id(1));
    assert.deepEqual(swiped.context.chat.at(-1).swipe_info[0].unknownWrapper, { keep: true });
});

test('stop during callbacks snapshots the already received text and defers script save to terminal', async () => {
    const entered = deferred(), finish = deferred();
    const f = sessionFixture(); await f.open();
    f.context.eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        await f.context.saveChat();
        entered.resolve(); await finish.promise;
        f.context.chat.at(-1).mes = 'late callback';
    });
    const pending = f.session.send('new user'); await entered.promise;
    assert.equal(f.saves.some(save => save.next.messages.some(message => message.mes === 'new assistant')), false);
    const stopping = f.session.stop(); finish.resolve(); await stopping; await pending;
    assert.equal(f.saves.at(-1).options.generation.state, 'aborted');
    assert.equal(f.saves.at(-1).next.messages.at(-1).mes, 'new assistant');
});

test('unsettled source callbacks cannot publish a settled Go candidate', async () => {
    const f = sessionFixture(); await f.open();
    f.context.eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        const guard = globalThis[Symbol.for('virtual-companion.f2-source')];
        guard.begin(f.context.chat.length - 1)(false);
    });
    assert.equal(await f.session.send('new user'), false);
    assert.equal(f.saves.at(-1).options.generation.state, 'aborted');
    assert.equal(f.saves.at(-1).next.messages.at(-1).extra.no_memory, true);
});

test('unchanged generation reconciliation preserves active card metadata and does not replay scripts', async () => {
    const f = sessionFixture(); let opens = 0, closes = 0, activeMetadata;
    f.engine.cards = { settle: async () => {}, closeScripts: async () => { closes++; },
        open: async () => { opens++; activeMetadata = f.context.chatMetadata; },
        surface: { refresh: async () => assert.equal(f.context.chatMetadata, activeMetadata) } };
    await f.open(); const metadata = f.context.chatMetadata, message = f.context.chat[0], messages = f.context.chat;
    assert.equal(await f.session.send('new user'), true);
    assert.equal(f.context.chatMetadata, metadata); assert.equal(f.context.chat[0], message); assert.equal(f.context.chat, messages);
    assert.equal(opens, 1); assert.equal(closes, 1);
});

test('remote changes invalidate old metadata and reopen cards once before the next generation', async () => {
    const f = sessionFixture(); let opens = 0, closes = 0, activeMetadata;
    f.engine.cards = { settle: async () => {}, closeScripts: async () => { closes++; },
        open: async () => { opens++; activeMetadata = f.context.chatMetadata; },
        surface: { refresh: async () => assert.equal(f.context.chatMetadata, activeMetadata) } };
    await f.open(); const metadata = f.context.chatMetadata;
    const sync = f.store.sync; let remote = true;
    f.store.sync = async (...args) => {
        const full = await sync(...args);
        if (remote) { full.chat.metadata.remote = 'change'; remote = false; }
        return full;
    };
    assert.equal(await f.session.send('new user'), true);
    assert.notEqual(f.context.chatMetadata, metadata); assert.equal(f.context.chatMetadata.remote, 'change');
    assert.equal(opens, 2); assert.equal(closes, 2);
});

test('local edits made while changes reconciliation is in flight keep their old baseline', async () => {
    const entered = deferred(), resume = deferred(); let paused = false;
    const f = fixture({ onRead: async path => {
        if (paused && path.includes('/changes?')) { entered.resolve(); await resume.promise; }
    } });
    const next = nextOf(await f.store.loadFull()); paused = true;
    const pending = f.store.sync(next); await entered.promise;
    next.messages[0].name = 'local during read'; resume.resolve();
    await assert.rejects(pending, { code: 'REVISION_CONFLICT' });
    assert.equal(next.messages[0].name, 'local during read');
    assert.equal(f.store.snapshot().messages[0].data.name, 'synthetic');
});

test('list cancellation after an ignored abort response stops before requesting the next page', async () => {
    const controller = new AbortController(), entered = deferred(), resume = deferred(); let lists = 0;
    const client = createDesktopClient({ document: doc, fetchImpl: async url => {
        if (url === '/csrf-token') return json({ token: 'st' });
        if (url.startsWith('/auth/')) return json({ accountId: '1', sessionId: '2', chatStorage: { mode: 'GO', authorityEpoch: '8' } });
        lists++; entered.resolve(); await resume.promise;
        return json({ authorityEpoch: '8', items: [], nextCursor: 'next' });
    } });
    await client.initialize(); const pending = client.listStoredChats({ signal: controller.signal });
    await entered.promise; controller.abort(); resume.resolve();
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal(lists, 1);
});

test('ACK retains preconditions for a message deleted locally while its edit is pending', async () => {
    const entered = deferred(), resume = deferred();
    const f = fixture({ onWrite: async (body, { chat }) => {
        entered.resolve(); await resume.promise;
        const changed = row(1); changed.messageRevision = '3'; changed.data.name = 'remote edit';
        return { ...ack(chat, [changed]), orderRevision: '2' };
    } });
    const next = nextOf(await f.store.loadFull()); next.messages[0].name = 'submitted';
    const pending = f.store.save(next); await entered.promise; next.messages.splice(0, 1); resume.resolve(); await pending;
    assert.equal(next.messages.length, 0); assert.equal(f.store.snapshot().messages[0].messageRevision, '1');
    assert.equal(f.store.snapshot().chat.orderRevision, '1');
});

test('empty Go chat allows text-only generate/generateRaw without any ChatStore operation or generation run', async () => {
    const f = sessionFixture({ initialMessages: [] }); await f.open();
    for (const name of ['save', 'sync', 'snapshot', 'generation']) {
        f.store[name] = () => { assert.fail('text-only Helper must not access ChatStore.' + name); };
    }
    for (const api of ['generate', 'generateRaw']) {
        assert.equal(await f.context.generateHelper(api, { user_input: 'synthetic prompt' }), 'helper');
    }
    assert.deepEqual(f.helperScopes, [undefined, undefined]);
    assert.equal(f.context.chat.length, 0); assert.equal(f.saves.length, 0);
});

test('Go opening assistant is saved before continue uses its real message and candidate as input', async () => {
    const f = sessionFixture({ initialMessages: [], firstMessage: () => ({
        name: 'synthetic', is_user: false, mes: 'opening assistant', swipes: ['opening assistant'], swipe_id: 0, extra: {},
    }) });
    await f.open();
    assert.equal(f.saves.length, 1); assert.equal(f.saves[0].options.generation, undefined);
    const opening = f.store.snapshot().messages[0];
    assert.equal(opening.data.mes, 'opening assistant');
    assert.equal(await f.session.continue(), true);
    assert.equal(f.generations[0].inputMessageId, opening.messageId);
    assert.equal(f.generations[0].inputCandidateId, opening.selectedCandidateId);
    assert.equal(f.saves.at(-1).options.generation.state, 'settled');
});

test('generated commit against an empty saved history is rejected before mutating the result draft', async () => {
    const f = fixture({ initialMessages: [], onWrite: () => { assert.fail('empty-input generated commit must not be sent'); } });
    const next = nextOf(await f.store.loadFull());
    next.messages.push({ name: 'synthetic', is_user: false, mes: 'generated result draft', extra: {} });
    const draft = structuredClone(next);
    await assert.rejects(f.store.save(next, { generation: { generationRunId: id(990), state: 'settled' } }), { code: 'CHAT_GENERATION_FENCED' });
    assert.deepEqual(next, draft);
    assert.equal(f.requests.some(request => request.method === 'POST'), false);
});

test('missing generation scope retains the Session result snapshot and never falls back to ordinary save', async () => {
    const f = sessionFixture(); await f.open();
    f.store.generation = () => undefined;
    assert.equal(await f.session.send('new user'), false);
    assert.equal(f.states.at(-1).conflict, true);
    assert.match(await f.session.copyRejected(), /new assistant/);
    assert.equal(f.saves.some(save => save.next.messages.some(message => message.mes === 'new assistant')), false);
});
