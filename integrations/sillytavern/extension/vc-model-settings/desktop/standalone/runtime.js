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
    const [purposes, providers, packet] = await Promise.all([fetchModelPurposes(), fetchProviders(), client.settings()]);
    const decision = resolveForegroundProjection(purposes, providers);
    const settings = runtimeSettings(JSON.parse(packet.settings));
    const scope = buildScope(characterKeyOf(context), chatKeyOf(context.chatId), 0);
    projectModelSettings(settings, decision, scope);
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
            session.setCatalogStatus(next.eligible, next.eligible ? '' : '请先配置聊天模型。', !next.eligible);
        } catch (error) {
            if (ticket === catalogRead) session.setCatalogStatus(false, error.kind === 'context-changed' || error.status === 401
                ? '登录状态或聊天已变化，请重新打开页面。' : '模型配置没有加载出来，请重试。');
        }
    }
    const media = installDesktopMedia({ context, session, paint });
    return Object.assign(session, media, { refreshCatalog, renderMessage: engine.cards.renderMessage, mountCardActions: engine.cards.mountCardActions });
}
