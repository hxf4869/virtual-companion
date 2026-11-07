import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeChatBridge, NATIVE_CHAT_TIMEOUT_MS } from '../server-plugin/virtual-companion/lib/native-chat-bridge.js';
import { createF2Client } from '../extension/vc-model-settings/f2-logic.js';

const id = '1593eac1-7c91-4f03-83ca-be28dca58d01';
const messageId = '1593eac1-7c91-4f03-83ca-be28dca58d02';
const candidateId = '1593eac1-7c91-4f03-83ca-be28dca58d03';
const requestId = '1593eac1-7c91-4f03-83ca-be28dca58d04';
const scope = { kind: 'SINGLE', characterRef: 'synthetic-card' };
const epoch = '9007199254740993';
const config = { goBaseUrl: 'http://synthetic.invalid', serviceToken: 'synthetic-service-secret', timeoutMs: 1 };
const token = revision => ({ id, revision });
const document = (revision = 4) => [{ chat_metadata: { vc_f2: token(revision), vc_binding: { relationshipId: '999' } } },
    { mes: 'synthetic', extension: { keep: true }, swipes: ['synthetic', 'alternate'], swipe_id: 0 }];
const canonical = (revision = 5) => [{ chat_metadata: { vc_f2: token(revision), vc_binding: { relationshipId: '7' }, vc_branch_root: id } },
    { ...document()[1], vc_message_id: messageId, extra: { vc_source: { id: candidateId, revision: 1, generation: 1 } },
        swipe_info: [{ extra: { vc_source: { id: candidateId, revision: 1, generation: 1 } } },
            { extra: { vc_source: { id: requestId, revision: 1, generation: 1 } } }] }];
const mapping = [{ messageIndex: 0, inputMessageId: null, messageId, candidates: [candidateId, requestId].map((id, i) =>
    ({ candidateIndex: i, inputCandidateId: null, candidateId: id, sourceRevision: '1', sourceGeneration: '1' })) }];
const summary = (revision = '5') => ({ chatId: id, ...scope, authorityEpoch: epoch, chatRevision: revision,
    fileName: 'renamed.jsonl', fileAliases: ['old.jsonl'], messageCount: 1, updatedAt: '2026-11-07T00:00:00Z' });
function ndjson(records = canonical(), headers = {}) {
    const body = records.map(row => JSON.stringify(row)).join('\n') + '\n';
    return new Response(body, { headers: { 'content-type': 'application/x-ndjson', 'content-length': String(Buffer.byteLength(body)),
        'x-chat-id': id, 'x-chat-revision': String(records[0].chat_metadata.vc_f2.revision), 'x-chat-authority-epoch': epoch, ...headers } });
}
function request(path, body = {}) {
    return { method: 'POST', path, headers: {}, body, vcIdentity: { accountId: '1', sessionId: '2', handle: 'synthetic' },
        vcChatStorage: { mode: 'GO', authorityEpoch: epoch } };
}
function response() {
    return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        status(n) { this.statusCode = n; return this; }, json(value) { this.value = value; return this; },
        send(text) { this.text = text; this.value = JSON.parse(text); return this; } };
}
async function invoke(bridge, req) { const res = response(); let next = false; await bridge(req, res, () => { next = true; }); return { res, next }; }
const setup = fetchImpl => createNativeChatBridge({ config, fetchImpl, resolveScope: async () => ({ scope, mode: 'COMPANION' }) });
async function upload(init) { const chunks = []; for await (const chunk of init.body) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString(); }

test('authentication/FROZEN/stale epoch/missing stable request id fail before scope resolution or Go writes', async () => {
    let resolutions = 0, calls = 0;
    const bridge = createNativeChatBridge({ config, fetchImpl: async () => { calls++; assert.fail(); }, resolveScope: async () => { resolutions++; return { scope }; } });
    const absent = request('/api/chats/save'); delete absent.vcIdentity;
    assert.equal((await invoke(bridge, absent)).res.statusCode, 401);
    const frozen = request('/api/chats/save'); frozen.vcChatStorage.mode = 'FROZEN';
    assert.equal((await invoke(bridge, frozen)).res.value.code, 'CHAT_AUTHORITY_CHANGED');
    const stale = request('/api/chats/save', { vc_authority_epoch: '1' });
    assert.equal((await invoke(bridge, stale)).res.value.code, 'CHAT_AUTHORITY_CHANGED');
    assert.equal(resolutions, 0);
    const noId = request('/api/chats/save', { vc_authority_epoch: epoch, chat: document(), file_name: 'old' });
    assert.equal((await invoke(bridge, noId)).res.statusCode, 400);
    assert.equal(calls, 0);
});

test('only pure supported chat routes are adapted; ST passes through', async () => {
    const bridge = setup(() => assert.fail('must not call Go'));
    for (const path of ['/api/characters/rename', '/api/groups/delete', '/api/data-maid/delete', '/api/chats/import']) {
        assert.equal((await invoke(bridge, request(path))).next, true);
    }
    const req = request('/api/chats/get'); req.vcChatStorage.mode = 'ST';
    assert.equal((await invoke(bridge, req)).next, true);
});

test('legacy export uses the prepared current JSONL and preserves raw large integers', async () => {
    const chat = canonical();
    const raw = chat.map(row => JSON.stringify(row)).join('\n') + '\n';
    const body = raw.replace('"chat_metadata":', '"huge":900719925474099312345,"chat_metadata":');
    const bridge = setup(async () => new Response(body, { headers: {
        'content-length': String(Buffer.byteLength(body)), 'x-chat-id': id, 'x-chat-revision': '5', 'x-chat-authority-epoch': epoch,
    } }));
    const { res, next } = await invoke(bridge, request('/api/chats/export', { file: 'old.jsonl', format: 'jsonl', exportfilename: 'synthetic.jsonl' }));
    assert.equal(next, false); assert.equal(res.statusCode, 200);
    assert.equal(res.value.result, body);
    assert.equal(res.value.message, 'Chat saved to synthetic.jsonl');
    const text = await invoke(setup(async () => ndjson()), request('/api/chats/export', { file: 'old.jsonl', format: 'txt', exportfilename: 'synthetic.txt' }));
    assert.equal(text.res.value.result, 'undefined: synthetic\n\n');
});

test('read uses trusted owner/scope, full UTF8 JSONL and exact ID/revision/epoch/content length', async () => {
    const bridge = setup(async (url, init) => {
        assert.equal(url, config.goBaseUrl + '/api/v1/service/chats/native/read');
        assert.deepEqual(JSON.parse(init.body), { ownerAccountId: '1', scope, authorityEpoch: epoch, fileName: 'old.jsonl' });
        assert.equal(init.headers.Authorization, 'Bearer ' + config.serviceToken);
        assert.equal(init.headers.Origin, undefined); assert.equal(init.headers.Cookie, undefined);
        assert.equal(NATIVE_CHAT_TIMEOUT_MS, 150_000);
        await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(init.signal.aborted, false);
        return ndjson();
    });
    const { res } = await invoke(bridge, request('/API/chats//get/', { file_name: 'old', ownerAccountId: '999', vc_binding: { characterRef: 'foreign' } }));
    assert.equal(res.statusCode, 200); assert.equal(res.value[1].swipes[1], 'alternate');
    assert.equal(res.value[0].chat_metadata.vc_authority_epoch, undefined);
    for (const headers of [{ 'content-length': '1' }, { 'content-length': '999999' }, { 'x-chat-authority-epoch': '8' }, { 'x-chat-revision': '6' }, { 'x-chat-id': 'bad' }]) {
        assert.equal((await invoke(setup(async () => ndjson(canonical(), headers)), request('/api/chats/get', { file_name: 'old' }))).res.statusCode, 502);
    }
    for (const file_name of ['../old', '/old', 'x\\old', '\u0000old', 'CON']) {
        assert.equal((await invoke(setup(() => assert.fail()), request('/api/chats/get', { file_name }))).res.statusCode, 400);
    }
});

test('whole-save/create/fork use multipart exact snapshot, fixed request ID, same-ID/+1 and canonical readback', async () => {
    for (const [rev, parent, action] of [[4, false, 'save'], [0, false, 'create'], [0, true, 'fork']]) {
        const calls = [], chat = document(rev), next = canonical(rev + 1);
        if (parent) chat[0].chat_metadata.vc_f2_parent = { id: candidateId, revision: 8 };
        const bridge = setup(async (url, init) => {
            calls.push(url);
            if (url.endsWith('/read')) return ndjson(next);
            assert.ok(url.endsWith('/' + action));
            const text = await upload(init);
            for (const expected of ['name="file"', 'name="requestId"\r\n\r\n' + requestId, 'name="ownerAccountId"\r\n\r\n1', JSON.stringify(chat[1])]) assert.ok(text.includes(expected), expected);
            assert.equal(text.includes('name="ownerAccountId"\r\n\r\n999'), false);
            if (action === 'fork') assert.ok(text.includes('name="parentRevision"\r\n\r\n8'));
            if (action === 'create') assert.ok(text.includes('name="mode"\r\n\r\nCOMPANION'));
            return Response.json({ requestId, chat: summary(String(rev + 1)), identityMapping: mapping });
        });
        const req = request('/api/chats/save', { chat, file_name: 'old', ownerAccountId: '999', vc_request_id: requestId, vc_authority_epoch: epoch });
        const { res } = await invoke(bridge, req);
        assert.equal(res.statusCode, 200); assert.deepEqual(res.value.vc_f2, token(rev + 1));
        assert.equal(res.value.chat[1].vc_message_id, messageId); assert.equal(res.value.chat[0].chat_metadata.vc_binding.relationshipId, '7');
        assert.equal(calls.length, 2);
    }
});

test('invalid ACK identity/revision/mapping fails without false success; canonical read conflict remains conflict', async () => {
    const req = request('/api/chats/save', { chat: document(), file_name: 'old', vc_request_id: requestId, vc_authority_epoch: epoch });
    for (const chat of [{ ...summary(), chatId: candidateId }, summary('6'), summary('9007199254740992')]) {
        const { res } = await invoke(setup(async () => Response.json({ requestId, chat, identityMapping: mapping })), req);
        assert.ok(res.statusCode >= 400);
    }
    const { res } = await invoke(setup(async url => url.endsWith('/read')
        ? Response.json({ code: 'REVISION_CONFLICT' }, { status: 409 })
        : Response.json({ requestId, chat: summary(), identityMapping: mapping })), req);
    assert.equal(res.statusCode, 409); assert.equal(res.value.code, 'REVISION_CONFLICT');
});

test('unrelated tail 409 propagates original Go error once; existing F2 keeps serialized draft and blocks blind retry', async () => {
    let calls = 0; const drafts = [];
    const original = { error: { code: 'REVISION_CONFLICT', message: 'synthetic tail conflict' } };
    const bridge = setup(async () => { calls++; return Response.json(original, { status: 409, headers: { 'Retry-After': '1' } }); });
    const f2 = createF2Client({ uuid: () => requestId, getAuthorityEpoch: () => epoch, onConflict: (raw, error) => drafts.push({ raw, error }) });
    const metadata = { vc_f2: token(4) }; f2.loaded('old', metadata);
    const send = async raw => {
        const { res } = await invoke(bridge, request('/api/chats/save', { ...JSON.parse(raw), file_name: 'old' }));
        assert.equal(res.headers['retry-after'], '1'); assert.deepEqual(res.value, original);
        return Response.json(res.value, { status: res.statusCode });
    };
    const payload = { file_name: 'old', chat: document() };
    await assert.rejects(f2.save('old', payload, { live: true, send }), { code: 'REVISION_CONFLICT' });
    assert.equal(calls, 1); assert.equal(JSON.parse(drafts[0].raw).chat[1].mes, 'synthetic');
    assert.equal(JSON.parse(drafts[0].raw).vc_request_id, requestId); assert.equal(JSON.parse(drafts[0].raw).vc_authority_epoch, epoch);
    await assert.rejects(f2.save('old', payload, { live: true, send }), { code: 'VC_STALE_SOURCE' });
    assert.equal(calls, 1); assert.deepEqual(metadata.vc_f2, token(4));
});

test('rename/delete use typed observed target and preserve same-ID/+1; retained aliases stay in scoped list', async () => {
    for (const action of ['rename', 'delete']) {
        const bridge = setup(async (url, init) => {
            assert.ok(url.endsWith('/' + action));
            const data = JSON.parse(init.body);
            assert.deepEqual(data.target, { fileName: 'old.jsonl', chatId: id, chatRevision: '4' });
            assert.equal(data.ownerAccountId, '1');
            return Response.json({ requestId, result: { scope, fileName: 'new.jsonl', chatId: id, chatRevision: '5', authorityEpoch: epoch, deleted: action === 'delete' } });
        });
        const { res } = await invoke(bridge, request('/api/chats/' + action, { original_file: 'old.jsonl', renamed_file: 'new.jsonl',
            vc_f2: token(4), vc_request_id: requestId, vc_authority_epoch: epoch }));
        assert.equal(res.statusCode, 200); assert.deepEqual(res.value.vc_f2, token(5));
    }
    const bridge = setup(async () => Response.json({ authorityEpoch: epoch, items: [summary()], nextCursor: null }));
    const { res } = await invoke(bridge, request('/api/characters/chats'));
    assert.deepEqual(res.value[0].fileAliases, ['old.jsonl']); assert.equal(res.value[0].file_name, 'renamed.jsonl');
});

test('strict JSONL rejects partial, invalid UTF8, blank lines and non-object metadata', async () => {
    for (const bytes of [Buffer.from('{"chat_metadata":{}}\n\n'), Buffer.from([0xc3, 0x28]), Buffer.from('[]\n'),
        Buffer.from(JSON.stringify({ chat_metadata: { vc_f2: token(5) } }) + '\n{"mes":')]) {
        const headers = { 'content-length': String(bytes.length), 'x-chat-id': id, 'x-chat-revision': '5', 'x-chat-authority-epoch': epoch };
        const { res } = await invoke(setup(async () => new Response(bytes, { headers })), request('/api/chats/get', { file_name: 'old' }));
        assert.equal(res.statusCode, 502);
    }
});

test('one request budget and cancellation cover mutation plus canonical read; timeout never retries/falls back', async () => {
    let firstSignal, calls = 0;
    const bridge = setup(async (url, init) => {
        calls++;
        if (firstSignal) assert.equal(init.signal, firstSignal); else firstSignal = init.signal;
        if (url.endsWith('/read')) return ndjson();
        await upload(init);
        return Response.json({ requestId, chat: summary(), identityMapping: mapping });
    });
    const req = request('/api/chats/save', { chat: document(), file_name: 'old', vc_request_id: requestId, vc_authority_epoch: epoch });
    assert.equal((await invoke(bridge, req)).res.statusCode, 200); assert.equal(calls, 2);
    let failedCalls = 0;
    const failed = setup(async () => { failedCalls++; throw new DOMException('synthetic deadline', 'TimeoutError'); });
    const { res } = await invoke(failed, req);
    assert.equal(res.statusCode, 503); assert.equal(res.value.code, 'CHAT_TRANSFER_TIMEOUT'); assert.equal(failedCalls, 1);
    const abort = new AbortController(); abort.abort(); req.signal = abort.signal;
    assert.equal((await invoke(setup(() => assert.fail('cancelled request must not write')), req)).res.statusCode, 503);
});

test('owner-wide recent retains physical resource addressing and pinned aliases; search uses complete fragment matches', async () => {
    const group = { kind: 'GROUP', groupRef: 'synthetic-group' };
    let sharedSignal;
    const bridge = createNativeChatBridge({ config, resolveScope: async ({ signal }) => {
        sharedSignal = signal;
        return { scopes: [scope, group], avatars: { [scope.characterRef]: 'trusted.png' }, groupIds: { [group.groupRef]: 'physical-group' } };
    }, fetchImpl: async (url, init) => {
        assert.equal(init.signal, sharedSignal);
        const data = JSON.parse(init.body);
        assert.equal(data.ownerAccountId, '1');
        return Response.json({ authorityEpoch: epoch, nextCursor: null, items: data.scope.kind === 'SINGLE' ? [summary()]
            : [{ ...summary(), chatId: candidateId, ...group, characterRef: null, fileName: 'group-new.jsonl', fileAliases: ['group-old.jsonl'], updatedAt: '2026-11-06T00:00:00Z' }] });
    } });
    const { res } = await invoke(bridge, request('/api/chats/recent', { max: 1, pinned: [{ group: 'physical-group', file_name: 'group-old.jsonl' }] }));
    assert.equal(res.value[0].group, 'physical-group'); assert.equal(res.value[1].avatar, 'trusted.png');
    assert.equal(res.value[0].file_name, 'group-new.jsonl'); assert.equal(res.value[1].file_id, 'renamed');
    assert.equal(res.value[1].chat_metadata.vc_f2.id, id);
    const search = setup(async url => url.endsWith('/list')
        ? Response.json({ authorityEpoch: epoch, items: [summary()], nextCursor: null })
        : ndjson([...canonical(), { mes: 'another fragment' }]));
    const found = await invoke(search, request('/api/chats/search', { query: 'synthetic fragment' }));
    assert.equal(found.res.value[0].file_name, 'renamed'); assert.equal(found.res.value[0].message_count, 1);
    const absent = await invoke(search, request('/api/chats/search', { query: 'missing fragment' }));
    assert.deepEqual(absent.res.value, []);
    const info = await invoke(setup(async () => Response.json({ authorityEpoch: epoch, items: [summary()], nextCursor: null })), request('/api/chats/group/info', { id: 'old' }));
    assert.equal(info.res.value.file_name, 'renamed.jsonl'); assert.equal(Array.isArray(info.res.value), false);
});
