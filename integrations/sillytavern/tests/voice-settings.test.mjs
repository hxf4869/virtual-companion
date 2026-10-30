import assert from 'node:assert/strict';
import test from 'node:test';
import { readGlobalVoiceSettings, relationshipVoicePayload, renderGlobalVoiceSettings, renderRelationshipVoiceSettings } from '../extension/vc-model-settings/voice-settings.js';
import { installMiniDom } from './mini-dom.mjs';

const settings={revision:7,updatedAt:'synthetic',kokoroEnabled:true,cosyVoiceEnabled:true,asrEnabled:false,kokoroTimeoutSeconds:60,cosyVoiceTimeoutSeconds:300,asrTimeoutSeconds:30,dailyChatLimit:60,dailyProactiveLimit:8,maxRecordingSeconds:60,voiceFrequency:'STANDARD',cosyVoiceInstructions:{morning:'You are a helpful assistant.',night:'You are a helpful assistant.',care:'You are a helpful assistant.',share:'You are a helpful assistant.',default:'You are a helpful assistant.'},proactiveVoiceRates:{morning:1,night:1,care:.5,share:.3,default:0},kokoroMoodSpeeds:{开心:1.05}};
const engines={tts:[{engine:'kokoro',configured:true,healthy:true,enabled:true,voices:[{id:'zf_001',name:'女声',gender:'FEMALE'},{id:'zm_010',name:'男声',gender:'MALE'}]},{engine:'cosyvoice',configured:false,voices:[]}],asr:{configured:false}};

test('全局表单包含健康、超时、上限、频率、场景指令与比例，保留 revision',()=>{
    const doc=installMiniDom();const form=doc.createElement('form');form.innerHTML=renderGlobalVoiceSettings(settings,engines);
    for(const field of form.querySelectorAll('input'))field.value=field.getAttribute('value');
    for(const field of form.querySelectorAll('select'))field.value='STANDARD';
    for(const field of form.querySelectorAll('textarea'))field.value=field.textContent;
    const values=readGlobalVoiceSettings(form,settings);
    assert.equal(values.expectedRevision,7);assert.equal(Object.hasOwn(values,'revision'),false);assert.equal(Object.hasOwn(values,'updatedAt'),false);
    assert.equal(values.proactiveVoiceRates.care,.5);assert.equal(values.kokoroMoodSpeeds['开心'],1.05);
    assert.match(form.textContent,/未配置/);assert.match(form.textContent,/发送比例/);
});

test('角色设置按性别列音色，隐藏未配置引擎；写入沿用完整旧偏好并区分 null',()=>{
    const doc=installMiniDom();const relationship={relationshipId:'9007199254740993',companionName:'合成角色',userAddressAs:'你',replyLength:'SHORT',initiative:'LOW',humor:'LIGHT',advicePref:'ASK_FIRST',remindersAllowed:true,memoryShareScope:'RELATIONSHIP',avoidTopics:[],gender:'FEMALE',avatarRef:'',speed:1,proactiveVoice:true};
    const form=doc.createElement('form');form.innerHTML=renderRelationshipVoiceSettings(relationship,engines);
    assert.match(form.innerHTML,/男声/);assert.doesNotMatch(form.innerHTML,/data-voice-field="cosyVoice"/);
    for(const field of form.querySelectorAll('select'))field.value='';
    form.querySelector('input').value='1.1';
    const payload=relationshipVoicePayload(relationship,form);
    assert.equal(payload.kokoroVoice,null);assert.equal(payload.voiceFrequency,null);assert.equal(payload.proactiveEngine,null);assert.equal(payload.speed,1.1);assert.equal(payload.replyLength,'SHORT');assert.equal(payload.companionName,'合成角色');assert.equal(payload.proactiveVoice,true);
});
