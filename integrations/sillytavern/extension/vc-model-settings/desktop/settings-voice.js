// 语音分类打开时才加载既有表单控制器。
import { mountVoiceFormView, voiceFormValues } from './build/index.js';
import { readGlobalVoiceSettings } from '../voice-settings.js';
import { fetchVoiceSettings, fetchVoiceEngines, saveVoiceSettings } from '../api.js';
import { invalidateVoicePolicy } from '../voice-chat.js';
import { confirmDiscard } from '../ui/alert.js';
import { showToast } from '../ui/toast.js';

export async function mountVoice(content,body,setHeader) {
    let settings, engines, baseline='', working=false, loaded=false, destroyed=false, fields=null, values={}, saveStyle={};
    const form=document.createElement('form');form.className='vc-settings-voice';body.append(form);
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='正在加载…';
    const latest=document.createElement('button');latest.type='button';latest.className='vc-btn vc-btn-text';latest.textContent='加载最新';latest.hidden=true;
    body.append(status,latest);
    const snapshot=()=>JSON.stringify(readGlobalVoiceSettings(form,settings));
    const isDirty=()=>!destroyed&&loaded&&snapshot()!==baseline;
    function renderFields(){
        if(!loaded||destroyed)return;
        const props={mode:'global',values,engines,disabled:working,onFieldChange(key,value){values[key]=value;feedback();}};
        if(fields)fields.update(props);else fields=mountVoiceFormView(form,props);
    }
    function feedback({reset=false}={}){
        if(destroyed)return;
        renderFields();
        if(reset)baseline=snapshot();
        setHeader({dirty:isDirty(),working,disabled:working||!isDirty(),style:saveStyle,onSave:()=>void submit(),onDiscard:async trigger=>{if(destroyed)return;if(await confirmDiscard({opener:trigger})&&!destroyed)paint();}});
        latest.disabled=working;
    }
    function paint(){values=voiceFormValues(settings);feedback({reset:true});}
    async function load(){
        if(destroyed)return;
        try{[settings,engines]=await Promise.all([fetchVoiceSettings(),fetchVoiceEngines()]);if(destroyed||!form.isConnected)return;loaded=true;paint();status.textContent='';latest.hidden=true;}
        catch{if(!destroyed&&form.isConnected){status.textContent='没有完成，请重试。';latest.hidden=false;}}
    }
    latest.onclick=()=>void load();
    async function submit(){
        if(destroyed||working||!isDirty()||!form.reportValidity())return;
        const save=content.querySelector('[data-voice-save]');const width=save.getBoundingClientRect().width;saveStyle={width:`${width}px`,minWidth:`${width}px`};
        working=true;feedback();status.textContent='';
        try{settings=await saveVoiceSettings(readGlobalVoiceSettings(form,settings));if(destroyed||!form.isConnected)return;invalidateVoicePolicy();window.dispatchEvent(new Event('vc-voice-settings-changed'));baseline=snapshot();latest.hidden=true;showToast('已保存');}
        catch(error){if(!destroyed&&form.isConnected){status.textContent=error.kind==='conflict-revision'?'设置已在另一处更新。你的输入已保留。':'没有完成，请重试。';latest.hidden=error.kind!=='conflict-revision';}}
        finally{working=false;if(!destroyed&&form.isConnected){saveStyle={};feedback();}}
    }
    feedback();form.onsubmit=event=>{event.preventDefault();void submit();};void load();
    return {isDirty,working:()=>working,destroy(){if(destroyed)return;destroyed=true;fields?.unmount();fields=null;latest.onclick=null;form.onsubmit=null;}};
}
