// F3 设置与酒馆：vc-ui 开启时的受管浏览器场景。默认不进场景集。
import path from 'node:path';
import { waitFor } from './managed-lib.mjs';
import { trackPageErrors } from './lib/page-errors.mjs';
import { createShotBudget, keepSceneShot } from './lib/scene-shots.mjs';

let shotBudget = createShotBudget();

const DRAWERS = [
    ['left-nav-panel', 'AI 回复配置'],
    ['rm_api_block', 'API 连接'],
    ['AdvancedFormatting', '提示词格式'],
    ['WorldInfo', '世界书'],
    ['user-settings-block', '界面'],
    ['Backgrounds', '背景'],
    ['rm_extensions_block', '扩展'],
    ['PersonaManagement', '人设'],
    ['right-nav-panel', '角色卡'],
];

function stBase() {
    return `http://127.0.0.1:${process.env.VC_W03_ST_PORT || 8752}`;
}

function fixtureBase() {
    return `http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT || 8753}`;
}

async function shot(page, file) {
    if (!keepSceneShot(shotBudget, file)) return;
    await page.evaluate(async () => {
        const fonts = document.fonts?.ready ?? Promise.resolve();
        await Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, 2000))]);
        const animations = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
        await Promise.race([
            Promise.all(animations.map((item) => item.finished.catch(() => undefined))),
            new Promise((resolve) => setTimeout(resolve, 800)),
        ]);
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: file, fullPage: false });
}

async function setTheme(page, mode) {
    await page.evaluate((value) => {
        localStorage.setItem('vc-theme', value);
        document.documentElement.setAttribute('data-vc-theme', value);
    }, mode);
}

async function openDrawer(page, id) {
    await page.evaluate((drawerId) => {
        const root = document.getElementById(drawerId);
        if (!root) throw new Error('drawer missing');
        if (root.classList.contains('openDrawer')) return;
        const toggle = [...root.parentElement.children].find((el) => el.classList.contains('drawer-toggle'));
        if (!toggle) throw new Error('toggle missing');
        toggle.click();
    }, id);
    await page.waitForFunction((drawerId) => {
        const root = document.getElementById(drawerId);
        return root?.classList.contains('openDrawer') && root.querySelector('[data-vc-drawer-nav]');
    }, id, { timeout: 8000 });
}

async function closeDrawer(page, id) {
    await page.evaluate((drawerId) => {
        document.querySelector(`#${drawerId} [data-vc-drawer-back]`)?.click();
    }, id);
    await page.waitForFunction((drawerId) => {
        const root = document.getElementById(drawerId);
        return root && !root.classList.contains('openDrawer') && !root.classList.contains('vc-drawer-page') && !root.querySelector('[data-vc-drawer-nav]');
    }, id, { timeout: 8000 });
}

async function clickControl(page, selector) {
    await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
}

function chatModels() {
    const model = (profileKey, modelId, displayName, extra = {}) => ({
        profileKey,
        modelId,
        displayName,
        contextWindowTokens: 8192,
        maxOutputTokens: 2048,
        state: 'ENABLED',
        capabilities: { toolCalls: 'DECLARED', systemMessage: 'DECLARED' },
        reasoningLevels: [],
        generationParams: { temperature: 0.3 },
        ...extra,
    });
    return [
        model('chat', 'vc03m-chat', 'Chat 主档', { pricing: { currency: 'USD', inputPerMillionTokens: 1, outputPerMillionTokens: 2 } }),
        model('chat-tools', 'vc03m-tools', 'Chat 工具档', { generationParams: { temperature: 0.3, topP: 0.9 }, pricing: { currency: 'USD', inputPerMillionTokens: 1, outputPerMillionTokens: 2 } }),
        model('chat-slow', 'vc03m-chat-slow', 'Chat 慢速档', { pricing: { currency: 'USD', inputPerMillionTokens: 1, outputPerMillionTokens: 2 } }),
    ];
}

async function dismissWelcome(page) {
    const welcomeDialog = page.locator('dialog[open].popup').first();
    if (await welcomeDialog.count()) {
        const name = welcomeDialog.locator('textarea');
        await name.waitFor({ state: 'visible', timeout: 15000 });
        await name.fill('f3-owner');
        await welcomeDialog.locator('.popup-button-ok').click();
        await welcomeDialog.waitFor({ state: 'hidden', timeout: 10000 });
    }
}

export async function sceneF3Settings(ctx) {
    shotBudget = createShotBudget();
    let chromium;
    try {
        ({ chromium } = await import('playwright-core'));
    } catch {
        throw new Error('playwright-core 不可用');
    }
    const launchOpts = { headless: true };
    if (process.env.VC_W03_CHROMIUM_PATH) launchOpts.executablePath = process.env.VC_W03_CHROMIUM_PATH;
    const browser = await chromium.launch(launchOpts);
    const base = stBase();
    try {
        const browserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await browserContext.addInitScript(() => {
            localStorage.setItem('vc-ui', 'on');
            localStorage.setItem('vc-theme', 'light');
        });
        await browserContext.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: base },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: base },
        ]);
        const page = await browserContext.newPage();
        const pageErrors = trackPageErrors(page);
        await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
            const area = document.querySelector('dialog[open].popup textarea');
            const shown = area && area.getClientRects().length > 0 && getComputedStyle(area).visibility !== 'hidden';
            const app = document.querySelector('#vc_models_menu_button') || document.body.classList.contains('vc-ui');
            return shown || (app && !document.querySelector('dialog[open].popup'));
        }, undefined, { timeout: 45000 });
        await dismissWelcome(page);
        await page.waitForSelector('#vc_models_menu_button', { state: 'attached', timeout: 45000 });
        await page.waitForFunction(() => document.body.classList.contains('vc-ui'), undefined, { timeout: 15000 });
        await setTheme(page, 'light');
        await page.setViewportSize({ width: 390, height: 844 });

        for (const [id, title] of DRAWERS) {
            await openDrawer(page, id);
            const seen = await page.locator(`#${id} .vc-nav-title`).innerText();
            if (seen.trim() !== title) throw new Error(`抽屉标题不符：${id}`);
            const box = await page.locator(`#${id}`).evaluate((el) => {
                const style = getComputedStyle(el);
                return { position: style.position, left: style.left, top: style.top, height: style.height };
            });
            if (box.position !== 'fixed' || box.left !== '0px' || Number.parseFloat(box.top) > 1) throw new Error(`手机抽屉定位不符：${id} ${box.top}`);
            const geom = await page.locator(`#${id}`).boundingBox();
            if (!geom || geom.x > 8 || geom.width < 360) throw new Error(`手机抽屉未铺满：${id} x=${geom?.x} w=${geom?.width}`);
            await shot(page, path.join(ctx.artifactsDir, `f3-390-light-${id}.png`));
            await closeDrawer(page, id);
        }

        await openDrawer(page, 'user-settings-block');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('user-settings-block')?.classList.contains('openDrawer'), undefined, { timeout: 8000 });

        await openDrawer(page, 'AdvancedFormatting');
        const cross = await page.evaluate(() => {
            const select = document.getElementById('main_api');
            const previous = select.value;
            const holder = document.getElementById('top-settings-holder');
            const inside = holder.contains(select) && select.closest('#rm_api_block');
            select.value = 'openai';
            const notice = document.getElementById('advanced-formatting-cc-notice');
            const display = notice ? getComputedStyle(notice).display : '';
            select.value = previous;
            return { inside, display };
        });
        if (!cross.inside || cross.display !== 'flex') throw new Error('跨抽屉 :has 规则未保持');
        await closeDrawer(page, 'AdvancedFormatting');

        await page.evaluate(() => {
            const pop = document.getElementById('character_popup');
            pop.classList.add('open');
            pop.style.display = 'flex';
        });
        const pop390 = await page.locator('#character_popup').evaluate((el) => getComputedStyle(el).left);
        if (pop390 !== '0px') throw new Error('手机角色卡弹层定位不符');
        await page.evaluate(() => {
            const pop = document.getElementById('character_popup');
            pop.classList.remove('open');
            pop.style.display = '';
        });

        const openModels = async () => {
            if (await page.locator('.vcms-overlay').isVisible()) return;
            await clickControl(page, '#extensionsMenuButton');
            await clickControl(page, '#vc_models_menu_button');
            await page.waitForSelector('.vcms-overlay', { state: 'visible', timeout: 10000 });
        };
        await openModels();
        await page.waitForSelector('#vcms-provider-list [data-id="vc03m-chat"]', { timeout: 15000 });
        await page.waitForSelector('.vcms-local', { timeout: 10000 });
        await page.waitForFunction(() => {
            const text = document.querySelector('.vcms-local')?.textContent || '';
            return text.includes('向量') && (text.includes('不可用') || text.includes('运行中') || text.includes('已在部署中关闭') || text.includes('加载中'));
        }, undefined, { timeout: 10000 });
        await shot(page, path.join(ctx.artifactsDir, 'f3-390-light-model-home.png'));

        await page.click('#vcms-provider-list [data-id="vc03m-chat"]');
        await page.waitForSelector('#vcms-f-display', { timeout: 8000 });
        const longName = '受管 Chat（F3 超长显示名用于换行与截断验收样本）';
        await page.fill('#vcms-f-display', longName);
        await shot(page, path.join(ctx.artifactsDir, 'f3-390-light-model-long.png'));
        const beforeList = await ctx.admin.listProviders();
        const beforeRow = beforeList.json.find((item) => item.providerId === 'vc03m-chat');
        await page.fill('#vcms-f-display', '受管 Chat（F3）');
        await page.click('#vcms-save');
        await waitFor(async () => {
            const listed = await ctx.admin.listProviders();
            const row = listed.json.find((item) => item.providerId === 'vc03m-chat');
            return row && row.displayName === '受管 Chat（F3）' && row.revision === beforeRow.revision + 1;
        }, { timeoutMs: 15000, label: 'F3 模型改名保存' });
        const readBack = await page.inputValue('#vcms-f-display');
        if (readBack !== '受管 Chat（F3）') throw new Error('F3 改名读回不一致');
        await shot(page, path.join(ctx.artifactsDir, 'f3-390-light-model-provider.png'));

        await page.fill('#vcms-f-display', '受管 Chat（F3 草稿）');
        const current = (await ctx.admin.listProviders()).json.find((item) => item.providerId === 'vc03m-chat');
        const externalName = `受管 Chat（F3 他侧 ${Date.now() % 1000}）`;
        const external = await ctx.admin.saveProvider('vc03m-chat', {
            displayName: externalName,
            protocol: 'OPENAI_CHAT_COMPLETIONS',
            baseUrl: `${fixtureBase()}/v1`,
            state: 'ENABLED',
            expectedRevision: current.revision,
            models: chatModels(),
        });
        if (external.status !== 200) throw new Error(`F3 外部更新失败 HTTP ${external.status}`);
        await page.click('#vcms-save');
        await page.waitForSelector('[data-action="conflict-keep"]', { timeout: 10000 });
        const draftKept = await page.inputValue('#vcms-f-display');
        if (draftKept !== '受管 Chat（F3 草稿）') throw new Error('F3 冲突后草稿未保留');
        await page.click('[data-action="conflict-keep"]');
        await shot(page, path.join(ctx.artifactsDir, 'f3-390-light-model-conflict.png'));

        await page.waitForSelector('.vcms-keybox', { timeout: 8000 });
        if (await page.locator('#vcms-f-key').count()) throw new Error('已配置密钥不应直接出现输入框');
        const keyboxText = await page.locator('.vcms-keybox').first().innerText();
        if (!/已配置/.test(keyboxText)) throw new Error('密钥状态文案缺失');
        await page.click('[data-action="key-replace"]');
        await page.waitForSelector('#vcms-f-key', { timeout: 5000 });
        if (await page.getAttribute('#vcms-f-key', 'type') !== 'password') throw new Error('密钥框不是 password');
        if (await page.inputValue('#vcms-f-key') !== '') throw new Error('密钥框回显了原值');
        const pageHtml = await page.content();
        if (pageHtml.includes(ctx.secrets.fixtureKey)) throw new Error('页面 DOM 泄露明文密钥');
        await page.click('[data-action="key-undo"]');
        await page.click('[data-action="vc-back"]');
        if (await page.locator('#vcms-dirty').isVisible()) await page.click('#vcms-discard');
        await page.click('[data-action="vc-back"]');
        await page.waitForSelector('.vcms-overlay', { state: 'hidden', timeout: 10000 });

        await clickControl(page, '#extensionsMenuButton');
        await clickControl(page, '#vc_data_menu_button');
        await page.waitForSelector('.vc-data-dialog[open] [data-vc-account-nav]', { timeout: 10000 });
        await page.click('[data-vc-account-go="password"]');
        await page.waitForFunction(() => document.querySelector('.vc-data-dialog')?.getAttribute('data-vc-screen') === 'password');
        await shot(page, path.join(ctx.artifactsDir, 'f3-390-light-account.png'));
        await page.fill('[data-password] input[name="newPassword"]', 'synthetic-not-used');
        await page.click('[data-password] button[type="submit"]');
        await page.waitForSelector('.vc-account-reauth', { state: 'visible', timeout: 8000 });
        await shot(page, path.join(ctx.artifactsDir, 'f3-390-light-account-reauth.png'));
        await page.click('[data-reauth-cancel]');
        await page.waitForSelector('.vc-account-reauth', { state: 'hidden', timeout: 8000 });
        await page.click('[data-vc-account-back]');
        await page.click('[data-vc-account-back]');
        await page.waitForSelector('.vc-data-dialog', { state: 'hidden', timeout: 8000 });

        await setTheme(page, 'dark');
        await openDrawer(page, 'WorldInfo');
        await shot(page, path.join(ctx.artifactsDir, 'f3-390-dark-WorldInfo.png'));
        await closeDrawer(page, 'WorldInfo');
        await openModels();
        await page.waitForSelector('.vcms-local', { timeout: 10000 });
        await shot(page, path.join(ctx.artifactsDir, 'f3-390-dark-model-home.png'));
        await page.click('.vcms-overlay [data-action="close"]');

        await page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(page, 'light');
        await openDrawer(page, 'left-nav-panel');
        const wide = await page.locator('#left-nav-panel').evaluate((el) => getComputedStyle(el).left);
        if (wide !== '240px') throw new Error(`宽屏抽屉定位不符：${wide}`);
        await shot(page, path.join(ctx.artifactsDir, 'f3-1440-light-left-nav-panel.png'));
        await page.evaluate(() => {
            const pop = document.getElementById('character_popup');
            pop.classList.add('open');
            pop.style.display = 'flex';
        });
        const popWide = await page.locator('#character_popup').evaluate((el) => getComputedStyle(el).left);
        if (popWide !== '240px') throw new Error('宽屏角色卡弹层定位不符');
        await page.evaluate(() => {
            const pop = document.getElementById('character_popup');
            pop.classList.remove('open');
            pop.style.display = '';
        });
        await closeDrawer(page, 'left-nav-panel');

        await setTheme(page, 'dark');
        await openModels();
        await page.click('#vcms-provider-list [data-id="vc03m-chat"]');
        await page.waitForSelector('#vcms-f-display', { timeout: 8000 });
        await shot(page, path.join(ctx.artifactsDir, 'f3-1440-dark-model-provider.png'));
        await page.click('.vcms-overlay [data-action="close"]');
        await clickControl(page, '#extensionsMenuButton');
        await clickControl(page, '#vc_data_menu_button');
        await page.waitForSelector('.vc-data-dialog[open]', { timeout: 10000 });
        await shot(page, path.join(ctx.artifactsDir, 'f3-1440-dark-account.png'));
        await page.click('[data-vc-account-back]');
        await page.waitForSelector('.vc-data-dialog', { state: 'hidden', timeout: 8000 });

        await page.evaluate(() => {
            document.querySelectorAll('.vc-sheet, .vc-scrim').forEach((el) => el.remove());
            const menu = document.querySelector('#extensionsMenu');
            const open = menu && getComputedStyle(menu).display !== 'none' && menu.getClientRects().length > 0;
            if (open) document.body.click();
        });
        await page.waitForFunction(() => {
            const menu = document.querySelector('#extensionsMenu');
            if (!menu) return true;
            const style = getComputedStyle(menu);
            return style.display === 'none' || menu.getClientRects().length === 0;
        }, null, { timeout: 8000 });
        const showRightView = async (view) => {
            await page.evaluate((name) => {
                const map = { list: 'rm_characters_block', edit: 'rm_ch_create_block', import: 'rm_character_import' };
                for (const [key, id] of Object.entries(map)) {
                    const el = document.getElementById(id);
                    if (el) el.style.display = key === name ? 'block' : 'none';
                }
            }, view);
        };
        for (const theme of ['light', 'dark']) {
            await setTheme(page, theme);
            for (const [width, height] of [[390, 844], [1440, 900]]) {
                await page.setViewportSize({ width, height });
                const tag = `${width}-${theme}`;
                for (const [id] of DRAWERS) {
                    await openDrawer(page, id);
                    await page.waitForFunction((drawerId) => {
                        const el = document.getElementById(drawerId);
                        const z = Number.parseFloat(getComputedStyle(el).zIndex);
                        return el?.classList.contains('vc-drawer-page') && Number.isFinite(z);
                    }, id, { timeout: 8000 });
                    const cover = await page.locator(`#${id}`).evaluate((el) => {
                        const style = getComputedStyle(el);
                        const sheld = document.getElementById('sheld');
                        const shell = document.getElementById('vc-shell');
                        const box = el.getBoundingClientRect();
                        const x = Math.min(window.innerWidth - 12, Math.max(box.left + 24, 12));
                        const y = Math.min(window.innerHeight - 12, Math.max(box.top + 96, 96));
                        const hit = document.elementFromPoint(x, y);
                        const sidebar = document.querySelector('#vc-shell .vc-sidebar');
                        const sideHit = document.elementFromPoint(12, Math.min(240, window.innerHeight - 12));
                        return {
                            bg: style.backgroundColor,
                            z: Number.parseFloat(style.zIndex),
                            sheldZ: Number.parseFloat(sheld ? getComputedStyle(sheld).zIndex : ''),
                            shellZ: Number.parseFloat(shell ? getComputedStyle(shell).zIndex : ''),
                            w: box.width,
                            x: box.x,
                            left: style.left,
                            hit: !!(hit && (hit === el || el.contains(hit))),
                            hitName: hit ? `${hit.tagName}#${hit.id}.${String(hit.className).split(' ').slice(0, 4).join('.')}` : 'none',
                            pointerEvents: style.pointerEvents,
                            sidebarClickable: !!(sidebar && sideHit && sidebar.contains(sideHit) && !el.contains(sideHit)),
                        };
                    });
                    const covered = cover.bg && cover.bg !== 'rgba(0, 0, 0, 0)' && cover.z > cover.sheldZ && cover.z > cover.shellZ && cover.hit;
                    if (!covered) {
                        throw new Error(id === 'right-nav-panel' ? `角色卡页未盖住内容区 ${tag} ${JSON.stringify(cover)}` : `抽屉页未盖住内容区 ${id} ${tag} ${JSON.stringify(cover)}`);
                    }
                    if (width < 744 && (cover.x > 8 || cover.w < 360)) {
                        throw new Error(id === 'right-nav-panel' ? `角色卡页未铺满 ${tag}` : `抽屉页未铺满 ${id} ${tag}`);
                    }
                    if (width >= 744) {
                        if (cover.left !== '240px') throw new Error(`宽屏抽屉定位不符：${cover.left}`);
                        if (!cover.sidebarClickable) throw new Error(`侧边栏被抽屉挡住 ${id} ${tag}`);
                    }
                    if (id === 'right-nav-panel') {
                        await showRightView('list');
                        await shot(page, path.join(ctx.artifactsDir, `f3-${tag}-right-nav-panel.png`));
                        await showRightView('edit');
                        await shot(page, path.join(ctx.artifactsDir, `f3-${tag}-right-nav-edit.png`));
                        await showRightView('import');
                        await shot(page, path.join(ctx.artifactsDir, `f3-${tag}-right-nav-import.png`));
                        await showRightView('list');
                    } else {
                        if (id === 'rm_api_block') {
                            await page.evaluate(() => {
                                const input = document.querySelector('#temp_openai');
                                const settings = globalThis.SillyTavern?.getContext?.()?.chatCompletionSettings;
                                const previous = settings?.temp_openai ?? input?.value;
                                if (settings) settings.temp_openai = 0.91;
                                if (input) {
                                    input.value = '0.91';
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                }
                                const root = document.getElementById('rm_api_block');
                                const banner = document.getElementById('vc_foreground_banner');
                                const nav = root?.querySelector('[data-vc-drawer-nav]');
                                if (root && banner) {
                                    const navH = nav ? nav.getBoundingClientRect().height : 56;
                                    const delta = banner.getBoundingClientRect().top - root.getBoundingClientRect().top;
                                    root.scrollTop += delta - navH - 8;
                                }
                                if (root) root.dataset.vcPrevTemp = previous == null ? '' : String(previous);
                            });
                            await page.waitForSelector('#vc_foreground_banner.vcfg-banner-drift [data-vcfg-action="reproject"]', { timeout: 8000 });
                        }
                        if (id === 'user-settings-block') {
                            await page.evaluate(() => {
                                const root = document.getElementById('user-settings-block');
                                if (root) root.scrollTop = 0;
                            });
                        }
                        await shot(page, path.join(ctx.artifactsDir, `f3-${tag}-${id}.png`));
                        if (id === 'rm_api_block') {
                            await page.evaluate(() => {
                                const root = document.getElementById('rm_api_block');
                                const previous = root?.dataset.vcPrevTemp;
                                const settings = globalThis.SillyTavern?.getContext?.()?.chatCompletionSettings;
                                const input = document.querySelector('#temp_openai');
                                if (settings && previous !== undefined && previous !== '') settings.temp_openai = Number(previous);
                                if (input && previous !== undefined && previous !== '') {
                                    input.value = previous;
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                }
                                document.querySelector('#vc_foreground_banner [data-vcfg-action="reproject"]')?.click();
                            });
                        }
                    }
                    await closeDrawer(page, id);
                }
                await openModels();
                await page.waitForSelector('.vcms-local', { timeout: 10000 });
                await shot(page, path.join(ctx.artifactsDir, `f3-${tag}-model-home.png`));
                await page.evaluate(() => document.querySelector('.vcms-usage')?.scrollIntoView({ block: 'center' }));
                await shot(page, path.join(ctx.artifactsDir, `f3-${tag}-model-usage.png`));
                await page.evaluate(() => {
                    const scroller = document.querySelector('#vc-model-settings-root .vcms-overlay') || document.scrollingElement;
                    if (scroller) scroller.scrollTop = 0;
                    document.querySelector('#vcms-provider-list')?.scrollIntoView({ block: 'center' });
                });
                await page.click('#vcms-provider-list [data-id="vc03m-chat"]');
                await page.waitForSelector('#vcms-f-display', { timeout: 8000 });
                await page.evaluate(() => {
                    const scroller = document.querySelector('#vc-model-settings-root .vcms-overlay');
                    if (scroller) scroller.scrollTop = 0;
                });
                await shot(page, path.join(ctx.artifactsDir, `f3-${tag}-model-provider.png`));
                await page.click('[data-action="vc-back"]');
                await page.click('.vcms-overlay [data-action="close"]');
                await page.waitForSelector('.vcms-overlay', { state: 'hidden', timeout: 10000 });
                await clickControl(page, '#extensionsMenuButton');
                await clickControl(page, '#vc_data_menu_button');
                await page.waitForSelector('.vc-data-dialog[open] [data-vc-account-home]', { timeout: 10000 });
                for (const screen of ['home', 'password', 'auth', 'sessions', 'export', 'delete']) {
                    if (screen !== 'home') await page.click(`[data-vc-account-go="${screen}"]`);
                    await page.waitForFunction((name) => document.querySelector('.vc-data-dialog')?.getAttribute('data-vc-screen') === name, screen);
                    await shot(page, path.join(ctx.artifactsDir, `f3-${tag}-account-${screen}.png`));
                    if (tag === '390-light' && screen === 'delete') {
                        const opened = await page.evaluate(() => {
                            document.querySelector('[data-delete] button[type="submit"]')?.click();
                            return !!document.querySelector('[data-vc-cancel]');
                        });
                        if (!opened) throw new Error('删除确认框未出现');
                        await page.waitForSelector('[data-vc-cancel]', { state: 'visible', timeout: 8000 });
                        await shot(page, path.join(ctx.artifactsDir, 'f3-390-light-account-delete-alert.png'));
                        await page.click('[data-vc-cancel]');
                    }
                    if (screen !== 'home') await page.click('[data-vc-account-back]');
                }
                await page.click('[data-vc-account-back]');
                await page.waitForSelector('.vc-data-dialog', { state: 'hidden', timeout: 8000 });
            }
        }
        pageErrors.assertNone();
        console.log('[accept] ✓ F3 抽屉页、模型页与账户页截图完成');
    } finally {
        await browser.close();
    }
}

export const f3SettingsScene = {
    id: 'f3-settings',
    title: 'F3 设置与酒馆抽屉页',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneF3Settings,
};
export const scenes = [f3SettingsScene];
