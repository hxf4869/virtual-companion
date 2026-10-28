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
import { getRequestHeaders } from '../../../../script.js';
import { getContext } from '../../../../scripts/st-context.js';
import { mountModelSettings } from './page.js';
import { setStHeadersProvider, fetchProviders, fetchModelPurposes } from './api.js';
import { createProjectionController } from './projection.js';

export async function init() {
    setStHeadersProvider(() => {
        const headers = getRequestHeaders();
        // 浏览器侧桥约定：X-CSRF-Token 用 ST 令牌；Go 令牌经 X-VC-CSRF-Token 由 api.js 附加。
        return { 'X-CSRF-Token': headers['X-CSRF-Token'] ?? headers['x-csrf-token'] ?? '' };
    });

    // 页面控制器（单例，立即挂载但保持隐藏；横幅「打开模型设置」与菜单共用同一实例）。
    const pageController = mountModelSettings();

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

    button.addEventListener('click', () => {
        if (!pageController.isOpen()) pageController.open();
    });
}
