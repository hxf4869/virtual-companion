// 与页面启动解耦的聊天准备入口；后续聊天计算/生成只在此模块接线，保存设置不会触发它。
import { fetchModelPurposes, fetchProviders } from '../../api.js';
import { resolveForegroundProjection, buildScope, characterKeyOf, chatKeyOf } from '../../projection-logic.js';
import { createChatEngine, runtimeSettings, projectModelSettings, settingsForSave } from './engine/runtime.js';
import { createDesktopSession } from './session.js';
import { readGenerationResponse } from './engine/response.js';
import { prepareSourceIdentities } from '/scripts/vc-runtime/source-identity.js';
import { voicePlayer, installChatVoice, requestChatVoice } from '../../voice-logic.js';
import { planSticker, readSettings, listStickerPicks, stripStickerTags } from '../../stickers-logic.js';
import { injectNudges } from '../../chat-logic.js';
import { initializeCards } from './cards/index.js';

function installRuntimeMediaBindings({ context, paint = () => {} }) {
    const getContext = () => ({ ...context });
    const voice = installChatVoice({ getContext, saveChat: () => context.saveChatConditional(), ready: Promise.resolve() });
    const changed = () => { voicePlayer.stop(); paint(); };
    const refreshed = () => paint();
    const generated = async () => {
        context.setExtensionPrompt?.('vc_react_nudge', '', 1, 0);
        const message = context.chat.at(-1);
        if (message && !message.is_user && !message.is_system && !message.extra?.no_memory) await requestChatVoice(context.chat.length - 1);
        paint();
    };
    const before = () => injectNudges(getContext());
    const settle = index => {
        if (context.chatMetadata.vc_binding?.mode !== 'COMPANION') return;
        const message = context.chat[index];
        if (!message || message.is_user || message.is_system) return;
        const settings = readSettings(), user = context.chat.slice(0, index).findLast(row => row.is_user);
        const result = planSticker({ segments: [message.mes], metadata: context.chatMetadata, userText: user?.mes || '',
            turnId: String(index), live: true, enabled: settings.enabled, frequency: settings.frequency, assets: listStickerPicks() });
        if (/<sticker\b/i.test(message.mes)) {
            message.mes = stripStickerTags(message.mes); message.extra ||= {};
            message.extra.vc_sticker = result.sticker; message.extra.vc_sticker_settled = true;
        }
    };
    const bindings = [[context.eventTypes.CHAT_CHANGED, changed], [context.eventTypes.MESSAGE_SWIPED, changed], [context.eventTypes.MESSAGE_EDITED, changed],
        [context.eventTypes.CHARACTER_MESSAGE_RENDERED, settle], [context.eventTypes.GENERATION_ENDED, generated],
        [context.eventTypes.GENERATION_STARTED, before]];
    for (const [type, handler] of bindings) context.eventSource.on(type, handler);
    if (typeof document !== 'undefined') document.addEventListener('vc-chat-retry', refreshed);
    return {
        destroy() {
            voicePlayer.stop();
            voice.destroy();
            if (typeof document !== 'undefined') document.removeEventListener('vc-chat-retry', refreshed);
            for (const [type, handler] of bindings) context.eventSource.removeListener(type, handler);
        },
    };
}

export async function prepareChatRuntime({ client, context, signal, choosePersona, callGenericPopup, readInput, readFirstDisplayedMessageId, onChange, onTakeDraft, onRestoreDraft, onConflict, onToast, paint = () => {} }) {
    signal?.throwIfAborted();
    const [purposes, providers, packet] = await Promise.all([fetchModelPurposes(), fetchProviders(), client.settings()]);
    signal?.throwIfAborted();
    const decision = resolveForegroundProjection(purposes, providers);
    const settings = runtimeSettings(JSON.parse(packet.settings));
    const scope = buildScope(characterKeyOf(context), chatKeyOf(context.chatId), 0);
    projectModelSettings(settings, decision, scope);
    client.documents.captureSettings(JSON.parse(packet.settings), settingsForSave(settings));
    client.documents.seedPresets(packet);
    const presets = Object.fromEntries(packet.openai_setting_names.map((name, index) => [name, JSON.parse(packet.openai_settings[index])]));
    const models = providers.flatMap(provider => provider.models.map(model => ({ id: model.modelId, ...model })));
    const safeToast = onToast ? (message, opts) => { if (!signal?.aborted) onToast(message, opts); } : undefined;
    const engine = await createChatEngine({ client, context, signal, settings, decision, presets, models, packet, readInput, readFirstDisplayedMessageId, onToast: safeToast,
        initializeCards: args => initializeCards({ ...args, packet, callGenericPopup, signal }) });
    if (signal?.aborted) {
        engine.destroy?.();
        signal.throwIfAborted();
    }
    const session = createDesktopSession({ client, context, engine, prepareSourceIdentities, readResponse: readGenerationResponse,
        choosePersona, onChange, onTakeDraft, onRestoreDraft, onConflict });
    session.setCatalogStatus(decision.eligible, decision.eligible ? '' : '请先配置聊天模型。', !decision.eligible);
    let catalogRead = 0;
    async function refreshCatalog() {
        if (signal?.aborted) return;
        const ticket = ++catalogRead;
        session.setCatalogStatus(false);
        try {
            const [purposes, providers] = await Promise.all([fetchModelPurposes(), fetchProviders()]);
            if (signal?.aborted) return;
            const next = resolveForegroundProjection(purposes, providers);
            await session.whenIdle();
            if (signal?.aborted || ticket !== catalogRead) return;
            engine.updateCatalog(next, providers.flatMap(provider => provider.models.map(model => ({ id: model.modelId, ...model }))));
            if(next.eligible){
                const fields=['chat_completion_source','custom_url','reverse_proxy',next.modelField,'openai_max_context','openai_max_tokens',
                    ...(next.pinned.temperature===undefined?[]:['temp_openai']),...(next.pinned.topP===undefined?[]:['top_p_openai']),...(next.pinned.reasoningEffort===undefined?[]:['reasoning_effort'])];
                client.documents.projectSettings(fields.map(key=>['oai_settings',key]),engine.settingsForSave());
            }
            session.setCatalogStatus(next.eligible, next.eligible ? '' : '请先配置聊天模型。', !next.eligible);
        } catch (error) {
            if (!signal?.aborted && ticket === catalogRead) session.setCatalogStatus(false, error.kind === 'context-changed' || error.status === 401
                ? '登录状态或聊天已变化，请重新打开页面。' : '模型配置没有加载出来，请重试。');
        }
    }
    const media = installRuntimeMediaBindings({ context, paint });
    const restartFor = changes => changes.some(({ path }) => !path.length || path[0] === 'oai_settings' && (path.length === 1 || path[1] === 'preset_settings_openai')
        || path[0] === 'extension_settings' && (path.length === 1 || path[1] === 'tavern_helper' && (path.length === 2 || path[2] === 'script')));
    return Object.assign(session, media, {
        destroy() { media.destroy(); session.destroySession?.(); engine.destroy?.(); },
        refreshCatalog, story: engine.story, renderMessage: engine.cards.renderMessage, mountCardActions: engine.cards.mountCardActions,
        applySettings(changes) { return session.configure(async () => {
            engine.applySettings(changes);
            client.documents.acceptSettings(changes, engine.settingsForSave());
            if (changes.some(({path}) => !path.length || ['user_avatar','username'].includes(path[0]) || path[0]==='power_user'&&(path.length===1||['personas','persona_descriptions'].includes(path[1])))) await session.refreshPersona();
            await engine.cards.configure({ restartScripts: restartFor(changes) });
            context.settingsDirty = client.settingsChanged(engine.settingsForSave());
        }); },
        applyPreset(apiId, name, changes, value) { return session.configure(async () => {
            if (apiId === 'openai') {
                const current=engine.applyPreset(name,changes,value);client.documents.acceptPreset(apiId,name,changes,current);
                if (engine.settings.oai_settings.preset_settings_openai === name) await engine.cards.configure({restartScripts:changes.some(({path})=>!path.length || path[0] === 'extensions' && (path.length === 1 || path[1] === 'tavern_helper'&&(path.length===2||path[2]==='scripts')))});
            }else client.documents.acceptPreset(apiId,name,changes,value);
        }); },
        applyWorldbook(name, value, action) { return session.configure(async () => {
            client.documents.captureWorldbook(name, value);
            const names = packet.world_names ||= [];
            if (action === 'delete') { const index = names.indexOf(name); if (index >= 0) names.splice(index, 1); }
            else if (!names.includes(name)) names.push(name);
            await context.eventSource.emit(context.eventTypes.WORLDINFO_UPDATED, name, value);
        }); },
        reloadCharacter(avatar) { return session.configure(async () => {
            const active = currentAvatar();
            const cards = await client.characters(), index = cards.findIndex(card => card.avatar === avatar);
            context.characters.splice(0, context.characters.length, ...cards);
            context.characterId = cards.findIndex(card => card.avatar === active);
            if (avatar === active && index >= 0) {
                context.characterId = index; context.name2 = cards[index].name; engine.bindContext();
                await engine.cards.configure({restartScripts:true});
            }
            await context.eventSource.emit(context.eventTypes.CHARACTER_EDITED, index);
        }); },
    });
    function currentAvatar() { return context.characters[context.characterId]?.avatar; }
}
