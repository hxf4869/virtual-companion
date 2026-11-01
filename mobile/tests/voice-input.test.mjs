import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceInput } from '../src/voice/input.mjs';

function fixture(overrides={}) {
 const recorders=[];let stops=0,recognitions=0;const sent=[];const state={};
 class Recorder {
  constructor(){this.events={};this.mimeType='audio/webm';recorders.push(this);}
  addEventListener(name,fn){this.events[name]=fn;}
  start(){}
  stop(){this.events.dataavailable?.({data:new Blob(['audio'])});this.events.stop?.();}
 }
 const media={getTracks:()=>[{stop(){stops++;}}]};
 const input=createVoiceInput({state,getMedia:async()=>media,Recorder,startMeter:()=>()=>{},convert:async()=>({wav:new Blob(['wav']),durationMs:1200}),transcribe:async()=>{recognitions++;return {text:'合成识别',emotion:'HAPPY'};},onText:async(...args)=>sent.push(args),...overrides});
 return {input,state,recorders,sent,media,stops:()=>stops,recognitions:()=>recognitions};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('录音结束后经 WAV 识别发送文字与本轮语音元数据，并释放麦克风',async()=>{
 const f=fixture();await f.input.start();assert.equal(f.state.phase,'recording');f.input.finish();await flush();
 assert.deepEqual(f.sent,[['合成识别',{durationMs:1200,emotion:'HAPPY'}]]);assert.equal(f.stops(),1);assert.equal(f.state.phase,'idle');
});
test('上滑取消与权限对话框期间松手都不识别、不发送',async()=>{
 const f=fixture();await f.input.start();f.input.finish(true);await flush();assert.equal(f.recognitions(),0);assert.equal(f.sent.length,0);assert.equal(f.stops(),1);
 let permission;const g=fixture({getMedia:()=>new Promise(r=>{permission=r;})});const start=g.input.start();g.input.finish();permission(g.media);await start;
 assert.equal(g.recorders.length,0);assert.equal(g.sent.length,0);assert.equal(g.stops(),1);
});
test('离开页面后丢弃迟到识别；识别失败不发送',async()=>{
 let recognition;const f=fixture({transcribe:()=>new Promise(r=>{recognition=r;})});await f.input.start();f.input.finish();await flush();f.input.cancel();recognition({text:'迟到文字'});await flush();assert.equal(f.sent.length,0);
 const g=fixture({transcribe:async()=>{throw Error('asr unavailable');}});await g.input.start();g.input.finish();await flush();assert.equal(g.sent.length,0);assert.equal(g.state.error,'没听清，再说一次？');
});
