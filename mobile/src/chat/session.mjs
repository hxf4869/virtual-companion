// 会话页面的生命周期；ST 是唯一消息与生成权威，草稿只在本机保存。
import { readDraft, writeDraft, withQuote } from './format.mjs';
import { until } from '../engine/engine.mjs';

export function createChatSession({ engine, server, state, storage = globalThis.localStorage, changed = () => {} }) {
    Object.assign(state, { target: null, messages: [], draft: '', quote: null, loading: true, ready: false, busy: false, error: '', interrupted: false });
    let version = 0; let operation = 0; let alive = true;let active=true,activation=0;
    const key = () => `${state.target?.avatar || ''}/${state.target?.file || ''}`;
    const valid = (v, op) => alive && version === v && (op === undefined || operation === op);
    const owns=()=>engine.chatId()===state.target?.file&&engine.character()?.avatar===state.target?.avatar;
    const isCurrent=()=>alive&&active&&state.ready&&owns();
    function usable(){if(isCurrent())return true;if(active&&state.ready){state.ready=false;state.error='connect';changed();}return false;}
    function sync() {
        if (!isCurrent()) return;
        state.messages = engine.messages(); changed();
    }
    const off = ['message','token','ended','stopped'].map(t => engine.on(t, () => {
        if(!active||!owns())return;sync(); if (t === 'stopped') { state.interrupted = true; state.busy = false; }
    }));
    off.push(engine.on('started', () => { if (active&&owns()) { state.busy = true; state.interrupted = false; } }));
    function draft(text) { state.draft = text; writeDraft(key(), text, storage); }
    async function finish(before, v, previousLength, op) {
        try {
            await engine.waitEnded(before);
            if (valid(v, op)&&isCurrent()) { sync(); if (state.messages.length <= previousLength || state.messages.at(-1)?.user) state.error = 'reply'; }
        } catch { if (valid(v, op)) state.error = 'reply'; }
        finally { if (valid(v, op)) { state.busy = false; changed(); } }
    }
    return {
        async open(target) {
            active=true;activation++;
            const v = ++version; state.target = { ...target }; state.ready = false; state.error = '';
            state.loading = true; state.messages = []; state.draft = readDraft(key(), storage); state.quote = null;
            // 历史读取不等引擎冷启动。
            const history = target.file ? server.chat(target.avatar, target.file, target.name).then((r) => {
                if (valid(v) && !state.ready) { state.messages = r.messages; state.loading = false; changed(); }
            }).catch(() => { if(valid(v)) state.error='load'; }) : Promise.resolve();
            try {
                await engine.start(); await until(() => engine.state === 'ready' || engine.state === 'error', { timeout: 180000 });
                if (!valid(v)||!active) return; if (engine.state === 'error') throw Error('engine');
                await engine.open(target.avatar, target.file);
                if (!valid(v)||!active) return;
                state.target.file = engine.chatId(); state.ready = true; state.loading = false; state.error = ''; sync();
            } catch { if (valid(v)) { state.error = 'connect'; state.loading = false; } }
            await history;
        },
        draft, sync,isCurrent,
        suspend(){active=false;activation++;state.ready=false;},
        async resume(){
            if(!alive||!state.target)return false;const token=++activation;active=true;state.ready=false;
            const current=()=>alive&&active&&activation===token;
            try{await engine.start();await until(()=>engine.state==='ready'||engine.state==='error',{timeout:180000});if(!current())return false;if(engine.state==='error')throw Error('engine');
                if(!owns())await engine.open(state.target.avatar,state.target.file);if(!current())return false;if(!owns())throw Error('chat changed');
                state.ready=true;state.loading=false;state.busy=state.busy||engine.generating();if(state.error==='connect')state.error='';sync();return true;
            }catch{if(current()){state.error='connect';state.loading=false;}return false;}
        },
        async send({ voiceInput, text: spoken } = {}) {
            const fromDraft = spoken === undefined; const raw = fromDraft ? state.draft : String(spoken);
            if (!usable() || state.busy || state.error === 'save' || !raw.trim()) return false;
            const v = version, op = ++operation; const text = fromDraft ? withQuote(state.quote, raw) : raw; const len = engine.messages().length;
            state.busy = true; state.error = ''; state.interrupted = false;
            try {
                const before = await engine.send(text, voiceInput);
                await until(() => !owns()||engine.messages().slice(len).some(m => m.user && m.text === text), { timeout: 15000, label: 'send accepted' });
                if (!valid(v, op)) return true;
                // 以服务端聊天读回确认保存，客户端 MESSAGE_SENT 早于实际保存完成。
                try {
                    let readError;
                    await until(async () => {
                        try {
                            const saved = await server.chat(state.target.avatar, state.target.file, state.target.name);
                            return saved.messages.slice(len).some(m => m.user && m.text === text);
                        } catch (e) { readError = e; return true; }
                    }, { timeout: 6000, interval: 200, label: 'send saved' });
                    if (readError) throw readError;
                } catch { if (valid(v, op)) { state.error = 'save'; state.busy = false; } return false; }
                if (!valid(v, op)) return true;
                if (fromDraft) { if (state.draft === raw) draft(''); state.quote = null; } sync();
                void finish(before, v, len + 1, op);
                return true;
            } catch { if (valid(v, op)) { state.busy = false; state.error = 'send'; } return false; }
        },
        async generate(kind = 'regenerate') {
            if (!usable() || state.busy) return;
            const v = version, op = ++operation; state.busy = true; state.error = ''; state.interrupted = false;
            try { const before = await engine[kind](); await engine.waitEnded(before); if(valid(v,op)) sync(); }
            catch { if(valid(v,op)) state.error='reply'; }
            finally { if(valid(v,op)) state.busy=false; }
        },
        stop() { if(!owns())return;operation++; engine.stop(); state.interrupted = true; state.busy = false; sync(); },
        dispose() { alive = false; version++;activation++; off.forEach(f=>f()); },
    };
}
