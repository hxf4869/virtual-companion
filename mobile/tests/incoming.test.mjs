import test from 'node:test';import assert from 'node:assert/strict';
import {createIncomingCalls} from '../src/voice/incoming.mjs';
const event=(id='fu-call')=>({eventId:id,relationshipId:'1',conversationId:'2',linkStatus:'present',stDelivered:true,body:'合成来电',call:{state:'RINGING',expiresAt:new Date(40000).toISOString()}});
test('incoming call expiry and failed reply keep the same action UUID; other client cannot answer twice',async()=>{
 let time=10000,rows=[event()],fail=true,requests=[];const state={};
 const incoming=createIncomingCalls({state,list:async()=>rows,respond:async(id,action,requestId)=>{requests.push({id,action,requestId});if(fail)throw Error('network');return {event:{...event(),call:{...event().call,state:'ANSWERED'}},applied:false};},now:()=>time,uuid:()=> 'request-1'});
 await incoming.poll();assert.equal(state.event.eventId,'fu-call');assert.equal(await incoming.reply('ANSWER'),null);assert.equal(state.event.eventId,'fu-call');fail=false;assert.equal(await incoming.reply('ANSWER'),null);assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(state.event,null);
 rows=[event('fu-next')];await incoming.poll();time=50000;await incoming.poll();assert.equal(state.event,null);incoming.stop();
});
test('late list response after stop cannot show a call; busy view leaves voicemail',async()=>{
 let resolve;const state={};const incoming=createIncomingCalls({state,list:()=>new Promise(r=>{resolve=r;}),respond:async()=>{},now:()=>10000});const pending=incoming.poll();incoming.stop();resolve([event()]);await pending;assert.equal(state.event,null);
 const blocked={};const busy=createIncomingCalls({state:blocked,list:async()=>[event()],respond:async()=>{},now:()=>10000,canRing:()=>false});await busy.poll();assert.equal(blocked.event,null);busy.stop();
});
test('来电开场未写入 ST 前不接管界面，避免和聊天保存并发',async()=>{
 const state={};const incoming=createIncomingCalls({state,list:async()=>[{...event(),stDelivered:false}],respond:async()=>{},now:()=>10000});await incoming.poll();assert.equal(state.event,null);incoming.stop();
});
