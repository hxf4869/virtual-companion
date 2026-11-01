import { mountAurora } from './aurora.js';
import { mountCharacterPanel } from './character-panel.js';
import { bindPointerLights } from './pointer-light.js';
import { bindSidebarLens, readReducedMotion } from './transition.js';
import { desktopLayout } from './presentation.js';
import { mountDesktopTheme } from './theme.js';

// 跟随真实宿主的断点和聊天事件；手机不创建桌面节点。
export function mountDesktopShell({ shell, getContext }) {
    const doc = shell.ownerDocument;
    const theme = mountDesktopTheme({ shell, getContext, document: doc });
    doc.documentElement.dataset.vcReducedMotion = String(readReducedMotion());
    let aurora, panel, releaseLens, releaseLights;
    function sync() {
        if (desktopLayout() && !aurora) {
            aurora = mountAurora(doc);
            releaseLens = bindSidebarLens(shell.querySelector('.vc-sidebar'));
            releaseLights = bindPointerLights(shell);
            panel = mountCharacterPanel({ shell, getContext, aurora });
        } else if (!desktopLayout() && aurora) {
            panel?.destroy(); panel = null;
            aurora.destroy(); aurora = null;
            releaseLens?.(); releaseLights?.();
            delete shell.dataset.characterPanel;
        }
    }
    const refresh = () => { void panel?.refresh(); };
    const ctx = getContext();
    const events = [ctx.eventTypes?.CHAT_CHANGED, ctx.eventTypes?.MESSAGE_RECEIVED].filter(Boolean);
    for (const type of events) ctx.eventSource?.on(type, refresh);
    globalThis.addEventListener('resize', sync);
    sync();
    return { destroy() {
        theme.destroy();
        for (const type of events) ctx.eventSource?.removeListener(type, refresh);
        globalThis.removeEventListener('resize', sync);
        panel?.destroy(); aurora?.destroy(); releaseLens?.(); releaseLights?.();
    } };
}
