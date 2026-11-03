import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { encodeMonoWAV, recordingWAV, installVoiceInput } from '../extension/vc-model-settings/voice-input.js';
import { installMiniDom } from './mini-dom.mjs';

test('录音编码是限幅的 16k 单声道 PCM16 WAV',async()=>{
    const data=await encodeMonoWAV(new Float32Array([-2,-.5,0,.5,2])).arrayBuffer();const view=new DataView(data);
    assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint16(34,true),16);
    assert.equal(view.getInt16(44,true),-32768);assert.equal(view.getInt16(52,true),32767);
});

test('声道先平均、OfflineAudioContext 完成抗混叠重采样，解码器最终关闭',async()=>{
    let closed=false,sourceBuffer,frames,rate;
    class Decoder {
        async decodeAudioData(){return {duration:1,length:48000,sampleRate:48000,numberOfChannels:2,getChannelData:(i)=>new Float32Array(48000).fill(i?-.5:1)};}
        createBuffer(){const samples=new Float32Array(48000);return {getChannelData:()=>samples};}
        async close(){closed=true;}
    }
    class Offline {
        constructor(channels,length,sampleRate){assert.equal(channels,1);frames=length;rate=sampleRate;}
        createBufferSource(){return {set buffer(value){sourceBuffer=value;},connect(){},start(){}};}
        async startRendering(){return {duration:1,getChannelData:()=>new Float32Array(16000).fill(.25)};}
    }
    const result=await recordingWAV(new Blob(['synthetic']),{AudioContext:Decoder,OfflineAudioContext:Offline});
    assert.equal(frames,16000);assert.equal(rate,16000);assert.equal(sourceBuffer.getChannelData(0)[0],.25);assert.equal(result.durationMs,1000);assert.equal(closed,true);
});

test('编码器尾部填充按用户配置的录音上限裁切，避免自动发送被 ASR 拒绝',async()=>{
    class Decoder {
        async decodeAudioData(){return {duration:1.02,length:48960,sampleRate:48000,numberOfChannels:1,getChannelData:()=>new Float32Array(48960)};}
        createBuffer(){return {getChannelData:()=>new Float32Array(48960)};}
        async close(){}
    }
    class Offline {
        constructor(channels,length,sampleRate){assert.equal(channels,1);assert.equal(sampleRate,16000);this.length=length;}
        createBufferSource(){return {connect(){},start(){}};}
        async startRendering(){return {duration:this.length/16000,getChannelData:()=>new Float32Array(this.length)};}
    }
    const {wav,durationMs}=await recordingWAV(new Blob(['synthetic']),{maxSeconds:1,AudioContext:Decoder,OfflineAudioContext:Offline});
    const view=new DataView(await wav.arrayBuffer());
    assert.equal(view.getUint32(40,true),16000*2);assert.equal(durationMs,1000);
});

test('ASR 容器解析仅接受一个有界单声道 WAV，不使用磁盘录音',()=>{
    const result=spawnSync('python3',[fileURLToPath(new URL('../../../ops/voice/asr/server_test.py',import.meta.url))],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
});

test('转录迟到时检查稳定会话身份和取消状态，仍允许当前会话正常发送', { timeout: 5000 }, async t => {
    for (const action of ['send', 'switch', 'cancel', 'destroy']) await t.test(action, async t => {
        const names = ['document', 'navigator', 'fetch', 'MediaRecorder', 'AudioContext', 'OfflineAudioContext', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener'];
        const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
        t.after(() => { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
        const set = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
        const doc = installMiniDom(); doc.getElementById = id => doc.querySelector(`#${id}`); doc.addEventListener = () => {};
        set('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
        set('fetch', async input => Response.json(String(input).endsWith('/engines') ? { asr: { enabled: true, healthy: true } } : { maxRecordingSeconds: 60 }));
        set('addEventListener', () => {}); set('requestAnimationFrame', () => 1); set('cancelAnimationFrame', () => {});
        class Audio {
            async close() {} createMediaStreamSource() { return { connect() {} }; }
            createAnalyser() { return { fftSize: 256, getByteTimeDomainData(values) { values.fill(128); } }; }
            async decodeAudioData() { return { duration: 1, length: 16000, sampleRate: 16000, numberOfChannels: 1, getChannelData: () => new Float32Array(16000) }; }
            createBuffer() { return { getChannelData: () => new Float32Array(16000) }; }
        }
        class Offline {
            createBufferSource() { return { connect() {}, start() {} }; }
            async startRendering() { return { duration: 1, getChannelData: () => new Float32Array(16000) }; }
        }
        class Recorder {
            constructor() { this.listeners = {}; this.mimeType = 'audio/wav'; }
            addEventListener(name, run) { this.listeners[name] = run; }
            start() {}
            stop() { this.listeners.dataavailable({ data: new Blob(['synthetic']) }); void this.listeners.stop(); }
        }
        set('AudioContext', Audio); set('OfflineAudioContext', Offline); set('MediaRecorder', Recorder);
        const form = doc.createElement('form'); form.id = 'send_form';
        const box = doc.createElement('textarea'); box.id = 'send_textarea'; form.append(box); doc.body.append(form);
        const events = new EventEmitter(), chat = [{ mes: 'synthetic A' }];
        const context = { chat, chatId: 'A', chatMetadata: { vc_binding: { mode: 'COMPANION' }, vc_f2: { id: 'chat-A' } }, eventSource: events,
            eventTypes: { CHAT_CHANGED: 'chat', GENERATION_STARTED: 'start', GENERATION_ENDED: 'end' } };
        let resolveRecognition, recognitionStarted;
        const pending = new Promise(resolve => { resolveRecognition = resolve; });
        const started = new Promise(resolve => { recognitionStarted = resolve; });
        const sent = [], tick = () => new Promise(resolve => setImmediate(resolve));
        const controller = installVoiceInput({ doc, getContext: () => context, recognize: () => { recognitionStarted(); return pending; }, sendText: async text => sent.push({ chatId: context.chatId, text }) });
        await tick(); await tick();
        const mic = doc.querySelector('#vc-voice-input'); mic.click(); await tick(); mic.click(); await started;
        if (action === 'switch') {
            // Match native ST: mutate the array before CHAT_CHANGED is emitted.
            chat.splice(0, chat.length, { mes: 'synthetic B' });
            context.chatId = 'B'; context.chatMetadata = { vc_binding: { mode: 'COMPANION' }, vc_f2: { id: 'chat-B' } };
        }
        if (action === 'destroy') { controller.destroy(); assert.equal(doc.querySelector('#vc-voice-input'), null); assert.equal(events.listenerCount('chat'), 0); }
        if (action === 'cancel') mic.dispatch('keydown', { key: 'Escape' });
        resolveRecognition({ text: 'synthetic transcript from A' }); await tick(); await tick();
        assert.deepEqual(sent, action === 'send' ? [{ chatId: 'A', text: 'synthetic transcript from A' }] : []);
        assert.equal(mic.getAttribute('aria-pressed'), 'false');
    });
});
