// 桌面设置表现层；控制器与协议继续来自公共生产模块。
import { iconSpriteUrl } from '../ui/icons.js';
import { mountSettingsFrameView, mountDrawerEntryView, mountSettingsOverviewView } from './build/index.js';
import { confirmDiscard } from '../ui/alert.js';
import { popMenu } from '../ui/menu.js';
import { showToast } from '../ui/toast.js';
import { TAVERN_ENTRIES } from '../shell.js';
import { openDrawerPage, closeDrawerPage } from '../drawers.js';
import { mountModelSettings } from '../page.js';
import { transitionContent } from './transition.js';
import { NOTIFY_KEY, notifySupported, requestNotifyPermission, systemNotifyEnabled } from './notify.js';
const categories = [['account','账户','user-round','gray'],['model','模型','cpu','blue'],['voice','语音','mic','orange'],['notifications','通知','bell','pink'],['appearance','外观','monitor','purple'],['data','账户与数据','shield','green']];
export function mountSettingsShell(container, { getContext = () => ({}), onBudgetChange, onCatalogSaved, mountTavernSettings } = {}) {
    const root = document.createElement('section'); root.className = 'vc-settings-shell';
    container.replaceChildren(root);
    const model = mountModelSettings({ onBudgetChange }); let account; let current = '', voice = null, detailHidden = false;
    const unregisterCatalog = onCatalogSaved ? model.onCatalogSaved(onCatalogSaved) : null;
    let unmountOverview = () => {};
    let unmountAppearance = () => {};
    let unmountDrawerEntry = () => {}, voiceHeader, editor, editorHeader, editorLoad;
    const titleFor = key => categories.find(row => row[0] === key)?.[1] || TAVERN_ENTRIES.find(row => row.panel === key)?.label || '';
    const frameProps = () => ({ sprite: iconSpriteUrl(), categories, tavern: TAVERN_ENTRIES, current, title: titleFor(current), model: model.root, voice: voiceHeader, editor: editorHeader, detailHidden,
        onSelect: key => void select(key), onCategories: openCategories });
    const frame = mountSettingsFrameView(root, frameProps());
    root.setDetailVisibility = hidden => { detailHidden = Boolean(hidden); frame.update(frameProps()); };
    const setVoiceHeader = next => { voiceHeader = next; frame.update(frameProps()); };
    const setEditorHeader = next => { editorHeader = next; frame.update(frameProps()); };
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
            onOpen(screen, trigger) { void openAccount(trigger, screen); },
        } : kind === 'data' ? { onOpen(trigger) { void openAccount(trigger); } } : {
            supported: notifySupported(), enabled, pending, onToggle,
            onInbox() { window.dispatchEvent(new CustomEvent('vc-shell-navigate', { detail: { destination: 'inbox' } })); },
        }) }; };
        async function openAccount(trigger, screen) {
            try {
                const { mountDataRights } = await import('../data-rights.js');
                if (disposed || ac.signal.aborted) return;
                (account ??= mountDataRights()).open(trigger, screen);
            } catch {
                if (disposed || ac.signal.aborted) return;
                showToast('页面没有加载出来，请重新打开。', { type: 'failure' });
            }
        }
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
        if (editor) return editor.requestLeave();
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
        editorLoad?.abort(); editorLoad = null; editor?.destroy(); editor = null; editorHeader = undefined;
        voice?.destroy();
        leaveDrawer();
        voice = null; current = key; detailHidden = false; root.dataset.category = key;root.dataset.categoriesOpen = 'false';
        voiceHeader = undefined;
        transitionContent(frame.content, () => frame.update(frameProps()));
        const content = frame.content, body = frame.body;
        if (key === 'model') { model.open(); return; }
        if (key === 'voice' || key === 'appearance') {
            const loading = new AbortController(); editorLoad = loading;
            const active = () => !loading.signal.aborted && !ac.signal.aborted && body.isConnected;
            try {
                if (key === 'voice') {
                    const { mountVoice } = await import('./settings-voice.js');
                    if (!active()) return;
                    const candidate = await mountVoice(content, body, setVoiceHeader);
                    if (!active()) { candidate.destroy(); return; }
                    voice = candidate;
                } else {
                    const { mountAppearance } = await import('./appearance.js');
                    if (!active()) return;
                    unmountAppearance = mountAppearance(body, getContext);
                }
            } catch {
                if (!active()) return;
                const status = document.createElement('p'); status.role = 'status'; status.textContent = '页面没有加载出来，请重新打开。';
                const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'vc-btn vc-btn-text'; retry.textContent = '重新加载'; retry.onclick = () => location.reload(); body.append(status, retry);
            } finally {
                if (editorLoad === loading) editorLoad = null;
            }
        }
        else if (['account', 'data', 'notifications'].includes(key)) mountOverview(body, key);
        else if (mountTavernSettings) {
            const loading = new AbortController(); editorLoad = loading;
            setEditorHeader({ dirty: false, working: false, disabled: true, onSave() {}, onDiscard() {} });
            try {
                const candidate = await mountTavernSettings(body, { key, signal: loading.signal, setHeader: setEditorHeader });
                if (loading.signal.aborted || ac.signal.aborted || !body.isConnected) { candidate?.destroy(); return; }
                editor = candidate;
            } catch {
                if (loading.signal.aborted || ac.signal.aborted || !body.isConnected) return;
                const status = document.createElement('p'); status.role = 'status'; status.textContent = '页面没有加载出来，请重新打开。';
                const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'vc-btn vc-btn-text'; retry.textContent = '重新加载'; retry.onclick = () => location.reload(); body.append(status, retry);
            }
        }
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
    return { root, model, select, requestLeave, refreshContext: () => editor?.refreshContext(),
        isDirty: () => current === 'model' ? model.isDirty() : Boolean(voice?.isDirty() || editor?.isDirty()),
        isBusy: () => current === 'model' ? model.isBusy() : Boolean(voice?.working() || editor?.working()),
        resume(){ if (current === 'model') { frame.content.append(model.root); model.open(); } else if (!current) void select('account', { initial: true }); },
        close(){ if (editorLoad) { editorLoad.abort(); editorLoad = null; editor?.destroy(); editor = null; current = ''; } if (current === 'model') { model.detach(); restoreModel(); } if (voice) { voice.destroy(); voice = null; current = ''; } if (root.dataset.drawer) { leaveDrawer(); current = ''; } },
        destroy(){ac.abort();editorLoad?.abort();editor?.destroy();unregisterCatalog?.();account?.destroy();unmountOverview();voice?.destroy();unmountAppearance();unmountDrawerEntry();leaveDrawer();if(current==='model')model.detach();restoreModel();frame.unmount();root.remove();} };
}
