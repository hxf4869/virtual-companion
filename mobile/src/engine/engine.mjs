// 引擎适配层：同源隐藏 iframe 运行完整 ST（含 Tavern Helper / EJS / MVU 与自有扩展），
// 手机界面只通过这里驱动聊天。这是唯一接触 ST 内部的模块（ADR-0011 §1）。
// 入口与 MB-0 验证一致：公开 getContext()、原生 script.js 导出、原生 DOM（与现有扩展同一路径）。
import { toMessage } from './server.mjs';

export const STATES = ['idle', 'loading', 'ready', 'reloading', 'error'];

export function createEmitter() {
    const map = new Map();
    return {
        on(type, fn) { (map.get(type) || map.set(type, new Set()).get(type)).add(fn); return () => map.get(type)?.delete(fn); },
        emit(type, payload) { for (const fn of map.get(type) || []) { try { fn(payload); } catch { /* 监听者错误不影响引擎 */ } } },
    };
}

export async function until(fn, { timeout = 60000, interval = 50, label = '' } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
        try { const v = await fn(); if (v) return v; } catch { /* 引擎尚未可用 */ }
        if (Date.now() > end) throw new Error(`engine timeout: ${label}`);
        await new Promise((r) => setTimeout(r, interval));
    }
}

// 宿主确认框的可读摘要（导入内嵌世界书、启用角色脚本、首次引导等）。由界面决定是否切到 ST 视图让用户处理。
export const POPUP_SETTLE_MS = 800;

const USER_CONTROLS = '.popup-button-ok, .popup-button-cancel, .popup-button-custom, .onboarding, textarea, input:not([type="hidden"])';

// 加载提示（ST 的 DISPLAY 弹窗）也带确定 / 取消按钮，但它们不可见；只看可见的操作控件。
export function needsUser(dialog) {
    const controls = dialog?.querySelectorAll ? [...dialog.querySelectorAll(USER_CONTROLS)] : [];
    return controls.some((el) => typeof el.getClientRects !== 'function' || el.getClientRects().length > 0);
}

export function popupSummary(dialog) {
    const text = String(dialog?.textContent || '').replace(/\s+/g, ' ').trim();
    return { onboarding: Boolean(dialog?.querySelector?.('.onboarding')), text: text.slice(0, 120) };
}

export function createEngine({ doc = globalThis.document, src = '/', onState } = {}) {
    const bus = createEmitter();
    let frame = null;
    let script = null;
    let state = 'idle';
    let observer = null;
    let ended = 0;
    let lastPopup = null;

    const win = () => frame?.contentWindow;
    const ctx = () => win()?.SillyTavern?.getContext?.();
    const setState = (s, detail) => {
        state = s;
        if (doc?.documentElement) doc.documentElement.dataset.vcEngine = s;
        onState?.(s, detail);
        bus.emit('state', { state: s, detail });
    };

    function mount() {
        if (frame) return frame;
        frame = doc.createElement('iframe');
        frame.id = 'vc-engine';
        frame.title = '酒馆';
        frame.setAttribute('aria-hidden', 'true');
        frame.className = 'vc-engine';
        doc.body.appendChild(frame);
        return frame;
    }

    function watchPopups() {
        observer?.disconnect();
        const d = win()?.document;
        if (!d || typeof win().MutationObserver !== 'function') return;
        const seen = new WeakSet();
        // 只接管需要用户操作且停留的弹窗：一闪而过的加载提示不打断界面。
        const scan = () => {
            for (const dialog of d.querySelectorAll('dialog.popup[open]')) {
                if (seen.has(dialog)) continue;
                seen.add(dialog);
                setTimeout(() => {
                    if (!dialog.open || !needsUser(dialog)) { seen.delete(dialog); return; }
                    lastPopup = popupSummary(dialog);
                    bus.emit('popup', lastPopup);
                }, POPUP_SETTLE_MS);
            }
        };
        observer = new (win().MutationObserver)(scan);
        observer.observe(d.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
        scan();
    }

    function hook() {
        const c = ctx();
        const types = c.eventTypes || c.event_types;
        const relay = (name, type) => c.eventSource.on(types[name], (...args) => bus.emit(type, args));
        c.eventSource.on(types.STREAM_TOKEN_RECEIVED, (text) => bus.emit('token', { text: String(text ?? '') }));
        c.eventSource.on(types.GENERATION_ENDED, () => { ended += 1; bus.emit('ended', { count: ended }); });
        c.eventSource.on(types.GENERATION_STARTED, (type, options, dryRun) => { if (!dryRun) bus.emit('started', { type }); });
        relay('GENERATION_STOPPED', 'stopped');
        relay('MESSAGE_RECEIVED', 'message');
        relay('MESSAGE_SENT', 'message');
        relay('MESSAGE_DELETED', 'message');
        relay('MESSAGE_SWIPED', 'message');
        relay('MESSAGE_EDITED', 'message');
        relay('CHAT_CHANGED', 'chat');
        win().document.addEventListener('vc-chat-retry',()=>bus.emit('message'));
    }

    async function boot() {
        mount();
        frame.src = src;
        await until(() => ctx()?.eventSource, { timeout: 120000, label: 'context' });
        script = await win().eval("import('/script.js')");
        watchPopups();
        // 首次引导等宿主弹窗由界面接管（切到 ST 视图），这里只等设置就绪。
        await until(() => script.settingsReady, { timeout: 600000, label: 'settings' });
        await until(() => !win().document.querySelector('#preloader'), { timeout: 60000, label: 'preloader' });
        hook();
    }

    async function idle() { await until(() => script && !script.isChatSaving, { timeout: 20000, label: 'saving' }); }

    const api = {
        on: bus.on,
        get state() { return state; },
        get frame() { return frame; },
        get lastPopup() { return lastPopup; },
        async start() {
            if (state === 'loading' || state === 'ready') return api;
            setState('loading');
            try { await boot(); setState('ready'); } catch (e) { setState('error', String(e.message)); throw e; }
            return api;
        },
        // 重载前先等保存结束并卸载旧页，避免旧页的保存触发 F2 冲突保护（MB-0 发现 4）。
        async reload() {
            setState('reloading');
            try {
                if (script) await idle();
                observer?.disconnect();
                const old = win();
                frame.src = 'about:blank';
                await until(() => win() !== old || !old?.SillyTavern, { timeout: 20000, label: 'unload' });
                await until(() => !ctx(), { timeout: 20000, label: 'blank' });
                script = null;
                await boot();
                setState('ready');
            } catch (e) { setState('error', String(e.message)); throw e; }
        },
        async open(avatar, file) {
            const index = script.characters.findIndex((c) => c.avatar === avatar);
            if (index < 0) throw new Error('character not found');
            await idle();
            await script.selectCharacterById(index, { switchMenu: false });
            if (file) await script.openCharacterChat(file);
            await until(() => String(ctx().characterId) === String(index), { timeout: 20000, label: 'open' });
            return { chatId: ctx().chatId };
        },
        chatId: () => ctx()?.chatId || '',
        messages: () => (ctx()?.chat || []).map(toMessage),
        character() {
            const c = ctx(); const i = Number(c?.characterId);
            const ch = Number.isInteger(i) ? c.characters[i] : null;
            return ch ? { index: i, name: ch.name, avatar: ch.avatar, theme: ch.data?.extensions?.vc_theme || '' } : null;
        },
        generating: () => Boolean(script?.isGenerating?.()),
        // 发送走原生输入框与发送键：与现有扩展同一路径（含陪伴模式的连发合并）。
        send(text, voiceInput) {
            if(voiceInput) return (async()=>{
                const before=ended,c=ctx();
                const message=await script.sendMessageAsUser(text);
                message.extra.vc_voice_input=voiceInput;
                await c.saveChat();
                win().document.dispatchEvent(new (win().Event)('vc-chat-retry'));
                void c.generate('normal');
                return before;
            })();
            const d = win().document;
            const box = d.querySelector('#send_textarea');
            const set = Object.getOwnPropertyDescriptor(win().HTMLTextAreaElement.prototype, 'value').set;
            set.call(box, text);
            box.dispatchEvent(new (win().Event)('input', { bubbles: true }));
            const before = ended;
            d.querySelector('#send_but').click();
            return before;
        },
        waitEnded: async (before, timeout = 120000) => { await until(() => ended > before, { timeout, label: 'generation' }); await idle(); },
        stop() { ctx().stopGeneration(); },
        async regenerate() { const before = ended; await ctx().generate('regenerate'); return before; },
        swipe(dir) { const before = ended; win().document.querySelector(`#chat .last_mes .swipe_${dir === 'left' ? 'left' : 'right'}`)?.click(); return before; },
        async edit(id, text) {
            const c = ctx(); const m = c.chat[id];
            if (!m) throw new Error('message not found');
            m.mes = text;
            if (Array.isArray(m.swipes)) m.swipes[m.swipe_id ?? 0] = text;
            await c.saveChat();
            await c.reloadCurrentChat();
        },
        async remove(id) { await ctx().deleteMessage(id, undefined, false, true); await idle(); },
        // 消息是否带角色卡前端（Tavern Helper 渲染块或 iframe）：界面显示占位行，点开切到 ST 视图。
        hasCardFrontend(id) {
            const mes = win()?.document?.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
            return Boolean(mes?.querySelector('.TH-render, iframe'));
        },
        mvuReady: () => Boolean(win()?.Mvu),
        async continueReply() { const before = ended; await ctx().generate('continue'); return before; },
        // ST 原生格式化（正则显示规则 + Markdown + DOMPurify），与 ST 自己的显示一致。
        formatMessage(id, text) {
            const m = ctx()?.chat?.[id];
            if (!m || typeof script?.messageFormatting !== 'function') return '';
            return script.messageFormatting(text ?? m.mes, m.name, Boolean(m.is_system), Boolean(m.is_user), id, { FORBID_TAGS: ['style', 'custom-style', 'iframe', 'object', 'embed'], FORBID_ATTR: ['style'] });
        },
        // 置顶与 ST 欢迎页共用账号存储（键 pinnedChats，格式 char_<avatar>_<file>.jsonl），随设置存服务器。
        async pinnedChats() {
            const { accountStorage } = await win().eval("import('/scripts/util/AccountStorage.js')");
            try { return JSON.parse(accountStorage.getItem('pinnedChats') || '{}'); } catch { return {}; }
        },
        async setPinned(avatar, file, on) {
            const { accountStorage } = await win().eval("import('/scripts/util/AccountStorage.js')");
            let state = {};
            try { state = JSON.parse(accountStorage.getItem('pinnedChats') || '{}'); } catch { state = {}; }
            const name = `${file}.jsonl`;
            const key = `char_${avatar}_${name}`;
            if (on) state[key] = { avatar, file_name: name }; else delete state[key];
            accountStorage.setItem('pinnedChats', JSON.stringify(state));
            await script.saveSettings();
        },
        // 删除走 ST 原生流程（与 ST 界面删除同一路径）。
        async deleteChat(avatar, file) {
            const index = script.characters.findIndex((c) => c.avatar === avatar);
            if (index < 0) throw new Error('character not found');
            await idle();
            await script.deleteCharacterChatByName(index, file);
        },
        // ST 视图：把同一个引擎全屏显示，并用现有外壳展开聊天、定位楼层（MB-0 发现 3）。
        async showStView(on, { messageId } = {}) {
            frame.classList.toggle('is-shown', Boolean(on));
            frame.setAttribute('aria-hidden', on ? 'false' : 'true');
            if (!on) return;
            const root = win().document.querySelector('#vc-shell');
            if (typeof root?.openConversation === 'function' && ctx()?.characterId !== undefined) {
                const c = ctx(); const i = Number(c.characterId); const ch = c.characters[i];
                await root.openConversation({ relationshipId: c.chatMetadata?.vc_binding?.relationshipId || '', file: c.chatId || '', characterIndex: i, name: ch?.name || '', avatar: ch?.avatar || '' });
            }
            if (Number.isInteger(messageId)) win().document.querySelector(`#chat .mes[mesid="${messageId}"]`)?.scrollIntoView({ block: 'start' });
        },
        // 使用引擎中已初始化的同源 API 边界，沿用身份快照、重新验证与版本冲突语义。
        async ready() {
            if(state === 'error') throw new Error('engine unavailable');
            await api.start();
            await until(() => state === 'ready' || state === 'error', { timeout: 180000, label: 'ready' });
            if(state === 'error') throw new Error('engine unavailable');
        },
        async call(module, method, ...args) {
            await api.ready();
            const files = { api: 'api.js', inbox: 'inbox-page.js', instances: 'instance-page.js', drawers: 'drawers.js', story: 'story-page.js', voice: 'voice-chat.js', audio: 'voice.js', voiceInput: 'voice-input.js', shell: 'chat-shell.js' };
            if (!files[module]) throw new Error('unknown module');
            const mod = await win().eval(`import('/scripts/extensions/third-party/vc-model-settings/${files[module]}')`);
            return mod[method](...args);
        },
        async voicePolicy() { return api.call('voice','loadVoicePolicy',ctx()); },
        async voiceBubble(snapshot, document) {
            await api.ready();
            const message=ctx().chat[snapshot.id];
            return api.call('audio','createVoiceBubble',{document,text:snapshot.text,voice:snapshot.extra?.vc_voice,input:snapshot.user?snapshot.extra?.vc_voice_input:null,onPlayed(){
                if(ctx().chat[snapshot.id]===message&&message?.extra?.vc_voice?.clipId===snapshot.extra?.vc_voice?.clipId){message.extra.vc_voice.played=true;void ctx().saveChat();}
            }});
        },
        async readAloud(id) {
            await api.ready();
            const button=win().document.querySelector(`#chat .mes[mesid="${id}"] [data-vc-act="read"]`);
            if(!button)throw Error('voice unavailable');
            return api.call('voice','readReplyAloud',id,button);
        },
        async stopVoice() { const mod=await win().eval("import('/scripts/extensions/third-party/vc-model-settings/voice.js')");mod.voicePlayer.stop(); },
        card(avatar) {
            const ch = script?.characters?.find(c=>c.avatar===avatar);
            return ch ? { avatar: ch.avatar, name: ch.name, description: ch.description || ch.data?.description || '', characterRef: ch.data?.extensions?.vc_character_ref || '', theme: ch.data?.extensions?.vc_theme || '' } : null;
        },
        async importCard(file) {
            if(file.size > 32 * 1024 * 1024) throw new Error('card too large');
            const bytes = new (win().Uint8Array)(await file.arrayBuffer());
            const mod = await win().eval("import('/scripts/extensions/third-party/vc-model-settings/instance-page.js')");
            const inspected = mod.inspectCharacterFile(bytes, file.name);
            if(!inspected.ok) throw new Error('invalid card');
            return mod.importNativeCharacterFile({ name:file.name, bytes, format:inspected.format, getContext:ctx });
        },
        async createInstance(avatar, displayName, relationshipId) {
            await api.ready();
            const bindings = await win().eval("import('/scripts/extensions/third-party/vc-model-settings/instance-binding.js')");
            bindings.holdCompanionBinding(true);
            try {
                await api.open(avatar, '');
                let ch=api.card(avatar);
                if(!ch.characterRef) { await ctx().writeExtensionField(Number(ctx().characterId),'vc_character_ref',crypto.randomUUID()); ch=api.card(avatar); }
                await script.doNewChat(); await ctx().saveChat();
                const binding=await api.call('api','resolveSTBinding',{ characterRef:ch.characterRef, displayName, chatIdentity:ctx().chatMetadata.vc_f2.id, mode:'COMPANION', ...(relationshipId?{relationshipId:String(relationshipId)}:{}) });
                ctx().chatMetadata.vc_binding={...binding,displayName};
                await ctx().saveChat();
                return { ...ch, file:ctx().chatId };
            } finally { bindings.holdCompanionBinding(false); }
        },
        binding() { return { ...(ctx()?.chatMetadata?.vc_binding || {}) }; },
        async openDrawer(id) { await api.showStView(true); return api.call('drawers','openDrawerPage',id); },
        // 主题设置（ADR-0011 §7.1）：全局存 ST 扩展设置，角色覆盖存角色卡扩展字段。
        themeSettings() {
            const s = ctx()?.extensionSettings?.vc_theme || {};
            return { global: typeof s.global === 'string' ? s.global : undefined, mode: typeof s.mode === 'string' ? s.mode : undefined };
        },
        async saveThemeSettings({ global, mode }) {
            await api.ready();
            const c = ctx();
            c.extensionSettings.vc_theme = { ...(c.extensionSettings.vc_theme || {}), ...(global !== undefined ? { global } : {}), ...(mode !== undefined ? { mode } : {}) };
            await script.saveSettings();
        },
        async saveCharacterTheme(themeId, avatar) {
            await api.ready();
            const c = ctx();
            const index = avatar ? script.characters.findIndex(ch=>ch.avatar===avatar) : Number(c.characterId);
            if(index < 0) throw new Error('character not found');
            await c.writeExtensionField(index, 'vc_theme', themeId || '');
        },
        destroy() { observer?.disconnect(); frame?.remove(); frame = null; script = null; setState('idle'); },
    };
    return api;
}
