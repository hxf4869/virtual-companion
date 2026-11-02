import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSession } from '../src/chat/session.mjs';

function fixture() {
    const data = new Map(); const listeners = new Map(); const chats=new Map();let messages = []; let current = '';let avatar=''; let fail = false;
    const storage = { getItem: (k) => data.get(k), setItem: (k,v) => data.set(k,v), removeItem: (k) => data.delete(k) };
    const engine = { state: 'ready', start: async () => {}, open: async (a,f) => { avatar=a;current=f;const key=`${a}/${f}`;if(!chats.has(key))chats.set(key,[]);messages=chats.get(key); }, chatId: () => current,
        messages: () => messages, character: () => ({avatar}), generating: () => false,
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
test('隐藏对话不操作另一角色的同名聊天；恢复后保留草稿与引用',async()=>{
 const f=fixture();await f.session.open({avatar:'a.png',file:'same',name:'A'});f.engine.messages().push({id:0,text:'A message'});f.session.sync();f.session.draft('A draft');f.state.quote={name:'A',text:'quoted'};
 f.session.suspend();await f.engine.open('b.png','same');f.engine.messages().push({id:0,text:'B message'});f.listeners.get('token')();assert.equal(f.state.messages[0].text,'A message');assert.equal(await f.session.send(),false);
 await f.session.resume();assert.equal(f.engine.character().avatar,'a.png');assert.equal(f.state.ready,true);assert.equal(f.state.draft,'A draft');assert.equal(f.state.quote.text,'quoted');assert.equal(f.state.messages[0].text,'A message');
});
test('宿主视图切到其他会话后，即使旧页面仍是 ready 也拒绝发送、生成和停止',async()=>{
 const f=fixture();await f.session.open({avatar:'a.png',file:'same',name:'A'});f.session.draft('stay in A');await f.engine.open('b.png','same');let generated=0,stopped=0;f.engine.regenerate=async()=>{generated++;return 0;};f.engine.stop=()=>{stopped++;};
 assert.equal(await f.session.send(),false);await f.session.generate();f.session.stop();assert.equal(f.engine.messages().length,0);assert.equal(generated,0);assert.equal(stopped,0);assert.equal(f.state.draft,'stay in A');
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

test('通话文字写入聊天时保留输入框中尚未发送的草稿与引用',async()=>{
 const f=fixture();await f.session.open({avatar:'a.png',file:'f',name:'A'});
 f.session.draft('待会儿再发');f.state.quote={name:'A',text:'留着的引用'};
 await f.session.send({text:'通话识别文字',voiceInput:{durationMs:1200}});
 assert.equal(f.engine.messages().find(m=>m.user).text,'通话识别文字');
 assert.equal(f.state.draft,'待会儿再发');assert.equal(f.state.quote.text,'留着的引用');
});
test('打断后旧回复的完成不能清掉新一轮的忙碌状态',async()=>{
 const f=fixture();await f.session.open({avatar:'a.png',file:'f',name:'A'});const done=[];
 f.engine.waitEnded=()=>new Promise(r=>done.push(r));
 f.session.draft('第一句');await f.session.send();f.session.stop();f.session.draft('第二句');await f.session.send();
 done[0]();await new Promise(r=>setImmediate(r));assert.equal(f.state.busy,true);assert.equal(f.state.error,'');
 f.engine.messages().push({user:false,text:'新回复'});done[1]();await new Promise(r=>setImmediate(r));assert.equal(f.state.busy,false);
});
