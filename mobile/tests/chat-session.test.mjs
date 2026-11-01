import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSession } from '../src/chat/session.mjs';

function fixture() {
    const data = new Map(); const listeners = new Map(); let messages = []; let current = ''; let fail = false;
    const storage = { getItem: (k) => data.get(k), setItem: (k,v) => data.set(k,v), removeItem: (k) => data.delete(k) };
    const engine = { state: 'ready', start: async () => {}, open: async (_,f) => { current=f; }, chatId: () => current,
        messages: () => messages, character: () => ({}), generating: () => false,
        on: (key,fn) => { listeners.set(key,fn); return () => listeners.delete(key); },
        send: (text) => { if(fail) throw Error('offline'); messages.push({ id:messages.length,user:true,text }); return 0; },
        waitEnded: async () => { messages.push({ id:messages.length,user:false,text:'reply' }); }, stop: () => {},
    };
    const server = { chat: async () => ({ messages: [...messages], meta: {} }) };
    const state = {}; const session = createChatSession({ engine, server, state, storage });
    return { session, state, data, engine, server, listeners, setFail: () => { fail=true; } };
}
test('发送被宿主接受才清草稿；失败保留原文与引用', async () => {
    const f=fixture(); await f.session.open({ avatar:'a.png',file:'f',name:'A' });
    f.session.draft('你好'); f.state.quote={ name:'A',text:'旧话' }; f.setFail();
    await f.session.send();
    assert.equal(f.state.draft,'你好'); assert.equal(f.state.quote.text,'旧话'); assert.equal(f.state.error,'send');
    assert.ok([...f.data.values()].includes('你好'));
});
test('已发送文字不因模型失败而自动重发', async () => {
    const f=fixture(); await f.session.open({ avatar:'a.png',file:'f',name:'A' });
    f.engine.waitEnded=async()=>{throw Error('model failed')};
    f.session.draft('只发送一次'); await f.session.send(); await new Promise(r=>setTimeout(r,5));
    assert.equal(f.state.draft,''); assert.equal(f.engine.messages().filter(m=>m.user).length,1); assert.equal(f.state.error,'reply');
});
test('迟到的历史读取不能覆盖新会话；草稿按角色与会话隔离', async () => {
    const f=fixture(); let resolveOld;
    f.server.chat=(_,file)=>file==='old' ? new Promise(r=>{resolveOld=r}) : Promise.resolve({messages:[{id:0,text:'new'}],meta:{}});
    const old=f.session.open({avatar:'a.png',file:'old',name:'A'});
    await f.session.open({avatar:'b.png',file:'new',name:'B'});
    f.session.draft('新草稿'); resolveOld({ messages:[{id:0,text:'old'}],meta:{} }); await old;
    assert.equal(f.state.target.avatar,'b.png'); assert.equal(f.state.draft,'新草稿');
    f.session.dispose(); assert.equal(f.listeners.size,0);
});
test('客户端出现消息不等于保存成功；保存失败保留草稿且不自动补发', async () => {
    const f=fixture(); await f.session.open({avatar:'a.png',file:'f',name:'A'});
    f.server.chat=async()=>{throw Error('save unavailable')};
    f.session.draft('别丢失'); await f.session.send();
    assert.equal(f.state.draft,'别丢失'); assert.equal(f.state.error,'save');
    await f.session.send();
    assert.equal(f.engine.messages().filter(m=>m.user).length,1);
});
