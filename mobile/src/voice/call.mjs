import {startMeter} from './input.mjs';
import {until} from '../engine/engine.mjs';
import {CALL_COPY} from '../copy.mjs';

// 一次 getUserMedia；有声后等 700ms 停顿分段，无声片段最多保留一秒。
export function createCallCapture({onSpeech,onQuiet,onUtterance,onLevel,onError,maxSeconds=60,
 getMedia=()=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}),Recorder=globalThis.MediaRecorder,meter=startMeter,now=Date.now}) {
 let stream,segment,stopMeter,alive=false,muted=false,waitingQuiet=false,lastLoud=0;
 function finish(waitQuiet=false){const s=segment;if(!s)return;segment=null;clearTimeout(s.timer);waitingQuiet=waitQuiet;if(s.speech)onQuiet();if(s.recorder.state==='recording')s.recorder.stop();}
 function begin(){
  if(!alive||muted||waitingQuiet||segment)return;
  const s={chunks:[],started:now(),speech:false,recorder:new Recorder(stream)};segment=s;
  s.recorder.addEventListener('dataavailable',e=>{if(e.data.size)s.chunks.push(e.data);});
  s.recorder.addEventListener('error',e=>onError(e),{once:true});
  s.recorder.addEventListener('stop',()=>{
   if(alive&&s.speech)onUtterance(new Blob(s.chunks,{type:s.recorder.mimeType}),{durationMs:Math.min(maxSeconds*1000,Math.max(1,now()-s.started))});
   s.chunks=[];begin();
  },{once:true});
  s.recorder.start(200);s.timer=setTimeout(()=>finish(true),maxSeconds*1000);
 }
 const api={
  async start(){
   alive=true;stream=await getMedia();if(!alive){stream.getTracks().forEach(t=>t.stop());return;}
   begin();stopMeter=meter(stream,raw=>{
    const level=muted?0:raw;onLevel(level);const time=now();
    if(waitingQuiet){if(level>=.055)lastLoud=time;else if(time-lastLoud>=700){waitingQuiet=false;begin();}return;}
    const s=segment;if(!s)return;
    if(level>=.055){lastLoud=time;if(!s.speech){s.speech=true;onSpeech();}}
    else if(s.speech&&time-lastLoud>=700)finish();
    else if(!s.speech&&time-s.started>=1000)finish();
   });
  },
  setMuted(value){muted=value;stream?.getTracks().forEach(t=>{t.enabled=!value;});if(value)finish();else begin();},
  discard(){if(segment)segment.speech=false;lastLoud=now();finish(true);},
  stop(){alive=false;finish();stopMeter?.();stopMeter=null;stream?.getTracks().forEach(t=>t.stop());stream=null;},
 };
 return api;
}

// ASR 只跑一个；识别中继续说的话依次合并，生成/播放中的开口立即打断。
export function createCallSession({state,engine,session,chat,convert,transcribe,opening,maxSeconds=60,capture=createCallCapture,now=Date.now}) {
 Object.assign(state,{phase:'connecting',muted:false,elapsed:0,level:0,previous:'',current:'',error:'',clipId:'',needsPlay:false,textRequired:false});
 const stats={turns:0,interruptions:0,latencies:[]};
 let alive=false,epoch=0,speaking=false,recorder,clock,started=0,draining=false,drainDone=Promise.resolve(),asrAbort,queue=[],queuedMs=0,texts=[],voiceMs=0,asrMs=0,emotion,lastEndedAt=0;
 const current=token=>alive&&epoch===token;
 const present=text=>{state.previous=state.current;state.current=text;};
 async function play(clipId,token,timing){
  if(!current(token))return;state.clipId=clipId;state.needsPlay=false;
  await engine.playVoice(clipId,{
   onState(value){if(current(token))state.phase=value?'speaking':'listening';},
   onPlayed(){if(current(token)&&timing){stats.latencies.push({asrMs:timing.asrMs,replyMs:timing.replyMs,voiceMs:timing.voiceMs,endToPlayMs:now()-timing.endedAt});if(stats.latencies.length>10)stats.latencies.shift();}},
   onError(){if(current(token)){state.needsPlay=true;state.textRequired=true;state.phase='listening';}},
  });
 }
 async function respond(text,durationMs,recognitionMs,voiceEmotion,endedAt){
  const token=++epoch,timing={start:now(),asrMs:recognitionMs,endedAt};stats.turns++;present(text);state.phase='thinking';state.error='';state.textRequired=false;
  const before=engine.messages().at(-1)?.id??-1;
  try {
   if(chat.busy)session.stop();
   const sent=await session.send({text,voiceInput:{durationMs,call:true,...(voiceEmotion?{emotion:voiceEmotion}:{})}});if(!current(token))return;if(!sent)throw Error('send');
   await until(()=>!current(token)||!chat.busy,{timeout:120000,label:'call reply'});if(!current(token))return;if(chat.error)throw Error('reply');
   let reply=engine.messages().findLast(m=>!m.user&&m.id>before);if(!reply)throw Error('reply');
   timing.replyMs=now()-timing.start;present(reply.text.replace(/<voice\s*\/>|<sticker\b[^>]*>/gi,'').trim());
   try {await until(()=>{
    if(!current(token))return true;
    reply=engine.messages().find(m=>m.id===reply.id);
    return reply?.extra?.vc_voice_attempt?.sent===false||['ready','failed','expired'].includes(reply?.extra?.vc_voice?.status);
   },{timeout:20000,interval:100,label:'call voice'});}catch{ /* 现有语音失败/超时按文字展示，不另发一次 TTS。 */ }
   if(!current(token))return;timing.voiceMs=now()-timing.start-timing.replyMs;
   if(reply?.extra?.vc_voice?.status==='ready'){
    await until(()=>!current(token)||!speaking,{timeout:maxSeconds*1000,label:'call listening'});if(current(token))await play(reply.extra.vc_voice.clipId,token,timing);
   }else{state.textRequired=true;state.phase='listening';}
  }catch{if(current(token)){state.error=CALL_COPY.failed;state.phase='listening';state.textRequired=true;}}
 }
 function flush(){if(!alive||speaking||draining||queue.length||!texts.length)return;const text=texts.join(' '),duration=voiceMs,ms=asrMs,voiceEmotion=emotion;texts=[];voiceMs=0;asrMs=0;emotion=undefined;void respond(text,duration,ms,voiceEmotion,lastEndedAt);}
 async function drain(){
  if(draining)return;draining=true;let done;drainDone=new Promise(resolve=>{done=resolve;});
  try {
   while(alive&&queue.length){
    const item=queue.shift(),start=now();
    try {
     const {wav,durationMs}=await convert(item.raw,{maxSeconds});if(!alive)return;
     asrAbort=new AbortController();const result=await transcribe(wav,{signal:asrAbort.signal});asrAbort=null;if(!alive)return;if(!String(result.text||'').trim())throw Error('empty');
     texts.push(result.text);voiceMs+=durationMs;asrMs+=now()-start;if(['HAPPY','SAD','ANGRY'].includes(result.emotion))emotion=result.emotion;
    }catch{if(alive){queue=[];texts=[];voiceMs=0;asrMs=0;emotion=undefined;queuedMs=0;recorder.discard();speaking=false;state.error='没听清，再说一次？';state.phase='listening';}return;}
    finally{queuedMs=Math.max(0,queuedMs-item.durationMs);}
   }
  }finally{asrAbort=null;draining=false;done();flush();}
 }
 const api={stats,
  async start(){
   alive=true;epoch++;queue=[];texts=[];queuedMs=0;state.phase='connecting';state.error='';
   try {
    await engine.setCallMode(true);if(!alive)return;
    recorder=capture({maxSeconds,
     onLevel:value=>{if(alive)state.level=value;},
     onSpeech(){if(!alive)return;speaking=true;if(['thinking','speaking'].includes(state.phase))stats.interruptions++;epoch++;state.error='';state.clipId='';state.needsPlay=false;state.phase='listening';if(chat.busy)session.stop();void engine.stopVoice();},
     onQuiet(){speaking=false;},
     onUtterance(raw,{durationMs}){
      if(!alive)return;
      if(queuedMs+durationMs>maxSeconds*1000){state.error=CALL_COPY.failed;void api.stop().then(()=>{state.phase='error';});return;}
      lastEndedAt=now();queuedMs+=durationMs;queue.push({raw,durationMs});if(!speaking)state.phase='listening';void drain();
     },onError(){if(alive){state.error=CALL_COPY.failed;void api.stop().then(()=>{state.phase='error';});}},
    });
    const openingToken=epoch;await recorder.start();if(!alive)return;started=now();clock=setInterval(()=>{state.elapsed=Math.floor((now()-started)/1000);},500);state.phase='listening';
    if(opening?.body&&current(openingToken)){present(opening.body);if(opening.voice?.status==='ready')await play(opening.voice.clipId,openingToken);else state.textRequired=true;}
   }catch{await api.stop();state.phase='error';state.error=CALL_COPY.failed;}
  },
  setMuted(value){state.muted=value;recorder?.setMuted(value);},
  async retryPlay(){if(state.clipId)await play(state.clipId,epoch);},
  async stop(){
   alive=false;epoch++;queue=[];texts=[];clearInterval(clock);recorder?.stop();recorder=null;asrAbort?.abort();if(chat.busy)session.stop();state.level=0;state.phase='ended';
   await drainDone;const cleanup=await Promise.allSettled([engine.stopVoice(),engine.setCallMode(false)]);if(cleanup.some(r=>r.status==='rejected'))state.error=CALL_COPY.failed;
  },
 };
 return api;
}
