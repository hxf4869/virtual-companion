import { fetchVoiceEngines, fetchVoiceSettings, transcribeVoice } from './api.js';
import { icon } from './ui/icons.js';
import { INPUT_COPY, encodeMonoWAV, recordingWAV } from './voice-logic.js';

export { INPUT_COPY, encodeMonoWAV, recordingWAV };

export function installVoiceInput({getContext,sendText,doc=globalThis.document,recognize=transcribeVoice,host}={}) {
    const form=doc.querySelector('#send_form');const box=doc.querySelector('#send_textarea');
    if(!form || !box || doc.getElementById('vc-voice-input') || !globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return;
    const button=doc.createElement('button');button.type='button';button.id='vc-voice-input';button.innerHTML=icon('mic');button.setAttribute('aria-label',INPUT_COPY.start);button.hidden=true;
    const note=doc.createElement('div');note.id='vc-voice-input-note';note.setAttribute('role','status');note.hidden=true;
    const label=doc.createElement('span');const level=doc.createElement('span');level.className='vc-voice-input-level';level.setAttribute('aria-hidden','true');note.append(label,level);
    const mount=host || form;mount.append(button,note);
    const listeners=new AbortController();let dead=false;
    const listen=(node,name,handler,options={})=>node.addEventListener(name,handler,{...options,signal:listeners.signal});
    let available=false,maxSeconds=60,phase='idle',recorder,stream,audioContext,frame,timer,started=0,cancelled=false,startY=0,touch=false;
    const sync=()=>{
        if(dead)return;
        const context=getContext();const companion=context?.chatMetadata?.vc_binding?.mode==='COMPANION' && !context.groupId;
        const show=available && companion && !box.value.trim() && doc.body.getAttribute('data-generating')!=='true';
        button.hidden=!show && phase==='idle';form.classList.toggle('vc-voice-input-available',show);button.disabled=phase==='listening';
    };
    const refresh=async()=>{
        try {const [capabilities,settings]=await Promise.all([fetchVoiceEngines(),fetchVoiceSettings()]);available=capabilities.asr?.enabled && capabilities.asr?.healthy;maxSeconds=settings.maxRecordingSeconds;} catch {available=false;}
        if(!dead)sync();
    };
    const release=()=>{
        clearTimeout(timer);cancelAnimationFrame(frame);stream?.getTracks().forEach((track)=>track.stop());stream=null;
        if(audioContext) void audioContext.close();audioContext=null;
    };
    const reset=()=>{release();phase='idle';recorder=null;note.hidden=true;button.setAttribute('aria-label',INPUT_COPY.start);button.setAttribute('aria-pressed','false');sync();};
    const fail=()=>{if(dead)return;reset();label.textContent=INPUT_COPY.failed;note.hidden=false;};
    const finish=(cancel=false)=>{cancelled=cancel;clearTimeout(timer);if(phase==='requesting'){phase='cancelled';return;}if(phase!=='recording')return;phase='listening';button.disabled=true;label.textContent=INPUT_COPY.listening;recorder.stop();};
    const start=async()=>{
        if(dead || phase!=='idle' || !available)return;
        phase='requesting';cancelled=false;note.hidden=true;
        const context=getContext(),chatId=context.chatId,chatIdentity=context.chatMetadata?.vc_f2?.id;
        // ST replaces chat contents in place; the array is not a chat identity.
        const active=()=>{const current=getContext();return !dead && !cancelled && current.chatId===chatId && current.chatMetadata?.vc_f2?.id===chatIdentity;};
        try {
            stream=await navigator.mediaDevices.getUserMedia({audio:true});
            if(phase==='cancelled' || !active()){reset();return;}
            const chunks=[];recorder=new MediaRecorder(stream);const activeRecorder=recorder;
            recorder.addEventListener('dataavailable',(event)=>{if(event.data.size)chunks.push(event.data);});
            recorder.addEventListener('stop',async()=>{
                const raw=new Blob(chunks,{type:activeRecorder.mimeType});chunks.length=0;release();
                if(!active()){reset();return;}
                try {
                    const {wav,durationMs}=await recordingWAV(raw,{maxSeconds});
                    if(!active()){reset();return;}
                    const result=await recognize(wav);
                    if(!active()){reset();return;}
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
    listen(button,'pointerdown',(event)=>{if(event.pointerType!=='touch')return;event.preventDefault();touch=true;startY=event.clientY;button.setPointerCapture(event.pointerId);void start();});
    listen(button,'pointermove',(event)=>{if(touch && phase==='recording')cancelled=startY-event.clientY>64;});
    listen(button,'pointerup',(event)=>{if(!touch)return;event.preventDefault();touch=false;finish(cancelled);});
    listen(button,'pointercancel',()=>{touch=false;finish(true);});
    listen(button,'click',(event)=>{if(event.pointerType==='touch')return;if(phase==='recording')finish(false);else void start();});
    listen(button,'keydown',(event)=>{if(event.key==='Escape'){event.preventDefault();finish(true);}});
    listen(box,'input',sync);
    listen(doc,'vc-chat-retry',sync);
    listen(globalThis,'vc-voice-settings-changed',()=>void refresh());
    const context=getContext(),changed=()=>{finish(true);if(phase==='idle')note.hidden=true;void refresh();};
    const bound=[[context.eventTypes.CHAT_CHANGED,changed],[context.eventTypes.GENERATION_STARTED,sync],[context.eventTypes.GENERATION_ENDED,sync]];
    for(const [type,handler] of bound)context.eventSource?.on(type,handler);
    void refresh();
    return {destroy(){if(dead)return;dead=true;cancelled=true;listeners.abort();if(recorder?.state==='recording')recorder.stop();release();
        for(const [type,handler] of bound)context.eventSource?.removeListener(type,handler);button.remove();note.remove();form.classList.remove('vc-voice-input-available');}};
}
