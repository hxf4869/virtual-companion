// 与页面启动解耦的聊天准备入口；后续聊天计算/生成只在此模块接线，保存设置不会触发它。
import { fetchModelPurposes, fetchProviders } from '../../api.js';
import { resolveForegroundProjection, buildScope, characterKeyOf, chatKeyOf } from '../../projection.js';
import { createChatEngine, runtimeSettings, projectModelSettings, settingsForSave } from './engine/runtime.js';
import { createDesktopSession } from './session.js';
import { readGenerationResponse } from './engine/response.js';
import { prepareSourceIdentities } from '/scripts/vc-runtime/source-identity.js';
import { installDesktopMedia } from './media.js';
import { initializeCards } from './cards/index.js';

export async function prepareChatRuntime({ client, context, choosePersona, readInput, onChange, onTakeDraft, onRestoreDraft, onConflict, paint = () => {} }) {
    const [purposes, providers, packet] = await Promise.all([fetchModelPurposes(), fetchProviders(), client.settings()]);
    const decision = resolveForegroundProjection(purposes, providers);
    const settings = runtimeSettings(JSON.parse(packet.settings));
    const scope = buildScope(characterKeyOf(context), chatKeyOf(context.chatId), 0);
    projectModelSettings(settings, decision, scope);
    client.documents.captureSettings(JSON.parse(packet.settings), settingsForSave(settings));
    client.documents.seedPresets(packet);
    const presets = Object.fromEntries(packet.openai_setting_names.map((name, index) => [name, JSON.parse(packet.openai_settings[index])]));
    const models = providers.flatMap(provider => provider.models.map(model => ({ id: model.modelId, ...model })));
    const engine = await createChatEngine({ client, context, settings, decision, presets, models, readInput,
        initializeCards: args => initializeCards({ ...args, packet }) });
    const session = createDesktopSession({ client, context, engine, prepareSourceIdentities, readResponse: readGenerationResponse,
        choosePersona, onChange, onTakeDraft, onRestoreDraft, onConflict });
    session.setCatalogStatus(decision.eligible, decision.eligible ? '' : '请先配置聊天模型。', !decision.eligible);
    let catalogRead = 0;
    async function refreshCatalog() {
        const ticket = ++catalogRead;
        session.setCatalogStatus(false);
        try {
            const [purposes, providers] = await Promise.all([fetchModelPurposes(), fetchProviders()]);
            const next = resolveForegroundProjection(purposes, providers);
            await session.whenIdle();
            if (ticket !== catalogRead) return;
            engine.updateCatalog(next, providers.flatMap(provider => provider.models.map(model => ({ id: model.modelId, ...model }))));
            if(next.eligible){
                const fields=['chat_completion_source','custom_url','reverse_proxy',next.modelField,'openai_max_context','openai_max_tokens',
                    ...(next.pinned.temperature===undefined?[]:['temp_openai']),...(next.pinned.topP===undefined?[]:['top_p_openai']),...(next.pinned.reasoningEffort===undefined?[]:['reasoning_effort'])];
                client.documents.projectSettings(fields.map(key=>['oai_settings',key]),engine.settingsForSave());
            }
            session.setCatalogStatus(next.eligible, next.eligible ? '' : '请先配置聊天模型。', !next.eligible);
        } catch (error) {
            if (ticket === catalogRead) session.setCatalogStatus(false, error.kind === 'context-changed' || error.status === 401
                ? '登录状态或聊天已变化，请重新打开页面。' : '模型配置没有加载出来，请重试。');
        }
    }
    const media = installDesktopMedia({ context, session, paint });
    const restartFor = changes => changes.some(({ path }) => !path.length || path[0] === 'oai_settings' && (path.length === 1 || path[1] === 'preset_settings_openai')
        || path[0] === 'extension_settings' && (path.length === 1 || path[1] === 'tavern_helper' && (path.length === 2 || path[2] === 'script')));
    return Object.assign(session, media, { refreshCatalog, renderMessage: engine.cards.renderMessage, mountCardActions: engine.cards.mountCardActions,
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
