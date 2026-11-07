import assert from 'node:assert/strict';
import test from 'node:test';

const setup = () => {
    let current = { chatId: 'new', chatMetadata: { vc_binding: { relationshipId: '11' }, vc_f2: { id: 'new-id' } }, chat: [] };
    const actions = [];
    const native = { async openCharacterChat(file) { actions.push(file);current = { chatId: file, chatMetadata: { vc_binding: { relationshipId: '11' }, vc_f2: { id: 'old-id' } }, chat: [{vc_message_id:'other'}, {vc_message_id:'stable-id',mes:'目标消息',send_date:'2026-11-02T00:00:00.000Z'}] }; }, async showMoreMessages(count) { actions.push(['history',count]); } };
    return { actions, getContext: () => current,
        openConversation: async () => { actions.push('open');return true; }, loadNative: async () => native,
        loadChats: async () => [{relationshipId:'11',file:'old',chatIdentity:'old-id',characterRef:'c'}],
        document: { querySelector: () => ({getAttribute:()=> '5'}) } };
};
test('独立来源端口等待会话激活再定位，不加载原生模块，并展开目标历史',async()=>{
    const {openMessageSource}=await import('../extension/vc-model-settings/message-source.js');
    let context={chatId:'new',chatMetadata:{},chat:[]};const calls=[];
    const result=await openMessageSource({relationshipId:'11',chatIdentity:'old-id',messageId:'stable-id'},{
        getContext:()=>context,loadChats:setup().loadChats,openConversation:async()=>{calls.push('read');return true;},
        afterOpen:async()=>{calls.push('activate');context={chatId:'old',chatMetadata:{vc_binding:{relationshipId:'11'},vc_f2:{id:'old-id'}},chat:[{vc_message_id:'stable-id'}]};},
        ensureVisible:async index=>calls.push(['history',index]),document:{querySelector:()=>null},
    });
    assert.equal(result,0);assert.deepEqual(calls,['read','activate',['history',0]]);
});

test('记忆来源跨聊天文件跳转，按持久消息ID解析楼层并加载历史', async () => {
    const { openMessageSource } = await import('../extension/vc-model-settings/message-source.js');
    const deps=setup();
    const mesId=await openMessageSource({relationshipId:'11',chatIdentity:'old-id',messageId:'stable-id'},deps);
    assert.equal(mesId,1);
    assert.deepEqual(deps.actions,['open','old',['history',4]]);
});

test('收藏跳转使用记录的聊天文件；来源已删除时不误跳到最新聊天', async () => {
    const { openMessageSource } = await import('../extension/vc-model-settings/message-source.js');
    const deps=setup();
    assert.equal(await openMessageSource({relationshipId:'11',chatFile:'old.jsonl',body:'目标消息',role:'character',messageAt:'2026-11-02T00:00:00.000Z'},deps),1);
    const missing=setup();
    await assert.rejects(openMessageSource({relationshipId:'11',chatIdentity:'gone',messageId:'stable-id'},missing));
    assert.deepEqual(missing.actions,[]);
});

test('消息持久ID不存在时不能回退成另一个楼层', async () => {
    const { openMessageSource } = await import('../extension/vc-model-settings/message-source.js');
    await assert.rejects(openMessageSource({relationshipId:'11',chatIdentity:'old-id',messageId:'gone-id',mesId:1},setup()));
});

test('收藏前方消息删除后按保存的快照定位，不沿用过期楼层', async () => {
    const { openMessageSource } = await import('../extension/vc-model-settings/message-source.js');
    const at = '2026-11-02T00:00:00.000Z';
    const context = { chatId: 'old', chatMetadata: { vc_binding: { relationshipId: '11' } }, chat: [
        { mes: '收藏的内容', is_user: false, send_date: at },
        { mes: '后来的内容', is_user: false, send_date: '2026-11-02T00:01:00.000Z' },
    ] };
    const deps = { ...setup(), getContext: () => context, document: { querySelector: () => null } };
    assert.equal(await openMessageSource({ relationshipId: '11', chatFile: 'old', mesId: 1,
        body: '收藏的内容', role: 'character', messageAt: at }, deps), 0);
});

test('收藏来源删除或快照有歧义时明确失败，不能高亮另一个消息', async () => {
    const { openMessageSource } = await import('../extension/vc-model-settings/message-source.js');
    const at = '2026-11-02T00:00:00.000Z';
    const context = { chatId: 'old', chatMetadata: { vc_binding: { relationshipId: '11' } }, chat: [
        { mes: '别的内容', is_user: false, send_date: at },
    ] };
    const deps = { ...setup(), getContext: () => context, document: { querySelector: () => null } };
    const detail = { relationshipId: '11', chatFile: 'old', mesId: 0, body: '收藏的内容', role: 'character', messageAt: at };
    await assert.rejects(openMessageSource(detail, deps), /source-message-unavailable/);
    context.chat = Array.from({length:2},()=>({ mes: '收藏的内容', is_user: false, send_date: at }));
    await assert.rejects(openMessageSource(detail, deps), /source-message-unavailable/);
    context.chat = context.chat.slice(0, 1);
    await assert.rejects(openMessageSource({ ...detail, messageAt: null }, deps), /source-message-unavailable/);
});

test('GO renamed filename alias resolves only inside the favorite original relationship', async () => {
    const { openMessageSource } = await import('../extension/vc-model-settings/message-source.js');
    const deps = setup();
    deps.loadChats = async () => [
        { relationshipId: 'other', file: 'foreign', fileAliases: ['old.jsonl'] },
        { relationshipId: '11', file: 'renamed', chatId: 'old-id', fileAliases: ['old.jsonl'] },
    ];
    assert.equal(await openMessageSource({ relationshipId: '11', chatFile: 'old.jsonl', messageId: 'stable-id' }, deps), 1);
    assert.deepEqual(deps.actions, ['open', 'renamed', ['history', 4]]);
    const absent = setup(); absent.loadChats = async () => [{ relationshipId: 'other', file: 'foreign', fileAliases: ['old.jsonl'] }];
    await assert.rejects(openMessageSource({ relationshipId: '11', chatFile: 'old.jsonl', messageId: 'stable-id' }, absent), /source-unavailable/);
    assert.deepEqual(absent.actions, []);
});
