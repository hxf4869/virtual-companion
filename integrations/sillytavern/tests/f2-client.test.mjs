import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { armSilentF2Conflict, createF2Client, createSourceGuard, F2ConflictError, installInstanceBinding } from '../extension/vc-model-settings/f2-client.js';
const token = (revision = 1, id = 'synthetic-chat') => ({ id, revision });
const document = (t, mes) => ({ chat: [{ chat_metadata: { vc_f2: t } }, { mes }] });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const response = (t) => new Response(JSON.stringify({ vc_f2: t }), { headers: { 'content-type': 'application/json' } });

test('同源因果队列冻结内容，仅前项ACK允许后项基线推进；分离旧快照不可借新ACK', async () => {
    const client = createF2Client();
    const metadata = { vc_f2: token() }; client.loaded('main', metadata);
    const gate = deferred(), sent = [];
    const send = async (raw) => { const body = JSON.parse(raw); sent.push(body); if (sent.length === 1) await gate.promise; return response(token(body.chat[0].chat_metadata.vc_f2.revision + 1)); };
    const firstPayload = document(token(), '第一条');
    const first = client.save('main', firstPayload, { live: true, send, apply: (t) => { metadata.vc_f2 = t; } });
    firstPayload.chat[1].mes = '调用后不能改写已捕获的快照';
    const second = client.save('main', document(token(), '第二条'), { live: true, send });
    await Promise.resolve(); assert.equal(sent.length, 1); gate.resolve();
    await Promise.all([first, second]);
    assert.equal(sent[0].chat[1].mes, '第一条');
    assert.equal(sent[1].chat[0].chat_metadata.vc_f2.revision, 2);
    await assert.rejects(client.save('main', document(token(), '分离旧快照'), { send }), { code: 'VC_STALE_SOURCE' });
    assert.equal(sent.length, 2);
});

test('换聊天后排队项不发送，迟到ACK不应用；错误保留原草稿且阻止后续盲重试', async () => {
    const drafts = [], client = createF2Client({ onConflict: (raw) => drafts.push(JSON.parse(raw)) });
    client.loaded('old', { vc_f2: token() });
    const gate = deferred(); let applied = false, sends = 0;
    const send = async () => { sends++; await gate.promise; return response(token(2)); };
    const first = client.save('old', document(token(), '在途'), { live: true, send, apply: () => { applied = true; } });
    const later = client.save('old', document(token(), '排队草稿'), { live: true, send });
    await Promise.resolve(); client.loaded('new', { vc_f2: token(1, 'other') }); gate.resolve();
    await first; await assert.rejects(later, { code: 'VC_STALE_SOURCE' });
    assert.equal(applied, false); assert.equal(sends, 1); assert.equal(drafts[0].chat[1].mes, '排队草稿');
    client.loaded('new', { vc_f2: token(1, 'other') });
    await assert.rejects(client.save('new', document(token(1, 'other'), '网络不确定草稿'), { live: true, send: async () => { throw Error('network'); } }), { code: 'VC_SAVE_UNCONFIRMED' });
    await assert.rejects(client.save('new', document(token(1, 'other'), '不能自动重试'), { live: true, send: async () => { assert.fail('must not send'); } }), F2ConflictError);
});

function source() {
    const c = { chat: [{ mes: '合成聊天原文', swipe_id: 0, variables: [{ trust: 1 }, { trust: 2 }] }], chatMetadata: { vc_f2: token() }, chatId: 'main', characterId: 0, groupId: null };
    return { c, guard: createSourceGuard(() => c) };
}
test('来源守卫拒绝同端revision、swipe、文字或变量变化，分支仅带父关系引用', () => {
    for (const change of [(c) => c.chatMetadata.vc_f2.revision++, (c) => c.chat[0].swipe_id++, (c) => { c.chat[0].mes = '新编辑'; }, (c) => { c.chat[0].variables[0].trust++; }, (c) => { c.chatMetadata = structuredClone(c.chatMetadata); }]) {
        const { c, guard } = source(), snapshot = guard.capture(0); change(c);
        assert.throws(() => guard.assert(snapshot), { code: 'VC_STALE_SOURCE' });
    }
    const client = createF2Client({ uuid: () => 'new-chat' });
    const branch = client.branchMetadata({ vc_f2: token(3), vc_binding: { relationshipId: '9007199254740993', conversationId: '99', mode: 'COMPANION' } });
    assert.deepEqual(branch.vc_f2, { id: 'new-chat', revision: 0 });
    assert.equal(branch.vc_f2_parent.revision, 3); assert.equal(branch.vc_binding.conversationId, undefined);
});

test('真实Helper updateVariablesWith产物：updater await后切swipe，replaceVariables前拒绝', async () => {
    const patch = JSON.parse(fs.readFileSync(new URL('../patches/helper-selfhost-runtime-assets.json', import.meta.url)));
    const actual = patch.replacements.find((r) => r.where === 'W05 async variable updater').to;
    const { c, guard } = source(), gate = deferred(); let writes = 0;
    const context = vm.createContext({ zI: () => ({ trust: 1 }), pI: (v) => v?.then, HI: () => { writes++; }, Symbol });
    context[Symbol.for('virtual-companion.f2-source')] = guard;
    const update = vm.runInContext(`(${actual})`, context);
    const pending = update(async () => { await gate.promise; return { trust: 10 }; }, { type: 'message', message_id: 0 });
    c.chat[0].swipe_id = 1; gate.resolve();
    await assert.rejects(pending, { code: 'VC_STALE_SOURCE' }); assert.equal(writes, 0);
});

test('真实MVU handleVariablesInMessage产物：事件await后改revision，不写文本或变量', async () => {
    const patch = JSON.parse(fs.readFileSync(new URL('../patches/mvu-current-message-lifecycle.json', import.meta.url)));
    const actual = patch.replacements.find((r) => r.where === 'W05 actual MVU source').to;
    const { c, guard } = source(), gate = deferred(); let writes = 0;
    const parent = { [Symbol.for('virtual-companion.f2-source')]: guard };
    const context = vm.createContext({ parent, Symbol, getChatMessages: () => [{ role: 'assistant', message: c.chat[0].mes }],
        Tt: () => ({ stat_data: {} }), Nt: { D: () => ({ effective_settings: { 兼容性: { 更新到聊天变量: true } } }) },
        _: { has: (v, key) => Object.hasOwn(v, key) }, ln: () => gate.promise,
        setChatMessages: () => { writes++; }, updateVariablesWith: () => { writes++; },
    });
    const update = vm.runInContext(`(${actual})`, context);
    const pending = update(0); c.chatMetadata.vc_f2.revision++; gate.resolve();
    await assert.rejects(pending, { code: 'VC_STALE_SOURCE' }); assert.equal(writes, 0);
});

test('conflict silent 仍拒绝且不调用 onConflict，下一次普通失败才交给对话框', async () => {
    let calls = 0;
    const client = createF2Client({ onConflict() { calls += 1; } });
    client.loaded('main', { vc_f2: token() });
    const send = async () => new Response(JSON.stringify({ code: 'VC_REVISION_CONFLICT' }), { status: 409, headers: { 'content-type': 'application/json' } });
    await assert.rejects(
        client.save('main', document(token(), '投影'), { live: true, send, conflict: 'silent' }),
        { name: 'F2ConflictError', code: 'VC_REVISION_CONFLICT' },
    );
    assert.equal(calls, 0);
    await assert.rejects(client.save('main', document(token(), '用户'), { live: true, send }), { name: 'F2ConflictError' });
    assert.equal(calls, 1);
});

test('无效 token 的 silent 保存不弹框；arm 只被下一次 save 同步消费', async () => {
    let calls = 0;
    const client = createF2Client({ onConflict() { calls += 1; } });
    await assert.rejects(
        client.save('main', { chat: [{ chat_metadata: {} }] }, { conflict: 'silent' }),
        { name: 'F2ConflictError', code: 'VC_REVISION_REQUIRED' },
    );
    assert.equal(calls, 0);
    armSilentF2Conflict();
    client.loaded('main', { vc_f2: token() });
    const send = async () => { throw new Error('network'); };
    const pending = client.save('main', document(token(), '投影补写'), { live: true, send });
    const user = createF2Client({ onConflict() { calls += 1; } });
    await assert.rejects(
        user.save('other', document(token(1, 'other'), '用户自己的保存'), { send }),
        { code: 'VC_SAVE_UNCONFIRMED' },
    );
    assert.equal(calls, 1);
    await assert.rejects(pending, { code: 'VC_SAVE_UNCONFIRMED' });
    assert.equal(calls, 1);
});

test('绑定 404 不丢弃 relationshipId，也不再分配新关系', async () => {
    const calls = [];
    const metadata = {
        vc_f2: token(),
        vc_binding: { relationshipId: '11', conversationId: '21', mode: 'COMPANION' },
    };
    const card = { name: '澄夏', data: { extensions: { vc_character_ref: 'card-1' } } };
    const context = {
        characters: [card], characterId: 0, groupId: null, chatMetadata: metadata,
        chat: [{ mes: 'hi' }], chatId: 'main',
        eventSource: { on() {} }, eventTypes: { CHAT_CHANGED: 'chat_changed' },
        saveChat: async () => { throw new Error('should not save'); },
    };
    const error = Object.assign(new Error('gone'), { status: 404, code: 'NOT_FOUND' });
    await assert.rejects(
        installInstanceBinding({
            getContext: () => context,
            resolveBinding: async (snapshot) => { calls.push(snapshot); throw error; },
            writeExtensionField: async () => { throw new Error('should not write ref'); },
            captureSessionContext: async () => {},
        }),
        (err) => err === error,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].relationshipId, '11');
    assert.equal(metadata.vc_binding.relationshipId, '11');
    assert.equal(metadata.vc_binding.conversationId, '21');
});
