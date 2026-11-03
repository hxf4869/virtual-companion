import {wi_anchor_position, forceWorldInfoEntries} from './world-info.js';
import {GENERATION_TYPE_TRIGGERS} from './st/constants.js';
// 一个桌面 realm 只有一个聊天计算 owner；页面/历史读取不等待此锁。
import { bindEngineContext, getMaxPromptTokens } from './ports.js';
import { initMacros } from './st/scripts/macros.js';
import { substituteParams, substituteParamsExtended, setExtensionPrompt, getBiasStrings, extractMessageBias, removeMacros, createRawPrompt } from './st/script.js';
import { getCharaFilename } from './st/scripts/utils.js';
import { Handlebars, Bowser, lodash } from './st/lib.js';
import { event_types } from './st/events.js';
import { createRegexRuntime } from './regex.js';
import { createTokenizer } from './tokenizers.js';
import { createResourcePorts } from './resources.js';
import { createPromptRuntime } from './st/scripts/openai.js';
import { ToolManager } from './tools.js';
import { createChatComputation } from './computation.js';
import { readGenerationResponse } from './response.js';
import { openaiDefaults, powerUserDefaults } from './defaults.js';
import { installHistoryWindow } from '../../../prompt-history.js';
import { createMemoryInjection } from '../../../memory-injection.js';
import { injectCompanionPrompt } from '../../../companion-prompt.js';
import { planReply } from '../../../reply-planner.js';
import { createStoryContext } from '../../../story-context.js';
import { companionToolSpecs, companionToolsShouldRegister, attachCompanionIdentity, COMPANION_TOOL_ACTION_ERROR } from '../../../companion-tools.js';
import { recallSTMemory, resolveSTBinding } from '../../../api.js';
import { loadBundledManifest } from '../../../stickers.js';
import { showToast } from '../../../ui/toast.js';
import { applyDocumentValues } from '../../../settings-documents.js';
import { buildScope, characterKeyOf, chatKeyOf, advanceRunState, isToolContinuation, rewriteGenerateData, restoreManagedReasoningEffort, parseBindingMarker, settingsMarkerFor } from '../../../projection.js';

let initialized = false, owner = Promise.resolve();
// 只为脱离 loadSettings 的现有设置补原缺省值；数组与已保存额外键保留，不维护另一份业务模型。
function defaults(saved, initial) {
    if (saved == null) return structuredClone(initial);
    if (!initial || typeof initial !== 'object' || Array.isArray(initial)) return saved;
    const output = { ...saved };
    for (const [key, value] of Object.entries(initial)) output[key] = defaults(saved[key], value);
    return output;
}

// 计算模块和扩展持有这些设置对象的引用。保存后原位更新，避免留下旧 power_user / EJS 引用。
function updateObject(target, next) {
    for (const key of Object.keys(target)) if (!Object.hasOwn(next, key)) delete target[key];
    for (const [key, value] of Object.entries(next)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) updateObject(target[key], value);
        else Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
    }
}

export function runtimeSettings(raw) {
    const settings = { ...raw, ...(raw.world_info_settings || {}) };
    settings.power_user = defaults(raw.power_user, powerUserDefaults);
    settings.oai_settings = defaults(raw.oai_settings, openaiDefaults);
    settings.extension_settings = { ...raw.extension_settings };
    const extensions = settings.extension_settings;
    extensions.variables ||= { global: {} };
    extensions.disabledExtensions ||= [];
    extensions.note ||= {};
    return settings;
}

export function settingsForSave(settings) {
    const document = { ...settings }, world = { ...settings.world_info_settings };
    for (const key of Object.keys(document)) {
        if (key !== 'world_info_settings' && (key === 'world_info' || key.startsWith('world_info_'))) { world[key] = document[key]; delete document[key]; }
    }
    document.world_info_settings = world;
    return document;
}

export function projectModelSettings(settings, decision, scope) {
    if (!decision?.eligible) return;
    const oai = settings.oai_settings;
    oai.chat_completion_source = decision.source;
    oai[decision.markerField] = settingsMarkerFor(decision, scope);
    const other = decision.markerField === 'custom_url' ? 'reverse_proxy' : 'custom_url';
    if (String(oai[other] || '').startsWith('vc-go://')) oai[other] = '';
    oai[decision.modelField] = decision.modelId;
    oai.openai_max_context = decision.contextWindowTokens;
    oai.openai_max_tokens = decision.maxOutputTokens;
    if (decision.pinned.temperature !== undefined) oai.temp_openai = decision.pinned.temperature;
    if (decision.pinned.topP !== undefined) oai.top_p_openai = decision.pinned.topP;
    if (decision.pinned.reasoningEffort !== undefined) oai.reasoning_effort = decision.pinned.reasoningEffort;
}

export async function createChatEngine({ client, context, settings, decision, presets, models, extensions = [], readInput = () => '', initializeCards }) {
    const getContext = () => context;
    const state = { runId: 0 };
    const toast = { error: message => showToast(String(message), { type: 'failure' }), warning: message => showToast(String(message)) };
    const t = (strings, ...values) => String.raw({ raw: strings }, ...values);
    context.extensionPrompts ||= {};
    context.extensionSettings = settings.extension_settings;
    context.powerUserSettings = settings.power_user;
    context.chatCompletionSettings = settings.oai_settings;
    context.tagMap = settings.tag_map || {};
    context.eventTypes = event_types;
    const locale = String(localStorage.getItem('language') || navigator.language || 'en').toLowerCase();
    const mobile = ['mobile', 'tablet'].includes(Bowser.getParser(navigator.userAgent).getPlatformType());
    const environment = { readInput, firstDisplayedMessageId: 0, model: decision?.modelId || '', models,
        openrouterWebsiteModel: '', locale, mobile, extensions };
    bindEngineContext(context, settings, environment);
    context.setExtensionPrompt = setExtensionPrompt;
    context.saveMetadataDebounced = () => { context.metadataDirty = true; };
    context.saveSettingsDebounced = () => { context.settingsDirty = true; };
    if (!initialized) {
        initMacros();
        Handlebars.registerHelper('trim', () => '{{trim}}');
        Handlebars.registerHelper('helperMissing', function () { const options = arguments[arguments.length - 1]; return substituteParams(`{{${options.name}}}`); });
        initialized = true;
    }
    await loadBundledManifest({ getContext });
    // 锁定EJS的SETTINGS_READY处理必须在项目记忆/陪伴/剧情注入之前登记。
    const cards = await initializeCards?.({ client, context, settings, presets, models });
    const memory = createMemoryInjection({ getContext, recall: recallSTMemory, ensureBinding: async () => {
        const metadata = context.chatMetadata;
        if (metadata.vc_binding?.relationshipId && metadata.vc_binding?.conversationId) return metadata.vc_binding;
        const characterRef = context.characters[context.characterId]?.data?.extensions?.vc_character_ref;
        if (!characterRef || !metadata.vc_f2?.id) throw new Error('聊天尚未建立读取基线。');
        metadata.vc_binding = await resolveSTBinding({ characterRef, chatIdentity: metadata.vc_f2.id,
            mode: metadata.vc_binding?.mode || 'COMPANION', displayName: metadata.vc_binding?.displayName || context.name2 });
        context.metadataDirty = true;
        return metadata.vc_binding;
    }, onStatus: message => { context.memoryStatus = message; } });
    const story = createStoryContext({ getContext });
    const onProjection = data => {
        advanceRunState(state, isToolContinuation(data.messages));
        const scope = buildScope(characterKeyOf(context), chatKeyOf(context.chatId), state.runId);
        rewriteGenerateData(data, decision, scope);
        restoreManagedReasoningEffort(data, decision, settings.oai_settings);
    };
    installHistoryWindow(getContext);
    context.eventSource.on(event_types.CHAT_CHANGED, () => { memory.reset(); state.runId = 0; context.forcedWorldInfoEntries?.clear(); });
    context.eventSource.on(event_types.WORLDINFO_FORCE_ACTIVATE, entries => forceWorldInfoEntries(context, entries));
    context.eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, onProjection);
    context.eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, memory.attach);
    context.eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, data => attachCompanionIdentity(data, getContext));
    for (const spec of companionToolSpecs) ToolManager.registerFunctionTool({ ...spec,
        shouldRegister: () => companionToolsShouldRegister(getContext), action() { throw new Error(COMPANION_TOOL_ACTION_ERROR); } });
    story.install(context.eventSource, event_types.CHAT_COMPLETION_SETTINGS_READY);

    let lastComputation, stoppingStrings;
    function currentRegex() {
        const presetName = settings.oai_settings.preset_settings_openai;
        const preset = presets?.[presetName] || settings.oai_settings;
        return createRegexRuntime({ characters: context.characters, characterId: context.characterId,
            extensionSettings: settings.extension_settings, substituteParams, substituteParamsExtended,
            getPresetManager: () => ({ apiId: 'openai', getSelectedPresetName: () => presetName,
                readPresetExtensionField: ({ path }) => lodash.get(preset.extensions, path) }) });
    }
    async function measureMessage(message) {
        if(!settings.power_user.message_token_count_enabled)return;
        message.extra ||= {};
        message.extra.token_count=await createTokenizer({settings,models,request:(url,body)=>client.request(url,body)}).getTokenCountAsync(message.mes,0);
    }

    function makeComputation(options = {}) {
    const request = (url, body) => client.request(url, body, { signal: options.signal });
    const fetch = (input, init = {}) => globalThis.fetch(input, { ...init, signal: options.signal });
    const resources = createResourcePorts({ getRequestHeaders: client.headers, fetch, toast, t });
    const tokenizer = createTokenizer({ settings, models, request });
    const presetName = settings.oai_settings.preset_settings_openai;
    const preset = presets?.[presetName] || settings.oai_settings;
    const regex = createRegexRuntime({ characters: context.characters, characterId: context.characterId,
        extensionSettings: settings.extension_settings, substituteParams, substituteParamsExtended,
        getPresetManager: () => ({ apiId: 'openai', getSelectedPresetName: () => presetName,
            readPresetExtensionField: ({ path }) => lodash.get(preset.extensions, path) }),
    });
    const prompt = createPromptRuntime({ ...resources, countTokensOpenAIAsync: tokenizer.countTokensOpenAIAsync,
        eventSource: context.eventSource, event_types, ToolManager, fetch, toast, t,
        getTokenizerModel: tokenizer.getTokenizerModel, getRequestHeaders: client.headers,
        async validateReverseProxy() {
            const marker = parseBindingMarker(settings.oai_settings.reverse_proxy);
            if (!marker || marker.invalid || marker.purpose !== 'FOREGROUND_CHAT') throw new Error('请先同步模型绑定。');
        },
    });
    const generatePlan = async ({ prompt: input, systemPrompt, responseLength, prefill }) => {
        const data = { chat: createRawPrompt(input, systemPrompt, prefill), dryRun: false };
        await context.eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, data);
        options.signal?.throwIfAborted();
        const packet = await prompt.createGenerationParameters(settings.oai_settings, decision.modelId, 'quiet', data.chat, {});
        await context.eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY, packet.generate_data);
        if (responseLength > 0) packet.generate_data.max_tokens = Math.min(responseLength, decision.maxOutputTokens);
        const result = await readGenerationResponse(await client.generate({ url: '/api/backends/chat-completions/generate',
            body: JSON.parse(JSON.stringify(packet.generate_data)) }, { signal: options.signal }), { settings: settings.oai_settings, signal: options.signal, stream: packet.stream });
        return computation.cleanUpMessage({ getMessage: result.text, isImpersonate: false, isContinue: false,
            displayIncompleteSentences: true, includeUserPromptBias: false, trimNames: true, trimWrongNames: true });
    };
    const computation = createChatComputation({ context, settings, regex, prompt, tokenizer, ToolManager,
        ...resources, eventSource: context.eventSource, event_types, getCharaFilename, getMaxPromptTokens, Handlebars,
        model: decision.modelId, wi_anchor_position,
        generationTriggers: GENERATION_TYPE_TRIGGERS,
        toast, t,
        loadWorldInfo: name => request('/api/worldinfo/get', { name }),
        async runGenerationInterceptors(chat, size, type) {
            const plan = await planReply({ getContext, type, discardPending: memory.discardPending, generate: generatePlan });
            if (plan?.silent || plan?.cancelled) return true;
            let aborted = false;
            await memory.intercept(chat, size, () => { aborted = true; }, type);
            try { await injectCompanionPrompt({ getContext }); } catch { /* 沿用原状态服务不可用时的语义。 */ }
            return aborted;
        },
    });
        return { computation, prompt, regex, tokenizer, loadWorldInfo: name => request('/api/worldinfo/get', { name }) };
    }

    return { settings, story, memory, cards, measureMessage, substituteMacros: substituteParams, settingsForSave: () => settingsForSave(settings),
        async shouldAutoContinue(chunk) {
            const auto=settings.power_user.auto_continue;
            if(!auto?.enabled || !auto.allow_chat_completions || auto.target_length<=0 || String(readInput()).length || typeof chunk!=='string' || chunk.trim().length<=5 || !context.chat.length)return false;
            const count=await createTokenizer({settings,models,request:(url,body)=>client.request(url,body)}).getTokenCountAsync(context.chat.at(-1).mes,0);
            return count<auto.target_length;
        },
        async generateHelper(config, { signal, onPhase = () => {} } = {}) {
            const [{createHelperPromptRuntime},{createGenerateResult}] = await Promise.all([import('./helper-computation.js'),import('./helper-types.js')]);
            signal.throwIfAborted();
            const original = structuredClone(settings.oai_settings), prompts = Object.fromEntries(Object.entries(context.extensionPrompts).map(([key,value])=>[key,{...value}]));
            const character = context.characters[context.characterId], scenario = character?.scenario;
            const resumeMemory = memory.suspendPending();
            try {
                const custom = config.custom_api || {};
                if (['key','apiurl','proxy_preset','custom_include_headers'].some(key => custom[key]) || custom.model && custom.model !== decision.modelId || custom.source && custom.source !== decision.source) throw new Error('角色卡生成使用当前聊天模型，请在模型设置中配置连接。');
                for (const [key, field] of Object.entries({temperature:'temp_openai',frequency_penalty:'freq_pen_openai',presence_penalty:'pres_pen_openai',top_p:'top_p_openai',top_k:'top_k_openai',max_tokens:'openai_max_tokens'})) {
                    if (typeof custom[key] === 'number') settings.oai_settings[field] = custom[key];
                    else if (custom[key] === 'unset') delete settings.oai_settings[field];
                }
                settings.oai_settings.stream_openai = config.stream;
                projectModelSettings(settings, decision, buildScope(characterKeyOf(context),chatKeyOf(context.chatId),state.runId));
                if (typeof custom.max_tokens === 'number') settings.oai_settings.openai_max_tokens = Math.min(custom.max_tokens,decision.maxOutputTokens);
                bindEngineContext(context,settings,environment);
                const services = makeComputation({signal});
                const calculation = createHelperPromptRuntime({context,settings,...services,getMaxContextSize:getMaxPromptTokens});
                const data = await calculation.prepare({...config,user_input:config.user_input || ''});
                signal.throwIfAborted();
                await context.eventSource.emit('js_generation_started',config.generation_id);
                const packet = await services.prompt.createGenerationParameters(settings.oai_settings,decision.modelId,'normal',data.prompt,{jsonSchema:config.json_schema});
                packet.generate_data.include_reasoning = true;
                Object.assign(packet.generate_data,custom.custom_include_body || {});
                for(const key of custom.custom_exclude_body || [])delete packet.generate_data[key];
                if(config.tools?.length){packet.generate_data.tools=config.tools;if(config.tool_choice)packet.generate_data.tool_choice=config.tool_choice;}
                await context.eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY,packet.generate_data);
                onPhase('transport');
                let previous='',reasoning='';
                const result=await readGenerationResponse(await client.generate({url:'/api/backends/chat-completions/generate',body:JSON.parse(JSON.stringify(packet.generate_data))},{signal}),{
                    settings:settings.oai_settings,powerSettings:settings.power_user,signal,stream:packet.stream,onUpdate:async result=>{
                        if(!packet.stream)return;
                        const full=result.text,thought=result.state.reasoning;
                        const incremental=services.computation.cleanUpMessage({getMessage:full.slice(previous.length),isImpersonate:false,isContinue:false,displayIncompleteSentences:true});
                        await context.eventSource.emit('js_stream_token_received_fully',full,config.generation_id);
                        await context.eventSource.emit('js_stream_token_received_incrementally',incremental,config.generation_id);
                        await context.eventSource.emit('js_reasoning_token_received_fully',thought,config.generation_id);
                        await context.eventSource.emit('js_reasoning_token_received_incrementally',thought.slice(reasoning.length),config.generation_id);
                        previous=full;reasoning=thought;
                    },
                });
                onPhase('callbacks');
                const text=packet.stream?services.computation.cleanUpMessage({getMessage:result.text,isImpersonate:false,isContinue:false,displayIncompleteSentences:false}):result.text;
                await context.eventSource.emit('js_generation_before_end',{message:text,...(result.state.reasoning?{reasoning:result.state.reasoning}:{})},config.generation_id);
                await context.eventSource.emit('js_generation_ended',text,config.generation_id,result.state.reasoning || undefined);
                return createGenerateResult(result.text,{reasoning:result.state.reasoning,reasoning_signature:result.state.signature,tool_calls:result.toolCalls},config.should_return_reasoning);
            } finally {
                updateObject(settings.oai_settings,original); updateObject(context.extensionPrompts,prompts);
                if(character)character.scenario=scenario;
                resumeMemory();bindEngineContext(context,settings,environment);
            }
        },
        applySettings(changes) {
            const next = applyDocumentValues(structuredClone(settingsForSave(settings)), changes);
            updateObject(settings, runtimeSettings(next));
            projectModelSettings(settings, decision, buildScope(characterKeyOf(context), chatKeyOf(context.chatId), state.runId));
            context.tagMap = settings.tag_map || {};
            bindEngineContext(context, settings, environment);
        },
        applyPreset(name, changes, value) { return presets[name] = applyDocumentValues(presets[name] || value,changes); },
        bindContext() { bindEngineContext(context, settings, environment); cards?.bindContext?.(); },
        updateCatalog(nextDecision, nextModels) {
            decision = nextDecision;
            models.splice(0, models.length, ...nextModels);
            environment.model = decision.modelId || '';
            projectModelSettings(settings, decision, buildScope(characterKeyOf(context), chatKeyOf(context.chatId), state.runId));
            bindEngineContext(context, settings, environment);
        },
        async userMessage(input) {
            bindEngineContext(context, settings, environment);
            const bias = getBiasStrings(input, 'normal');
            const { messageBias } = bias;
            const regex = currentRegex();
            const text = regex.getRegexedString(input, regex.regex_placement.USER_INPUT);
            const biasOnly = messageBias && !removeMacros(input);
            const message = { name: context.name1, is_user: !biasOnly, is_system: Boolean(biasOnly),
                send_date: new Date().toISOString(), mes: biasOnly ? ' ' : substituteParams(text), extra: { isSmallSys: false } };
            if (messageBias) { message.extra.bias = messageBias; if (!biasOnly) message.mes = removeMacros(message.mes); }
            if (context.userAvatar in settings.power_user.personas) message.force_avatar = `/thumbnail?type=persona&file=${encodeURIComponent(context.userAvatar)}`;
            await measureMessage(message);
            return { message, bias };
        },
        editMessage(message, text) {
            // 锁定ST updateMessage 的编辑计算，移除原textarea/mesBlock读取。
            bindEngineContext(context, settings, environment);
            const regex = currentRegex(), placement = message.is_user ? regex.regex_placement.USER_INPUT
                : message.extra?.type === 'narrator' ? regex.regex_placement.SLASH_COMMAND : regex.regex_placement.AI_OUTPUT;
            text = regex.getRegexedString(text, placement, { characterOverride: message.extra?.type === 'narrator' ? undefined : message.name, isEdit: true });
            if (settings.power_user.trim_spaces) text = text.trim();
            const bias = substituteParams(extractMessageBias(text)); text = substituteParams(text);
            if (bias) text = removeMacros(text);
            message.extra ||= {}; message.extra.bias = message.is_system || message.is_user || message.extra.type === 'narrator' ? bias ?? null : null;
            return text;
        },
        cleanResponse(text, { incomplete = false, type = 'normal' } = {}) {
            return lastComputation.cleanUpMessage({ getMessage: text, isImpersonate: type === 'impersonate', isContinue: type === 'continue',
                displayIncompleteSentences: incomplete, stoppingStrings });
        },
        async prepare(options = {}) {
            let release;
            const previous = owner;
            owner = new Promise(resolve => { release = resolve; });
            await previous;
            try {
                options.signal?.throwIfAborted();
                environment.firstDisplayedMessageId = context.firstDisplayedMessageId ?? 0;
                bindEngineContext(context, settings, environment);
                const type = options.type || 'normal';
                const eventOptions = { automatic_trigger: options.automatic_trigger ?? false, force_name2: options.force_name2 ?? false,
                    quiet_prompt: options.quiet_prompt || '', quietToLoud: options.quietToLoud ?? false, skipWIAN: options.skipWIAN ?? false,
                    force_chid: options.force_chid, signal: options.signal, quietImage: options.quietImage ?? null };
                await context.eventSource.emit(event_types.GENERATION_STARTED, type, eventOptions, options.dryRun ?? false);
                await context.eventSource.emit(event_types.GENERATION_AFTER_COMMANDS, type, eventOptions, options.dryRun ?? false);
                if (!options.dryRun) context.chatMetadata.tainted = true;
                const { computation } = makeComputation(options);
                const result = await computation.prepare(options);
                options.signal?.throwIfAborted();
                lastComputation = computation;
                stoppingStrings = computation.getStoppingStrings();
                return result;
            } finally { release(); }
        },
    };
}
