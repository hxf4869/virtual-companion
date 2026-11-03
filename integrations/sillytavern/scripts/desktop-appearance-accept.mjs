// DR-1：复用 UX-11 合成样板验证真实设置模块，无业务接口或真实数据。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { startPreview, settle } from './lib/ux11-preview.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = path.join(ROOT, '.review-queue/DR-1');
const REFERENCE = 'a8b240e2'; // 本批开始前的桌面候选，参照不从新实现生成。
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }];

async function checkInteractions(page) {
    const theme = page.getByRole('radiogroup', { name: '外观', exact: true });
    assert.equal(await theme.count(), 1, '外观分段须有可定位的单选组名称');
    const light = theme.getByRole('radio', { name: '浅色', exact: true });
    await light.focus();
    await light.press('ArrowRight');
    assert.equal(await theme.getByRole('radio', { name: '深色', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await page.evaluate(() => localStorage.getItem('vc-theme')), 'dark');

    const reply = page.getByRole('radiogroup', { name: '回复样式', exact: true });
    await reply.getByRole('radio', { name: '气泡', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => localStorage.getItem('vc-reply-style')), 'spread');
    await page.getByRole('switch', { name: '减弱动态效果', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('vc-reduced-motion')), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.vcReducedMotion), 'true');
    await page.getByRole('switch', { name: '关键词特效', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('vc-keyword-effects')), 'off');

    const suggestions = page.getByRole('switch', { name: '建议回复', exact: true });
    await suggestions.focus();
    await suggestions.press('Space');
    assert.equal(await suggestions.getAttribute('aria-checked'), 'false');
    assert.equal(await page.evaluate(() => localStorage.getItem('vc-reply-suggestions')), 'off');
    await page.evaluate(async () => {
        window.DR_RETIRED_SWITCH = document.querySelector('[data-preference="suggest"]');
        await window.VC_SETTINGS_PREVIEW.select('account');
        window.DR_RETIRED_SWITCH.click();
    });
    assert.equal(await page.evaluate(() => localStorage.getItem('vc-reply-suggestions')), 'off', '卸载后的旧控件不再写入偏好');
    await page.evaluate(() => window.VC_SETTINGS_PREVIEW.select('appearance'));
    assert.equal(await page.getByRole('switch', { name: '建议回复', exact: true }).getAttribute('aria-checked'), 'false');
    assert.equal(await page.getByRole('switch', { name: '关键词特效', exact: true }).getAttribute('aria-checked'), 'false');
    assert.equal(await page.getByRole('switch', { name: '减弱动态效果', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await page.getByRole('radio', { name: '铺开', exact: true }).getAttribute('aria-checked'), 'true');
    await page.getByRole('switch', { name: '建议回复', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('vc-reply-suggestions')), 'on', '重挂载后动作只生效一次');
    await page.evaluate(() => window.VC_SETTINGS_PREVIEW.destroy());
    assert.equal(await page.locator('.vc-settings-shell').count(), 0);
}

export async function runDesktopAppearance({ captureReference = false, compareReference = false, width } = {}) {
    const viewports = VIEWPORTS.filter(viewport => width === undefined || viewport.width === width);
    assert.ok(viewports.length, '宽度须为本场景的 1440、1024、768 或 390');
    if (captureReference || compareReference) await mkdir(path.join(OUT, 'before'), { recursive: true });
    if (!captureReference) await mkdir(path.join(OUT, 'after'), { recursive: true });
    const preview = await startPreview();
    let browser;
    try {
        const { chromium } = await import('playwright-core');
        browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : { channel: 'chrome' }), args: ['--disable-partial-raster'] });
        const context = await browser.newContext({ reducedMotion: 'no-preference', timezoneId: 'Asia/Shanghai' });
        await context.addInitScript(() => { localStorage.clear(); });
        const page = await context.newPage();
        await page.clock.install({ time: new Date('2026-11-02T04:00:00Z') });
        if (captureReference || compareReference) {
            const source = execFileSync('git', ['show', `${REFERENCE}:integrations/sillytavern/extension/vc-model-settings/desktop/settings-shell.js`], { cwd: ROOT, encoding: 'utf8' });
            await page.route('**/source/desktop/settings-shell.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
            // 旧设置壳静态导入旧语音 renderer；同版依赖仅用于独立参照，不能为回放恢复生产旧导出。
            const voice = execFileSync('git', ['show', `${REFERENCE}:integrations/sillytavern/extension/vc-model-settings/voice-settings.js`], { cwd: ROOT, encoding: 'utf8' });
            await page.route('**/source/voice-settings.js', route => route.fulfill({ contentType: 'text/javascript', body: voice }));
        }
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        for (const viewport of viewports) for (const theme of ['light', 'dark']) {
            await page.setViewportSize(viewport);
            await page.emulateMedia({ colorScheme: theme, reducedMotion: viewport.width < 744 ? 'reduce' : 'no-preference' });
            for (const state of viewport.width >= 744 ? ['default', 'alternate'] : ['default']) {
                await page.goto(`${preview.url}frame.html?view=settings&screen=appearance&theme=${theme}`);
                await settle(page);
                if (state === 'alternate') {
                    await page.locator('[data-preference="reply"] button').first().click();
                    for (const name of ['减弱动态效果', '建议回复', '关键词特效']) await page.getByRole('switch', { name, exact: true }).click();
                    await page.mouse.move(0, 0);
                    await settle(page);
                }
                const name = `appearance-${viewport.width}-${theme}-${state}.png`;
                const reference = await page.screenshot({ animations: 'disabled' });
                await writeFile(path.join(OUT, captureReference || compareReference ? 'before' : 'after', name), reference);
                if (compareReference) {
                    // 同一 DOM 中只替换当前迁移的子树，避免未变更的玻璃层被重新建立。
                    // reference 始终由上面的固定 Git 旧渲染器产生，不能由候选覆盖。
                    if (viewport.width >= 744) await page.evaluate(async () => {
                        const { mountAppearance } = await import('/source/desktop/appearance.js');
                        window.DR_APPEARANCE_UNMOUNT = mountAppearance(document.querySelector('.vc-settings-body'), () => ({}));
                    });
                    await settle(page);
                    const candidate = await page.screenshot({ animations: 'disabled' });
                    await writeFile(path.join(OUT, 'after', name), candidate);
                    assert.ok(candidate.equals(reference), `${name} 与迁移前截图不同，须定位并还原`);
                    if (viewport.width === 1440 && theme === 'light' && state === 'default') {
                        await page.locator('[data-vc-appearance]').evaluate(node => { node.style.transform = 'translateX(1px)'; });
                        assert.ok(!(await page.screenshot({ animations: 'disabled' })).equals(reference), '视觉检查须检出 1px 位移');
                        await page.locator('[data-vc-appearance]').evaluate(node => { node.style.transform = ''; });
                    }
                    await page.evaluate(() => window.DR_APPEARANCE_UNMOUNT?.());
                }
                const outside = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
                assert.equal(outside, false, `${viewport.width}/${theme}/${state} 文档溢出`);
            }
        }
        if (!captureReference) {
            await page.unroute('**/source/desktop/settings-shell.js');
            await page.unroute('**/source/voice-settings.js');
            await page.setViewportSize(VIEWPORTS[0]);
            await page.goto(`${preview.url}frame.html?view=settings&screen=appearance&theme=light`);
            await settle(page);
            await checkInteractions(page);
        }
        assert.deepEqual(errors, [], '样板不得出现脚本错误');
        console.log(`[dr-appearance] ${captureReference ? 'REFERENCE CAPTURED' : 'PASS'}：桌面与手机参照、设置交互${compareReference ? '、截图零差异' : ''}`);
    } finally {
        await browser?.close();
        await preview.close();
    }
}

export const desktopAppearanceScene = { id: 'dr-appearance', title: 'DR-1 React 外观页与原视觉对照', needs: ['browser'], default: false, run: () => runDesktopAppearance() };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const widthIndex = process.argv.indexOf('--width');
    await runDesktopAppearance({ captureReference: process.argv.includes('--capture-reference'), compareReference: process.argv.includes('--compare-reference'), width: widthIndex < 0 ? undefined : Number(process.argv[widthIndex + 1]) });
}
