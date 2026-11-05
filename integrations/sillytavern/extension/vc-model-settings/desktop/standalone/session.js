// 桌面唯一聊天写入/生成 owner。原始JSONL始终经ST的既有F2/CAS保存。
import { createF2Client, createSourceGuard, createNativeF2IO, characterChatPath, F2ConflictError, F2_CONFLICT_COPY, extractUnsavedUserInput } from '../../f2-logic.js';
import { createInstanceBinding } from '../../instance-binding.js';
import { resolveSTBinding, reconcileSTSources } from '../../api.js';
import { toggleReaction, addNudge, dropNudge, reactionNudge, runPat } from '../../chat-logic.js';
import { createPersonaSelection } from './personas.js';
import { BUDGET_COPY, budgetSignalFromGenerateBody, interpretUsageBudget } from '../../model-logic.js';
import { applyDocumentValues, documentEqual, documentValue } from '../../settings-documents.js';
import { createStoryProjection } from '../../story-projection.js';
import { commitStoryProjectionSave } from '../../projection-save.js';
import { confirmStoryProjection } from '../../story-action.js';

export function createDesktopSession({ client, context, engine, prepareSourceIdentities, readResponse,
    choosePersona, onChange = () => {}, onTakeDraft = () => {}, onRestoreDraft = () => {}, onConflict = () => {},
    resolveBinding = resolveSTBinding, reconcileSources = reconcileSTSources, confirmProjection = confirmStoryProjection }) {
    let current, job, epoch = 0, savingSettled = false, opening = Promise.resolve();
    let budget, catalogReady = true, catalogNotice = '', catalogNeedsSettings = false, lastOperation = Promise.resolve();
    let metadataDirtyFlag = Boolean(context.metadataDirty);
    let metadataRevision = metadataDirtyFlag ? 1 : 0;
    Object.defineProperty(context, 'metadataDirty', {
        get: () => metadataDirtyFlag,
        set: value => {
            const next = Boolean(value);
            if (next) {
                metadataDirtyFlag = true;
                metadataRevision += 1;
            } else {
                metadataDirtyFlag = false;
            }
        },
        configurable: true,
        enumerable: true,
    });
    const messageKeys = new WeakMap();
    let messageSeq = 0;
    function messageKeyOf(target, message, initialIndex = 0) {
        if (!message || typeof message !== 'object') return `${target?.key || ''}:msg:${initialIndex}`;
        let key = messageKeys.get(message);
        if (!key) {
            key = `${target?.key || ''}:${String(message.send_date ?? '')}:${initialIndex}:${++messageSeq}`;
            messageKeys.set(message, key);
        }
        return key;
    }
    function seedMessageKeys(target) {
        if (!target || !Array.isArray(target.messages)) return [];
        return target.messages.map((msg, idx) => messageKeyOf(target, msg, idx));
    }
    const rejected = new Map(), patState = {};
    const helperRuns = new Map();
    const f2 = createF2Client();
    const f2IO = createNativeF2IO({getRequestHeaders:client.headers,client:f2});
    const getContext = () => context;
    const guard = createSourceGuard(getContext, { onSettled() {
        if (current?.ready && !job) {
            lastOperation = save(current).catch(() => {});
        }
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
        if (!target || target !== current || target.signal?.aborted) return;
        const keys = seedMessageKeys(target);
        onChange({ key: target.key, messages: target.messages, messageKeys: keys, busy: Boolean(job && job.target === target && job.kind !== 'opening'),
            canSend: target.ready && !target.blocked && !job && catalogReady && !budget?.insufficient,
            notice: target.blocked ? target.notice : budget?.insufficient ? BUDGET_COPY : target.notice || catalogNotice,
            conflict: target.blocked, catalogBlocked: !catalogReady, settingsRequired: !target.blocked && (catalogNeedsSettings || Boolean(budget?.insufficient)),
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
        for (const message of target.messages) {
            if (!message || typeof message !== 'object') continue;
            if (Array.isArray(message.swipe_info)) {
                const activeIdx = message.swipe_id ?? 0;
                const currentInfo = message.swipe_info[activeIdx];
                if (currentInfo && typeof currentInfo === 'object' && message.extra && typeof message.extra === 'object') {
                    const send_date = message.send_date !== undefined ? message.send_date : currentInfo.send_date;
                    const gen_started = message.gen_started !== undefined ? message.gen_started : currentInfo.gen_started;
                    const gen_finished = message.gen_finished !== undefined ? message.gen_finished : currentInfo.gen_finished;
                    message.swipe_info[activeIdx] = {
                        ...(send_date !== undefined ? { send_date } : {}),
                        ...(gen_started !== undefined ? { gen_started } : {}),
                        ...(gen_finished !== undefined ? { gen_finished } : {}),
                        extra: structuredClone(message.extra),
                    };
                }
            }
        }
        const savedMetadataRevision = metadataRevision;
        const payload = { avatar_url: target.row.avatar, file_name: target.row.file,
            chat: [{ ...target.header, chat_metadata: target.metadata }, ...target.messages] };
        savingSettled = settled;
        try {
            const result = await f2.save(target.path, payload, { live: true,
                send: serialized => client.raw('/api/chats/save', serialized),
                apply(token) { target.metadata.vc_f2 = token; } });
            if (target === current) {
                if (metadataRevision === savedMetadataRevision) metadataDirtyFlag = false;
                publish(target);
            }
            return result;
        } catch (error) { throw reject(target, error, JSON.stringify(payload), job?.kind === 'mutation'); }
    }
    async function saveSettings() {
        if (!context.settingsDirty) return;
        await client.saveSettings(() => engine.settingsForSave());
        context.settingsDirty = client.settingsChanged(engine.settingsForSave());
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
        if (active.kind === 'mutation' || active.kind === 'configuration') { await active.promise; return; }
        if (!active.controller.signal.aborted) {
            active.controller.abort();
            await context.eventSource.emit(context.eventTypes.GENERATION_STOPPED);
        }
        try { await active.promise; } catch (error) { if (!active.controller.signal.aborted) throw error; }
    }
    async function open(row, records, { signal, latest = false } = {}, ticket, operation) {
        await stop();
        await engine.cards?.settle();
        await engine.cards?.closeScripts();
        signal?.throwIfAborted();
        if (ticket !== epoch) return false;
        f2.leave();
        const target = { key: JSON.stringify([row.avatar, row.file]), path: characterChatPath(row.avatar, row.file), row,
            header: records[0], metadata: records[0].chat_metadata, messages: records.slice(1), signal, ready: false, blocked: false, notice: '' };
        seedMessageKeys(target);
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
        operation.target = target; operation.phase = 'preparing'; operation.leaf = operation; job = operation;
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
            const firstMessage = !target.messages.length && engine.firstMessage?.();
            if (firstMessage?.mes) { messageKeyOf(target, firstMessage, 0); target.messages.push(firstMessage); context.metadataDirty = true; }
            await context.eventSource.emit(context.eventTypes.CHAT_CHANGED, row.file);
            await engine.cards?.open({ signal });
            if (firstMessage?.mes) {
                await context.eventSource.emit(context.eventTypes.CHAT_CREATED);
                await context.eventSource.emit(context.eventTypes.MESSAGE_RECEIVED, 0, 'first_message');
                await context.eventSource.emit(context.eventTypes.CHARACTER_MESSAGE_RENDERED, 0, 'first_message');
            }
            await context.eventSource.emit(context.eventTypes.CHAT_LOADED, { detail: { id: index, character: card } });
            await engine.cards?.surface.refresh(target.messages.map((_, index) => index));
            if (context.metadataDirty) await save(target, { settled: guard.isSettled() });
            await saveSettings();
            target.ready = true; publish(target); return true;
        } catch (error) {
            if (ticket === epoch && !signal?.aborted) {
                target.notice = error instanceof F2ConflictError ? F2_CONFLICT_COPY : '聊天没有加载出来，请重试。'; publish(target);
            }
            throw error;
        } finally { if (job === operation) { job = null; publish(target); } }
    }
    function send(input, { retry = false, type = 'normal', voiceInput, draftInput = input, _fromAutoContinue = false } = {}) {
        const target = current;
        if(type==='normal'&&!retry&&!input.trim()&&engine.settings.power_user.continue_on_send&&target?.messages.at(-1)&&!target.messages.at(-1).is_user&&!target.messages.at(-1).is_system)type='continue';
        if (!target?.ready || target.signal?.aborted || target.blocked || job || !catalogReady || budget?.insufficient || (type === 'normal' && !retry && !input.trim())) {
            if (_fromAutoContinue && target) return Promise.resolve(context.eventSource.emit(context.eventTypes.GENERATION_ENDED, target.messages.length)).then(() => { publish(target); return false; });
            return Promise.resolve(false);
        }
        const previous = target.messages.at(-1);
        if (type !== 'normal' && (!previous || previous.is_user || previous.is_system)) {
            if (_fromAutoContinue && target) return Promise.resolve(context.eventSource.emit(context.eventTypes.GENERATION_ENDED, target.messages.length)).then(() => { publish(target); return false; });
            return Promise.resolve(false);
        }
        const active = { target, controller: new AbortController(), promise: null, phase: 'preparing' }; active.leaf = active;
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
                    messageKeyOf(target, message, target.messages.length);
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
                active.phase = 'transport';
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
                } else {
                    assistant = { name: context.name2, is_user: false, is_system: false, send_date: new Date().toISOString(),
                        mes: '', swipe_id: 0, swipes: [''], swipe_info: [], gen_started: Date.now(),
                        extra: { api: packet.body.chat_completion_source, model: packet.body.model } };
                    messageKeyOf(target, assistant, target.messages.length);
                }
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
                const result = await readResponse(response, { settings: responseSettings, powerSettings:engine.settings.power_user, signal, stream: packet.stream,
                    onUpdate: value => update(value, true) });
                update(result, false);
                await engine.measureMessage?.(assistant);
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
                active.phase = 'callbacks';
                await context.eventSource.emit(context.eventTypes.MESSAGE_RECEIVED, target.messages.length - 1, type);
                await context.eventSource.emit(context.eventTypes.CHARACTER_MESSAGE_RENDERED, target.messages.length - 1, type);
                await engine.cards?.surface.refresh([target.messages.length - 1]);
                snapshot();
                await save(target, { settled: guard.isSettled() });
                finalSaved = true;
                active.autoChunk = result.text;
                if (!signal.aborted && type !== 'swipe' && result.finishReason !== 'cancelled' && current === target) {
                    try {
                        active.willAutoContinue = Boolean(await engine.shouldAutoContinue?.(active.autoChunk, { signal }))
                            && !signal.aborted && current === target;
                    } catch {
                        active.willAutoContinue = false;
                    }
                }
                if (signal.aborted && !target.blocked) target.notice = '已停止';
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
                const budgetSignal = !signal.aborted && current === target ? budgetSignalFromGenerateBody(error?.details) : null;
                if (budgetSignal) budget = interpretUsageBudget(budgetSignal);
                if (!target.blocked) target.notice = signal.aborted ? '已停止' : budget?.insufficient ? BUDGET_COPY : '没有发送成功';
                if (error.status === 401 || /ACCOUNT|SESSION/.test(error.details?.code || error.code || '')) {
                    target.blocked = true; target.notice = '登录状态或聊天已变化，请重新打开页面。';
                }
                if (!savedUser && draftInput !== null) onRestoreDraft(target.key, draftInput);
                return false;
            } finally {
                clearTimeout(slowTimer);
                target.pendingInput = null;
                if (!target.blocked && (context.metadataDirty || (savedUser && !finalSaved))) { try { await save(target, { settled: guard.isSettled() }); } catch { /* 同上。 */ } }
                try { await saveSettings(); } catch { target.notice ||= '没有完成，请重试。'; }
                const continuing = Boolean(active.willAutoContinue && current === target && !signal.aborted && !target.blocked && catalogReady && !budget?.insufficient);
                active.willAutoContinue = continuing;
                if (job === active) job = null;
                if (!continuing) await context.eventSource.emit(context.eventTypes.GENERATION_ENDED, target.messages.length);
                publish(target);
            }
        })();
        active.promise=active.promise.then(async result=>{
            if (active.willAutoContinue) {
                if (result && current === target && !signal.aborted && !job) {
                    return send('', { type: 'continue', _fromAutoContinue: true });
                }
                await context.eventSource.emit(context.eventTypes.GENERATION_ENDED, target.messages.length);
                publish(target);
            }
            return result;
        });
        lastOperation = active.promise;
        return active.promise;
    }
    function mutate(index, expected, change, refresh = [index], afterRefresh, refreshOptions, beforeMutation, { deferChatSave = false } = {}) {
        const target = current;
        const mutationEpoch = epoch;
        if (!target?.ready || target.blocked || target.signal?.aborted || job || target.messages[index] !== expected) return Promise.resolve(false);
        const active = { kind: 'mutation', target, controller: new AbortController(), promise: null, phase: 'preparing' };
        active.leaf = active;
        job = active; target.notice = ''; publish(target);
        const isSessionActive = () =>
            mutationEpoch === epoch &&
            target === current &&
            job === active &&
            Boolean(target?.ready) &&
            !target.blocked &&
            !target.signal?.aborted &&
            !active.controller.signal.aborted;
        const canStartMutation = () => isSessionActive() && target.messages[index] === expected;
        active.promise = (async () => {
            let beforeError = null;
            try {
                let preAllowed = true;
                let preIsAsync = false;
                if (beforeMutation) {
                    try {
                        preAllowed = beforeMutation(target);
                        preIsAsync = Boolean(preAllowed && typeof preAllowed.then === 'function');
                        if (preIsAsync) {
                            preAllowed.catch(() => {});
                        } else if (preAllowed === false || !canStartMutation()) {
                            return false;
                        }
                    } catch (err) {
                        beforeError = err;
                        throw err;
                    }
                }
                await engine.cards?.settle();
                if (!canStartMutation() || engine.cards?.isRendering?.()) {
                    return false;
                }
                if (beforeMutation) {
                    try {
                        if (preIsAsync) {
                            const resolved = await preAllowed;
                            if (resolved === false || !canStartMutation()) {
                                return false;
                            }
                        } else {
                            let postAllowed = beforeMutation(target);
                            if (postAllowed && typeof postAllowed.then === 'function') {
                                postAllowed = await postAllowed;
                            }
                            if (postAllowed === false || !canStartMutation()) {
                                return false;
                            }
                        }
                    } catch (err) {
                        beforeError = err;
                        throw err;
                    }
                }
                await change(target, index, expected);
                if (!isSessionActive()) {
                    return false;
                }
                if (deferChatSave) context.metadataDirty = true;
                target.metadata.tainted = true; publish(target);
                if (refresh.length || refresh === 'all') {
                    const indices = refresh === 'all' ? target.messages.map((_, id) => id) : refresh;
                    await engine.cards?.surface.refresh(indices, refreshOptions);
                }
                if (afterRefresh) {
                    active.phase = 'callbacks';
                    await afterRefresh(target, index, expected);
                    publish(target);
                }
                if (!isSessionActive()) {
                    return false;
                }
                if (!deferChatSave) {
                    await save(target, { settled: guard.isSettled() });
                }
                await saveSettings();
                return true;
            } catch (error) {
                if (beforeError) throw beforeError;
                if (!target.blocked) target.notice = '没有完成，请重试。';
                return false;
            } finally { if (job === active) job = null; publish(target); }
        })();
        lastOperation = active.promise.catch(() => {});
        return active.promise;
    }
    const api = { activate(row, records, options = {}) {
        const ticket = ++epoch, previous = opening;
        const operation = {kind:'opening',controller:new AbortController(),promise:null};
        const signal = options.signal ? AbortSignal.any([options.signal,operation.controller.signal]) : operation.controller.signal;
        const pending = previous.catch(() => {}).then(() => open(row, records, {...options,signal}, ticket, operation));
        operation.promise = pending;
        opening = pending; return pending;
    }, send, stop,
        refreshView() { publish(current); },
        setBudget(value) { budget = value; publish(current); },
        setCatalogStatus(ready, notice = '', needsSettings = false) { catalogReady = ready; catalogNotice = notice; catalogNeedsSettings = needsSettings; publish(current); },
        async whenIdle() {
            while (true) {
                const pendingOpen = opening, operation = lastOperation;
                await pendingOpen.catch(() => {}); await operation;
                if (pendingOpen === opening && operation === lastOperation) return;
            }
        },
        async configure(apply) {
            await api.whenIdle();
            const target = current, active = { kind: 'configuration', target, promise: null };
            job = active; publish(target);
            active.promise = (async () => {
                try {
                    await engine.cards?.settle();
                    await apply();
                    if (target === current && context.metadataDirty && target?.ready && !target.blocked) await save(target, { settled: guard.isSettled() });
                    await saveSettings();
                } finally { if (job === active) job = null; publish(target); }
            })();
            lastOperation = active.promise.catch(() => {});
            return active.promise;
        },
        refreshPersona: () => personas.refresh(),
        async createConversation({ characterRef, displayName, chatIdentity = crypto.randomUUID(), mode = 'COMPANION' }) {
            let created;
            await api.configure(async () => {
                const card = context.characters.find(card => card.data?.extensions?.vc_character_ref === characterRef);
                if (!card) throw new Error('角色卡没有加载出来，请重试。');
                const file = chatIdentity, path = characterChatPath(card.avatar, file);
                const metadata = { vc_f2: { id: chatIdentity, revision: 0 }, vc_binding: { mode } };
                const records = [{ user_name: engine.settings.username || context.name1, character_name: card.name, chat_metadata: metadata }];
                // Go只解析绑定；原始聊天和初始F2 token仍由同一ST保存路径持有。
                const bound = await resolveBinding({ characterRef, displayName, chatIdentity, mode });
                metadata.vc_binding = bound;
                const saved = await f2.save(path, { avatar_url: card.avatar, file_name: file, chat: records }, {
                    send: serialized => client.raw('/api/chats/save', serialized),
                });
                metadata.vc_f2 = saved.vc_f2;
                created = { ...bound, avatar: card.avatar, file, chatIdentity, characterRef, name: displayName };
            });
            return created;
        },
        async projectStory(job) {
            let result;
            await api.configure(async () => {
                const target = current;
                const assertTarget = () => {
                    if (!target?.ready || target !== current || target.blocked || target.signal?.aborted
                        || target.metadata.vc_binding?.mode !== 'STORY' || target.metadata.vc_binding.conversationId !== job.conversationId) {
                        throw new F2ConflictError('VC_STALE_SOURCE');
                    }
                };
                assertTarget();
                const projection = createStoryProjection({
                    readChat: async () => { assertTarget(); return { metadata: target.metadata, messages: target.messages.slice() }; },
                    saveChat: async snapshot => {
                        assertTarget(); commitStoryProjectionSave(context, snapshot);
                        await save(target, { settled: guard.isSettled() });
                        await engine.cards?.surface.refresh(target.messages.map((_, index) => index));
                        publish(target);
                    },
                    confirm: confirmProjection,
                });
                result = await projection.project(job);
            });
            return result;
        },
        deleteCharacter(avatar, deleteChats) { return api.configure(async () => {
            const rows=deleteChats?await client.request('/api/characters/chats',{avatar_url:avatar,simple:true}):[];
            const baselines=await f2IO.baselines((Array.isArray(rows)?rows:[]).map(row=>({avatar,file:row.file_name})));
            await client.post('/api/characters/delete',{avatar_url:avatar,delete_chats:deleteChats,vc_f2_chats:baselines});
            if(current?.row.avatar===avatar){await engine.cards?.closeScripts();f2.leave();current=null;context.chat=[];context.chatMetadata={};context.chatId='';context.characterId=undefined;context.metadataDirty=false;}
        }); },
        get ready() { return Boolean(current?.ready && !current.blocked && !current.signal?.aborted); },
        async commitMetadata(changes, expectedKey) {
            await api.whenIdle();
            const target = current;
            if (!api.ready || target.key !== expectedKey) throw new Error('聊天已切换或尚未就绪，聊天绑定尚未保存；其他设置可继续保存。');
            if (changes.some(change => !documentEqual(documentValue(target.metadata, change.path), change.before))) {
                const error = new Error('设置已在另一处更新。'); error.status = 409; throw error;
            }
            const saved = await mutate(0, target.messages[0], async () => {
                applyDocumentValues(target.metadata, changes);
                if (changes.some(change => change.path[0] === 'persona')) await personas.load(`${target.path}:settings:${crypto.randomUUID()}`, { signal: target.signal });
                engine.bindContext();
                await context.eventSource.emit(context.eventTypes.CHAT_CHANGED, context.chatId);
            }, 'all');
            if (!saved) { const error = new Error(target.notice || '配置没有保存，请重试。'); error.status = target.blocked ? 409 : undefined; throw error; }
        },
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
                const rawExtra = info && typeof info === 'object'
                    ? (info.extra && typeof info.extra === 'object'
                        ? info.extra
                        : Object.fromEntries(Object.entries(info).filter(([k]) => !['send_date', 'gen_started', 'gen_finished', 'extra'].includes(k))))
                    : {};
                const nextExtra = structuredClone(rawExtra);
                if (info?.send_date !== undefined) message.send_date = info.send_date;
                message.gen_started = info?.gen_started; message.gen_finished = info?.gen_finished;
                message.extra = nextExtra;
                message.swipe_info[next] = {
                    ...(message.send_date !== undefined ? { send_date: message.send_date } : {}),
                    ...(message.gen_started !== undefined ? { gen_started: message.gen_started } : {}),
                    ...(message.gen_finished !== undefined ? { gen_finished: message.gen_finished } : {}),
                    extra: structuredClone(nextExtra),
                };
                await context.eventSource.emit(context.eventTypes.MESSAGE_SWIPED, id);
            });
        },
        save: () => save(current), get busy() { return Boolean(job); },
        messageKey: (message, index = 0) => messageKeyOf(current, message, index),
        destroySession() {
            epoch++;
            if (job?.controller && !job.controller.signal.aborted) job.controller.abort();
            for (const controller of helperRuns.values()) controller.abort();
            helperRuns.clear();
            engine.cards?.destroy?.();
            if (globalThis.SillyTavern?.getContext?.() === context) delete globalThis.SillyTavern;
            f2.leave();
            current = null;
            job = null;
            const sym = Symbol.for('virtual-companion.f2-source');
            if (globalThis[sym] === guard) delete globalThis[sym];
        },
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
    let activeTemplateScopes = 0;
    let templateScopeEpoch = epoch;
    const hasActiveTemplateScopes = () => templateScopeEpoch === epoch && activeTemplateScopes > 0;
    context.captureHelperScope = () => {
        if (templateScopeEpoch !== epoch) {
            templateScopeEpoch = epoch;
            activeTemplateScopes = 0;
        }
        const capturedEpoch = epoch;
        const capturedOwner = current;
        let released = false;
        activeTemplateScopes++;
        let scope;
        const release = () => {
            if (released) return;
            released = true;
            if (capturedEpoch === epoch && capturedOwner === current && templateScopeEpoch === epoch) {
                activeTemplateScopes = Math.max(0, activeTemplateScopes - 1);
            }
            if (scope) scope.valid = false;
        };
        if (!job || job.phase === 'transport') return { scope: undefined, release };
        scope = { job, leaf: job.leaf, valid: true };
        return { scope, release };
    };
    context.generateHelper = (apiName, config, scoped) => {
        if (!catalogReady || budget?.insufficient || !current || current.blocked || current.signal?.aborted) return Promise.reject(new Error('请先配置聊天模型并打开聊天。'));
        const nested = Boolean(scoped);
        if (job && (!scoped?.valid || scoped.job !== job || scoped.leaf !== job.leaf || job.phase === 'transport')) return Promise.reject(new Error('当前生成尚未结束。'));
        if (scoped && !job) return Promise.reject(new Error('角色卡执行上下文已失效。'));
        if (!job && !current.ready) return Promise.reject(new Error('聊天尚未就绪。'));
        config.generation_id ||= crypto.randomUUID();
        if (helperRuns.has(config.generation_id)) return Promise.reject(new Error('该生成请求仍在进行中。'));
        const parent = job, target = current, token = structuredClone(target.metadata.vc_f2);
        const controller = new AbortController(), active = parent || {kind:'helper',target,controller,promise:null,phase:'preparing'};
        const previousLeaf = active.leaf, previousPhase = active.phase, leaf = {generationId:config.generation_id};
        active.leaf = leaf; active.phase = 'preparing'; job = active;
        const signal = AbortSignal.any([controller.signal,active.controller?.signal || controller.signal,target.signal].filter(Boolean));
        helperRuns.set(config.generation_id,controller); publish(target);
        const pending = (async () => {
            try {
                await context.eventSource.emit('js_generation_requested',config.generation_id,apiName,config);
                const {fromGenerateConfig,fromGenerateRawConfig,convertGenerateWithCustomPreset} = await import('./engine/helper-config.js');
                const params = apiName === 'generateRaw' ? fromGenerateRawConfig(config) : config.preset_name && config.preset_name !== 'in_use'
                    ? fromGenerateRawConfig(convertGenerateWithCustomPreset(config,engine.cards.getPreset,engine.substituteMacros)) : fromGenerateConfig(config);
                const value = await engine.generateHelper(params,{signal,onPhase:phase=>{active.phase=phase;}});
                signal.throwIfAborted();
                if (target !== current || target.metadata.vc_f2.id !== token.id || target.metadata.vc_f2.revision !== token.revision) throw new F2ConflictError('VC_STALE_SOURCE');
                return value;
            } finally {
                helperRuns.delete(config.generation_id);
                active.leaf = previousLeaf; active.phase = previousPhase;
                if (!nested && job === active) {
                    try { if (context.metadataDirty && guard.isSettled()) await save(target,{settled:true}); await saveSettings(); }
                    finally {job = null;publish(target);}
                }
            }
        })();
        if (!parent) {active.promise = pending;lastOperation = pending.catch(()=>{});}
        return pending;
    };
    context.stopHelperGenerationById = id => { const controller=helperRuns.get(id);if(!controller)return false;controller.abort();void context.eventSource.emit(context.eventTypes.GENERATION_STOPPED,id);return true; };
    context.stopAllHelperGeneration = () => {for(const id of helperRuns.keys())context.stopHelperGenerationById(id);};
    Object.defineProperty(context, 'isGenerating', {
        get: () => Boolean(helperRuns.size > 0 || (job && !['opening', 'mutation', 'configuration'].includes(job.kind))),
        configurable: true,
        enumerable: true,
    });
    context.mutateChatMessages = (expectedMetadata, change, { refresh = 'all', afterRefresh, refreshOptions, structural = true, beforeMutation, deferChatSave = false } = {}) => {
        if (
            !current ||
            current.blocked ||
            current.signal?.aborted ||
            current.metadata !== expectedMetadata ||
            (engine.cards?.isRendering?.() && (hasActiveTemplateScopes() || typeof engine.cards?.settle !== 'function'))
        ) {
            return Promise.resolve(false);
        }
        const guardBeforeMutation = target => {
            if (target !== current || target.blocked || target.signal?.aborted || target.metadata !== expectedMetadata) {
                return false;
            }
            return beforeMutation ? beforeMutation(target) : true;
        };
        if (structural) {
            if (!current.ready || job) return Promise.resolve(false);
            return mutate(
                0,
                current.messages[0],
                target => change(target.messages),
                refresh,
                afterRefresh ? target => afterRefresh(target.messages) : undefined,
                refreshOptions,
                guardBeforeMutation,
            );
        }
        if (!job) {
            if (!current.ready) return Promise.resolve(false);
            return mutate(
                0,
                current.messages[0],
                target => change(target.messages),
                refresh,
                afterRefresh ? target => afterRefresh(target.messages) : undefined,
                refreshOptions,
                guardBeforeMutation,
                { deferChatSave },
            );
        }
        if (job.target !== current || job.phase === 'transport') {
            return Promise.resolve(false);
        }
        const target = current;
        const parentJob = job;
        const parentLeaf = job.leaf;
        const nestedEpoch = epoch;
        const canMutateNested = () =>
            nestedEpoch === epoch &&
            target === current &&
            !target.blocked &&
            !target.signal?.aborted &&
            target.metadata === expectedMetadata &&
            job === parentJob &&
            job.target === target &&
            job.leaf === parentLeaf &&
            !job.controller?.signal?.aborted &&
            job.phase !== 'transport';
        return (async () => {
            if (!canMutateNested()) {
                return false;
            }
            let preAllowed = guardBeforeMutation(target);
            const preIsAsync = Boolean(preAllowed && typeof preAllowed.then === 'function');
            if (preIsAsync) {
                preAllowed.catch(() => {});
            } else if (preAllowed === false || !canMutateNested()) {
                return false;
            }
            await engine.cards?.settle();
            if (!canMutateNested() || engine.cards?.isRendering?.()) {
                return false;
            }
            if (preIsAsync) {
                const resolved = await preAllowed;
                if (resolved === false || !canMutateNested()) {
                    return false;
                }
            } else {
                let postAllowed = guardBeforeMutation(target);
                if (postAllowed && typeof postAllowed.then === 'function') {
                    postAllowed = await postAllowed;
                }
                if (postAllowed === false || !canMutateNested()) {
                    return false;
                }
            }
            await change(target.messages);
            if (!canMutateNested()) {
                return false;
            }
            context.metadataDirty = true;
            target.metadata.tainted = true;
            publish(target);
            if (job?.kind !== 'opening' && (refresh.length || refresh === 'all')) {
                const indices = refresh === 'all' ? target.messages.map((_, id) => id) : refresh;
                await engine.cards?.surface.refresh(indices, refreshOptions);
            }
            if (job?.kind !== 'opening' && afterRefresh) {
                await afterRefresh(target.messages);
                publish(target);
            }
            return true;
        })();
    };
    context.commitHelperChanges = async expectedMetadata => {
        const validateOwner = () => {
            const activeSt = globalThis.SillyTavern;
            const ownsContext = !activeSt || typeof activeSt.getContext !== 'function' || activeSt.getContext() === context;
            return Boolean(ownsContext && current && !current.blocked && !current.signal?.aborted && expectedMetadata === current.metadata);
        };
        if (!validateOwner()) {
            throw new Error('VC_CHAT_MUTATION_REJECTED');
        }
        if (job) {
            if (job.target !== current || job.phase === 'transport') {
                throw new Error('VC_CHAT_MUTATION_REJECTED');
            }
            return true;
        }
        if (!current.ready) {
            throw new Error('VC_CHAT_MUTATION_REJECTED');
        }
        if (engine.cards?.isRendering?.()) {
            if (hasActiveTemplateScopes() || typeof engine.cards?.settle !== 'function') {
                throw new Error('VC_CHAT_MUTATION_REJECTED');
            }
            await engine.cards.settle();
            if (!validateOwner() || !current.ready || hasActiveTemplateScopes() || engine.cards?.isRendering?.()) {
                throw new Error('VC_CHAT_MUTATION_REJECTED');
            }
            if (job) {
                if (job.target !== current || job.phase === 'transport') {
                    throw new Error('VC_CHAT_MUTATION_REJECTED');
                }
                return true;
            }
        }
        if (context.metadataDirty) {
            if (!guard.isSettled()) {
                throw new Error('VC_CHAT_MUTATION_REJECTED');
            }
            await save(current, { settled: true });
        }
        await saveSettings();
        return true;
    };
    context.generate = type => type === 'regenerate' ? api.regenerate() : type === 'continue' ? api.continue() : type === 'swipe' ? api.swipe(context.chat.length - 1, 1) : api.retry();
    return api;
}
