import { fetchRelationships, fetchVoiceEngines, fetchVoiceSettings, previewVoice, saveVoiceSettings, storyRequest } from './api.js';
import { invalidateVoicePolicy, waitForVoiceClip, voicePlayer, voiceSettingsAvailable, refreshVoiceAvailability } from './voice-logic.js';
import { confirmDiscard } from './ui/alert.js';
import { showToast } from './ui/toast.js';
import { openSheet } from './ui/sheet.js';
import { mountVoiceFormView, voiceFormValues } from './desktop/build/index.js';

export { voiceSettingsAvailable, refreshVoiceAvailability };
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
    form.append(content,status,latest);
    let settings,relationship,engines,closed=false,working=false,loading=false,baseline='',loaded=false,fields=null,values={};
    let previewEpoch=0,previewState={};
    const previews=new Map();
    const snapshot=()=>JSON.stringify(relationship?relationshipVoicePayload(relationship,content):readGlobalVoiceSettings(content,settings));
    const isDirty=()=>!closed&&loaded&&snapshot()!==baseline;
    const desktop=()=>doc.defaultView.innerWidth>=744;
    const sheet=openSheet({title:relationshipId?'声音':'语音',large:true,body:form,opener,isDirty,canClose:()=>!working,onSubmit:submit,onDone(){
        closed=true;previewEpoch+=1;fields?.unmount();fields=null;voicePlayer.stop();form.onsubmit=null;latest.onclick=null;doc.defaultView.removeEventListener('resize',feedback);
    }});
    let doneStyle = {};
    async function discardChanges(trigger) { if(closed||!await confirmDiscard({opener:trigger})||closed)return;values=voiceFormValues(settings,relationship);feedback(); }
    function renderFields(){
        if(!loaded||closed)return;
        const props={mode:relationship?'relationship':'global',values,engines,disabled:working||loading,onFieldChange(key,value){
            values[key]=value;
            if(['kokoroVoice','cosyVoice','speed'].includes(key)){previewEpoch+=1;previewState={};voicePlayer.stop();}
            feedback();
        },...(relationship?{preview:previewState,onPreview}:{} )};
        if(fields)fields.update(props);else fields=mountVoiceFormView(content,props);
    }
    function feedback({reset=false}={}){
        if(closed)return;
        renderFields();if(reset)baseline=snapshot();
        const dirty=isDirty();
        sheet.setHeader({ actions: [
            { label: '放弃修改', hidden: !dirty, disabled: working||loading, onClick: discardChanges },
            { label: '取消', hidden: !desktop(), disabled: working, onClick: () => void sheet.close() },
        ], done: { disabled: working||loading||!loaded||(desktop()&&!dirty), label: working?'保存中…':desktop()?'保存':'完成', style: doneStyle } });
        latest.disabled=working||loading;
    }
    doc.defaultView.addEventListener('resize',feedback);
    feedback();
    const load=async()=>{
        if(closed)return;loading=true;feedback();
        try{
            const [data,caps,relationships]=await Promise.all([fetchVoiceSettings(),fetchVoiceEngines(),relationshipId?fetchRelationships():Promise.resolve([])]);
            if(closed)return;settings=data;engines=caps;relationship=relationships.find(row=>String(row.relationshipId)===String(relationshipId));
            if(relationshipId&&!relationship)throw new Error('missing');
            values=voiceFormValues(settings,relationship);loaded=true;status.textContent='';latest.hidden=true;feedback({reset:true});
        }catch{if(!closed){status.textContent='没有完成，请重试。';latest.hidden=false;}}
        finally{loading=false;feedback();}
    };
    latest.onclick=()=>void load();
    async function onPreview(engine){
        if(closed)return;
        const ticket=++previewEpoch,key=engine==='kokoro'?'kokoroVoice':'cosyVoice';
        const choice=String(values[key]||'');
        let voice=choice||(engine==='kokoro'?(relationship.gender==='MALE'?'zm_010':'zf_001'):'default');
        if(engine==='cosyvoice'&&!choice&&relationship.gender==='MALE')voice=engines.tts.find(item=>item.engine===engine)?.voices.find(item=>item.gender==='MALE')?.id||'default';
        const speed=Number(values.speed),cached=previews.get(engine);
        const valid=()=>!closed&&ticket===previewEpoch;
        const callbacks={onState(playing){if(!valid())return;previewState={[engine]:{playing}};renderFields();},onError(){if(!valid())return;previews.delete(engine);previewState={};status.textContent='没有完成，请重试。';renderFields();}};
        previewState={};renderFields();
        if(cached?.voice===voice&&cached.speed===speed){await voicePlayer.toggle(cached.clipId,callbacks);return;}
        previewState={[engine]:{busy:true}};renderFields();
        try{
            const queued=await previewVoice({relationshipId:String(relationshipId),engine,voice,speed});
            if(!valid())return;
            const clip=await waitForVoiceClip(queued.clipId,{timeoutMs:(engine==='kokoro'?settings.kokoroTimeoutSeconds:settings.cosyVoiceTimeoutSeconds)*1000+5000});
            if(!valid())return;if(!clip)throw new Error('preview');
            previews.set(engine,{clipId:clip.clipId,voice,speed});
            await voicePlayer.toggle(clip.clipId,callbacks);
        }catch{if(valid()){previewState={};status.textContent='没有完成，请重试。';}}
        finally{if(valid()){if(previewState[engine]?.busy)previewState={};renderFields();}}
    }
    async function submit(){
        if(closed||working||loading||!isDirty()||!form.reportValidity())return false;
        const width=sheet.done.getBoundingClientRect().width;doneStyle={whiteSpace:'nowrap',textAlign:'right',width:`${width}px`,minWidth:`${width}px`};
        working=true;feedback();status.textContent='';let saved=false;
        try{
            if(relationship)relationship=await storyRequest('PATCH',`/api/v1/relationships/${relationshipId}`,relationshipVoicePayload(relationship,content));
            else settings=await saveVoiceSettings(readGlobalVoiceSettings(content,settings));
            if(closed)return false;invalidateVoicePolicy();globalThis.dispatchEvent(new Event('vc-voice-settings-changed'));baseline=snapshot();latest.hidden=true;showToast('已保存');saved=true;
        }catch(error){if(!closed){status.textContent=error.kind==='conflict-revision'?'设置已在另一处更新。你的输入已保留。':'没有完成，请重试。';latest.hidden=error.kind!=='conflict-revision';}}
        finally{working=false;if(!closed){doneStyle={whiteSpace:'nowrap',textAlign:'right'};feedback();}}
        return saved;
    }
    form.onsubmit=event=>{event.preventDefault();void submit();};
    void load();return sheet;
}
export const openGlobalVoiceSettings=(options)=>openVoiceForm(options);
export const openRelationshipVoiceSettings=(relationshipId,options={})=>openVoiceForm({...options,relationshipId});
