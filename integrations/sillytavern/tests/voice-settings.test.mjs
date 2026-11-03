import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installReactDom } from './react-dom.mjs';

const settings={revision:7,updatedAt:'synthetic',kokoroEnabled:true,cosyVoiceEnabled:true,asrEnabled:false,kokoroTimeoutSeconds:60,cosyVoiceTimeoutSeconds:300,asrTimeoutSeconds:30,dailyChatLimit:60,dailyProactiveLimit:8,maxRecordingSeconds:60,voiceFrequency:'STANDARD',cosyVoiceInstructions:{morning:'You are a helpful assistant.',night:'You are a helpful assistant.',care:'You are a helpful assistant.',share:'You are a helpful assistant.',default:'You are a helpful assistant.'},proactiveVoiceRates:{morning:1,night:1,care:.5,share:.3,default:0},kokoroMoodSpeeds:{开心:1.05}};
const engines={tts:[{engine:'kokoro',configured:true,healthy:true,enabled:true,voices:[{id:'zf_001',name:'女声',gender:'FEMALE'},{id:'zm_010',name:'男声',gender:'MALE'}]},{engine:'cosyvoice',configured:false,voices:[]}],asr:{configured:false}};

test('语音图标是可解析 SVG 中可引用的 symbol',()=>{
    const result=spawnSync('python3',['-c',`import sys,xml.etree.ElementTree as E
r=E.parse(sys.argv[1]).getroot()
symbols={s.get('id'):s for s in r.findall('{http://www.w3.org/2000/svg}symbol')}
assert all(name in symbols and len(symbols[name])>0 for name in ['mic','pause','volume-2'])`,fileURLToPath(new URL('../extension/vc-model-settings/ui/icons/lucide.svg',import.meta.url))],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
});

test('全局表单包含健康、超时、上限、频率、场景指令与比例，保留 revision',async(t)=>{
    const doc=installReactDom(t),form=doc.createElement('form');doc.body.append(form);
    const {readGlobalVoiceSettings}=await import('../extension/vc-model-settings/voice-settings.js');
    const {mountVoiceFormView,voiceFormValues}=await import('../extension/vc-model-settings/desktop/build/index.js');
    const values=voiceFormValues(settings);
    const props=()=>({mode:'global',values,engines,disabled:false,onFieldChange(key,value){values[key]=value;view.update(props());}});
    const view=mountVoiceFormView(form,props());
    try{
        const payload=readGlobalVoiceSettings(form,settings);
        assert.equal(payload.expectedRevision,7);assert.equal(Object.hasOwn(payload,'revision'),false);assert.equal(Object.hasOwn(payload,'updatedAt'),false);
        assert.equal(payload.proactiveVoiceRates.care,.5);assert.equal(payload.kokoroMoodSpeeds['开心'],1.05);
        assert.match(form.textContent,/未配置/);assert.match(form.textContent,/发送比例/);
        assert.equal(form.querySelector('[data-voice-field="cosyVoiceEnabled"]').disabled,true);
    }finally{view.unmount();}
});

test('角色设置按性别列音色，隐藏未配置引擎；写入沿用完整旧偏好并区分 null',async(t)=>{
    const doc=installReactDom(t),form=doc.createElement('form');doc.body.append(form);
    const {relationshipVoicePayload}=await import('../extension/vc-model-settings/voice-settings.js');
    const {mountVoiceFormView,voiceFormValues}=await import('../extension/vc-model-settings/desktop/build/index.js');
    const relationship={relationshipId:'9007199254740993',companionName:'合成角色',userAddressAs:'你',replyLength:'SHORT',initiative:'LOW',humor:'LIGHT',advicePref:'ASK_FIRST',remindersAllowed:true,memoryShareScope:'RELATIONSHIP',avoidTopics:[],gender:'FEMALE',avatarRef:'',speed:1,proactiveVoice:true};
    const values=voiceFormValues(settings,relationship);
    const props=()=>({mode:'relationship',values,engines,disabled:false,preview:{},onPreview(){},onFieldChange(key,value){values[key]=value;view.update(props());}});
    const view=mountVoiceFormView(form,props());
    try{
        assert.match(form.innerHTML,/男声/);assert.equal(form.querySelector('[data-voice-field="cosyVoice"]'),null);
        for(const field of form.querySelectorAll('select')){field.value='';field.dispatchEvent(new Event('change',{bubbles:true}));}
        const speed=form.querySelector('input[type="range"]');
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(speed,'1.1');speed.dispatchEvent(new Event('input',{bubbles:true}));
        const payload=relationshipVoicePayload(relationship,form);
        assert.equal(payload.kokoroVoice,null);assert.equal(payload.voiceFrequency,null);assert.equal(payload.proactiveEngine,null);assert.equal(payload.speed,1.1);assert.equal(payload.replyLength,'SHORT');assert.equal(payload.companionName,'合成角色');assert.equal(payload.proactiveVoice,true);
    }finally{view.unmount();}
});
