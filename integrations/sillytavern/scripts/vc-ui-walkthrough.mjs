// 新外观全站走查。默认不进场景集，只在 --filter vc-ui-walkthrough 时运行。
// 合成角色与合成会话；不发真实消息，不记录凭据或对话正文。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinVcUi } from './vc-ui-pin.mjs';
import { waitFor } from './managed-lib.mjs';
import { allowedOverlays, unexpectedOverlays } from './lib/overlay-guard.mjs';

const MANAGED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dev-managed');
const WIDTHS = [
    { width: 360, height: 780 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
];
const THEMES = ['light', 'dark'];

async function closeAccountDialog(page) {
    if (!(await page.locator('.vc-data-dialog[open]').count())) return;
    await page.evaluate(() => {
        const dialog = document.querySelector('.vc-data-dialog[open]');
        if (!dialog) return;
        dialog.querySelector('[data-close]')?.click();
        if (dialog.open) dialog.close();
    });
    await page.waitForFunction(() => !document.querySelector('.vc-data-dialog[open]'), null, { timeout: 8000 });
}

async function removeSheets(page) {
    await page.evaluate(() => {
        document.querySelectorAll('.vc-sheet, .vc-scrim').forEach((el) => {
            el.style.pointerEvents = 'none';
            el.remove();
        });
    });
}
const DRAWERS = [
    { id: 'ai-config-button', panel: 'left-nav-panel', page: 'tavern-ai' },
    { id: 'advanced-formatting-button', panel: 'AdvancedFormatting', page: 'tavern-prompt' },
    { id: 'WI-SP-button', panel: 'WorldInfo', page: 'tavern-world' },
    { id: 'extensions-settings-button', panel: 'rm_extensions_block', page: 'tavern-extensions' },
    { id: 'persona-management-button', panel: 'PersonaManagement', page: 'tavern-persona' },
    { id: 'backgrounds-button', panel: 'Backgrounds', page: 'tavern-backgrounds' },
    { id: 'user-settings-button', panel: 'user-settings-block', page: 'tavern-ui' },
    { id: 'sys-settings-button', panel: 'rm_api_block', page: 'tavern-api' },
    { id: 'rightNavHolder', panel: 'right-nav-panel', page: 'tavern-card' },
];

function selectedWidths() {
    const raw = process.env.VC_WALKTHROUGH_WIDTHS;
    if (!raw) return WIDTHS;
    const wanted = new Set(raw.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item)));
    const picked = WIDTHS.filter((item) => wanted.has(item.width));
    if (!picked.length) throw new Error(`没有匹配的走查宽度 ${raw}`);
    return picked;
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function iconUsesReady(uses) {
    const visible = (uses || []).filter((item) => item && item.visible);
    if (!visible.length) return true;
    return visible.every((item) => Number(item.width) > 0);
}

export function noteForIconSettleTimeouts(count) {
    const n = Number(count) || 0;
    return n > 0 ? [`图标未在时限内就绪 ${n}`] : [];
}

export function createMutex() {
    let tail = Promise.resolve();
    return function exclusive(task) {
        const run = tail.then(() => task());
        tail = run.then(() => {}, () => {});
        return run;
    };
}

export function walkthroughGroups(widths, themes = THEMES) {
    return themes.flatMap((theme) => widths.map((viewport) => ({ theme, viewport })));
}

let iconSettleTimeouts = 0;

async function until(check, ms) {
    const deadline = Date.now() + ms;
    do {
        if (await check()) return true;
        const left = deadline - Date.now();
        if (left <= 0) return false;
        await sleep(Math.min(16, left));
    } while (Date.now() <= deadline);
    return false;
}

async function settle(page) {
    await page.evaluate(async () => {
        const fonts = document.fonts?.ready ?? Promise.resolve();
        await Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, 2000))]);
        const animations = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
        const finite = animations.filter((anim) => anim.effect?.getTiming?.().iterations !== Infinity);
        await Promise.race([
            Promise.all(finite.map((anim) => anim.finished.catch(() => {}))),
            new Promise((resolve) => setTimeout(resolve, 1200)),
        ]);
        await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => {}))));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    let ready = false;
    try {
        await page.waitForFunction(() => {
            const uses = [...document.querySelectorAll('.vc-icon use')].map((node) => {
                const svg = node.closest('svg') || node;
                const style = getComputedStyle(svg);
                const rect = svg.getBoundingClientRect();
                const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                let width = 0;
                if (visible) {
                    try { width = node.getBBox().width; } catch { width = 0; }
                }
                return { visible, width };
            });
            const shown = uses.filter((item) => item.visible);
            if (!shown.length) return true;
            return shown.every((item) => item.width > 0);
        }, null, { timeout: 8000 });
        ready = true;
    } catch {
        ready = false;
    }
    if (!ready) iconSettleTimeouts += 1;
}

function writeIndex(dir, shots, notes) {
    const cards = shots.map((shot) => {
        const name = path.basename(shot.file);
        return `<figure><img src="${name}" alt="${shot.caption}"><figcaption>${shot.caption}</figcaption></figure>`;
    }).join('\n');
    const extra = notes.length ? `<ul>${notes.map((note) => `<li>${note}</li>`).join('')}</ul>` : '';
    const html = `<!DOCTYPE html>
<meta charset="utf-8">
<title>vc-ui walkthrough</title>
<style>
  body { margin: 24px; font: 14px/1.4 system-ui, sans-serif; background: #111; color: #eee; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  figure { margin: 0; background: #1c1c1e; }
  img { width: 100%; height: auto; background: #000; }
  figcaption { padding: 8px; }
</style>
<h1>vc-ui walkthrough</h1>
${extra}
<div class="grid">
${cards}
</div>
`;
    fs.writeFileSync(path.join(dir, 'index.html'), html);
}

export async function sceneVcUiWalkthrough(ctx) {
    const startedAt = Date.now();
    iconSettleTimeouts = 0;
    const dir = path.join(MANAGED, 'artifacts', `walkthrough-${stamp()}`);
    fs.mkdirSync(dir, { recursive: true });
    const notes = [];
    const buckets = [];
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        const granted = await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'vc-ui-walkthrough', granted: true });
        if (granted.status !== 200) throw new Error(`授权 ${consentType} HTTP ${granted.status}`);
    }
    const cardName = `走查 ${crypto.randomUUID().slice(0, 8)}`;
    const form = new FormData();
    form.append('file_type', 'json');
    form.append('avatar', new Blob([JSON.stringify({
        name: cardName, description: '合成走查卡。', first_mes: '合成开场。', personality: '', scenario: '', mes_example: '',
    })], { type: 'application/json' }), 'synthetic.json');
    const imported = await ctx.st.call('POST', '/api/characters/import', form);
    if (imported.status !== 200 || !imported.json?.file_name) throw new Error(`导入合成卡 HTTP ${imported.status}`);
    const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
    const chatFile = `vc-ui-walkthrough-${crypto.randomUUID()}`;
    const chat = [{ user_name: 'unused', character_name: cardName, chat_metadata: { vc_f2: { id: crypto.randomUUID(), revision: 0 }, vc_binding: { mode: 'COMPANION' } } }, {
        name: cardName, is_user: false, mes: '合成开场。', send_date: new Date().toISOString(),
    }];
    const saved = await ctx.st.call('POST', '/api/chats/save', { avatar_url: avatar, file_name: chatFile, chat });
    if (saved.status !== 200) throw new Error(`保存聊天 HTTP ${saved.status}`);

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}),
    });
    const record = async (page, width, theme, pageName, bucket) => {
        await settle(page);
        const allowed = allowedOverlays(pageName);
        try {
            if (!allowed.includes('drawer')) {
                for (let i = 0; i < 4; i += 1) {
                    const back = page.locator('.openDrawer [data-vc-drawer-back]').first();
                    if (!(await back.count())) break;
                    await back.click();
                    await page.waitForFunction(() => !document.querySelector('.openDrawer'), null, { timeout: 8000 });
                }
            }
            if (!allowed.includes('menu')) {
                const menuOpen = await page.evaluate(() => [...document.querySelectorAll('.vc-menu')].some((el) => el.getClientRects().length > 0));
                if (menuOpen) {
                    await page.keyboard.press('Escape');
                    await page.waitForFunction(() => ![...document.querySelectorAll('.vc-menu')].some((el) => el.getClientRects().length > 0), null, { timeout: 4000 });
                }
            }
            if (!allowed.includes('model')) {
                const modelClose = page.locator('.vcms-overlay:not([hidden]) [data-action="close"]').first();
                if (await modelClose.count()) {
                    await modelClose.click();
                    await page.waitForFunction(() => !document.querySelector('.vcms-overlay:not([hidden])'), null, { timeout: 8000 });
                }
            }
            if (!allowed.includes('dialog')) await closeAccountDialog(page);
            if (!allowed.includes('sheet') && !allowed.includes('drawer')) await removeSheets(page);
            const names = await page.evaluate(({ allowDrawer, pageName: shot }) => {
                const visible = (el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
                const found = [];
                const openDrawer = document.querySelector('.openDrawer');
                const drawer = Boolean(openDrawer);
                const model = Boolean(document.querySelector('.vcms-overlay:not([hidden])'));
                const dialog = Boolean(document.querySelector('dialog[open], .vc-data-dialog[open]'));
                const sheet = [...document.querySelectorAll('.vc-sheet')].some((el) => {
                    if (!visible(el)) return false;
                    // 手机设置 sheet 是酒馆抽屉的宿主，抽屉步骤里它不是上一步残留。
                    if (allowDrawer && openDrawer && el.querySelector('.vc-settings-form')) return false;
                    return true;
                });
                const menu = [...document.querySelectorAll('.vc-menu')].some(visible);
                const scrim = [...document.querySelectorAll('.vc-scrim')].some(visible);
                if (drawer) found.push('drawer');
                if (menu) found.push('menu');
                if (sheet) found.push('sheet');
                if (model) found.push('model');
                if (dialog) found.push('dialog');
                if (scrim && !drawer && !sheet && !model && !dialog) found.push('scrim');
                const shell = document.querySelector('#vc-shell');
                if (shell?.getAttribute('data-settings') === 'page') found.push('settings');
                const destination = shell?.getAttribute('data-destination') || '';
                const foreignPage = [...document.querySelectorAll('[data-vc-page]')].some((el) => {
                    if (!visible(el)) return false;
                    const name = el.getAttribute('data-vc-page') || '';
                    return name !== destination;
                });
                if (foreignPage) found.push('page');
                if (shot === 'story-stage') {
                    const stage = document.querySelector('.vc-story-tab[data-view="stage"]');
                    const rect = stage?.getBoundingClientRect();
                    const onScreen = Boolean(rect && rect.width > 80 && rect.height > 80 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth);
                    if (!onScreen) found.push('stage-hidden');
                }
                return found;
            }, { allowDrawer: allowed.includes('drawer'), pageName });
            const extra = unexpectedOverlays(names, allowed);
            if (extra.length) throw new Error(`截图前残留浮层 ${width} ${theme} ${pageName}: ${extra.join(',')}`);
        } catch (error) {
            if (String(error?.message || error).includes('残留浮层')) throw error;
            throw new Error(`截图前残留浮层 ${width} ${theme} ${pageName}: ${String(error?.message || error).split('\n')[0]}`);
        }
        const file = path.join(dir, `${width}-${theme}-${pageName}.png`);
        await page.screenshot({ path: file });
        bucket.shots.push({ file, caption: `${width} ${theme} ${pageName}` });
        if (Array.isArray(ctx.screenshots)) ctx.screenshots.push(file);
    };
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await pinVcUi(context, 'on');
        await context.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
        ]);
        await context.addInitScript(() => {
            try { localStorage.setItem('vc-theme', 'light'); } catch { /* 主题在每个视口前再写一次 */ }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
        await waitFor(async () => page.evaluate(async () => (await import('/script.js')).settingsReady || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 60000, label: 'ST 设置或欢迎页' });
        const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
        if (await onboarding.count()) {
            await onboarding.locator('textarea').fill('vc-ui-walkthrough');
            await onboarding.locator('.popup-button-ok').click();
            await onboarding.waitFor({ state: 'hidden' });
        }
        await waitFor(async () => page.evaluate(() => document.body.classList.contains('vc-ui') && document.querySelector('#vc-shell')), { timeoutMs: 60000, label: '外壳' });
        await page.evaluate(async ({ name, file }) => {
            const native = await import('/script.js');
            const index = native.characters.findIndex((item) => item.avatar === name);
            if (index < 0) throw new Error('合成角色未加载');
            await native.selectCharacterById(index);
            await native.openCharacterChat(file);
        }, { name: avatar, file: chatFile });
        await waitFor(async () => page.evaluate(() => Boolean(window.SillyTavern.getContext().chatMetadata?.vc_binding?.relationshipId)), { timeoutMs: 30000, label: '会话绑定' });
        const binding = await page.evaluate(() => {
            const value = window.SillyTavern.getContext().chatMetadata?.vc_binding || {};
            return {
                relationshipId: value.relationshipId == null ? '' : String(value.relationshipId),
                conversationId: value.conversationId == null ? '' : String(value.conversationId),
            };
        });
        if (binding.relationshipId) {
            const created = await ctx.admin.call('POST', `/api/v1/relationships/${binding.relationshipId}/memories/candidates`, {
                scope: 'RELATIONSHIP',
                conversationId: binding.conversationId || undefined,
                summary: '用户把怀表放在旅店前台。',
            });
            if (created.status === 200 && created.json?.memoryId) {
                const confirmed = await ctx.admin.call('POST', `/api/v1/memories/${created.json.memoryId}/confirm`, {});
                if (confirmed.status !== 200) notes.push(`记忆确认 HTTP ${confirmed.status}`);
            } else notes.push(`记忆候选 HTTP ${created.status}`);
        } else notes.push('没有关系，跳过记忆种子');

        const storageState = await context.storageState();
        const chatLock = createMutex();
        const storyLock = createMutex();
        async function captureGroup(page, bucket, theme, viewport) {
        const notes = bucket.notes;
        const closeLayers = async () => {
            for (let i = 0; i < 6; i += 1) {
                const idle = await page.evaluate(() => {
                    const back = document.querySelector('.openDrawer [data-vc-drawer-back]');
                    if (back) { back.click(); return false; }
                    const model = document.querySelector('.vcms-overlay:not([hidden]) [data-action="close"]');
                    if (model) { model.click(); return false; }
                    const data = document.querySelector('.vc-data-dialog[open] [data-close]');
                    if (data) { data.click(); return false; }
                    const done = document.querySelector('#vc-shell[data-settings="page"] [data-settings-done]');
                    if (done) { done.click(); return false; }
                    const sheet = document.querySelector('.vc-sheet-done');
                    if (sheet) { sheet.click(); return false; }
                    const stage = document.querySelector('.vc-story-tab[data-view="stage"] [data-action="close"]');
                    if (stage) { stage.click(); return false; }
                    return true;
                });
                if (idle) return;
                await until(async () => page.evaluate(() => !document.querySelector('.openDrawer [data-vc-drawer-back], .vcms-overlay:not([hidden]) [data-action="close"], .vc-data-dialog[open] [data-close], #vc-shell[data-settings="page"] [data-settings-done], .vc-sheet-done, .vc-story-tab[data-view="stage"] [data-action="close"]')), 250);
            }
            await dismissSheet();
        };
        const dismissSheet = () => removeSheets(page);
        const leaveChat = async () => {
            const open = await page.evaluate(() => document.querySelector('#vc-shell')?.dataset.chat === 'open' && window.innerWidth < 744);
            if (!open) return;
            const back = page.locator('#vc-shell [data-back]:visible');
            if (await back.count()) {
                await back.first().click();
                await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.chat !== 'open', null, { timeout: 8000 }).catch(() => {});
            }
        };
        const go = async (nav) => {
            await dismissSheet();
            await leaveChat();
            await page.locator(`#vc-shell [data-nav="${nav}"]:visible`).first().click();
            await page.waitForFunction((name) => document.querySelector('#vc-shell')?.dataset.destination === name, nav, { timeout: 8000 });
        };
        const settingsOpen = () => page.evaluate(() => {
            const y = Math.min(window.innerHeight * 0.42, window.innerHeight - 120);
            const probe = document.elementFromPoint(window.innerWidth / 2, y);
            const narrow = window.innerWidth < 744;
            if (narrow) {
                const sheet = [...document.querySelectorAll('.vc-sheet')].find((el) => {
                    const rect = el.getBoundingClientRect();
                    const title = el.querySelector('.vc-sheet-head h3')?.textContent?.trim() || '';
                    return Boolean(el.querySelector('.vc-settings-form')) && title === '设置'
                        && rect.top < window.innerHeight * 0.22 && rect.bottom > window.innerHeight * 0.72;
                });
                return Boolean(sheet && probe?.closest?.('.vc-sheet') === sheet);
            }
            const shell = document.querySelector('#vc-shell');
            return shell?.dataset.settings === 'page' && Boolean(probe?.closest?.('.vc-shell-settings'));
        });
        const ensureSettings = async () => {
            if (await page.evaluate(() => window.innerWidth < 744 && document.querySelector('#vc-shell')?.dataset.chat === 'open')) {
                await page.locator('#vc-shell [data-back]:visible').click();
                await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.chat !== 'open', null, { timeout: 8000 });
            }
            if (!(await settingsOpen())) {
                await page.evaluate(() => {
                    document.querySelectorAll('.openDrawer [data-vc-drawer-back]').forEach((el) => el.click());
                    document.querySelectorAll('.openDrawer').forEach((el) => el.classList.remove('openDrawer'));
                    document.body.classList.remove('vc-host-drawer');
                    document.querySelectorAll('.vc-scrim').forEach((el) => {
                        if (!el.nextElementSibling?.classList?.contains('vc-sheet')) el.remove();
                    });
                    const buttons = [...document.querySelectorAll('#vc-shell [data-settings]')];
                    const visible = buttons.find((el) => {
                        const style = getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                    });
                    (visible || buttons[0])?.click();
                });
            }
            await page.waitForFunction(() => {
                const y = Math.min(window.innerHeight * 0.42, window.innerHeight - 120);
                const probe = document.elementFromPoint(window.innerWidth / 2, y);
                const narrow = window.innerWidth < 744;
                if (narrow) {
                    const sheet = [...document.querySelectorAll('.vc-sheet')].find((el) => {
                        const rect = el.getBoundingClientRect();
                        const title = el.querySelector('.vc-sheet-head h3')?.textContent?.trim() || '';
                        return Boolean(el.querySelector('.vc-settings-form')) && title === '设置'
                            && rect.top < window.innerHeight * 0.22 && rect.bottom > window.innerHeight * 0.72;
                    });
                    return Boolean(sheet && probe?.closest?.('.vc-sheet') === sheet);
                }
                const shell = document.querySelector('#vc-shell');
                return shell?.dataset.settings === 'page' && Boolean(probe?.closest?.('.vc-shell-settings'));
            }, null, { timeout: 8000 });
            await settle(page);
            if (!(await settingsOpen())) throw new Error('设置没有停在可见的页面或 sheet');
        };
        const clickSettings = async (action) => {
            await ensureSettings();
            const ok = await page.evaluate((name) => {
                const shown = (el) => el && el.getClientRects().length > 0;
                const forms = [...document.querySelectorAll('.vc-settings-form')].filter(shown);
                const button = forms.flatMap((form) => [...form.querySelectorAll(`[data-action="${CSS.escape(name)}"]`)]).find(shown)
                    || forms.flatMap((form) => [...form.querySelectorAll(`[data-action="${name}"]`)]).find(shown);
                if (!button) return false;
                button.scrollIntoView({ block: 'center', inline: 'nearest' });
                button.click();
                return true;
            }, action);
            if (!ok) throw new Error(`没有设置项 ${action}`);
        };

                console.log(`[vc-ui-walkthrough] ${theme} ${viewport.width}`);
                try {
                await closeLayers();
                await page.setViewportSize(viewport);
                await page.evaluate((mode) => {
                    try { localStorage.setItem('vc-theme', mode); } catch { /* 截图前仍设置属性 */ }
                    document.documentElement.setAttribute('data-vc-theme', mode);
                }, theme);
                await page.waitForFunction((width) => document.querySelector('#vc-shell')?.dataset.chrome === (width < 744 ? 'tabbar' : 'sidebar'), viewport.width);
                await go('chat');
                await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.chat !== 'open' || window.innerWidth >= 744);
                // 744–1179 且已进入会话时，外壳会把列表收起。走查要先看到列表。
                await page.evaluate(() => {
                    const shell = document.querySelector('#vc-shell');
                    if (shell?.dataset.list === 'hidden') shell.dataset.list = 'open';
                });
                await record(page, viewport.width, theme, 'chat-list', bucket);
                const row = page.locator('#vc-shell .vc-convo:visible').first();
                if (await row.count()) {
                    await row.click();
                    await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.chat === 'open', null, { timeout: 8000 }).catch(() => {});
                }
                await record(page, viewport.width, theme, 'chat', bucket);
                if (theme === 'light' && viewport.width === 390) {
                    await page.evaluate(() => {
                        try { localStorage.setItem('vc-reply-style', 'spread'); } catch { /* 铺开仍去掉气泡类 */ }
                        document.body.classList.remove('vc-reply-bubble');
                    });
                    await record(page, viewport.width, theme, 'chat-spread', bucket);
                    const message = page.locator('#chat .mes .mes_text').first();
                    if (await message.count()) {
                        await message.click({ button: 'right' });
                        const menu = await page.waitForFunction(() => [...document.querySelectorAll('.vc-menu')].some((el) => el.getClientRects().length > 0), null, { timeout: 4000 }).then(() => true).catch(() => false);
                        if (menu) await record(page, viewport.width, theme, 'chat-press', bucket);
                        else notes.push('390 light chat-press：长按菜单没有出现');
                        await page.keyboard.press('Escape');
                        await page.waitForFunction(() => ![...document.querySelectorAll('.vc-menu')].some((el) => el.getClientRects().length > 0), null, { timeout: 4000 });
                    } else notes.push('390 light chat-spread：没有消息可长按');
                }

                await ensureSettings();
                await record(page, viewport.width, theme, 'settings', bucket);
                for (const drawer of DRAWERS) {
                    try {
                        await clickSettings(drawer.id);
                        await page.waitForFunction((panelId) => {
                            const root = document.getElementById(panelId);
                            return root?.classList.contains('openDrawer') && root.querySelector('[data-vc-drawer-nav]');
                        }, drawer.panel, { timeout: 8000 });
                        await record(page, viewport.width, theme, drawer.page, bucket);
                    } catch (error) {
                        if (String(error?.message || error).includes('残留浮层')) throw error;
                        notes.push(`${viewport.width} ${theme} ${drawer.page}：${error.message}`);
                    }
                    const back = page.locator(`#${drawer.panel} [data-vc-drawer-back]`).first();
                    if (await back.count()) await back.click();
                    await page.waitForFunction((panelId) => !document.getElementById(panelId)?.classList.contains('openDrawer'), drawer.panel, { timeout: 8000 });
                }

                try {
                    await clickSettings('models');
                    await page.waitForSelector('.vcms-overlay:not([hidden]) #vcms-provider-list', { timeout: 20000 });
                    await record(page, viewport.width, theme, 'model-home', bucket);
                    const provider = page.locator('#vcms-provider-list [data-action="select-provider"]').first();
                    if (await provider.count()) {
                        await provider.click();
                        await page.waitForSelector('#vcms-f-display', { timeout: 8000 });
                        await record(page, viewport.width, theme, 'model-provider', bucket);
                    } else notes.push(`${viewport.width} ${theme} model-provider：没有供应商行`);
                } catch (error) {
                    if (String(error?.message || error).includes('残留浮层')) throw error;
                    notes.push(`${viewport.width} ${theme} model：${error.message}`);
                }
                const modelClose = page.locator('.vcms-overlay:not([hidden]) [data-action="close"]').first();
                if (await modelClose.count()) await modelClose.click();
                await page.waitForFunction(() => !document.querySelector('.vcms-overlay:not([hidden])'), null, { timeout: 8000 });

                try {
                    await clickSettings('data');
                    await page.waitForSelector('.vc-data-dialog[open], [data-vc-account-home]', { timeout: 15000 });
                    await record(page, viewport.width, theme, 'account', bucket);
                } catch (error) {
                    if (String(error?.message || error).includes('残留浮层')) throw error;
                    notes.push(`${viewport.width} ${theme} account：${error.message}`);
                }
                try {
                    await closeAccountDialog(page);
                } catch (error) {
                    throw new Error(`截图前残留浮层 ${viewport.width} ${theme} account: ${String(error?.message || error).split('\n')[0]}`);
                }
                await closeLayers();

                await go('characters');
                await page.waitForSelector('.vc-characters', { timeout: 15000 });
                await record(page, viewport.width, theme, 'characters', bucket);
                const withInstances = page.locator('.vc-characters .vc-role:visible').filter({ hasNotText: '0 个实例' });
                const card = (await withInstances.count()) ? withInstances.first() : page.locator('.vc-characters .vc-role:visible').first();
                if (await card.count()) {
                    await card.click();
                    await page.waitForSelector('.vc-characters [data-action="back"]', { timeout: 8000 });
                    await record(page, viewport.width, theme, 'character-detail', bucket);
                    await page.locator('.vc-characters [data-action="back"]').click();
                } else notes.push(`${viewport.width} ${theme} character-detail：没有角色卡`);

                await go('memory');
                await page.waitForSelector('[data-vc-page="memory"]', { timeout: 15000 });
                await record(page, viewport.width, theme, 'memory-list', bucket);
                try {
                    await dismissSheet();
                    let memory = page.locator('[data-vc-page="memory"] [data-memory-id]:visible').first();
                    if (!(await memory.count())) {
                        const pick = page.locator('[data-vc-page="memory"] [data-action="pick-instance"]:visible');
                        if (await pick.count()) {
                            await dismissSheet();
                            await pick.click();
                            const total = await page.locator('.vc-menu button:visible').count();
                            for (let i = 0; i < total; i += 1) {
                                await removeSheets(page);
                                const picked = await page.evaluate((index) => {
                                    const buttons = [...document.querySelectorAll('.vc-menu button')].filter((el) => el.getClientRects().length > 0);
                                    const button = buttons[index];
                                    if (!button) return false;
                                    button.click();
                                    return true;
                                }, i);
                                if (!picked) break;
                                memory = page.locator('[data-vc-page="memory"] [data-memory-id]:visible').first();
                                await until(async () => (await memory.count()) > 0, 400);
                                if (await memory.count()) break;
                                if (i + 1 < total) await pick.click();
                            }
                        }
                    }
                    if (await memory.count()) {
                        await memory.click();
                        await page.waitForSelector('[data-vc-page="memory"] [data-action="back"], .vc-memory-title', { timeout: 8000 });
                        await record(page, viewport.width, theme, 'memory-detail', bucket);
                        const back = page.locator('[data-vc-page="memory"] [data-action="back"]');
                        if (await back.count()) await back.first().click();
                    } else notes.push(`${viewport.width} ${theme} memory-detail：没有记忆行`);
                } catch (error) {
                    if (String(error?.message || error).includes('残留浮层')) throw error;
                    notes.push(`${viewport.width} ${theme} memory-detail：${String(error?.message || error).split('\n')[0]}`);
                    await removeSheets(page);
                }

                await go('inbox');
                await page.waitForSelector('[data-vc-page="inbox"]', { timeout: 15000 });
                await record(page, viewport.width, theme, 'inbox', bucket);
                const channel = page.locator('[data-vc-page="inbox"] [data-action="open-channel"]:visible').first();
                if (await channel.count()) {
                    await channel.click();
                    await page.waitForSelector('[data-action="pop-channel"]', { timeout: 8000 });
                    await record(page, viewport.width, theme, 'inbox-channel', bucket);
                    await page.locator('[data-action="pop-channel"]').click();
                } else notes.push(`${viewport.width} ${theme} inbox-channel：没有渠道`);

                await storyLock(async () => {
                await go('story');
                await page.waitForSelector('.vc-story-tab', { timeout: 15000 });
                const storyView = await page.evaluate(() => document.querySelector('.vc-story-tab')?.dataset.view || '');
                if (storyView === 'stage') {
                    await record(page, viewport.width, theme, 'story-stage', bucket);
                    notes.push(`${viewport.width} ${theme} story-gate：这一局已经在舞台`);
                } else {
                    await record(page, viewport.width, theme, 'story-gate', bucket);
                    const start = page.locator('.vc-story-tab [data-action="start"]:visible, .vc-story-tab [data-action="enter"]:visible').first();
                    if (await start.count()) {
                        await start.click();
                        const staged = await page.waitForFunction(() => document.querySelector('.vc-story-tab')?.dataset.view === 'stage', null, { timeout: 12000 }).then(() => true).catch(() => false);
                        await record(page, viewport.width, theme, 'story-stage', bucket);
                        if (!staged) notes.push(`${viewport.width} ${theme} story-stage：开局后仍不是舞台`);
                    } else {
                        notes.push(`${viewport.width} ${theme} story-stage：没有开局按钮`);
                    }
                }
                });
                } catch (error) {
                    if (String(error?.message || error).includes('残留浮层')) throw error;
                    notes.push(`${viewport.width} ${theme}：${error.message || error}`);
                }
        }
        const groups = walkthroughGroups(selectedWidths());
        groups.forEach(() => buckets.push({ shots: [], notes: [] }));
        await Promise.all(groups.map(async (group, index) => {
            const bucket = buckets[index];
            if (index === 0) {
                try {
                    await captureGroup(page, bucket, group.theme, group.viewport);
                } finally {
                    await context.close();
                }
                return;
            }
            const groupContext = await browser.newContext({
                viewport: { width: group.viewport.width, height: group.viewport.height },
                storageState,
            });
            await pinVcUi(groupContext, 'on');
            await groupContext.addInitScript((mode) => {
                try { localStorage.setItem('vc-theme', mode); } catch { /* 主题在截图前再写一次 */ }
            }, group.theme);
            const groupPage = await groupContext.newPage();
            groupPage.setDefaultTimeout(8000);
            try {
                await groupPage.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
                await waitFor(async () => groupPage.evaluate(async () => (await import('/script.js')).settingsReady || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 60000, label: 'ST 设置或欢迎页' });
                const onboarding = groupPage.locator('dialog[open].popup').filter({ has: groupPage.locator('.onboarding') });
                if (await onboarding.count()) {
                    await chatLock(async () => {
                        if (!(await onboarding.count())) return;
                        await onboarding.locator('textarea').fill('vc-ui-walkthrough');
                        await onboarding.locator('.popup-button-ok').click();
                        await onboarding.waitFor({ state: 'hidden' });
                    });
                }
                await waitFor(async () => groupPage.evaluate(() => document.body.classList.contains('vc-ui') && document.querySelector('#vc-shell')), { timeoutMs: 60000, label: '外壳' });
                await chatLock(async () => {
                    await groupPage.evaluate(async ({ name, file }) => {
                        const native = await import('/script.js');
                        const index = native.characters.findIndex((item) => item.avatar === name);
                        if (index < 0) throw new Error('合成角色未加载');
                        await native.selectCharacterById(index);
                        await native.openCharacterChat(file);
                    }, { name: avatar, file: chatFile });
                    await waitFor(async () => groupPage.evaluate(() => Boolean(window.SillyTavern.getContext().chatMetadata?.vc_binding?.relationshipId)), { timeoutMs: 30000, label: '会话绑定' });
                });
                await captureGroup(groupPage, bucket, group.theme, group.viewport);
            } finally {
                await groupContext.close();
            }
        }));
        const shots = buckets.flatMap((bucket) => bucket.shots);
        notes.push(...buckets.flatMap((bucket) => bucket.notes));
        notes.push(...noteForIconSettleTimeouts(iconSettleTimeouts));
        writeIndex(dir, shots, notes);
        console.log(`WALKTHROUGH ${dir}`);
        console.log(`WALKTHROUGH_MS ${Date.now() - startedAt}`);
        console.log(`WALKTHROUGH_INDEX ${path.join(dir, 'index.html')}`);
        if (notes.length) console.log(`[vc-ui-walkthrough] notes\n${notes.join('\n')}`);
        return { dir, index: path.join(dir, 'index.html'), shots: shots.length, notes };
    } catch (error) {
        const shots = buckets.flatMap((bucket) => bucket.shots);
        const extra = buckets.flatMap((bucket) => bucket.notes);
        writeIndex(dir, shots, notes.concat(extra, noteForIconSettleTimeouts(iconSettleTimeouts), String(error.message || error)));
        console.log(`WALKTHROUGH ${dir}`);
        throw error;
    } finally {
        await browser.close();
    }
}

export const vcUiWalkthroughScene = {
    id: 'vc-ui-walkthrough',
    title: 'F5 新外观全站走查截图',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneVcUiWalkthrough,
};
export const scenes = [vcUiWalkthroughScene];
