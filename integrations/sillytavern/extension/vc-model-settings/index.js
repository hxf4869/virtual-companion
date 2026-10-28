// Virtual Companion · 模型设置 — SillyTavern 扩展入口（ST 专用胶水层）。
// 页面本体在 page.js（无 ST 依赖，可独立 harness 验证）；
// 前台投影控制器在 projection.js（ST 依赖经本文件注入）。
// ST 宿主 API 依据（锁定 ST 1.19.0）：docs/product/v2-design.md §7.3
//   — 魔法棒菜单 #extensionsMenu 是公开挂载点；
//   — getRequestHeaders() 提供 ST 原生 CSRF 令牌；
//   — getContext()（scripts/st-context.js）暴露 chatCompletionSettings 活引用、
//     saveSettingsDebounced、chatId / characterId / groupId / characters、
//     eventSource / eventTypes（CHAT_COMPLETION_SETTINGS_READY、CHAT_CHANGED）。
// third-party 扩展被装载在 /scripts/extensions/third-party/<name>/（比内置扩展深一层），
// 相对导入主脚本要走四层（内置扩展的三层在这里会落到不存在的 /scripts/script.js）
import { getRequestHeaders, getChat, saveChat as saveCurrentChat } from '../../../../script.js';
import { getContext } from '../../../../scripts/st-context.js';
import { mountModelSettings } from './page.js';
import { setStHeadersProvider, fetchProviders, fetchModelPurposes, captureSessionContext, resolveSTBinding, reconcileSTSources, recallSTMemory } from './api.js';
import { confirmStoryProjection } from './story-action.js';
import { createStoryProjection } from './story-projection.js';
import { installInstanceBinding, showF2Draft } from '/scripts/vc-runtime/f2-client.js';
import { createProjectionController } from './projection.js';
import { mountChatShell } from './chat-shell.js';
import { mountDataRights } from './data-rights.js';
import { mountMemoryPage } from './memory-page.js';
import { mountStoryPage } from './story-page.js';
import { createMemoryInjection, mountMemoryControls, MEMORY_INTERCEPTOR } from './memory-injection.js';
import { createStoryContext } from './story-context.js';

export async function init() {
    setStHeadersProvider(() => {
        const headers = getRequestHeaders();
        // 浏览器侧桥约定：X-CSRF-Token 用 ST 令牌；Go 令牌经 X-VC-CSRF-Token 由 api.js 附加。
        return { ...headers, 'X-CSRF-Token': headers['X-CSRF-Token'] ?? headers['x-csrf-token'] ?? '' };
    });

    // 页面控制器（单例，立即挂载但保持隐藏；横幅「打开模型设置」与菜单共用同一实例）。
    const pageController = mountModelSettings();
    mountChatShell({ getContext, openModels: () => pageController.open() });

    // 前台投影：Go FOREGROUND_CHAT 绑定 → ST 原生 chatCompletionSettings。
    // 初始化即刷新一次；页面保存目录成功后经 onCatalogSaved 再刷新。
    const projection = createProjectionController({
        getContext: () => getContext(),
        fetchPurposes: () => fetchModelPurposes(),
        fetchProviders: () => fetchProviders(),
        openModelSettings: () => {
            if (!pageController.isOpen()) pageController.open();
        },
    });
    pageController.onCatalogSaved(() => {
        projection.refresh();
    });
    projection.init();
    // Instance metadata is persisted through the same native F2 save path.
    const bindingReady = installInstanceBinding({ getContext, resolveBinding: resolveSTBinding, reconcileSources: reconcileSTSources,
        onSourceStatus: (states) => { if (states.some((s) => s.state === 'UNAVAILABLE')) globalThis.toastr?.warning('部分长期记忆暂不可用；聊天仍可保存。'); },
        writeExtensionField: (...args) => getContext().writeExtensionField(...args), captureSessionContext,
    });
    bindingReady.catch((error) => showF2Draft(JSON.stringify({ chat_metadata: getContext().chatMetadata, chat: getContext().chat }), error));
    let reportMemory = () => {};
    const memory = createMemoryInjection({ getContext, recall: recallSTMemory,
        ensureBinding: async () => (await bindingReady).ensureBound(),
        onStatus: (message) => { reportMemory(message); if (message.includes('跳过')) globalThis.toastr?.warning(message); },
    });
    reportMemory = mountMemoryControls({ getContext, reset: memory.reset });
    globalThis[MEMORY_INTERCEPTOR] = memory.intercept;
    const story = createStoryContext({ getContext });
    const events = getContext();
    events.eventSource.on(events.eventTypes.CHAT_CHANGED, memory.reset);
    events.eventSource.on(events.eventTypes.CHAT_COMPLETION_SETTINGS_READY, memory.attach);
    // 本扩展 loading_order 为 100，晚于 EJS（loading_order 1）装载。
    // SETTINGS_READY 只用 on() 追加，因此 vc_story 写在 EJS 改写之后。
    story.install(events.eventSource, events.eventTypes.CHAT_COMPLETION_SETTINGS_READY);
    globalThis.addEventListener('vc-memory-status', (event) => memory.finalStatus(event.detail));

    const dataRights = mountDataRights();
    const memoryPage = mountMemoryPage({ getRelationshipId: () => getContext().chatMetadata?.vc_binding?.relationshipId });
    const storyProjection = createStoryProjection({
        readChat: async () => {
            await getChat();
            const ctx = getContext();
            return {
                metadata: ctx.chatMetadata && typeof ctx.chatMetadata === 'object' ? ctx.chatMetadata : {},
                messages: Array.isArray(ctx.chat) ? ctx.chat.slice() : [],
            };
        },
        saveChat: async (snapshot) => {
            const ctx = getContext();
            if (ctx.chatMetadata && snapshot.metadata) Object.assign(ctx.chatMetadata, snapshot.metadata);
            if (Array.isArray(ctx.chat)) ctx.chat.splice(0, ctx.chat.length, ...snapshot.messages);
            try {
                await saveCurrentChat();
            } catch (error) {
                if (error?.code) throw error;
                const wrapped = new Error('save failed');
                wrapped.code = 'VC_SAVE_FAILED';
                wrapped.name = 'F2ConflictError';
                throw wrapped;
            }
        },
        confirm: ({ runId, worldEventId }) => confirmStoryProjection({ runId, worldEventId }),
    });
    const storyPage = mountStoryPage({
        getConversation: () => {
            try {
                const binding = getContext().chatMetadata?.vc_binding || {};
                const conversationId = typeof binding.conversationId === 'string' ? binding.conversationId : '';
                if (binding.mode === 'STORY' && /^[1-9][0-9]{0,18}$/.test(conversationId)) return { conversationId, mode: 'STORY' };
                return { conversationId: '', mode: binding.mode || 'COMPANION' };
            } catch {
                return { conversationId: '', mode: 'COMPANION' };
            }
        },
        onRun: (turn) => story.setRun(turn),
        onActor: (actorId) => story.selectActor(actorId),
        onAdvance: (turn) => story.advance(turn),
        getChatIdentity: () => {
            try { return getContext().chatMetadata?.vc_f2?.id || ''; } catch { return ''; }
        },
        project: (job) => storyProjection.project(job),
    });
    const wand = document.querySelector('#extensionsMenu');
    if (!wand) {
        console.warn('[vc-model-settings] 未找到扩展菜单挂载点 #extensionsMenu');
        return;
    }

    const container = document.createElement('div');
    container.id = 'vc_models_wand_container';
    container.className = 'extension_container';
    const button = document.createElement('div');
    button.id = 'vc_models_menu_button';
    button.className = 'menu_button';
    button.title = '模型设置（供应商 · 模型 · 用途绑定）';
    button.setAttribute('aria-label', '打开模型设置');
    button.innerHTML = '<i class="fa-solid fa-microchip"></i><span class="vcms-menu-label">模型设置</span>';
    container.appendChild(button);
    wand.appendChild(container);
    const dataContainer = document.createElement('div'); dataContainer.className = 'extension_container';
    const dataButton = document.createElement('button'); dataButton.type = 'button'; dataButton.id = 'vc_data_menu_button'; dataButton.className = 'menu_button';
    dataButton.innerHTML = '<i class="fa-solid fa-file-shield" aria-hidden="true"></i><span class="vcms-menu-label">数据副本与删除</span>';
    dataButton.addEventListener('click', () => dataRights.open());
    dataContainer.append(dataButton); wand.append(dataContainer);
    const memoryContainer = document.createElement('div'); memoryContainer.className = 'extension_container';
    const memoryButton = document.createElement('button'); memoryButton.type = 'button'; memoryButton.id = 'vc_memory_menu_button'; memoryButton.className = 'menu_button';
    memoryButton.innerHTML = '<i class="fa-solid fa-brain" aria-hidden="true"></i><span class="vcms-menu-label">记忆</span>';
    memoryButton.addEventListener('click', () => memoryPage.open(document.getElementById('extensionsMenuButton')));
    memoryContainer.append(memoryButton); wand.append(memoryContainer);
    const storyContainer = document.createElement('div'); storyContainer.className = 'extension_container';
    const storyButton = document.createElement('button'); storyButton.type = 'button'; storyButton.id = 'vc_story_menu_button'; storyButton.className = 'menu_button';
    storyButton.innerHTML = '<i class="fa-solid fa-book-open" aria-hidden="true"></i><span class="vcms-menu-label">剧情</span>';
    storyButton.addEventListener('click', () => storyPage.open(document.getElementById('extensionsMenuButton')));
    storyContainer.append(storyButton); wand.append(storyContainer);

    button.addEventListener('click', () => {
        if (!pageController.isOpen()) pageController.open();
    });
}
