// 桌面唯一聊天写入/生成 owner。原始JSONL始终经ST的既有F2/CAS保存。
import { createF2Client, createSourceGuard, characterChatPath, F2ConflictError, F2_CONFLICT_COPY, extractUnsavedUserInput } from '../../f2-client.js';
import { createInstanceBinding } from '../../instance-binding.js';
import { resolveSTBinding, reconcileSTSources } from '../../api.js';
import { toggleReaction, addNudge, dropNudge, reactionNudge, runPat } from '../../chat-react.js';
import { createPersonaSelection } from './personas.js';

export function createDesktopSession({ client, context, engine, prepareSourceIdentities, readResponse,
    choosePersona, onChange = () => {}, onTakeDraft = () => {}, onRestoreDraft = () => {}, onConflict = () => {},
    resolveBinding = resolveSTBinding, reconcileSources = reconcileSTSources }) {
    let current, job, epoch = 0, savingSettled = false, opening = Promise.resolve();
    const rejected = new Map(), patState = {};
    const f2 = createF2Client();
    const getContext = () => context;
    const guard = createSourceGuard(getContext, { onSettled() {
        if (current?.ready && !job) void save(current).catch(() => {});
    }, onConflict(serialized, error, source) {
        if (current?.metadata === source.metadata) reject(current, error, serialized, true);
    } });
    globalThis[Symbol.for('virtual-companion.f2-source')] = guard;
    f2.setSourcePreparer(records => prepareSourceIdentities(records, { settled: savingSettled,
        sourceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    f2.setSourceObserver(token => reconcileSources([token.id]));
    const personas = createPersonaSelection({ client, context, settings: engine.settings, choose: choosePersona,
        async onSelected(avatar) { engine.bindContext(); await context.eventSource.emit(context.eventTypes.PERSONA_CHANGED, avatar); } });
    const source = () => current && ({ chatIdentity: context.chatMetadata.vc_f2.id,
        characterRef: context.characters[context.characterId]?.data?.extensions?.vc_character_ref,
        mode: context.chatMetadata.vc_binding?.mode || 'COMPANION' });
    const binding = createInstanceBinding({ resolveBinding, getSource: source });
    const publish = target => {
        if (target !== current || target.signal?.aborted) return;
        onChange({ key: target.key, messages: target.messages, busy: Boolean(job && job.target === target),
            canSend: target.ready && !target.blocked && !job, notice: target.notice || '', conflict: target.blocked,
            enterToSend: engine.settings.power_user.send_on_enter !== -1 });
    };
    function reject(target, error, snapshot, sourceConflict = false) {
        target.blocked = true;
        target.notice = F2_CONFLICT_COPY;
        rejected.set(target.path, { snapshot, draft: target.pendingInput, sourceConflict });
        publish(target);
        if (target === current && !target.signal?.aborted) onConflict(snapshot, error);
        return error;
    }
    async function save(target, { settled = !job && guard.isSettled() } = {}) {
        if (target.blocked) throw new F2ConflictError();
        const payload = { avatar_url: target.row.avatar, file_name: target.row.file,
            chat: [{ ...target.header, chat_metadata: target.metadata }, ...target.messages] };
        savingSettled = settled;
        try {
            const result = await f2.save(target.path, payload, { live: true,
                send: serialized => client.raw('/api/chats/save', serialized),
                apply(token) { target.metadata.vc_f2 = token; } });
            if (target === current) { context.metadataDirty = false; publish(target); }
            return result;
        } catch (error) { throw reject(target, error, JSON.stringify(payload), job?.kind === 'mutation'); }
    }
    async function saveSettings() {
        if (!context.settingsDirty) return;
        await client.post('/api/settings/save', engine.settings);
        context.settingsDirty = false;
    }
    context.getCurrentChatId = () => context.chatId;
    context.saveChat = () => save(current);
    context.saveChatConditional = context.saveMetadata = () => {
        context.metadataDirty = true;
        return job || !current?.ready || !guard.isSettled() ? Promise.resolve() : save(current);
    };
    // 生成中的变量变化随最终回复提交；不在memory快照和出站之间另启元数据保存。
    context.saveMetadataDebounced = () => { context.metadataDirty = true; if (current?.ready && !job && guard.isSettled()) void save(current).catch(() => {}); };
    context.saveSettingsDebounced = () => { context.settingsDirty = true; if (!job) void saveSettings().catch(() => {}); };

    async function stop() {
        if (!job) return;
        const active = job;
        if (active.kind === 'mutation') { await active.promise; return; }
        if (!active.controller.signal.aborted) {
            active.controller.abort();
            await context.eventSource.emit(context.eventTypes.GENERATION_STOPPED);
        }
        await active.promise;
    }
    async function open(row, records, { signal, latest = false } = {}, ticket) {
        await stop();
        await engine.cards?.settle();
        await engine.cards?.closeScripts();
        signal?.throwIfAborted();
        if (ticket !== epoch) return false;
        f2.leave();
        const target = { key: JSON.stringify([row.avatar, row.file]), path: characterChatPath(row.avatar, row.file), row,
            header: records[0], metadata: records[0].chat_metadata, messages: records.slice(1), signal, ready: false, blocked: false, notice: '' };
        const previousFinish = target.messages.at(-1)?.extra?.finish_reason;
        if (previousFinish === 'cancelled') target.notice = '已停止';
        if (previousFinish === 'error') target.notice = '没有发送成功';
        current = target;
        if (latest && rejected.has(target.path)) {
            const entry = rejected.get(target.path), missing = extractUnsavedUserInput(entry.snapshot, records);
            if (missing) onRestoreDraft(target.key, entry.draft || missing);
            else rejected.delete(target.path);
        }
        const card = await client.request('/api/characters/get', { avatar_url: row.avatar }, { signal });
        signal?.throwIfAborted(); if (ticket !== epoch) return false;
        let index = context.characters.findIndex(item => item.avatar === row.avatar);
        if (index < 0) index = context.characters.push(card) - 1;
        else context.characters[index] = card;
        Object.assign(context, { chat: target.messages, chatMetadata: target.metadata, chatId: row.file,
            characterId: index, name2: card.name, groupId: null });
        engine.bindContext();
        target.metadata.integrity ||= crypto.randomUUID();
        f2.loaded(target.path, target.metadata);
        context.metadataDirty = false;
        try {
            await personas.load(target.path, { signal });
            signal?.throwIfAborted();
            card.data.extensions ||= {};
            if (!card.data.extensions.vc_character_ref) {
                const ref = crypto.randomUUID();
                await client.post('/api/characters/merge-attributes', { avatar: card.avatar, data: { extensions: { vc_character_ref: ref } } }, { signal });
                signal?.throwIfAborted(); card.data.extensions.vc_character_ref = ref;
                if (card.json_data) {
                    const data = JSON.parse(card.json_data); data.data ||= {}; data.data.extensions ||= {};
                    data.data.extensions.vc_character_ref = ref; card.json_data = JSON.stringify(data);
                }
            }
            const bound = await binding.ensure({ ...source(), displayName: Array.from(card.name || '').slice(0, 32).join('') });
            signal?.throwIfAborted(); if (ticket !== epoch) return false;
            if (JSON.stringify(target.metadata.vc_binding) !== JSON.stringify(bound)) {
                target.metadata.vc_binding = bound; context.metadataDirty = true;
            }
            if (context.metadataDirty) await save(target, { settled: guard.isSettled() });
            await saveSettings();
            signal?.throwIfAborted(); if (ticket !== epoch) return false;
            await engine.cards?.open({ signal });
            await context.eventSource.emit(context.eventTypes.CHAT_CHANGED, row.file);
            await context.eventSource.emit(context.eventTypes.CHAT_LOADED, { detail: { id: index, character: card } });
            await engine.cards?.surface.refresh(target.messages.map((_, index) => index));
            if (context.metadataDirty) await save(target, { settled: guard.isSettled() });
            target.ready = true; publish(target); return true;
        } catch (error) {
            if (ticket === epoch && !signal?.aborted) {
                target.notice = error instanceof F2ConflictError ? F2_CONFLICT_COPY : '聊天没有加载出来，请重试。'; publish(target);
            }
            throw error;
        }
    }
    function send(input, { retry = false, type = 'normal', voiceInput, draftInput = input } = {}) {
        const target = current;
        if (!target?.ready || target.signal?.aborted || target.blocked || job || (type === 'normal' && !retry && !input.trim())) return Promise.resolve(false);
        const previous = target.messages.at(-1);
        if (type !== 'normal' && (!previous || previous.is_user || previous.is_system)) return Promise.resolve(false);
        const active = { target, controller: new AbortController(), promise: null };
        job = active; target.notice = ''; target.retryType = type; publish(target);
        const signal = active.controller.signal;
        const slowTimer = setTimeout(() => {
            if (job === active && !active.received && !target.blocked) {
                target.notice = '回复较慢，可以继续等或停止'; publish(target);
            }
        }, 60000);
        active.promise = (async () => {
            let assistant, bias, savedUser = retry || type !== 'normal', finalSaved = false, removed, original, candidate = 0, prefix = '';
            const snapshot = () => {
                assistant.swipes[candidate] = assistant.mes;
                assistant.swipe_info[candidate] = { send_date: assistant.send_date, gen_started: assistant.gen_started,
                    gen_finished: assistant.gen_finished, extra: structuredClone(assistant.extra) };
            };
            try {
                if (type === 'regenerate') {
                    removed = target.messages.pop(); target.metadata.tainted = true; publish(target);
                    await context.eventSource.emit(context.eventTypes.MESSAGE_DELETED, target.messages.length);
                    await save(target, { settled: false });
                }
                if (type === 'normal' && !retry) {
                    target.pendingInput = input;
                    if (draftInput !== null) onTakeDraft(target.key, draftInput);
                    const prepared = await engine.userMessage(input); signal.throwIfAborted();
                    const message = prepared.message; bias = prepared.bias;
                    if (voiceInput) message.extra.vc_voice_input = voiceInput;
                    target.messages.push(message); target.metadata.tainted = true; publish(target);
                    await save(target, { settled: false }); savedUser = true;
                    target.pendingInput = null;
                    await context.eventSource.emit(context.eventTypes.MESSAGE_SENT, target.messages.length - 1);
                    await context.eventSource.emit(context.eventTypes.USER_MESSAGE_RENDERED, target.messages.length - 1);
                }
                signal.throwIfAborted();
                if (type === 'swipe') {
                    assistant = previous; original = structuredClone(previous);
                    assistant.swipe_id ??= 0; assistant.swipes ||= [assistant.mes]; assistant.swipe_info ||= [];
                    assistant.swipe_info[assistant.swipe_id] = { send_date: assistant.send_date, gen_started: assistant.gen_started,
                        gen_finished: assistant.gen_finished, extra: structuredClone(assistant.extra || {}) };
                    assistant.swipe_id = assistant.swipes.length; assistant.swipes.push(''); candidate = assistant.swipe_id;
                    if (assistant.variables) assistant.variables[candidate] = {};
                    assistant.extra = {}; assistant.swipe_info[candidate] = { extra: {} }; assistant.mes = '';
                    publish(target);
                    // 原swipe先切换空候选再触发生成，EJS/MVU必须读取新候选的变量上下文。
                    await context.eventSource.emit(context.eventTypes.MESSAGE_SWIPED, target.messages.length - 1);
                }
                const packet = await engine.prepare({ type, automatic_trigger: type === 'normal', input, bias, signal });
                if (!packet) {
                    if (original) { for (const key of Object.keys(assistant)) delete assistant[key]; Object.assign(assistant, original); }
                    if (removed) target.messages.push(removed);
                    publish(target); return true; // 原reply planner可选择沉默/取消。
                }
                signal.throwIfAborted();
                const responseSettings = { ...engine.settings.oai_settings };
                const response = await client.generate(packet, { signal });
                if (packet.body.vc_memory && response.headers.has('X-VC-Memory-Status')) {
                    engine.memory.finalStatus({ ...packet.body.vc_memory, status: response.headers.get('X-VC-Memory-Status') });
                }
                if (type === 'swipe' || type === 'continue') {
                    if (type === 'continue') {
                        assistant = previous; original = structuredClone(previous);
                        assistant.swipe_id ??= 0; assistant.swipes ||= [assistant.mes]; assistant.swipe_info ||= [];
                        prefix = assistant.mes; assistant.extra = { ...assistant.extra };
                        delete assistant.extra.no_memory; delete assistant.extra.vc_voice; delete assistant.extra.vc_voice_attempt;
                    }
                    Object.assign(assistant.extra, { api: packet.body.chat_completion_source, model: packet.body.model });
                    candidate = assistant.swipe_id; assistant.gen_started = Date.now(); assistant.send_date = new Date().toISOString();
                } else assistant = { name: context.name2, is_user: false, is_system: false, send_date: new Date().toISOString(),
                    mes: '', swipe_id: 0, swipes: [''], swipe_info: [], gen_started: Date.now(),
                    extra: { api: packet.body.chat_completion_source, model: packet.body.model } };
                if (type !== 'swipe' && type !== 'continue') target.messages.push(assistant);
                publish(target);
                const update = (result, incomplete) => {
                    active.received ||= Boolean(result.text);
                    if (result.text && target.notice === '回复较慢，可以继续等或停止') target.notice = '';
                    assistant.mes = prefix + engine.cleanResponse(result.text, { incomplete, type });
                    assistant.extra.reasoning = result.state.reasoning;
                    if (result.state.signature) assistant.extra.reasoning_signature = result.state.signature;
                    assistant.swipes[candidate] = assistant.mes;
                    publish(target);
                };
                const result = await readResponse(response, { settings: responseSettings, signal, stream: packet.stream,
                    onUpdate: value => update(value, true) });
                update(result, false);
                if (!result.text && !result.toolCalls.length) throw new Error('VC_EMPTY_RESPONSE');
                assistant.gen_finished = Date.now(); assistant.extra.finish_reason = result.finishReason;
                if (result.toolCalls.length) assistant.extra.tool_calls = result.toolCalls;
                if (result.logprobs) assistant.extra.logprobs = result.logprobs;
                for (const alternative of result.swipes) {
                    const at = assistant.swipes.length; assistant.swipes.push(alternative);
                    const extra = structuredClone(assistant.extra); delete extra.vc_source;
                    assistant.swipe_info[at] = { send_date: assistant.send_date, gen_started: assistant.gen_started, gen_finished: assistant.gen_finished, extra };
                    if (assistant.variables) assistant.variables[at] = {};
                }
                context.liveReply = assistant;
                await context.eventSource.emit(context.eventTypes.MESSAGE_RECEIVED, target.messages.length - 1, type);
                await context.eventSource.emit(context.eventTypes.CHARACTER_MESSAGE_RENDERED, target.messages.length - 1, type);
                await engine.cards?.surface.refresh([target.messages.length - 1]);
                snapshot();
                await save(target, { settled: guard.isSettled() });
                finalSaved = true;
                return true;
            } catch (error) {
                if (assistant) {
                    if (!active.received && original) {
                        for (const key of Object.keys(assistant)) delete assistant[key];
                        Object.assign(assistant, original);
                    } else if (!assistant.mes) target.messages.splice(target.messages.indexOf(assistant), 1);
                    else {
                        assistant.extra.no_memory = true;
                        assistant.extra.finish_reason = signal.aborted ? 'cancelled' : 'error';
                        assistant.gen_finished = Date.now();
                        snapshot();
                        try { await save(target, { settled: guard.isSettled() }); finalSaved = true; } catch { /* save已保留拒绝快照和冲突状态。 */ }
                    }
                }
                if (removed && (!assistant || !assistant.mes)) target.messages.push(removed);
                if (!target.blocked) target.notice = signal.aborted ? '已停止' : '没有发送成功';
                if (error.status === 401 || /ACCOUNT|SESSION/.test(error.details?.code || error.code || '')) {
                    target.blocked = true; target.notice = '登录状态或聊天已变化，请重新打开页面。';
                }
                if (!savedUser) onRestoreDraft(target.key, input);
                return false;
            } finally {
                clearTimeout(slowTimer);
                target.pendingInput = null;
                if (!target.blocked && (context.metadataDirty || (savedUser && !finalSaved))) { try { await save(target, { settled: guard.isSettled() }); } catch { /* 同上。 */ } }
                try { await saveSettings(); } catch { target.notice ||= '没有完成，请重试。'; }
                if (job === active) job = null;
                await context.eventSource.emit(context.eventTypes.GENERATION_ENDED, target.messages.length);
                publish(target);
            }
        })();
        return active.promise;
    }
    function mutate(index, expected, change, refresh = [index]) {
        const target = current;
        if (!target?.ready || target.blocked || target.signal?.aborted || job || target.messages[index] !== expected) return Promise.resolve(false);
        const active = { kind: 'mutation', target, controller: new AbortController(), promise: null };
        job = active; target.notice = ''; publish(target);
        active.promise = (async () => {
            try {
                await engine.cards?.settle();
                await change(target, index, expected);
                target.metadata.tainted = true; publish(target);
                if (refresh.length || refresh === 'all') await engine.cards?.surface.refresh(refresh === 'all' ? target.messages.map((_, id) => id) : refresh);
                await save(target, { settled: guard.isSettled() }); return true;
            } catch (error) {
                if (!target.blocked) target.notice = '没有完成，请重试。';
                return false;
            } finally { if (job === active) job = null; publish(target); }
        })();
        return active.promise;
    }
    const api = { activate(row, records, options = {}) {
        const ticket = ++epoch, previous = opening;
        const pending = previous.catch(() => {}).then(() => open(row, records, options, ticket));
        opening = pending; return pending;
    }, send, stop,
        regenerate: () => send('', { type: 'regenerate' }),
        continue: () => send('', { type: 'continue' }),
        edit(index, text, expected = current?.messages[index]) {
            return mutate(index, expected, async (target, id, message) => {
                text = engine.editMessage ? engine.editMessage(message, text) : text;
                message.mes = text;
                if (message.extra) { delete message.extra.vc_voice; delete message.extra.vc_voice_attempt; }
                if (message.swipes) message.swipes[message.swipe_id ?? 0] = text;
                await context.eventSource.emit(context.eventTypes.MESSAGE_EDITED, id);
                await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, id);
            });
        },
        react(index, emoji, expected = current?.messages[index]) {
            return mutate(index, expected, async (target, id, message) => {
                message.extra ||= {};
                const next = toggleReaction(message.extra.vc_reactions, emoji);
                if (next.length) message.extra.vc_reactions = next; else delete message.extra.vc_reactions;
                if (next.includes(emoji)) addNudge(target.metadata, { id: `react:${id}`, text: reactionNudge({ user: context.name1, text: message.mes, emoji }) });
                else dropNudge(target.metadata, `react:${id}`);
            }, []);
        },
        async pat() {
            const target = current; if (!target?.messages.length) return false;
            let generate = false;
            const posted = await mutate(0, target.messages[0], async () => {
                await runPat({ ctx: { ...context, saveChat: async () => {}, generate: async () => { generate = true; } }, state: patState });
            }, [target.messages.length]);
            if (posted && generate && current === target) return send('', { retry: true });
            return posted;
        },
        remove(index, expected = current?.messages[index]) {
            return mutate(index, expected, async target => {
                target.messages.splice(index, 1);
                await context.eventSource.emit(context.eventTypes.MESSAGE_DELETED, target.messages.length);
            }, 'all');
        },
        swipe(index, delta, expected = current?.messages[index]) {
            if (expected?.is_user || expected?.is_system || current?.messages[index] !== expected) return Promise.resolve(false);
            const at = expected.swipe_id ?? 0, next = at + delta, count = expected.swipes?.length || 1;
            if (next === count && index === current.messages.length - 1) return send('', { type: 'swipe' });
            if (next < 0 || next >= count) return Promise.resolve(false);
            return mutate(index, expected, async (target, id, message) => {
                message.swipes ||= [message.mes]; message.swipe_info ||= [];
                message.swipe_info[at] = { send_date: message.send_date, gen_started: message.gen_started,
                    gen_finished: message.gen_finished, extra: structuredClone(message.extra || {}) };
                message.swipe_id = next; message.mes = message.swipes[next];
                const info = message.swipe_info[next];
                message.send_date = info?.send_date; message.gen_started = info?.gen_started; message.gen_finished = info?.gen_finished;
                message.extra = structuredClone(info?.extra || {});
                await context.eventSource.emit(context.eventTypes.MESSAGE_SWIPED, id);
            });
        },
        save: () => save(current), get busy() { return Boolean(job); },
        retry: () => send('', { retry: true, type: current?.retryType || 'normal' }), async copyRejected() {
            const target = current, entry = rejected.get(target?.path);
            if (!entry) return '';
            if (entry.sourceConflict) return entry.snapshot;
            if (entry.draft) return entry.draft;
            const latest = await client.readChat(target.row);
            if (target !== current || target.signal?.aborted) return '';
            return extractUnsavedUserInput(entry.snapshot, latest);
        },
    };
    context.generate = type => type === 'regenerate' ? api.regenerate() : type === 'continue' ? api.continue() : type === 'swipe' ? api.swipe(context.chat.length - 1, 1) : api.retry();
    return api;
}
