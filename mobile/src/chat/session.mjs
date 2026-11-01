// 会话页面的生命周期；ST 是唯一消息与生成权威，草稿只在本机保存。
import { readDraft, writeDraft, withQuote } from './format.mjs';
import { until } from '../engine/engine.mjs';

export function createChatSession({ engine, server, state, storage = globalThis.localStorage, changed = () => {} }) {
    Object.assign(state, { target: null, messages: [], draft: '', quote: null, loading: true, ready: false, busy: false, error: '', interrupted: false });
    let version = 0; let alive = true;
    const key = () => `${state.target?.avatar || ''}/${state.target?.file || ''}`;
    const valid = (v) => alive && version === v;
    function sync() {
        if (!alive || !state.ready || engine.chatId() !== state.target?.file) return;
        state.messages = engine.messages(); changed();
    }
    const off = ['message','token','ended','stopped'].map(t => engine.on(t, () => {
        sync(); if (t === 'stopped') { state.interrupted = true; state.busy = false; }
    }));
    off.push(engine.on('started', () => { if (engine.chatId() === state.target?.file) { state.busy = true; state.interrupted = false; } }));
    function draft(text) { state.draft = text; writeDraft(key(), text, storage); }
    async function finish(before, v, previousLength) {
        try {
            await engine.waitEnded(before);
            if (valid(v)) { sync(); if (state.messages.length <= previousLength || state.messages.at(-1)?.user) state.error = 'reply'; }
        } catch { if (valid(v)) state.error = 'reply'; }
        finally { if (valid(v)) { state.busy = false; changed(); } }
    }
    return {
        async open(target) {
            const v = ++version; state.target = { ...target }; state.ready = false; state.error = '';
            state.loading = true; state.messages = []; state.draft = readDraft(key(), storage); state.quote = null;
            // 历史读取不等引擎冷启动。
            const history = target.file ? server.chat(target.avatar, target.file, target.name).then((r) => {
                if (valid(v) && !state.ready) { state.messages = r.messages; state.loading = false; changed(); }
            }).catch(() => { if(valid(v)) state.error='load'; }) : Promise.resolve();
            try {
                await engine.start(); await until(() => engine.state === 'ready' || engine.state === 'error', { timeout: 180000 });
                if (!valid(v)) return; if (engine.state === 'error') throw Error('engine');
                await engine.open(target.avatar, target.file);
                if (!valid(v)) return;
                state.target.file = engine.chatId(); state.ready = true; state.loading = false; state.error = ''; sync();
            } catch { if (valid(v)) { state.error = 'connect'; state.loading = false; } }
            await history;
        },
        draft, sync,
        async send({ voiceInput } = {}) {
            if (!state.ready || state.busy || state.error === 'save' || !state.draft.trim()) return false;
            const v = version; const raw = state.draft; const text = withQuote(state.quote, raw); const len = engine.messages().length;
            state.busy = true; state.error = ''; state.interrupted = false;
            try {
                const before = await engine.send(text, voiceInput);
                await until(() => engine.messages().slice(len).some(m => m.user && m.text === text), { timeout: 15000, label: 'send accepted' });
                if (!valid(v)) return true;
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
                } catch { if (valid(v)) { state.error = 'save'; state.busy = false; } return false; }
                if (!valid(v)) return true;
                if (state.draft === raw) draft(''); state.quote = null; sync();
                void finish(before, v, len + 1);
                return true;
            } catch { if (valid(v)) { state.busy = false; state.error = 'send'; } return false; }
        },
        async generate(kind = 'regenerate') {
            if (!state.ready || state.busy) return;
            const v = version; state.busy = true; state.error = ''; state.interrupted = false;
            try { const before = await engine[kind](); await engine.waitEnded(before); if(valid(v)) sync(); }
            catch { if(valid(v)) state.error='reply'; }
            finally { if(valid(v)) state.busy=false; }
        },
        stop() { engine.stop(); state.interrupted = true; state.busy = false; sync(); },
        dispose() { alive = false; version++; off.forEach(f=>f()); },
    };
}
