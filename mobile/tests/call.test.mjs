import test from 'node:test';import assert from 'node:assert/strict';
import {createCallCapture,createCallSession} from '../src/voice/call.mjs';
const tick=()=>new Promise(r=>setImmediate(r));

test('接听播放已有来电开场，不新建聊天消息；无语音时保留字幕',async()=>{
 for(const voice of [undefined,{status:'ready',clipId:'42'}]){
  const state={},played=[];let sends=0;
  const c=createCallSession({state,opening:{body:'合成开场',voice},engine:{setCallMode:async()=>{},stopVoice:async()=>{},playVoice:async id=>played.push(id)},session:{send:async()=>{sends++;}},chat:{busy:false},capture:()=>({start:async()=>{},stop(){}})});
  await c.start();assert.equal(state.current,'合成开场');assert.equal(sends,0);assert.deepEqual(played,voice?['42']:[]);if(!voice)assert.equal(state.textRequired,true);await c.stop();
 }
});

test('连续收音按停顿分段；静音和结束均释放当前录音',async()=>{
 let level,clock=0,stopped=0,speech=0;const clips=[],recorders=[];
 class Recorder {
  constructor(){this.events={};this.state='inactive';recorders.push(this);this.mimeType='audio/webm';}
  addEventListener(k,fn){this.events[k]=fn;}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.events.dataavailable?.({data:new Blob(['segment'])});this.events.stop?.();}
 }
 const stream={getTracks:()=>[{enabled:true,stop(){stopped++;}}]};
 const c=createCallCapture({getMedia:async()=>stream,Recorder,meter:(_,fn)=>{level=fn;return ()=>{};},now:()=>clock,onSpeech:()=>speech++,onQuiet:()=>{},onLevel:()=>{},onUtterance:(...a)=>clips.push(a),onError:e=>{throw e;}});
 await c.start();clock=100;level(.2);clock=1000;level(0);await tick();assert.equal(clips.length,1);assert.equal(speech,1);
 clock=1100;level(.2);c.setMuted(true);await tick();assert.equal(clips.length,2);c.stop();assert.equal(stopped,1);assert.ok(recorders.every(r=>r.state==='inactive'));
});

test('ASR 串行，用户继续说话时合并识别文字；同一聊天保留声音元数据',async()=>{
 let hooks,recognize;const asr=[],sent=[];let active=0,maxActive=0;
 const chat={busy:false,messages:[]};const engine={setCallMode:async()=>{},stopVoice:async()=>{},messages:()=>chat.messages};
 const session={stop(){chat.busy=false;},async send(args){sent.push(args);chat.messages.push({id:sent.length,user:false,text:'短回复',extra:{vc_voice_attempt:{sent:false}}});return true;}};
 const c=createCallSession({state:{},engine,session,chat,capture:opts=>{hooks=opts;return {start:async()=>{},stop(){},setMuted(){},discard(){}};},convert:async()=>({wav:new Blob(['wav']),durationMs:1000}),transcribe:()=>{active++;maxActive=Math.max(active,maxActive);return new Promise(r=>{asr.push(()=>{active--;r({text:asr.length===1?'第一句':'第二句'});});recognize=true;});}});
 await c.start();hooks.onSpeech();hooks.onQuiet();hooks.onUtterance(new Blob(['a']),{durationMs:1000});await tick();assert.ok(recognize);
 hooks.onSpeech();hooks.onUtterance(new Blob(['b']),{durationMs:1000});asr[0]();await tick();assert.equal(sent.length,0);hooks.onQuiet();asr[1]();await tick();await tick();
 assert.equal(maxActive,1);assert.equal(sent[0].text,'第一句 第二句');assert.equal(sent[0].voiceInput.durationMs,2000);await c.stop();
});

test('挂断后迟到的 ASR 不会发送，开口会停止当前生成与播放',async()=>{
 let hooks,finish,stops=0,playsStopped=0,sends=0;const chat={busy:true,messages:[]};
 const c=createCallSession({state:{},engine:{setCallMode:async()=>{},stopVoice:async()=>{playsStopped++;},messages:()=>[]},session:{stop(){stops++;chat.busy=false;},send:async()=>{sends++;return true;}},chat,capture:opts=>{hooks=opts;return {start:async()=>{},stop(){},setMuted(){},discard(){}};},convert:async()=>({wav:new Blob(['wav']),durationMs:1000}),transcribe:()=>new Promise(r=>{finish=r;})});
 await c.start();hooks.onSpeech();hooks.onQuiet();hooks.onUtterance(new Blob(['a']),{durationMs:1000});await tick();assert.equal(stops,1);assert.ok(playsStopped>0);
 const closing=c.stop();finish({text:'迟到识别'});await closing;await tick();assert.equal(sends,0);
});
