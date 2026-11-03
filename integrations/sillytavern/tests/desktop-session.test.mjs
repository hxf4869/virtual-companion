import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopSession } from '../extension/vc-model-settings/desktop/standalone/session.js';
import { EventEmitter } from '../extension/vc-model-settings/desktop/standalone/engine/events.js';
import { event_types } from '../extension/vc-model-settings/desktop/standalone/engine/st/events.js';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';
import { Window } from 'happy-dom';
import { createPersonaSelection } from '../extension/vc-model-settings/desktop/standalone/personas.js';
const window = new Window({ url: 'http://localhost' });
globalThis.localStorage = window.localStorage;
test.after(() => window.happyDOM.close());

test('旧卡异步变量结果过期：拒绝原操作，不能把新会话标成保存冲突', async () => {
    const f = fixture();
    await f.session.activate({ avatar: 'synthetic.png', file: 'A' }, f.records('A'));
    const guard = globalThis[Symbol.for('virtual-companion.f2-source')];
    const source = guard.capture(0), finish = guard.begin(0);
    await f.session.activate({ avatar: 'synthetic.png', file: 'B' }, f.records('B'));
    assert.throws(() => guard.assert(source, { rejected: true }), error => error.code === 'VC_STALE_SOURCE');
    finish(false);
    assert.equal(f.states.at(-1).canSend, true);
    assert.equal(f.states.at(-1).conflict, false);
    assert.equal(f.context.chatMetadata.vc_f2.id, 'B');
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture({ save, prepare, readResponse } = {}) {
    const card = { avatar: 'synthetic.png', name: '合成角色', data: { extensions: { vc_character_ref: 'synthetic-ref' } } };
    const context = { characters: [card], chat: [], chatMetadata: {}, extensionPrompts: {}, eventSource: new EventEmitter(), eventTypes: event_types };
    const binding = id => ({ characterRef: 'synthetic-ref', chatIdentity: id, relationshipId: '1', conversationId: id, mode: 'COMPANION' });
    const records = id => [{ user_name: 'unused', character_name: 'unused', chat_metadata: {
        integrity: 'synthetic-integrity', vc_f2: { id, revision: 1 }, vc_binding: binding(id),
    } }, { name: card.name, mes: '合成历史', is_user: false }];
    const sent = [], states = [], taken = [], restored = []; let generations = 0, preparations = 0;
    const client = {
        request: async path => path === '/api/avatars/get' ? [] : structuredClone(card), post: async () => new Response('{}'),
        async raw(path, serialized) {
            const body = JSON.parse(serialized); sent.push(body);
            if (save) return save(body);
            return new Response(JSON.stringify({ vc_f2: { ...body.chat[0].chat_metadata.vc_f2, revision: body.chat[0].chat_metadata.vc_f2.revision + 1 } }));
        },
        async generate() { generations++; return new Response('{}'); },
    };
    const engine = { settings: { username: '合成用户', user_avatar: '', power_user: { personas: {}, persona_descriptions: {} }, oai_settings: {} },
        bindContext() {},
        userMessage: async text => ({ message: { name: context.name1, mes: text, is_user: true, extra: {} }, bias: {} }),
        async prepare(options) { preparations++; if (prepare) return prepare(options); return { body: { model: 'synthetic', chat_completion_source: 'custom' } }; },
        cleanResponse: text => text, memory: { finalStatus() {} },
    };
    const session = createDesktopSession({ client, context, engine, prepareSourceIdentities,
        choosePersona: async () => '', resolveBinding: async value => binding(value.chatIdentity), reconcileSources: async () => [],
        onChange: value => states.push(value), onTakeDraft: (...value) => taken.push(value), onRestoreDraft: (...value) => restored.push(value),
        readResponse: readResponse || (async (response, { onUpdate }) => {
            const result = { text: '合成回复', state: { reasoning: '' }, swipes: [], toolCalls: [], finishReason: 'stop' };
            await onUpdate(result); return result;
        }),
    });
    return { session, context, sent, states, taken, restored, records,
        open: (id, options) => session.activate({ avatar: card.avatar, file: id }, records(id), options),
        get generations() { return generations; }, get preparations() { return preparations; } };
}

test('桌面一次动作只生成一次；先F2保存用户消息，ACK后用真实人设/角色名生成并保存回复', async () => {
    const gate = deferred(); let saves = 0;
    const f = fixture({ save: async body => {
        if (++saves === 1) await gate.promise;
        return new Response(JSON.stringify({ vc_f2: { ...body.chat[0].chat_metadata.vc_f2, revision: saves + 1 } }));
    } });
    await f.open('synthetic-a');
    const first = f.session.send('合成输入');
    assert.equal(await f.session.send('重复点击'), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.generations, 0); assert.equal(f.preparations, 0); assert.equal(f.taken.length, 1);
    assert.equal(f.sent[0].chat.at(-1).name, '合成用户');
    gate.resolve(); assert.equal(await first, true);
    assert.equal(f.generations, 1); assert.equal(f.preparations, 1); assert.equal(f.sent.length, 2);
    assert.equal(f.context.name2, '合成角色'); assert.equal(f.context.chat.at(-1).mes, '合成回复');
    assert.equal(f.context.chatMetadata.vc_f2.revision, 3);
    assert.equal(f.taken.length, 1); assert.equal(f.states.at(-1).canSend, true);
    assert.ok(f.sent[1].chat.at(-1).extra.vc_source.settled);
});

test('切会话取消旧流，部分回复仅保存到旧文件；迟到收尾不替换新会话和输入', async () => {
    const began = deferred();
    const f = fixture({ readResponse: async (response, { signal, onUpdate }) => {
        await onUpdate({ text: '合成部分回复', state: { reasoning: '' } }); began.resolve();
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    } });
    await f.open('synthetic-a');
    const old = f.session.send('合成旧输入'); await began.promise;
    let stopped = 0; f.context.eventSource.on(event_types.GENERATION_STOPPED, () => stopped++);
    await f.open('synthetic-b'); await old;
    assert.equal(stopped, 1); assert.equal(f.context.chatId, 'synthetic-b');
    assert.deepEqual(f.context.chat.map(message => message.mes), ['合成历史']);
    assert.ok(f.sent.every(body => body.file_name === 'synthetic-a'));
    assert.equal(f.sent.at(-1).chat.at(-1).extra.finish_reason, 'cancelled');
    assert.equal(f.sent.at(-1).chat.at(-1).extra.no_memory, true);
    assert.equal(f.states.at(-1).key, JSON.stringify(['synthetic.png', 'synthetic-b']));
    assert.equal(f.states.at(-1).notice, '');
});

test('F2保存409保留输入与拒绝快照、阻止盲重试；显式读取最新后可重新建立基线', async () => {
    let conflict = true;
    const f = fixture({ save: async body => conflict
        ? new Response(JSON.stringify({ code: 'VC_REVISION_CONFLICT' }), { status: 409 })
        : new Response(JSON.stringify({ vc_f2: { ...body.chat[0].chat_metadata.vc_f2, revision: body.chat[0].chat_metadata.vc_f2.revision + 1 } })) });
    await f.open('synthetic-a');
    assert.equal(await f.session.send('合成冲突草稿'), false);
    assert.equal(f.generations, 0); assert.equal(f.taken.length, 1);
    assert.ok((await f.session.copyRejected()).includes('合成冲突草稿'));
    assert.equal(await f.session.retry(), false); assert.equal(f.sent.length, 1);
    assert.equal(f.states.at(-1).conflict, true);
    conflict = false; await f.open('synthetic-a', { latest: true });
    assert.ok(f.restored.some(([, text]) => text.includes('合成冲突草稿')));
    assert.equal(await f.session.send('合成重新发送'), true);
    assert.equal(f.generations, 1);
});

test('准备阶段停止不发送模型；已确认的用户输入仍可刷新读取，重复停止只发一次事件', async () => {
    const began = deferred();
    const f = fixture({ prepare: async ({ signal }) => {
        began.resolve(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    } });
    await f.open('synthetic-a'); let stopped = 0;
    f.context.eventSource.on(event_types.GENERATION_STOPPED, () => stopped++);
    const pending = f.session.send('合成停止输入'); await began.promise;
    await Promise.all([f.session.stop(), f.session.stop()]); await pending;
    assert.equal(f.generations, 0); assert.equal(stopped, 1);
    assert.equal(f.sent[0].chat.at(-1).mes, '合成停止输入');
    assert.equal(f.states.at(-1).notice, '已停止');
});

test('同一人设保留临时称呼/描述，切到锁定人设才按原字段应用描述、深度、角色与世界书', async () => {
    const selected = [];
    const settings = { username: '临时称呼', user_avatar: 'a.png', power_user: {
        personas: { 'a.png': '人设A', 'b.png': '人设B' }, persona_descriptions: {
            'a.png': { description: '默认A' }, 'b.png': { description: '描述B', position: 1, depth: 4, role: 2, lorebook: '合成世界书B' },
        }, persona_description: '临时描述', persona_auto_lock: true,
    } };
    const context = { characters: [{ avatar: 'synthetic.png' }], characterId: 0, chatMetadata: { persona: 'a.png' } };
    const selection = createPersonaSelection({ client: { request: async () => ['a.png', 'b.png'] }, context, settings,
        choose: async () => { assert.fail('单一锁定人设不应弹选择'); }, onSelected: avatar => selected.push(avatar) });
    await selection.load('one');
    assert.equal(context.name1, '临时称呼'); assert.equal(settings.power_user.persona_description, '临时描述');
    context.chatMetadata = { persona: 'b.png' }; await selection.load('two');
    assert.equal(context.name1, '人设B'); assert.equal(settings.power_user.persona_description, '描述B');
    assert.equal(settings.power_user.persona_description_position, 0); assert.equal(settings.power_user.persona_description_depth, 4);
    assert.equal(settings.power_user.persona_description_role, 2); assert.equal(settings.power_user.persona_description_lorebook, '合成世界书B');
    assert.deepEqual(selected, ['b.png']);
});

test('多个人设遵循原连接顺序；选择期间切会话，迟到结果不能应用', async () => {
    const gate = deferred(), began = deferred(), selected = [];
    const settings = { username: '临时称呼', user_avatar: 'a.png', power_user: {
        personas: { 'a.png': '人设A', 'b.png': '人设B' }, persona_allow_multi_connections: true,
        persona_descriptions: { 'a.png': { connections: [{ id: 'synthetic.png', type: 'character' }] },
            'b.png': { connections: [{ id: 'synthetic.png', type: 'group' }] } },
    } };
    const context = { characters: [{ avatar: 'synthetic.png' }], characterId: 0, chatMetadata: {} };
    const selection = createPersonaSelection({ client: { request: async () => ['a.png', 'b.png'] }, context, settings,
        async choose(rows) { assert.deepEqual(rows.map(row => row.avatar), ['a.png', 'b.png']); began.resolve(); return gate.promise; },
        onSelected: avatar => selected.push(avatar) });
    const controller = new AbortController();
    const pending = selection.load('one', { signal: controller.signal }); await began.promise;
    controller.abort(); gate.resolve('b.png');
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(context.name1, '临时称呼'); assert.equal(context.userAvatar, 'a.png'); assert.deepEqual(selected, []);
});
