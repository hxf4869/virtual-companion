import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodeMonoWAV, recordingWAV } from '../extension/vc-model-settings/voice-input.js';

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

test('ASR 容器解析仅接受一个有界单声道 WAV，不使用磁盘录音',()=>{
    const result=spawnSync('python3',[fileURLToPath(new URL('../../../ops/voice/asr/server_test.py',import.meta.url))],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
});
