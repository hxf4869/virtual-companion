import { fetchRelationships, fetchVoiceEngines, fetchVoiceSettings, previewVoice, saveVoiceSettings, storyRequest } from './api.js';
import { invalidateVoicePolicy, waitForVoiceClip } from './voice-chat.js';
import { voicePlayer } from './voice.js';
import { openSheet } from './ui/sheet.js';

const esc=(value)=>String(value??'').replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const scenes={morning:'早安',night:'晚安',care:'关心',share:'分享',default:'其他'};
const frequencies={OFF:'关',LOW:'少',STANDARD:'标准',HIGH:'多'};
const moodNames=['开心','黏人','好奇','得意','懒洋洋','有点累','想独处','有点烦','困'];
let available=false;
export const voiceSettingsAvailable=()=>available;
export async function refreshVoiceAvailability(){try{const caps=await fetchVoiceEngines();available=caps.tts.some((engine)=>engine.configured)||caps.asr.configured;}catch{available=false;}return available;}
const group=(rows)=>`<div class="vc-group">${rows.join('')}</div>`;
const row=(label,control)=>`<label class="vc-cell"><span class="vc-grow">${esc(label)}</span>${control}</label>`;
const number=(key,value,min,max,step=1)=>`<input type="number" data-voice-field="${esc(key)}" value="${esc(value)}" min="${min}" max="${max}" step="${step}" required>`;
const select=(key,value,options)=>`<select data-voice-field="${esc(key)}">${Object.entries(options).map(([id,label])=>`<option value="${esc(id)}"${String(value??'')===id?' selected':''}>${esc(label)}</option>`).join('')}</select>`;
const toggle=(key,value,disabled=false)=>`<button type="button" class="vc-switch" role="switch" aria-label="${esc(key)}" aria-checked="${value?'true':'false'}" data-voice-field="${esc(key)}"${disabled?' disabled':''}><span></span></button>`;
const state=(engine)=>!engine?.configured?'未配置':engine.healthy?'可用':'不可用';

export function renderGlobalVoiceSettings(settings,engines){
    const k=engines.tts.find((e)=>e.engine==='kokoro'),c=engines.tts.find((e)=>e.engine==='cosyvoice');
    const engine=(title,key,info,timeout,limit)=>group([
        `<div class="vc-cell"><span class="vc-grow">${title}</span><span class="vc-value">${state(info)}</span>${toggle(key,settings[key],!info?.configured)}</div>`,
        row('超时（秒）',number(timeout,settings[timeout],1,timeout==='asrTimeoutSeconds'?120:3600)),
        row(limit==='maxRecordingSeconds'?'最长录音（秒）':'每日上限',number(limit,settings[limit],limit==='maxRecordingSeconds'?1:0,limit==='maxRecordingSeconds'?60:2147483647)),
    ]);
    return engine('聊天语音','kokoroEnabled',k,'kokoroTimeoutSeconds','dailyChatLimit')
        +engine('主动语音','cosyVoiceEnabled',c,'cosyVoiceTimeoutSeconds','dailyProactiveLimit')
        +engine('语音输入','asrEnabled',engines.asr,'asrTimeoutSeconds','maxRecordingSeconds')
        +group([row('语音频率',select('voiceFrequency',settings.voiceFrequency,{LOW:'少',STANDARD:'标准',HIGH:'多'}))])
        +`<details><summary>场景指令</summary>${group(Object.entries(scenes).map(([id,label])=>`<label class="vc-cell vc-voice-setting-text"><span>${label}</span><textarea data-voice-instruction="${id}" maxlength="1000" required>${esc(settings.cosyVoiceInstructions[id])}</textarea></label>`))}</details>`
        +`<details><summary>发送比例</summary>${group(Object.entries(scenes).map(([id,label])=>row(`${label}（%）`,number(`rate:${id}`,Math.round(settings.proactiveVoiceRates[id]*100),0,100))))}</details>`
        +`<details><summary>心情语速</summary>${group(moodNames.map((mood)=>row(mood,number(`mood:${mood}`,settings.kokoroMoodSpeeds[mood]??1,.5,2,.01))))}</details>`;
}

export function readGlobalVoiceSettings(form,settings){
    const {revision,updatedAt,...values}=settings;
    const next={...values,expectedRevision:revision,cosyVoiceInstructions:{...settings.cosyVoiceInstructions},proactiveVoiceRates:{...settings.proactiveVoiceRates},kokoroMoodSpeeds:{...settings.kokoroMoodSpeeds}};
    for(const field of form.querySelectorAll('[data-voice-field]')){
        const key=field.getAttribute('data-voice-field');const value=field.getAttribute('role')==='switch'?field.getAttribute('aria-checked')==='true':field.type==='number'?Number(field.value):field.value;
        if(key.startsWith('rate:'))next.proactiveVoiceRates[key.slice(5)]=value/100;
        else if(key.startsWith('mood:'))next.kokoroMoodSpeeds[key.slice(5)]=value;
        else next[key]=value;
    }
    for(const area of form.querySelectorAll('[data-voice-instruction]'))next.cosyVoiceInstructions[area.getAttribute('data-voice-instruction')]=area.value;
    return next;
}

function voiceOptions(engine,value){
    return `<option value=""${!value?' selected':''}>默认</option>`+['FEMALE','MALE','NEUTRAL'].map((gender)=>`<optgroup label="${{FEMALE:'女生',MALE:'男生',NEUTRAL:'其他'}[gender]}">${(engine?.voices||[]).filter((option)=>(option.gender||'NEUTRAL')===gender).map((option)=>`<option value="${esc(option.id)}"${value===option.id?' selected':''}>${esc(option.name||option.id)}</option>`).join('')}</optgroup>`).join('');
}
export function renderRelationshipVoiceSettings(relationship,engines){
    const parts=[];
    for(const [engine,key,label] of [['kokoro','kokoroVoice','聊天语音'],['cosyvoice','cosyVoice','主动语音']]){
        const info=engines.tts.find((e)=>e.engine===engine);if(!info?.configured)continue;
        parts.push(group([row(label,`<select data-voice-field="${key}" aria-label="${label}">${voiceOptions(info,relationship[key])}</select>`),
            `<div class="vc-cell"><span class="vc-grow">${state(info)}</span><button type="button" class="vc-btn vc-btn-text" data-preview-engine="${engine}"${!info.enabled||!info.healthy?' disabled':''}>试听</button></div>`]));
    }
    parts.push(group([row('语速',`<input type="range" data-voice-field="speed" min="0.5" max="2" step="0.05" value="${esc(relationship.speed)}"><output>${Number(relationship.speed).toFixed(2)}×</output>`),
        row('语音频率',select('voiceFrequency',relationship.voiceFrequency,{'':'跟随全局',...frequencies})),
        row('主动语音引擎',select('proactiveEngine',relationship.proactiveEngine,{'':'默认',kokoro:'Kokoro',cosyvoice:'CosyVoice'})),
        `<div class="vc-cell"><span class="vc-grow">主动语音</span>${toggle('proactiveVoice',relationship.proactiveVoice)}</div>`]));
    return parts.join('');
}
export function relationshipVoicePayload(relationship,form){
    const keys=['companionName','userAddressAs','replyLength','initiative','humor','advicePref','remindersAllowed','memoryShareScope','avoidTopics','gender','avatarRef'];
    const body=Object.fromEntries(keys.map((key)=>[key,relationship[key]]));
    for(const field of form.querySelectorAll('[data-voice-field]')){
        const key=field.getAttribute('data-voice-field');body[key]=key==='speed'?Number(field.value):key==='proactiveVoice'?field.getAttribute('aria-checked')==='true':field.value||null;
    }
    return body;
}

async function openVoiceForm({relationshipId,opener,doc=globalThis.document}={}){
    const form=doc.createElement('form');form.className='vc-column vc-voice-settings';form.setAttribute('data-voice-settings',relationshipId?'relationship':'global');
    const content=doc.createElement('div');const status=doc.createElement('p');status.setAttribute('role','status');status.textContent='正在加载…';
    const latest=doc.createElement('button');latest.type='button';latest.className='vc-btn vc-btn-text';latest.textContent='加载最新';latest.hidden=true;
    const save=doc.createElement('button');save.type='submit';save.className='vc-btn vc-btn-fill';save.textContent='保存';save.disabled=true;
    form.append(content,status,latest,save);let settings,relationship,engines,closed=false,working=false;
    const sheet=openSheet({title:relationshipId?'声音':'语音',large:true,body:form,opener,onDone(){closed=true;voicePlayer.stop();}});
    const load=async()=>{
        try{
            const [values,caps,relationships]=await Promise.all([fetchVoiceSettings(),fetchVoiceEngines(),relationshipId?fetchRelationships():Promise.resolve([])]);
            if(closed)return;settings=values;engines=caps;
            relationship=relationships.find((row)=>String(row.relationshipId)===String(relationshipId));
            if(relationshipId && !relationship)throw new Error('missing');
            content.innerHTML=relationship?renderRelationshipVoiceSettings(relationship,engines):renderGlobalVoiceSettings(settings,engines);
            for(const control of content.querySelectorAll('[role="switch"]'))control.setAttribute('aria-label',control.parentElement.querySelector('.vc-grow')?.textContent||'语音');
            status.textContent='';latest.hidden=true;save.disabled=false;
        }catch{if(!closed){status.textContent='没有完成，请重试。';latest.hidden=false;}}
    };
    latest.addEventListener('click',()=>void load());
    content.addEventListener('click',async(event)=>{
        const field=event.target.closest('[role="switch"]');if(field && !field.disabled){field.setAttribute('aria-checked',String(field.getAttribute('aria-checked')!=='true'));return;}
        const button=event.target.closest('[data-preview-engine]');if(!button || button.disabled || working)return;
        const engine=button.dataset.previewEngine;const key=engine==='kokoro'?'kokoroVoice':'cosyVoice';
        const choice=content.querySelector(`[data-voice-field="${key}"]`).value;
        let voice=choice||(engine==='kokoro'?(relationship.gender==='MALE'?'zm_010':'zf_001'):'default');
        if(engine==='cosyvoice' && !choice && relationship.gender==='MALE')voice=engines.tts.find((item)=>item.engine===engine)?.voices.find((item)=>item.gender==='MALE')?.id||'default';
        const speed=Number(content.querySelector('[data-voice-field="speed"]').value);
        if(button.vcPreview?.voice===voice && button.vcPreview.speed===speed){
            await voicePlayer.toggle(button.vcPreview.clipId,{onState(playing){button.textContent=playing?'暂停语音':'试听';},onError(){button.vcPreview=null;status.textContent='没有完成，请重试。';}});return;
        }
        button.disabled=true;button.textContent='正在录音…';
        try{
            const queued=await previewVoice({relationshipId:String(relationshipId),engine,voice,speed});
            const clip=await waitForVoiceClip(queued.clipId,{timeoutMs:(engine==='kokoro'?settings.kokoroTimeoutSeconds:settings.cosyVoiceTimeoutSeconds)*1000+5000});
            if(closed)return;if(!clip)throw new Error('preview');
            button.vcPreview={clipId:clip.clipId,voice,speed};
            await voicePlayer.toggle(clip.clipId,{onState(playing){button.textContent=playing?'暂停语音':'试听';},onError(){status.textContent='没有完成，请重试。';}});
        }catch{if(!closed)status.textContent='没有完成，请重试。';}
        finally{if(!closed){button.disabled=false;if(button.textContent==='正在录音…')button.textContent='试听';}}
    });
    content.addEventListener('input',(event)=>{if(event.target.type==='range'){const output=event.target.parentElement.querySelector('output');if(output)output.textContent=`${Number(event.target.value).toFixed(2)}×`;}});
    form.addEventListener('submit',async(event)=>{
        event.preventDefault();if(working || !form.reportValidity())return;working=true;save.disabled=true;status.textContent='';
        try{
            if(relationship)relationship=await storyRequest('PATCH',`/api/v1/relationships/${relationshipId}`,relationshipVoicePayload(relationship,content));
            else settings=await saveVoiceSettings(readGlobalVoiceSettings(content,settings));
            if(closed)return;invalidateVoicePolicy();globalThis.dispatchEvent(new Event('vc-voice-settings-changed'));status.textContent='已保存';latest.hidden=true;
        }catch(error){if(!closed){status.textContent=error.kind==='conflict-revision'?'设置已在另一处更新。你的输入已保留。':'没有完成，请重试。';latest.hidden=error.kind!=='conflict-revision';}}
        finally{working=false;if(!closed)save.disabled=false;}
    });
    void load();return sheet;
}
export const openGlobalVoiceSettings=(options)=>openVoiceForm(options);
export const openRelationshipVoiceSettings=(relationshipId,options={})=>openVoiceForm({...options,relationshipId});
