// 与页面启动解耦的聊天准备入口；后续聊天计算/生成只在此模块接线，保存设置不会触发它。
import { fetchModelPurposes, fetchProviders } from '../../api.js';
import { resolveForegroundProjection, buildScope, characterKeyOf, chatKeyOf } from '../../projection.js';
import { createChatEngine, runtimeSettings, projectModelSettings } from './engine/runtime.js';
import { createDesktopSession } from './session.js';
import { readGenerationResponse } from './engine/response.js';
import { prepareSourceIdentities } from '/scripts/vc-runtime/source-identity.js';
import { installDesktopMedia } from './media.js';
import { initializeCards } from './cards/index.js';

export async function prepareChatRuntime({ client, context, choosePersona, readInput, onChange, onTakeDraft, onRestoreDraft, onConflict, paint = () => {} }) {
    const [purposes, providers, packet] = await Promise.all([fetchModelPurposes(), fetchProviders(), client.request('/api/settings/get', {})]);
    const decision = resolveForegroundProjection(purposes, providers);
    if (!decision.eligible) throw new Error('请先配置聊天模型。');
    const settings = runtimeSettings(JSON.parse(packet.settings));
    const scope = buildScope(characterKeyOf(context), chatKeyOf(context.chatId), 0);
    projectModelSettings(settings, decision, scope);
    const presets = Object.fromEntries(packet.openai_setting_names.map((name, index) => [name, JSON.parse(packet.openai_settings[index])]));
    const models = providers.flatMap(provider => provider.models.map(model => ({ id: model.modelId, ...model })));
    const engine = await createChatEngine({ client, context, settings, decision, presets, models, readInput,
        initializeCards: args => initializeCards({ ...args, packet }) });
    const session = createDesktopSession({ client, context, engine, prepareSourceIdentities, readResponse: readGenerationResponse,
        choosePersona, onChange, onTakeDraft, onRestoreDraft, onConflict });
    const media = installDesktopMedia({ context, session, paint });
    return Object.assign(session, media, { renderMessage: engine.cards.renderMessage, mountCardActions: engine.cards.mountCardActions });
}
