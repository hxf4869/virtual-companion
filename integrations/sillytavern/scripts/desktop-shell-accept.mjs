// DR-4A：真实组件与现有 UX-11 合成宿主；不访问真实数据或模型。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { startPreview, settle } from './lib/ux11-preview.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = path.join(ROOT, '.review-queue/DR-4A');
const REFERENCE = 'a8b240e2';
const REFERENCE_FILES = ['shell.js', 'shell.css', 'page.js', 'desktop/base.css', 'desktop/settings.css', 'desktop/chat-react.css', 'desktop/settings-shell.js'];

function assertSamePixels(actual, expected, name) {
    const a = PNG.sync.read(actual), b = PNG.sync.read(expected);
    assert.equal(a.width, b.width, name); assert.equal(a.height, b.height, name);
    assert.ok(a.data.equals(b.data), `${name} 正常页面像素发生变化`);
}

async function geometry(page) {
    return page.evaluate(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, bottom: r.bottom }; };
        const sidebar = document.querySelector('.vc-sidebar');
        const buttons = [...sidebar.querySelectorAll('[data-nav]')].map(node => ({ button: rect(node), icon: rect(node.querySelector('.vc-icon')) }));
        const avatar = sidebar.querySelector('.vc-side-avatar');
        const image = avatar.querySelector('img');
        const settings = sidebar.querySelector('[data-settings]');
        const toggle = document.querySelector('.vc-settings-category-toggle');
        return {
            width: innerWidth, sidebar: rect(sidebar), buttons, avatar: rect(avatar), image: image ? rect(image) : null,
            settings: rect(settings), footer: rect(sidebar.querySelector('.vc-side-foot')),
            toggle: toggle && getComputedStyle(toggle).display !== 'none' ? { button: rect(toggle), icon: rect(toggle.querySelector('.vc-icon')) } : null,
            outside: document.documentElement.scrollWidth > innerWidth + 1,
        };
    });
}

function assertGeometry(g) {
    const failures = [];
    const near = (a, b) => Math.abs(a - b) <= 0.5;
    if (g.width >= 744 && g.width < 1180) {
        for (const [index, item] of g.buttons.entries()) if (!near(item.button.cx, item.icon.cx)) failures.push(`导航 ${index} 图标偏移 ${item.icon.cx - item.button.cx}px`);
        if (!near(g.avatar.cx, g.settings.cx)) failures.push(`头像偏移 ${g.avatar.cx - g.settings.cx}px`);
    }
    if (g.toggle && (!near(g.toggle.button.cx, g.toggle.icon.cx) || !near(g.toggle.button.cy, g.toggle.icon.cy))) failures.push(`标题图标偏移 ${g.toggle.icon.cx - g.toggle.button.cx}px`);
    if (g.width >= 744 && g.footer.bottom > g.sidebar.bottom + 0.5) failures.push('侧栏底部控件越界');
    if (g.image && g.width >= 744 && (!near(g.image.width, g.avatar.width) || !near(g.image.height, g.avatar.height))) failures.push('头像图片尺寸超出容器');
    if (g.outside) failures.push('文档横向溢出');
    assert.deepEqual(failures, [], `${g.width}px 公共壳层布局`);
}

export async function runDesktopShell({ captureReference = false, compareReference = false, geometryOnly = false, modelOnly = false } = {}) {
    await mkdir(path.join(OUT, captureReference ? 'before' : 'after'), { recursive: true });
    const preview = await startPreview();
    let browser;
    try {
        const { chromium } = await import('playwright-core');
        browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : { channel: 'chrome' }), args: ['--disable-partial-raster', '--disable-gpu', '--disable-lcd-text', '--force-color-profile=srgb'] });
        const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' });
        await context.addInitScript(() => {
            localStorage.clear(); localStorage.setItem('vc-reduced-motion', 'true');
            if (new URLSearchParams(location.search).get('sidebar') === 'open') localStorage.setItem('vc-sidebar', 'open');
            const count = Number(new URLSearchParams(location.search).get('unread') || 0);
            window.VC_PREVIEW_INBOX = Array.from({ length: count }, (_, index) => ({ eventId: `synthetic-${index}`, relationshipId: '11', conversationId: '21', intent: 'BODY', stDelivered: false, linkStatus: 'present', read: false }));
        });
        const page = await context.newPage();
        await page.clock.install({ time: new Date('2026-11-02T04:00:00Z') });
        if (captureReference) {
            const sources = new Map(REFERENCE_FILES.map(file => [file, execFileSync('git', ['show', `${REFERENCE}:integrations/sillytavern/extension/vc-model-settings/${file}`], { cwd: ROOT, encoding: 'utf8' })]));
            await page.route('**/source/**', route => {
                const file = new URL(route.request().url()).pathname.split('/source/')[1];
                if (!sources.has(file)) return route.continue();
                return route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', body: sources.get(file) });
            });
        }
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const open = async (width, theme = 'light', query = '', screen = 'account') => {
            await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1440 ? 900 : 858 });
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await page.goto(`${preview.url}frame.html?view=settings&screen=${screen}&theme=${theme}${query}`);
            await settle(page);
        };
        if (geometryOnly) {
            await open(864);
            assertGeometry(await geometry(page));
            return;
        }
        const checkModel = async () => {
            for (const width of [1440, 1024, 1023, 864]) {
                await open(width, 'light', '', 'model');
                assert.equal(await page.locator('.vc-settings-category-toggle').isVisible(), width < 1024, `${width}px 模型页分类按钮可见性`);
                assertGeometry(await geometry(page));
            }
        };
        if (modelOnly) { await checkModel(); return; }
        for (const width of [1440, 864, 390]) for (const theme of ['light', 'dark']) {
            await open(width, theme);
            const name = `shell-${width}-${theme}.png`;
            const png = await page.screenshot({ animations: 'disabled' });
            await writeFile(path.join(OUT, captureReference ? 'before' : 'after', name), png);
            if (!captureReference) {
                assertGeometry(await geometry(page));
                if (compareReference && width !== 864) {
                    assertSamePixels(png, await readFile(path.join(OUT, 'before', name)), name);
                    if (width === 1440 && theme === 'light') {
                        await page.locator('.vc-settings-profile').evaluate(node => { node.style.transform = 'translateX(1px)'; });
                        const shifted = await page.screenshot({ animations: 'disabled' });
                        assert.throws(() => assertSamePixels(shifted, png, '1px 位移反例'), /像素发生变化/);
                        await page.locator('.vc-settings-profile').evaluate(node => { node.style.transform = ''; });
                    }
                }
            }
            if (width === 1440 && theme === 'light' && (captureReference || compareReference)) {
                await page.locator('.vc-sidebar [data-nav="memory"]').hover();
                await settle(page);
                const hover = await page.screenshot({ animations: 'disabled' });
                const hoverName = 'shell-1440-light-hover.png';
                await writeFile(path.join(OUT, captureReference ? 'before' : 'after', hoverName), hover);
                if (compareReference) assertSamePixels(hover, await readFile(path.join(OUT, 'before', hoverName)), hoverName);
                await page.mouse.move(0, 0);
            }
        }
        for (const theme of ['light', 'dark']) {
            await open(1440, theme, '', 'model');
            const name = `model-1440-${theme}.png`;
            const png = await page.screenshot({ animations: 'disabled' });
            await writeFile(path.join(OUT, captureReference ? 'before' : 'after', name), png);
            if (compareReference) assertSamePixels(png, await readFile(path.join(OUT, 'before', name)), name);
        }
        if (captureReference) { console.log('[dr-shell] REFERENCE CAPTURED'); return; }

        await open(1440);
        for (const width of [1180, 1179, 1024, 1023, 864, 768, 744, 1024, 1440]) {
            await page.setViewportSize({ width, height: 858 });
            await settle(page);
            assertGeometry(await geometry(page));
            const narrow = width < 1180;
            assert.equal(await page.locator('.vc-sidebar').evaluate(node => node.classList.contains('is-collapsed')), narrow);
            assert.equal(await page.locator('.vc-sidebar').evaluate(node => node.getBoundingClientRect().width), narrow ? 72 : 200);
            assert.equal(await page.locator('.vc-sidebar [data-settings][aria-current="page"]').count(), 1);
        }
        await open(864, 'light', '&sidebar=open');
        assertGeometry(await geometry(page));
        assert.equal(await page.locator('.vc-sidebar').evaluate(node => node.classList.contains('is-collapsed')), false, '保留已有的展开偏好');
        await page.setViewportSize({ width: 864, height: 390 });
        await settle(page);
        assertGeometry(await geometry(page));
        for (const count of [0, 1, 120]) {
            await open(864, 'light', `&unread=${count}`);
            const badge = page.locator('.vc-sidebar [data-badge="inbox"] .vc-badge');
            if (count) await page.waitForFunction(() => document.querySelector('.vc-sidebar [data-badge="inbox"] .vc-badge'));
            assert.equal(await badge.count(), count ? 1 : 0);
            if (count) assert.equal(await badge.textContent(), count > 99 ? '99+' : String(count));
            assertGeometry(await geometry(page));
        }
        await open(864);
        await page.route('**/thumbnail?type=persona&file=synthetic-portrait.png', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="#7359b8"/></svg>' }));
        await page.evaluate(() => {
            const fixture = document.createElement('div'); fixture.id = 'user_avatar_block'; fixture.hidden = true;
            fixture.innerHTML = '<div class="avatar-container selected" data-avatar-id="synthetic-portrait.png"></div>';
            document.body.append(fixture);
            window.dispatchEvent(new Event('resize'));
        });
        // 身份变化通过现有窗口控制器同步，不直接修改组件内部 DOM。
        await page.waitForFunction(() => document.querySelector('.vc-side-avatar img')?.complete);
        assertGeometry(await geometry(page));
        await page.locator('.vc-settings-category-toggle').click();
        await page.getByRole('menuitem', { name: '外观', exact: true }).click();
        assert.equal(await page.locator('[data-vc-appearance]').count(), 1, '缩窗后分类仍可达');
        await page.setViewportSize({ width: 1440, height: 900 });
        await settle(page);
        const memory = page.locator('.vc-sidebar [data-nav="memory"]');
        await memory.focus(); await memory.press('Enter');
        assert.equal(await memory.getAttribute('aria-current'), 'page');
        assert.equal(await page.locator('.vc-sidebar [aria-current="page"]').count(), 1);
        await checkModel();
        // 固定1440×900物理区域，以CSS视口+DPR组合模拟桌面125/150/200%缩放。
        // 图像只留本轮代表状态；不拿不同DPR与旧1x截图做伪像素对照。
        const zoomOut = path.join(ROOT, '.review-queue/DR-8/zoom'); await mkdir(zoomOut, { recursive: true });
        for (const factor of [1.25, 1.5, 2]) {
            const zoomContext = await browser.newContext({ viewport: { width: Math.round(1440 / factor), height: Math.round(900 / factor) }, deviceScaleFactor: factor, reducedMotion: 'reduce' });
            try {
                await zoomContext.addInitScript(() => { localStorage.clear(); localStorage.setItem('vc-reduced-motion', 'true'); });
                const zoomPage = await zoomContext.newPage(); zoomPage.on('pageerror', error => errors.push(error.message));
                for (const theme of ['light', 'dark']) {
                    await zoomPage.goto(`${preview.url}frame.html?view=settings&screen=account&theme=${theme}`); await settle(zoomPage);
                    assertGeometry(await geometry(zoomPage));
                    const toggle = zoomPage.locator('.vc-sidebar [data-collapse]:visible');
                    if (await toggle.count()) for (let i = 0; i < 2; i++) { await toggle.click(); await settle(zoomPage); assertGeometry(await geometry(zoomPage)); }
                    const category = zoomPage.locator('.vc-settings-category-toggle:visible');
                    if (await category.count()) {
                        await category.click(); await zoomPage.getByRole('menu').waitFor(); await settle(zoomPage);
                        const rounding = await zoomPage.evaluate(() => {
                            const a = document.querySelector('.vc-settings-category-toggle').getBoundingClientRect(), m = document.querySelector('.vc-menu:has([role="menu"])').getBoundingClientRect();
                            const x = Math.max(8, Math.min(a.left > innerWidth / 2 ? Math.min(innerWidth - 16, a.right) - m.width : Math.max(16, a.left), innerWidth - m.width - 8));
                            const y = Math.max(8, Math.min(a.bottom + 8, innerHeight - m.height - 8));
                            return { x:Math.abs(m.x-x), y:Math.abs(m.y-y), max:.5/devicePixelRatio, outside:m.x<0 || m.y<0 || m.right>innerWidth || m.bottom>innerHeight };
                        });
                        assert.ok(!rounding.outside && rounding.x <= rounding.max && rounding.y <= rounding.max, `缩放菜单保持边界和已批准物理像素取整 ${factor}: ${JSON.stringify(rounding)}`);
                        await zoomPage.keyboard.press('Escape'); await zoomPage.getByRole('menu').waitFor({state:'detached'});
                    }
                    await zoomPage.screenshot({ path:path.join(zoomOut, `zoom-${factor*100}-${theme}.png`), animations:'disabled' });
                }
            } finally { await zoomContext.close(); }
        }
        assert.deepEqual(errors, [], '样板不得出现脚本错误');
        console.log('[dr-shell] PASS：三处对齐、窗口自动收展、角标 0/1/99+、头像、分类与键盘导航，125/150/200% CSS视口+DPR缩放模拟');
    } finally {
        await browser?.close();
        await preview.close();
    }
}

export const desktopShellScene = { id: 'dr-shell', title: 'DR-4A 公共壳层布局与导航', needs: ['browser'], default: false, run: () => runDesktopShell() };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runDesktopShell({ captureReference: process.argv.includes('--capture-reference'), compareReference: process.argv.includes('--compare-reference'), geometryOnly: process.argv.includes('--check-geometry'), modelOnly: process.argv.includes('--check-model') });
