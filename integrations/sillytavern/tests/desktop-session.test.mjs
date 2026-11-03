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
    const conflictNotice=f.states.at(-1).notice;
    f.session.setCatalogStatus(false,'请先配置聊天模型。',true);f.session.setBudget({insufficient:true});
    assert.equal(f.states.at(-1).notice,conflictNotice);assert.equal(f.states.at(-1).settingsRequired,false,'模型设置不能抢走已有F2冲突的恢复动作');
    f.session.setCatalogStatus(true);f.session.setBudget(null);
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


test('候选沿用同一消息身份，各自来源与变量独立；切换、编辑和删除全部经F2保存', async () => {
    const f = fixture(); await f.open('synthetic-candidates'); await f.session.send('合成输入');
    const index = f.context.chat.length - 1, message = f.context.chat[index];
    message.variables = [{ marker: 'original' }];
    const firstId = message.extra.vc_source.id, messageId = message.vc_message_id;
    f.context.eventSource.on(event_types.MESSAGE_RECEIVED, (id, type) => {
        if (type === 'swipe') f.context.chat[id].variables[f.context.chat[id].swipe_id] = { marker: 'new' };
    });
    assert.equal(await f.session.swipe(index, 1, message), true);
    assert.equal(f.context.chat.length, 3); assert.equal(message.swipe_id, 1); assert.equal(message.swipes.length, 2);
    assert.equal(message.vc_message_id, messageId); const secondId = message.extra.vc_source.id; assert.notEqual(firstId, secondId);
    assert.deepEqual(message.variables, [{ marker: 'original' }, { marker: 'new' }]);
    assert.equal(await f.session.swipe(index, -1, message), true);
    assert.equal(message.extra.vc_source.id, firstId); assert.equal(message.variables[message.swipe_id].marker, 'original');
    assert.equal(await f.session.edit(index, '合成编辑', message), true); assert.equal(message.swipes[0], '合成编辑');
    assert.equal(message.swipes[1], '合成回复'); assert.equal(message.extra.vc_source.id, firstId);
    await f.session.swipe(index, 1, message); assert.equal(message.extra.vc_source.id, secondId);
    assert.equal(message.variables[message.swipe_id].marker, 'new');
    const saved = f.sent.at(-1).chat; await f.session.activate({ avatar: 'synthetic.png', file: 'synthetic-candidates' }, saved);
    assert.equal(f.context.chat[index].extra.vc_source.id, secondId); assert.deepEqual(f.context.chat[index].variables, message.variables);
    assert.equal(await f.session.remove(1), true); assert.equal(f.context.chat.length, 2); assert.equal(f.sent.at(-1).chat.length, 3);
    assert.equal(f.context.chat.at(-1).vc_message_id, messageId); assert.equal(f.generations, 2);
});

test('继续在当前候选追加且保留来源；重生成替换末条，不增加用户消息或消耗草稿', async () => {
    const f = fixture(); await f.open('synthetic-continue'); await f.session.send('合成输入');
    const previous = f.context.chat.at(-1), id = previous.extra.vc_source.id, messageId = previous.vc_message_id;
    await f.session.continue(); assert.equal(f.context.chat.length, 3); assert.equal(previous.mes, '合成回复合成回复');
    assert.equal(previous.swipes[0], previous.mes); assert.equal(previous.extra.vc_source.id, id);
    await f.session.regenerate(); assert.equal(f.context.chat.length, 3); assert.notEqual(f.context.chat.at(-1).vc_message_id, messageId);
    assert.equal(f.taken.length, 1); assert.equal(f.context.chat.filter(message => message.is_user).length, 1);
});

test('候选/继续在网络错误前恢复原候选，重生成失败恢复旧回复；不丢弃既有变量', async () => {
    const f = fixture({readResponse: async () => { throw new Error('synthetic transport'); }}); await f.open('synthetic-recover');
    const original = f.context.chat.at(-1); original.variables = [{ marker: 'saved' }]; await f.session.save(); const saved = structuredClone(original);
    assert.equal(await f.session.swipe(0, 1, original), false); assert.deepEqual(original, saved);
    assert.equal(await f.session.continue(), false); assert.deepEqual(original, saved);
    assert.equal(await f.session.regenerate(), false); assert.deepEqual(f.context.chat.at(-1), saved);
    assert.ok(f.states.at(-1).canSend);
});

test('编辑保存冲突保留完整拒绝快照，阻止后续生成，复制仍能取回未保存正文', async () => {
    const f = fixture({save: async () => new Response(JSON.stringify({code:'VC_REVISION_CONFLICT'}), {status:409})});
    await f.open('synthetic-edit-conflict');
    assert.equal(await f.session.edit(0, '合成未保存编辑'), false);
    const snapshot = JSON.parse(await f.session.copyRejected());
    assert.equal(snapshot.chat[1].mes, '合成未保存编辑'); assert.equal(snapshot.file_name, 'synthetic-edit-conflict');
    assert.equal(await f.session.retry(), false); assert.equal(f.generations, 0); assert.equal(f.states.at(-1).conflict, true);
});

test('生成中迟到的旧语音状态沿既有元数据端口随最终F2提交，不改动当前出站的版本基线', async () => {
    const began = deferred(), finish = deferred(); let prepared = 0;
    const f = fixture({ prepare: async () => { if (++prepared === 2) { began.resolve(); await finish.promise; }
        return {body:{model:'synthetic',chat_completion_source:'custom'}}; } });
    await f.open('synthetic-late-voice'); await f.session.send('合成第一轮');
    const oldReply = f.context.chat.at(-1), pending = f.session.send('合成第二轮'); await began.promise;
    const before = f.sent.length; oldReply.extra.vc_voice = {clipId:'1',status:'ready',durationMs:1000};
    await f.context.saveChatConditional(); assert.equal(f.sent.length, before);
    finish.resolve(); await pending;
    assert.deepEqual(f.sent.at(-1).chat[3].extra.vc_voice, {clipId:'1',status:'ready',durationMs:1000});
    assert.equal(f.generations, 2); assert.ok(f.states.at(-1).canSend);
});


test('目录不可用和预算不足由唯一Session阻止所有生成，保留历史与输入；恢复后不重建会话', async () => {
    const f = fixture(); f.session.setCatalogStatus(false,'请先配置聊天模型。',true); await f.open('synthetic-no-model');
    const messages = f.context.chat;
    assert.equal(f.states.at(-1).canSend,false); assert.equal(f.states.at(-1).settingsRequired,true);
    assert.equal(await f.session.send('保留合成输入'),false); assert.equal(await f.session.continue(),false);
    assert.equal(f.taken.length,0); assert.equal(f.generations,0);
    f.session.setCatalogStatus(true); f.session.setBudget({known:true,insufficient:true});
    assert.equal(await f.session.send('仍保留输入'),false); assert.equal(f.generations,0);
    f.session.setBudget({known:false,insufficient:false});
    assert.equal(f.context.chat,messages); assert.equal(await f.session.send('合成恢复发送'),true); assert.equal(f.generations,1);
});

test('目录刷新等待整个生成和最终保存完成，而不是只等提示词计算结束', async () => {
    const began = deferred(), finished = deferred(); let waiting = true;
    const f = fixture({readResponse: async () => { began.resolve(); await finished.promise;
        return {text:'合成完整回复',state:{reasoning:''},swipes:[],toolCalls:[],finishReason:'stop'}; }});
    await f.open('synthetic-catalog-idle'); const sending = f.session.send('合成输入'); await began.promise;
    const idle = f.session.whenIdle().then(() => {waiting=false;});
    f.session.setCatalogStatus(false); await new Promise(resolve => setImmediate(resolve));
    assert.equal(waiting,true); assert.equal(await f.session.send('刷新期间不发送'),false); assert.equal(f.generations,1);
    finished.resolve(); await sending; await idle;
    assert.equal(f.sent.at(-1).chat.at(-1).mes,'合成完整回复'); assert.equal(waiting,false);
    f.session.setCatalogStatus(true); assert.equal(f.states.at(-1).canSend,true);
});
