// H5 麦克风生命周期；原音只留内存，识别使用现有 Go 边界。
function startMeter(stream,onLevel) {
 const Context=globalThis.AudioContext || globalThis.webkitAudioContext;
 const audio=new Context(),source=audio.createMediaStreamSource(stream),analyser=audio.createAnalyser();
 analyser.fftSize=256;source.connect(analyser);const values=new Uint8Array(analyser.fftSize);let frame;
 const tick=()=>{analyser.getByteTimeDomainData(values);let peak=0;for(const v of values)peak=Math.max(peak,Math.abs(v-128)/128);onLevel(Math.min(1,peak*3));frame=requestAnimationFrame(tick);};tick();
 return ()=>{cancelAnimationFrame(frame);void audio.close();};
}

export function createVoiceInput({state,getMedia=()=>navigator.mediaDevices.getUserMedia({audio:true}),Recorder=globalThis.MediaRecorder,startMeter:meter=startMeter,convert,transcribe,onText,maxSeconds=60}) {
 Object.assign(state,{phase:'idle',seconds:0,level:0,cancelled:false,error:''});
 let current=null,disposed=false;
 const active=op=>current===op&&!disposed;
 const release=op=>{clearTimeout(op.timer);clearInterval(op.clock);op.stopMeter?.();op.stopMeter=null;op.stream?.getTracks().forEach(t=>t.stop());op.stream=null;};
 const reset=op=>{release(op);if(active(op)){current=null;state.phase='idle';state.level=0;}};
 const fail=op=>{if(!active(op))return;reset(op);state.error='没听清，再说一次？';};
 const api={
  async start(){
   if(disposed||current)return;
   const op={chunks:[]};current=op;state.phase='requesting';state.error='';state.cancelled=false;state.seconds=0;
   try {
    op.stream=await getMedia();if(!active(op)){release(op);return;}
    op.recorder=new Recorder(op.stream);op.recorder.addEventListener('dataavailable',e=>{if(e.data.size)op.chunks.push(e.data);});
    op.recorder.addEventListener('error',()=>fail(op),{once:true});
    op.recorder.addEventListener('stop',async()=>{
     release(op);if(!active(op))return;state.phase='transcribing';
     try {
      const {wav,durationMs}=await convert(new Blob(op.chunks,{type:op.recorder.mimeType}),{maxSeconds});op.chunks=[];if(!active(op))return;
      const result=await transcribe(wav);if(!active(op))return;if(!String(result.text||'').trim())throw Error('empty recognition');
      const metadata={durationMs};if(['HAPPY','SAD','ANGRY'].includes(result.emotion))metadata.emotion=result.emotion;
      await onText(result.text,metadata);reset(op);
     }catch{fail(op);}
    },{once:true});
    op.recorder.start(250);state.phase='recording';op.started=Date.now();
    op.stopMeter=meter(op.stream,level=>{if(active(op))state.level=level;});
    op.clock=setInterval(()=>{state.seconds=Math.floor((Date.now()-op.started)/1000);},200);
    op.timer=setTimeout(()=>{if(active(op))api.finish();},maxSeconds*1000);
   }catch{fail(op);}
  },
  move(cancelled){state.cancelled=cancelled;},
  finish(cancelled=state.cancelled){
   const op=current;if(!op)return;
   if(state.phase==='requesting'||cancelled){api.cancel();return;}
   if(state.phase!=='recording')return;
   state.phase='transcribing';op.recorder.stop();
  },
  cancel(){const op=current;current=null;state.phase='idle';state.level=0;if(!op)return;release(op);if(op.recorder?.state==='recording')op.recorder.stop();op.chunks=[];},
  dispose(){api.cancel();disposed=true;},
 };
 return api;
}
