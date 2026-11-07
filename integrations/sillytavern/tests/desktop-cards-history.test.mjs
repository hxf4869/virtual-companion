import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { Window } from 'happy-dom';

const sourceIdentityUrl = new URL('../server-plugin/virtual-companion/lib/source-identity.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === '/scripts/vc-runtime/source-identity.js') return { url: sourceIdentityUrl, shortCircuit: true };
    return nextResolve(specifier, context);
} });

const browser = new Window({ url: 'http://localhost/desktop/' });
const jquery = Object.assign(() => ({ on() {}, off() {}, triggerHandler() {} }), { ui: {} });
Object.assign(globalThis, {
    self: globalThis, window: browser, document: browser.document, location: browser.location,
    localStorage: browser.localStorage, Node: browser.Node, Element: browser.Element,
    HTMLElement: browser.HTMLElement, NodeFilter: browser.NodeFilter, DOMParser: browser.DOMParser,
    MutationObserver: browser.MutationObserver, $: jquery, jQuery: jquery,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    Event: browser.Event, CustomEvent: browser.CustomEvent, requestAnimationFrame: cb => setTimeout(cb, 0),
    toastr: { info() {}, warning() {}, error() {}, success() {} },
    fetch: async () => Response.json({ pkgVersion: '1.13.0' }),
});
test.after(() => browser.happyDOM.close());

const base = '../extension/vc-model-settings/desktop/standalone/';
const { bindEngineContext, event_types } = await import(base + 'engine/ports.js');
const { EventEmitter } = await import(base + 'engine/events.js');
const { openaiDefaults, powerUserDefaults } = await import(base + 'engine/defaults.js');
const { initializeCards } = await import(base + 'cards/index.js');
const { enterTemplateScope } = await import(base + 'cards/ejs-host.js');
const { createDesktopClient } = await import(base + 'client.js');
const predefineSource = readFileSync(new URL(base + 'cards/predefine.js', import.meta.url), 'utf8');

const epoch = '9007199254740993';
const ids = ['1593eac1-7c91-4f03-83ca-be28dca58d01', '1593eac1-7c91-4f03-83ca-be28dca58d02'];
const groupId = '1593eac1-7c91-4f03-83ca-be28dca58d03';
const ref = 'synthetic-card';
const avatar = 'synthetic.png';
const api = '/api/plugins/virtual-companion/go/api/v1/chats';

async function startCards(t, client, name = 'Synthetic', signal) {
    const card = { name, avatar, data: { name, extensions: { vc_character_ref: ref } } };
    const context = {
        characters: [card], characterId: 0, chatId: 'active', name1: 'User', name2: name, chat: [],
        chatMetadata: {}, extensionPrompts: {}, eventSource: new EventEmitter(), eventTypes: event_types,
    };
    const settings = {
        oai_settings: structuredClone(openaiDefaults), power_user: structuredClone(powerUserDefaults),
        extension_settings: { tavern_helper: { script: { enabled: { characters: [avatar] } } } },
    };
    bindEngineContext(context, settings, {});
    const cards = await initializeCards({ context, settings, client, signal, models: [], presets: {}, packet: {} });
    t.after(() => cards.destroy());
    await cards.open();
    return { cards, context, helper: globalThis.TavernHelper, card };
}

function startFrame(t) {
    const frame = document.createElement('iframe');
    frame.id = 'TH-message--0--0';
    document.body.append(frame);
    t.after(() => frame.remove());
    const win = { parent: globalThis, frameElement: frame };
    win.window = win;
    new Function('window', '$', '_', 'with (window) {\n' + predefineSource + '\n}')(win, jquery, globalThis._);
    return { frame, win };
}

function goRecord(chatId) {
    return {
        chatId, authorityEpoch: epoch, kind: chatId === groupId ? 'GROUP' : 'SINGLE', characterRef: ref,
        chatRevision: '4', metadataRevision: '1', orderRevision: '1', branchRoot: chatId,
        updatedAt: chatId === ids[0] ? '2026-11-07T09:00:00Z' : '2026-11-07T08:00:00Z',
        title: 'Synthetic title',
        messageCount: 4, header: { name: 'header' }, metadata: {},
    };
}

test('GO Helper traverses both index pages and all message pages without a legacy chat request', async t => {
    const indexPages = [], pages = [];
    const unloadedAvatar = 'unloaded.png';
    const unloadedRef = 'unloaded-character';
    let concurrent = 0, maxConcurrent = 0;
    const client = createDesktopClient({
        document: { querySelector: () => ({ content: '1' }) },
        fetchImpl: async (input, options) => {
            const { pathname, searchParams: query } = new URL(input, 'http://localhost');
            if (pathname === '/csrf-token') return Response.json({ token: 'synthetic' });
            if (pathname === '/auth/api/session') {
                return Response.json({ accountId: '1', sessionId: '1', chatStorage: { mode: 'GO', authorityEpoch: epoch } });
            }
            if (pathname === '/api/characters/get') {
                assert.deepEqual(JSON.parse(options.body), { avatar_url: unloadedAvatar, vc_resource_only: true });
                return Response.json({ data: { extensions: { vc_character_ref: unloadedRef } } });
            }
            assert.ok(pathname.startsWith(api), 'legacy chat endpoints must not be called');
            assert.equal(options.method, 'GET');
            assert.ok(options.signal instanceof AbortSignal);
            if (pathname === api) {
                if (query.get('characterRef') === unloadedRef) {
                    return Response.json({ items: [], nextCursor: null, authorityEpoch: epoch });
                }
                assert.equal(query.get('characterRef'), ref);
                const cursor = query.get('cursor');
                indexPages.push(cursor);
                return Response.json(cursor ? { items: [goRecord(ids[1])], nextCursor: null, authorityEpoch: epoch }
                    : { items: [goRecord(ids[0])], nextCursor: 'opaque+page/2', authorityEpoch: epoch });
            }
            const [id, route] = pathname.slice(api.length + 1).split('/');
            const chat = goRecord(id);
            if (!route) return Response.json(chat);
            if (route === 'changes') {
                return Response.json({ chatId: id, authorityEpoch: epoch, items: [], hasMore: false, currentRevision: '4', throughRevision: '4' });
            }
            assert.equal(route, 'messages');
            assert.equal(query.get('view'), 'full');
            const old = query.get('before') === 'older';
            pages.push([id, old]);
            maxConcurrent = Math.max(maxConcurrent, ++concurrent);
            await new Promise(resolve => setImmediate(resolve));
            concurrent--;
            return Response.json({
                chatId: id, authorityEpoch: epoch, chatRevision: '4', metadataRevision: '1', orderRevision: '1',
                beforeCursor: old ? null : 'older', afterCursor: old ? 'middle' : 'tail', hasOlder: !old, hasNewer: old,
                ...(query.get('include') ? { chat } : {}),
                items: (old ? [1, 2] : [3, 4]).map(n => ({
                    messageId: id + '-' + n, messageRevision: '1', view: 'full', candidates: [],
                    data: { mes: 'line ' + n, swipes: ['candidate ' + n], extra: { synthetic: n } },
                })),
            });
        },
    });
    await client.initialize();
    const { helper } = await startCards(t, client);
    const rawBrief = await helper.RawCharacter.getChatsFromFiles(avatar);
    assert.deepEqual(Object.values(rawBrief).map(row => row.file_name).sort(), ids.map(id => id + '.jsonl'));
    const brief = await helper.getChatHistoryBrief();
    assert.deepEqual(indexPages, [null, 'opaque+page/2', null, 'opaque+page/2']);
    assert.deepEqual(brief.map(row => row.file_name), ids.map(id => id + '.jsonl'));
    assert.ok(brief.every(row => row.avatar_url === avatar && row.ch_name === 'Synthetic' && row.chat_items === 4));
    const detail = await helper.getChatHistoryDetail('current');
    assert.deepEqual(Object.keys(detail), ids.map(id => id + '.jsonl'));
    for (const id of ids) {
        const messages = detail[id + '.jsonl'];
        assert.deepEqual(messages.map(message => message.mes), ['line 1', 'line 2', 'line 3', 'line 4']);
        assert.deepEqual(messages[0], { mes: 'line 1', swipes: ['candidate 1'], extra: { synthetic: 1 }, vc_message_id: id + '-1' });
    }
    assert.deepEqual(pages.filter(([id]) => ids.includes(id)).sort(), ids.flatMap(id => [[id, false], [id, true]]));
    assert.ok(maxConcurrent <= 2);
    const group = await helper.RawCharacter.getChatsFromFiles([{ file_name: groupId }], true);
    assert.equal(group[groupId].length, 4);
    assert.equal(group[groupId][0].mes, 'line 1');
    assert.deepEqual(await helper.RawCharacter.getChatsFromFiles(unloadedAvatar), []);
});

test('ST retains summary fields and single/group payloads, FROZEN and unknown authority perform zero reads', async t => {
    const calls = [];
    const summary = [{ file_name: 'history - z.jsonl', custom: true }, { file_name: 'history - a.jsonl' }];
    let mode = 'ST', denyLegacy = false, refreshes = 0;
    const { helper } = await startCards(t, {
        getChatStorage() {
            if (!mode) throw new Error('聊天存储暂时不可用');
            return { mode, authorityEpoch: epoch };
        },
        async refreshChatStorage() {
            refreshes++;
            mode = 'FROZEN';
        },
        request: async (url, body, { signal } = {}) => {
            calls.push([url, body]);
            assert.ok(signal instanceof AbortSignal);
            if (denyLegacy) throw Object.assign(new Error('synthetic authority change'), { code: 'CHAT_AUTHORITY_CHANGED' });
            if (url === '/api/characters/chats') return summary;
            return url === '/api/chats/group/get' ? [{ mes: 'group' }] : [{ metadata: {} }, { mes: 'single' }];
        },
        chatRequest: async () => assert.fail('unexpected Go read'),
    });
    const brief = await helper.getChatHistoryBrief();
    assert.deepEqual(brief, summary.map(row => ({ ...row, avatar_url: avatar, ch_name: 'Synthetic' })));
    assert.deepEqual(await helper.getChatHistoryDetail(brief), {
        'history - z.jsonl': [{ mes: 'single' }], 'history - a.jsonl': [{ mes: 'single' }],
    });
    assert.deepEqual(await helper.getChatHistoryDetail([{ file_name: 'group.jsonl' }], true), { 'group.jsonl': [{ mes: 'group' }] });
    assert.deepEqual(calls, [
        ['/api/characters/chats', { avatar_url: avatar }],
        ...['z', 'a'].map(suffix => ['/api/chats/get', { ch_name: 'Synthetic', avatar_url: avatar, file_name: 'history - ' + suffix }]),
        ['/api/chats/group/get', { id: 'group.jsonl' }],
    ]);
    calls.length = 0;
    mode = 'FROZEN';
    await assert.rejects(helper.getChatHistoryBrief(), /正在迁移/);
    await assert.rejects(helper.getChatHistoryDetail(brief), /正在迁移/);
    await assert.rejects(helper.RawCharacter.getChatsFromFiles(avatar), /正在迁移/);
    mode = null;
    await assert.rejects(helper.getChatHistoryBrief(), /暂时不可用/);
    assert.deepEqual(calls, []);

    mode = 'ST';
    denyLegacy = true;
    await assert.rejects(helper.getChatHistoryDetail(), /正在迁移/);
    assert.equal(refreshes, 1);
    assert.deepEqual(calls, [['/api/characters/chats', { avatar_url: avatar }]]);
});

test('an old iframe or released template retains its own RawCharacter class and discards late reads', async t => {
    const requests = [];
    const client = {
        getChatStorage: () => ({ mode: 'ST', authorityEpoch: epoch }),
        request(url, body, options) {
            const pending = Promise.withResolvers();
            requests.push({ ...pending, signal: options?.signal });
            return pending.promise;
        },
    };
    const first = await startCards(t, client, 'First');
    const { win } = startFrame(t);
    const template = enterTemplateScope({ RawCharacter: first.helper.RawCharacter });
    const frameClass = win.RawCharacter;
    const templateClass = template.data.RawCharacter;
    assert.equal(frameClass, win.TavernHelper.RawCharacter);
    for (const Raw of [frameClass, templateClass]) {
        assert.ok(Raw.find() instanceof Raw);
        assert.equal(Raw.findIndex(), 0);
        assert.equal(new Raw(first.card).getCardData(), first.card);
    }
    const late = frameClass.getChatsFromFiles(avatar);
    assert.equal(requests.length, 1);
    const rejection = assert.rejects(late, /失效|VC_STALE_CARD_RUNTIME/);
    await first.cards.closeScripts();
    first.context.chatMetadata = {};
    await first.cards.open();
    assert.equal(requests[0].signal.aborted, true);
    requests[0].resolve([{ file_name: 'late.jsonl' }]);
    await rejection;
    assert.throws(() => frameClass.find(), /失效|VC_STALE_CARD_RUNTIME/);
    await assert.rejects(frameClass.getChatsFromFiles(avatar), /失效|VC_STALE_CARD_RUNTIME/);
    template.release();
    assert.throws(() => templateClass.findIndex(), /失效/);
    const pendingTemplate = enterTemplateScope({});
    const lateTemplate = pendingTemplate.data.TavernHelper.getChatHistoryDetail();
    const templateRejection = assert.rejects(lateTemplate, /失效/);
    pendingTemplate.release();
    assert.equal(requests[1].signal.aborted, true);
    requests[1].resolve([{ file_name: 'late-template.jsonl' }]);
    await templateRejection;

    const lateOwner = first.helper.getChatHistoryDetail();
    const ownerRejection = assert.rejects(lateOwner, /失效|VC_STALE_CARD_RUNTIME/);
    const second = await startCards(t, { request: () => assert.fail('old scopes must never call the new owner') }, 'Second');
    assert.equal(requests[2].signal.aborted, true);
    requests[2].resolve([{ file_name: 'late-owner.jsonl' }]);
    await ownerRejection;
    assert.equal(second.helper.RawCharacter.find().name, 'Second');
    await assert.rejects(templateClass.getChatsFromFiles(avatar), /失效/);
    await assert.rejects(first.helper.RawCharacter.getChatsFromFiles(avatar), /失效|VC_STALE_CARD_RUNTIME/);
    await assert.rejects(first.helper.getChatHistoryBrief(), /失效|VC_STALE_CARD_RUNTIME/);
    assert.equal(requests.length, 3);
});
