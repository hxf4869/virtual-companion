// 桌面设置表现层；控制器与协议继续来自公共生产模块。
import { iconSpriteUrl } from '../ui/icons.js';
import { mountSettingsFrameView, mountDrawerEntryView, mountVoiceFormView, voiceFormValues, mountSettingsOverviewView } from './build/index.js';
import { confirmDiscard } from '../ui/alert.js';
import { popMenu } from '../ui/menu.js';
import { showToast } from '../ui/toast.js';
import { TAVERN_ENTRIES } from '../shell.js';
import { openDrawerPage, closeDrawerPage } from '../drawers.js';
import { mountModelSettings } from '../page.js';
import { readGlobalVoiceSettings } from '../voice-settings.js';
import { fetchVoiceSettings, fetchVoiceEngines, saveVoiceSettings } from '../api.js';
import { invalidateVoicePolicy } from '../voice-chat.js';
import { mountDataRights } from '../data-rights.js';
import { transitionContent } from './transition.js';
import { NOTIFY_KEY, notifySupported, requestNotifyPermission, systemNotifyEnabled } from './notify.js';
import { mountAppearance } from './appearance.js';
const categories = [['account','账户','user-round','gray'],['model','模型','cpu','blue'],['voice','语音','mic','orange'],['notifications','通知','bell','pink'],['appearance','外观','monitor','purple'],['data','账户与数据','shield','green']];
export function mountSettingsShell(container, { getContext = () => ({}), onBudgetChange, onCatalogSaved } = {}) {
    const root = document.createElement('section'); root.className = 'vc-settings-shell';
    container.replaceChildren(root);
    const model = mountModelSettings({ onBudgetChange }); let account; let current = '', voice = null, detailHidden = false;
    const unregisterCatalog = onCatalogSaved ? model.onCatalogSaved(onCatalogSaved) : null;
    let unmountOverview = () => {};
    let unmountAppearance = () => {};
    let unmountDrawerEntry = () => {}, voiceHeader;
    const titleFor = key => categories.find(row => row[0] === key)?.[1] || TAVERN_ENTRIES.find(row => row.panel === key)?.label || '';
    const frameProps = () => ({ sprite: iconSpriteUrl(), categories, tavern: TAVERN_ENTRIES, current, title: titleFor(current), model: model.root, voice: voiceHeader, detailHidden,
        onSelect: key => void select(key), onCategories: openCategories });
    const frame = mountSettingsFrameView(root, frameProps());
    root.setDetailVisibility = hidden => { detailHidden = Boolean(hidden); frame.update(frameProps()); };
    const setVoiceHeader = next => { voiceHeader = next; frame.update(frameProps()); };
    function openCategories(trigger) { popMenu(trigger, [...categories.map(([key, label]) => ({ label, run: () => void select(key) })), '-', ...TAVERN_ENTRIES.map(row => ({ label: row.label, run: () => void select(row.panel) }))]); }
    const modelHome = model.root.parentNode;
    function restoreModel() { if (root.contains(model.root)) (modelHome || document.body).append(model.root); }
    const ac = new AbortController();
    // 酒馆抽屉在内容区原位打开；离开分类、返回、关闭设置时一并关闭，避免宿主抽屉留在设置之外。
    function leaveDrawer() {
        const key = root.dataset.drawer; if (!key) return;
        delete root.dataset.drawer;
        const node = document.getElementById(key);
        if (node?.classList.contains('openDrawer')) closeDrawerPage(node);
    }
    async function openDrawer(key) {
        root.dataset.drawer = key;
        if (!openDrawerPage(key)) { delete root.dataset.drawer; return; }
        await Promise.resolve();
        const node = document.getElementById(key);
        for (const animation of node?.getAnimations?.() || []) animation.cancel();
        if (node) transitionContent(node, () => {});
    }
    function mountOverview(body, kind) {
        let disposed = false, pending = false;
        let enabled = notifySupported() && Notification.permission === 'granted' && systemNotifyEnabled();
        const props = () => { const context = getContext(), name = String(context.name1 || '').trim() || '账户';
            const persona = context.userAvatar ?? document.querySelector('#user_avatar_block .avatar-container.selected')?.getAttribute('data-avatar-id');
            return { sprite: iconSpriteUrl(), kind, ...(kind === 'account' ? {
            name, avatar: persona ? `/thumbnail?type=persona&file=${encodeURIComponent(persona)}` : undefined,
            onOpen(screen, trigger) { (account ??= mountDataRights()).open(trigger, screen); },
        } : kind === 'data' ? { onOpen(trigger) { (account ??= mountDataRights()).open(trigger); } } : {
            supported: notifySupported(), enabled, pending, onToggle,
            onInbox() { window.dispatchEvent(new CustomEvent('vc-shell-navigate', { detail: { destination: 'inbox' } })); },
        }) }; };
        const view = mountSettingsOverviewView(body, props());
        const context = getContext(), changed = () => { if (!disposed) view.update(props()); };
        const event = context.eventTypes?.PERSONA_CHANGED;
        if (event) context.eventSource?.on(event, changed);
        unmountOverview = () => { disposed = true; if (event) context.eventSource?.removeListener(event, changed); view.unmount(); };
        async function onToggle(on) {
            enabled = on;
            try { localStorage.setItem(NOTIFY_KEY, on ? 'on' : 'off'); } catch { /* 隐私模式下仅本次有效 */ }
            if (!on) { view.update(props()); return; }
            pending = true; view.update(props());
            const permission = await requestNotifyPermission();
            if (disposed) return;
            pending = false; enabled = permission === 'granted'; view.update(props());
            if (!enabled) showToast('浏览器没有允许通知，可在浏览器的网站设置里打开');
        }
    }
    let confirmingLeave = false;
    async function requestLeave() {
        if (confirmingLeave) return false;
        if (current === 'model') return model.requestLeave();
        if (voice?.working()) return false;
        if (voice?.isDirty()) {
            confirmingLeave = true;
            try { return await confirmDiscard({opener:document.activeElement}); }
            finally { confirmingLeave = false; }
        }
        return true;
    }
    async function select(key, { initial = false } = {}) {
        if (key === current && !initial) return;
        if (!initial && !await requestLeave()) return;
        if (current === 'model') { model.detach(); restoreModel(); }
        unmountOverview();
        unmountOverview = () => {};
        unmountAppearance();
        unmountAppearance = () => {};
        unmountDrawerEntry();
        unmountDrawerEntry = () => {};
        voice?.destroy();
        leaveDrawer();
        voice = null; current = key; detailHidden = false; root.dataset.category = key;root.dataset.categoriesOpen = 'false';
        voiceHeader = undefined;
        transitionContent(frame.content, () => frame.update(frameProps()));
        const content = frame.content, body = frame.body;
        if (key === 'model') { model.open(); return; }
        if (key === 'voice') { voice = await mountVoice(content, body, setVoiceHeader); }
        else if (key === 'appearance') unmountAppearance = mountAppearance(body, getContext);
        else if (['account', 'data', 'notifications'].includes(key)) mountOverview(body, key);
        else {
            unmountDrawerEntry = mountDrawerEntryView(body, { title: titleFor(key), sprite: iconSpriteUrl(), onOpen: () => void openDrawer(key) });
            await openDrawer(key);
        }
        content.querySelector('h1')?.focus();
    }
    root.addEventListener('click',event=>{
        const toggle=event.target.closest('[data-settings-categories]');
        if(toggle && model.root.contains(toggle)){openCategories(toggle);return;}
        const close=event.target.closest('[data-action="close"]');
        if(close && model.root.contains(close)){event.preventDefault();event.stopImmediatePropagation();void select('account');return;}
        const back=event.target.closest('[data-action="vc-back"]');
        if(back && model.root.querySelector('[data-vc-screen="home"]')){event.stopImmediatePropagation();void select('account');}
    },{capture:true,signal:ac.signal});
    // 抽屉标题栏自带返回（窄桌面分类列收起时才显示）：回到设置首页，不再重开抽屉。
    document.addEventListener('click',event=>{
        if(root.dataset.drawer&&event.target.closest?.('[data-vc-drawer-back]')){delete root.dataset.drawer;current='';}
    },{capture:true,signal:ac.signal});
    return { root, model, select, requestLeave,
        isDirty: () => current === 'model' ? model.isDirty() : Boolean(voice?.isDirty()),
        isBusy: () => current === 'model' ? model.isBusy() : Boolean(voice?.working()),
        resume(){ if (current === 'model') { frame.content.append(model.root); model.open(); } else if (!current) void select('account', { initial: true }); },
        close(){ if (current === 'model') { model.detach(); restoreModel(); } if (voice) { voice.destroy(); voice = null; current = ''; } if (root.dataset.drawer) { leaveDrawer(); current = ''; } },
        destroy(){ac.abort();unregisterCatalog?.();account?.destroy();unmountOverview();voice?.destroy();unmountAppearance();unmountDrawerEntry();leaveDrawer();if(current==='model')model.detach();restoreModel();frame.unmount();root.remove();} };
}
async function mountVoice(content,body,setHeader) {
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
