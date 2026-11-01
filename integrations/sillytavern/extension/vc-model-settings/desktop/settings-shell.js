// 桌面设置表现层；控制器与协议继续来自公共生产模块。
import { icon } from '../ui/icons.js';
import { confirmDiscard } from '../ui/alert.js';
import { popMenu } from '../ui/menu.js';
import { showToast } from '../ui/toast.js';
import { bindSegment, bindSwitch } from '../ui/controls.js';
import { readThemeMode, setThemeMode } from '../ui/theme.js';
import { TAVERN_ENTRIES } from '../shell.js';
import { openDrawerPage } from '../drawers.js';
import { readReplyStyle, writeReplyStyle } from '../chat-view.js';
import { mountModelSettings } from '../page.js';
import { renderGlobalVoiceSettings, readGlobalVoiceSettings } from '../voice-settings.js';
import { fetchVoiceSettings, fetchVoiceEngines, saveVoiceSettings } from '../api.js';
import { invalidateVoicePolicy } from '../voice-chat.js';
import { mountDataRights } from '../data-rights.js';
import { readReducedMotion, writeReducedMotion, transitionContent } from './transition.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const categories = [['account','账户','user-round','gray'],['model','模型','cpu','blue'],['voice','语音','mic','orange'],['notifications','通知','bell','pink'],['appearance','外观','monitor','purple'],['data','账户与数据','shield','green']];
export function mountSettingsShell(container, { getContext = () => ({}) } = {}) {
    const root = document.createElement('section'); root.className = 'vc-settings-shell';
    const nav = document.createElement('nav'); nav.className = 'vc-settings-categories vc-desk-panel'; nav.setAttribute('aria-label','设置分类');
    const category = (key, title, glyph, tile) => `<button type="button" data-category="${key}" data-vc-light><span class="vc-tile vc-tile-${tile}">${icon(glyph,{size:18})}</span><span>${esc(title)}</span></button>`;
    nav.innerHTML = `<h1>设置</h1>${categories.map(row=>category(...row)).join('')}<h2>酒馆</h2>${TAVERN_ENTRIES.map(row=>category(row.panel,row.label,row.icon,row.tile)).join('')}`;
    const content = document.createElement('div'); content.className = 'vc-settings-content vc-desk-panel'; root.append(nav,content);container.replaceChildren(root);
    const model = mountModelSettings(); let account; let current = '', voice = null;
    const modelHome = model.root.parentNode;
    function restoreModel() { if (root.contains(model.root)) (modelHome || document.body).append(model.root); }
    const ac = new AbortController();
    const header = title => `<header class="vc-settings-header"><button type="button" class="vc-circle vc-settings-category-toggle" data-settings-categories aria-label="设置">${icon('settings')}</button><h1 tabindex="-1">${esc(title)}</h1></header>`;
    async function requestLeave() {
        if (current === 'model') return model.requestLeave();
        if (voice?.working()) return false;
        if (voice?.isDirty()) return confirmDiscard({opener:document.activeElement});
        return true;
    }
    async function select(key, { initial = false } = {}) {
        if (key === current && !initial) return;
        if (!initial && !await requestLeave()) return;
        if (current === 'model') { model.close(); restoreModel(); }
        voice = null; current = key; root.dataset.category = key;root.dataset.categoriesOpen = 'false';
        for (const row of nav.querySelectorAll('[data-category]')) { row.setAttribute('aria-current',row.dataset.category===key?'page':'false'); }
        transitionContent(content, () => { content.replaceChildren(); });
        if (key === 'model') { content.append(model.root); model.open(); return; }
        const title = categories.find(row=>row[0]===key)?.[1] || TAVERN_ENTRIES.find(row=>row.panel===key)?.label;
        content.innerHTML = header(title);
        const body = document.createElement('div'); body.className='vc-settings-body';content.append(body);
        if (key === 'voice') { voice = await mountVoice(content,body); }
        else if (key === 'appearance') mountAppearance(body);
        else if (key === 'account' || key === 'data') {
            body.innerHTML = `<div class="vc-desk-group">${key==='account'?`<div class="vc-cell">${esc(getContext().name1||'账户')}</div>`:''}<button type="button" class="vc-cell vc-settings-open-account"><span class="vc-grow">账户与数据</span>${icon('chevron-right',{size:16})}</button></div>`;
            body.querySelector('button').onclick = event => (account ??= mountDataRights()).open(event.currentTarget);
        } else if (key === 'notifications') {
            body.innerHTML = `<div class="vc-desk-group"><button type="button" class="vc-cell"><span class="vc-grow">陪伴</span>${icon('chevron-right',{size:16})}</button></div>`;
            body.querySelector('button').onclick = () => window.dispatchEvent(new CustomEvent('vc-shell-navigate',{detail:{destination:'inbox'}}));
        } else {
            body.innerHTML = `<div class="vc-desk-group"><button type="button" class="vc-cell"><span class="vc-grow">${esc(title)}</span>${icon('chevron-right',{size:16})}</button></div>`;
            body.querySelector('button').onclick = () => { openDrawerPage(key); if (shell) delete shell.dataset.settings; };
        }
        content.querySelector('h1')?.focus();
    }
    root.addEventListener('click',event=>{
        const toggle=event.target.closest('[data-settings-categories]');
        if(toggle){popMenu(toggle,[...categories.map(([key,label])=>({label,run:()=>void select(key)})),'-',...TAVERN_ENTRIES.map(row=>({label:row.label,run:()=>void select(row.panel)}))]);return;}
        const row=event.target.closest('[data-category]');if(row)void select(row.dataset.category);
        const close=event.target.closest('[data-action="close"]');
        if(close && model.root.contains(close)){event.preventDefault();event.stopImmediatePropagation();void select('account');return;}
        const back=event.target.closest('[data-action="vc-back"]');
        if(back && model.root.querySelector('[data-vc-screen="home"]')){event.stopImmediatePropagation();void select('account');}
    },{capture:true,signal:ac.signal});
    const shell=container.closest('#vc-shell');
    shell?.addEventListener('click',async event=>{
        const target=event.target.closest('[data-nav],[data-settings-done]');
        if(!target || root.closest('#vc-shell')?.dataset.settings!=='page')return;
        if(!voice?.isDirty() && !(current==='model'&&model.isDirty()))return;
        event.preventDefault();event.stopImmediatePropagation();if(await requestLeave()){voice=null;current='';target.click();}
    },{capture:true,signal:ac.signal});
    return { root, model, select, requestLeave,
        resume(){ if (current === 'model') { content.append(model.root); model.open(); } else if (!current) void select('account', { initial: true }); },
        close(){ if (current === 'model') { model.close(); restoreModel(); } },
        destroy(){ac.abort();if(current==='model')model.close();restoreModel();root.remove();} };
}
async function mountVoice(content,body) {
    let settings, engines, baseline='', working=false, loaded=false;
    const form=document.createElement('form');form.className='vc-settings-voice';body.append(form);
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='正在加载…';
    const latest=document.createElement('button');latest.type='button';latest.className='vc-btn vc-btn-text';latest.textContent='加载最新';latest.hidden=true;
    body.append(status,latest);
    const discard=document.createElement('button');discard.className='vc-btn vc-btn-text';discard.textContent='放弃修改';discard.hidden=true;
    const save=document.createElement('button');save.className='vc-btn vc-btn-fill';save.textContent='保存';save.disabled=true;
    content.querySelector('header').append(discard,save);
    const snapshot=()=>JSON.stringify(readGlobalVoiceSettings(form,settings));
    const isDirty=()=>loaded&&snapshot()!==baseline;
    const feedback=()=>{discard.hidden=!isDirty();save.disabled=working||!isDirty();save.innerHTML=working?`${icon('refresh-cw',{size:16})}保存中…`:'保存';latest.disabled=working;};
    const paint=()=>{form.innerHTML=renderGlobalVoiceSettings(settings,engines);for(const control of form.querySelectorAll('[role="switch"]')){control.setAttribute('aria-label',control.parentElement.querySelector('.vc-grow')?.textContent||'语音');bindSwitch(control,{onChange:feedback});}baseline=snapshot();feedback();};
    async function load(){try{[settings,engines]=await Promise.all([fetchVoiceSettings(),fetchVoiceEngines()]);if(!form.isConnected)return;loaded=true;paint();status.textContent='';latest.hidden=true;}catch{if(form.isConnected){status.textContent='没有完成，请重试。';latest.hidden=false;}}}
    latest.onclick=()=>void load();form.addEventListener('input',feedback);form.addEventListener('change',feedback);
    discard.onclick=async()=>{if(await confirmDiscard({opener:discard}))paint();};
    async function submit(){
        if(working||!isDirty()||!form.reportValidity())return;
        const width=save.getBoundingClientRect().width;save.style.width=`${width}px`;save.style.minWidth=`${width}px`;
        working=true;feedback();for(const field of form.elements)field.disabled=true;discard.disabled=true;status.textContent='';
        try{settings=await saveVoiceSettings(readGlobalVoiceSettings(form,settings));if(!form.isConnected)return;invalidateVoicePolicy();window.dispatchEvent(new Event('vc-voice-settings-changed'));baseline=snapshot();latest.hidden=true;showToast('已保存');}
        catch(error){if(form.isConnected){status.textContent=error.kind==='conflict-revision'?'设置已在另一处更新。你的输入已保留。':'没有完成，请重试。';latest.hidden=error.kind!=='conflict-revision';}}
        finally{working=false;if(form.isConnected){for(const field of form.elements)field.disabled=false;for(const control of form.querySelectorAll('[role="switch"]')){const key=control.dataset.voiceField;const engine=key==='kokoroEnabled'?engines.tts.find(e=>e.engine==='kokoro'):key==='cosyVoiceEnabled'?engines.tts.find(e=>e.engine==='cosyvoice'):engines.asr;control.disabled=!engine?.configured;}discard.disabled=false;save.style.width='';save.style.minWidth='';feedback();}}
    }
    save.onclick=()=>void submit();form.onsubmit=event=>{event.preventDefault();void submit();};void load();return {isDirty,working:()=>working};
}
function mountAppearance(body) {
    const segment=(key,labels,index)=>`<div class="vc-segment" data-preference="${key}"><i class="vc-segment-thumb"></i>${labels.map((label,i)=>`<button type="button" aria-pressed="${i===index}">${label}</button>`).join('')}</div>`;
    body.innerHTML=`<section class="vc-desk-group"><h2>外观</h2><div class="vc-desk-field"><span>外观</span>${segment('theme',['跟随系统','浅色','深色'],['auto','light','dark'].indexOf(readThemeMode()))}</div><div class="vc-desk-field"><span>回复样式</span>${segment('reply',['铺开','气泡'],readReplyStyle()==='bubble'?1:0)}</div><div class="vc-desk-field"><span>减弱动态效果</span><button type="button" class="vc-switch" role="switch" aria-label="减弱动态效果" aria-checked="${readReducedMotion()}"><span></span></button></div></section>`;
    bindSegment(body.querySelector('[data-preference="theme"]'),{onChange:index=>setThemeMode(['auto','light','dark'][index])});
    bindSegment(body.querySelector('[data-preference="reply"]'),{onChange:index=>{writeReplyStyle(index?'bubble':'spread');}});
    bindSwitch(body.querySelector('[role="switch"]'),{onChange:writeReducedMotion});
}
