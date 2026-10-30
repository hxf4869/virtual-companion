import { fetchVoiceEngines, fetchVoiceSettings, transcribeVoice } from './api.js';
import { icon } from './ui/icons.js';

export const INPUT_COPY={hold:'按住说话',start:'开始录音',stop:'结束录音',recording:'松开发送，上滑取消',cancel:'松开取消',listening:'正在听…',failed:'没听清，再说一次？'};

export function encodeMonoWAV(samples, sampleRate=16000) {
    const data=new ArrayBuffer(44+samples.length*2);const view=new DataView(data);
    const word=(offset,text)=>[...text].forEach((ch,i)=>view.setUint8(offset+i,ch.charCodeAt(0)));
    word(0,'RIFF');view.setUint32(4,data.byteLength-8,true);word(8,'WAVE');word(12,'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
    word(36,'data');view.setUint32(40,samples.length*2,true);
    for(let i=0;i<samples.length;i++) {const value=Math.max(-1,Math.min(1,samples[i]));view.setInt16(44+i*2,value<0?value*32768:value*32767,true);}
    return new Blob([data],{type:'audio/wav'});
}

export async function recordingWAV(blob, {AudioContext: Context=globalThis.AudioContext || globalThis.webkitAudioContext, OfflineAudioContext: Offline=globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext}={}) {
    const decoder=new Context();
    try {
        const decoded=await decoder.decodeAudioData(await blob.arrayBuffer());
        const frames=Math.min(60*16000,Math.ceil(decoded.duration*16000));
        if (!frames || frames>60*16000) throw new Error('duration');
        const mono=decoder.createBuffer(1,decoded.length,decoded.sampleRate);
        const target=mono.getChannelData(0);
        for(let channel=0;channel<decoded.numberOfChannels;channel++) {
            const values=decoded.getChannelData(channel);
            for(let i=0;i<values.length;i++) target[i]+=values[i]/decoded.numberOfChannels;
        }
        const offline=new Offline(1,frames,16000);const source=offline.createBufferSource();source.buffer=mono;source.connect(offline.destination);source.start();
        const result=await offline.startRendering();return {wav:encodeMonoWAV(result.getChannelData(0)),durationMs:Math.ceil(result.duration*1000)};
    } finally {await decoder.close();}
}

export function installVoiceInput({getContext,sendText,doc=globalThis.document,recognize=transcribeVoice}={}) {
    const form=doc.querySelector('#send_form');const box=doc.querySelector('#send_textarea');
    if(!form || !box || doc.getElementById('vc-voice-input') || !globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return;
    const button=doc.createElement('button');button.type='button';button.id='vc-voice-input';button.innerHTML=icon('mic');button.setAttribute('aria-label',INPUT_COPY.start);button.hidden=true;
    const note=doc.createElement('div');note.id='vc-voice-input-note';note.setAttribute('role','status');note.hidden=true;
    const label=doc.createElement('span');const level=doc.createElement('span');level.className='vc-voice-input-level';level.setAttribute('aria-hidden','true');note.append(label,level);
    form.append(button,note);
    let available=false,maxSeconds=60,phase='idle',recorder,stream,audioContext,frame,timer,started=0,cancelled=false,startY=0,touch=false,recordingChat;
    const sync=()=>{
        const context=getContext();const companion=context?.chatMetadata?.vc_binding?.mode==='COMPANION' && !context.groupId;
        const show=available && companion && !box.value.trim() && doc.body.getAttribute('data-generating')!=='true';
        button.hidden=!show && phase==='idle';form.classList.toggle('vc-voice-input-available',show);button.disabled=phase==='listening';
    };
    const refresh=async()=>{
        try {const [capabilities,settings]=await Promise.all([fetchVoiceEngines(),fetchVoiceSettings()]);available=capabilities.asr?.enabled && capabilities.asr?.healthy;maxSeconds=settings.maxRecordingSeconds;} catch {available=false;}
        sync();
    };
    const release=()=>{
        clearTimeout(timer);cancelAnimationFrame(frame);stream?.getTracks().forEach((track)=>track.stop());stream=null;
        if(audioContext) void audioContext.close();audioContext=null;
    };
    const reset=()=>{release();phase='idle';recorder=null;note.hidden=true;button.setAttribute('aria-label',INPUT_COPY.start);button.setAttribute('aria-pressed','false');sync();};
    const fail=()=>{reset();label.textContent=INPUT_COPY.failed;note.hidden=false;};
    const finish=(cancel=false)=>{cancelled=cancel;clearTimeout(timer);if(phase==='requesting'){phase='cancelled';return;}if(phase!=='recording')return;phase='listening';button.disabled=true;label.textContent=INPUT_COPY.listening;recorder.stop();};
    const start=async()=>{
        if(phase!=='idle' || !available)return;
        phase='requesting';cancelled=false;recordingChat=getContext().chat;note.hidden=true;
        try {
            stream=await navigator.mediaDevices.getUserMedia({audio:true});
            if(phase==='cancelled' || getContext().chat!==recordingChat){reset();return;}
            const chunks=[];recorder=new MediaRecorder(stream);const activeRecorder=recorder;
            recorder.addEventListener('dataavailable',(event)=>{if(event.data.size)chunks.push(event.data);});
            recorder.addEventListener('stop',async()=>{
                const raw=new Blob(chunks,{type:activeRecorder.mimeType});chunks.length=0;release();
                if(cancelled || getContext().chat!==recordingChat){reset();return;}
                try {
                    const {wav,durationMs}=await recordingWAV(raw);
                    const result=await recognize(wav);
                    if(getContext().chat!==recordingChat){reset();return;}
                    const metadata={durationMs};if(['HAPPY','SAD','ANGRY'].includes(result.emotion))metadata.emotion=result.emotion;
                    reset();await sendText(result.text,metadata);
                } catch {fail();}
            },{once:true});
            recorder.addEventListener('error',()=>{cancelled=true;fail();},{once:true});
            recorder.start(250);phase='recording';started=Date.now();button.setAttribute('aria-label',INPUT_COPY.stop);button.setAttribute('aria-pressed','true');note.hidden=false;
            const Context=globalThis.AudioContext || globalThis.webkitAudioContext;audioContext=new Context();
            const source=audioContext.createMediaStreamSource(stream);const analyser=audioContext.createAnalyser();analyser.fftSize=256;source.connect(analyser);const values=new Uint8Array(analyser.fftSize);
            const meter=()=>{
                if(phase!=='recording')return;analyser.getByteTimeDomainData(values);let peak=0;for(const value of values)peak=Math.max(peak,Math.abs(value-128)/128);
                level.style.setProperty('--vc-voice-level',String(Math.min(1,peak*3)));label.textContent=`${Math.floor((Date.now()-started)/1000)}″ · ${cancelled?INPUT_COPY.cancel:INPUT_COPY.recording}`;frame=requestAnimationFrame(meter);
            };meter();timer=setTimeout(()=>finish(false),maxSeconds*1000);
        } catch {fail();}
    };
    button.addEventListener('pointerdown',(event)=>{if(event.pointerType!=='touch')return;event.preventDefault();touch=true;startY=event.clientY;button.setPointerCapture(event.pointerId);void start();});
    button.addEventListener('pointermove',(event)=>{if(touch && phase==='recording')cancelled=startY-event.clientY>64;});
    button.addEventListener('pointerup',(event)=>{if(!touch)return;event.preventDefault();touch=false;finish(cancelled);});
    button.addEventListener('pointercancel',()=>{touch=false;finish(true);});
    button.addEventListener('click',(event)=>{if(event.pointerType==='touch')return;if(phase==='recording')finish(false);else void start();});
    button.addEventListener('keydown',(event)=>{if(event.key==='Escape'){event.preventDefault();finish(true);}});
    box.addEventListener('input',sync);
    doc.addEventListener('vc-chat-retry',sync);
    globalThis.addEventListener('vc-voice-settings-changed',()=>void refresh());
    const context=getContext();context.eventSource?.on(context.eventTypes.CHAT_CHANGED,()=>{finish(true);if(phase==='idle')note.hidden=true;void refresh();});
    context.eventSource?.on(context.eventTypes.GENERATION_STARTED,sync);context.eventSource?.on(context.eventTypes.GENERATION_ENDED,sync);
    void refresh();
}
