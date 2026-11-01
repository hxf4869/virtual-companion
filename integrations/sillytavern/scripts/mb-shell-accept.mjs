// MB-2 手机界面骨架：/m/ 同源提供、主题生效、浅深模式、无跨域请求（ADR-0011、DESIGN.md §17）。
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README；ADR-0009 §3）。
// 前提：已运行 `npm --prefix mobile run build:h5`，产物位于服务端插件 mobile-dist/。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeStOnboarding } from './lib/st-onboarding.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV = process.env.VC_W03_DEV_DIR || path.resolve(HERE, '../dev-managed');
const SHOTS = path.resolve(HERE, '../../../.review-queue/MB-2');
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

export async function sceneMbShell(ctx) {
    const dist = path.join(DEV, 'st-run', 'plugins', 'virtual-companion', 'mobile-dist', 'index.html');
    if (!fs.existsSync(dist)) throw new Error('受管插件缺少 mobile-dist：先运行 npm --prefix mobile run build:h5 再装配');
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    const origin = new URL(ctx.w05.stBase).origin;
    try {
        // 未登录：/m/ 跳登录页。
        {
            const bc = await browser.newContext(PHONE);
            const page = await bc.newPage();
            await page.goto(`${ctx.w05.stBase}/m/`);
            if (!new URL(page.url()).pathname.startsWith('/auth/')) throw new Error(`未登录没有跳登录页：${page.url()}`);
            await bc.close();
        }
        for (const scheme of ['light', 'dark']) {
            const bc = await browser.newContext({ ...PHONE, colorScheme: scheme });
            await bc.addCookies([
                { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
                { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
            ]);
            await completeStOnboarding(bc, ctx.w05.stBase);
            const page = await bc.newPage();
            const foreign = [];
            const errors = [];
            page.on('request', (r) => { const u = r.url(); if (r.frame() === page.mainFrame() && /^https?:/.test(u) && new URL(u).origin !== origin) foreign.push(u.slice(0, 80)); });
            page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
            const resp = await page.goto(`${ctx.w05.stBase}/m/`);
            if (resp?.status() !== 200) throw new Error(`/m/ HTTP ${resp?.status()}`);
            await page.waitForSelector('.vc-tabbar', { timeout: 30000 });
            const state = await page.evaluate(() => {
                const root = document.documentElement;
                const css = getComputedStyle(root);
                return {
                    themeId: root.dataset.vcThemeId, mode: root.dataset.vcTheme, bubble: root.dataset.vcVariantBubble,
                    canvas: css.getPropertyValue('--vc-canvas').trim(), title: document.querySelector('.vc-large-title')?.textContent,
                    tabs: [...document.querySelectorAll('.vc-tab-label')].map((t) => t.textContent),
                    sprite: Boolean(document.querySelector('.vc-icon use')?.getAttribute('href')),
                };
            });
            const want = scheme === 'dark' ? '#07070a' : '#eef0f6';
            if (state.themeId !== 'aurora' || state.mode !== scheme || state.bubble !== 'tail' || state.canvas !== want) throw new Error(`主题未生效 ${JSON.stringify(state)}`);
            if (state.title !== '聊天' || state.tabs.join() !== '聊天,角色,记忆,陪伴,剧情' || !state.sprite) throw new Error(`骨架不完整 ${JSON.stringify(state)}`);
            // 切到「剧情」：标题随之变化，选中态只有一个。
            await page.locator('.vc-tab', { hasText: '剧情' }).click();
            await page.waitForFunction(() => document.querySelector('.vc-large-title')?.textContent === '剧情');
            if (await page.locator('.vc-tab.is-on').count() !== 1) throw new Error('标签选中态不唯一');
            await page.locator('.vc-tab', { hasText: '聊天' }).click();
            await page.waitForTimeout(3500); // 越过 uni-h5 的 3 秒远程预加载，确认已关闭
            await page.screenshot({ path: path.join(SHOTS, `shell-390-${scheme}.png`) });
            if (foreign.length) throw new Error(`页面发起了跨域请求：${[...new Set(foreign)].join(' | ')}`);
            if (errors.length) throw new Error(`页面错误：${errors.join(' | ')}`);
            console.log(`[mb-shell] ${scheme} ${JSON.stringify(state)}`);
            await bc.close();
        }
    } finally {
        await browser.close();
    }
}

export const mbShellScene = {
    id: 'mb-shell',
    title: 'MB-2 手机界面骨架：/m/ 同源提供、主题与浅深模式、无跨域请求',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneMbShell,
};
