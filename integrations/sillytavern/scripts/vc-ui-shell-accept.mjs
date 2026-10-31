// F1 外壳受管验收。默认不进场景集，只在 --filter vc-ui-shell 时运行。
// 合成角色与合成会话；不发真实消息，不记录凭据或对话正文。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { waitFor } from './managed-lib.mjs';
import { createShotBudget, keepSceneShot } from './lib/scene-shots.mjs';

const VIEWPORTS = [
    { name: '360', width: 360, height: 780 },
    { name: '390', width: 390, height: 844 },
    { name: '768', width: 768, height: 1024 },
    { name: '1024', width: 1024, height: 768 },
    { name: '1440', width: 1440, height: 900 },
];
const THEMES = ['light', 'dark'];
const TABS = [
    { name: 'characters', kind: 'page', root: '.vc-characters', dialog: '.vc-instance-dialog[open]' },
    { name: 'memory', kind: 'page', root: '[data-vc-page="memory"]', dialog: '.vc-memory-dialog[open]', owned: true },
    { name: 'inbox', kind: 'page', root: '[data-vc-page="inbox"]', dialog: '.vc-inbox-dialog[open]', owned: true },
    { name: 'story', kind: 'page', root: '.vc-story-tab', dialog: '.vc-story-dialog[open]' },
];

function secondStamp(value) {
    const parsed = Date.parse(String(value ?? '').trim().replace('@', ' '));
    if (Number.isNaN(parsed)) return '';
    try {
        return new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).format(new Date(parsed));
    } catch {
        return '';
    }
}

// 外壳只用创建时间的秒来区分同名、且没有最后消息的实例。前面的场景加载默认角色时，
// 欢迎会话和替换出来的新会话可能在同一秒各绑一条。这里只删掉这种无法区分的多余行，
// 创建时间不同的会话全部保留。
async function dropSameSecondTwins(ctx, keepIds = []) {
    const keep = new Set(keepIds.map((id) => String(id)).filter(Boolean));
    const listed = await ctx.admin.call('GET', '/api/v1/relationships');
    if (listed.status !== 200 || !Array.isArray(listed.json)) throw new Error(`列出会话 HTTP ${listed.status}`);
    const ids = [...String(listed.text || '').matchAll(/"relationshipId"\s*:\s*(\d+)/g)].map((match) => match[1]);
    if (ids.length !== listed.json.length) throw new Error('会话编号无法按原文读取');
    const groups = new Map();
    listed.json.forEach((row, index) => {
        if (row?.personaRef !== 'st-character') return;
        const name = String(row?.companionName || '未命名实例');
        const key = `${name}\n${secondStamp(row?.createdAt)}`;
        const list = groups.get(key) || [];
        list.push(ids[index]);
        groups.set(key, list);
    });
    for (const list of groups.values()) {
        const victims = list.some((id) => keep.has(id)) ? list.filter((id) => !keep.has(id)) : list.slice(1);
        for (const id of victims) {
            const removed = await ctx.admin.call('DELETE', `/api/v1/relationships/${id}`);
            if (removed.status !== 200) throw new Error(`清理同时创建的会话 HTTP ${removed.status}`);
        }
    }
}

// 原生模块迟迟未完成时，状态和恢复操作必须早于扩展可用。
async function assertStartup(ctx, browser, dir) {
    const bc = await browser.newContext();
    await bc.addCookies([
        { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
        { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
    ]);
    try {
        await Promise.all([390, 1440].flatMap((width) => THEMES.map(async (colorScheme) => {
            const page = await bc.newPage();
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
            await page.emulateMedia({ colorScheme });
            await page.route(`${ctx.w05.stBase}/script.js`, async (route) => {
                const response = await route.fetch();
                await route.fulfill({ response, body: `await new Promise(() => {});\n${await response.text()}` });
            }, { times: 1 });
            await page.goto(ctx.w05.stBase, { waitUntil: 'commit' });
            await page.getByRole('status').filter({ hasText: '正在打开聊天…' }).waitFor({ state: 'visible' });
            const reload = page.getByRole('link', { name: '重新加载', exact: true });
            if (await reload.isVisible()) throw new Error('首屏不应立即要求重新加载');
            await reload.waitFor({ state: 'visible', timeout: 25000 });
            const fit = await reload.evaluate((el) => {
                const r = el.getBoundingClientRect();
                return { height: r.height, shadow: getComputedStyle(el).textShadow, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
                    overflow: document.documentElement.scrollWidth - innerWidth };
            });
            if (fit.height < 44 || !fit.inside || fit.overflow > 1 || fit.shadow !== 'none') throw new Error(`载入恢复布局 ${width}/${colorScheme}: ${JSON.stringify(fit)}`);
            const file = path.join(dir, `startup-${width}-${colorScheme}.png`);
            await page.screenshot({ path: file }); ctx.screenshots.push(file);
            if (width === 390 && colorScheme === 'light') {
                await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }), reload.click()]);
                await waitFor(async () => page.evaluate(async () => (await import('/script.js')).settingsReady || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 45000, label: '重新加载后恢复宿主' });
                const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
                if (await onboarding.count()) {
                    await onboarding.locator('textarea').fill('vc-ui-owner');
                    await onboarding.locator('.popup-button-ok').click();
                    await onboarding.waitFor({ state: 'hidden' });
                }
                await page.locator('#preloader').waitFor({ state: 'hidden', timeout: 45000 });
                if (new URL(page.url()).pathname !== '/') throw new Error('重新加载不应要求重复登录');
            }
            await page.close();
        })));
    } finally { await bc.close(); }
}

export async function sceneVcUiShell(ctx) {
    const dir = path.join(ctx.artifactsDir, 'vc-ui-shell');
    fs.mkdirSync(dir, { recursive: true });
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        const granted = await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'vc-ui-shell', granted: true });
        if (granted.status !== 200) throw new Error(`授权 ${consentType} HTTP ${granted.status}`);
    }
    const cardName = `外壳 ${crypto.randomUUID().slice(0, 8)}`;
    const form = new FormData();
    form.append('file_type', 'json');
    form.append('avatar', new Blob([JSON.stringify({
        name: cardName, description: '合成外壳卡，只供本场验收。', first_mes: '合成开场。', personality: '', scenario: '', mes_example: '',
    })], { type: 'application/json' }), 'synthetic.json');
    const imported = await ctx.st.call('POST', '/api/characters/import', form);
    if (imported.status !== 200 || !imported.json?.file_name) throw new Error(`导入合成卡 HTTP ${imported.status}`);
    const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
    const chatFile = `vc-ui-shell-${crypto.randomUUID()}`;
    const chat = [{ user_name: 'unused', character_name: cardName, chat_metadata: { vc_f2: { id: crypto.randomUUID(), revision: 0 }, vc_binding: { mode: 'COMPANION' } } }];
    for (let i = 0; i < 36; i += 1) {
        const user = i % 2 === 1;
        chat.push({
            name: user ? 'owner' : cardName,
            is_user: user,
            mes: `合成第 ${i + 1} 行。${'占位'.repeat(24)}`,
            send_date: new Date(Date.now() - (36 - i) * 60000).toISOString(),
        });
    }
    const saved = await ctx.st.call('POST', '/api/chats/save', { avatar_url: avatar, file_name: chatFile, chat });
    if (saved.status !== 200) throw new Error(`保存聊天 HTTP ${saved.status}`);

    const secrets = [ctx.secrets.password, ctx.secrets.fixtureKey, ctx.secrets.session?.vcSession, ctx.secrets.session?.vcCsrf]
        .filter((item) => typeof item === 'string' && item.length > 0);
    const redact = (value) => {
        let text = String(value || '');
        for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
        return text.slice(0, 240);
    };

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}),
    });
    try {
        await assertStartup(ctx, browser, dir);
        const bc = await browser.newContext({ viewport: VIEWPORTS[1] });
        await bc.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
        ]);
        await bc.addInitScript(() => {
            localStorage.setItem('vc-ui', 'on');
            localStorage.setItem('vc-theme', 'light');
        });
        const page = await bc.newPage();
        page.setDefaultTimeout(120000);
        const consoleLines = [];
        page.on('pageerror', (error) => consoleLines.push(String(error.message || '').slice(0, 180)));
        page.on('console', (msg) => { if (msg.type() === 'error') consoleLines.push(msg.text().slice(0, 180)); });
        const shotBudget = createShotBudget();
        const shot = async (name) => {
            if (!keepSceneShot(shotBudget, name)) return;
            await page.waitForFunction(() => {
                const shell = document.querySelector('#vc-shell');
                if (!shell) return false;
                if (shell.querySelector('.is-push, .is-pop')) return false;
                const layer = document.querySelector('#vc-fly-layer');
                if (layer && layer.childElementCount > 0) return false;
                const running = typeof shell.getAnimations === 'function' && shell.getAnimations({ subtree: true })
                    .some((anim) => anim.playState === 'running' || anim.playState === 'pending');
                if (running) return false;
                if (shell.dataset.chrome === 'tabbar') {
                    const tab = shell.querySelector('.vc-tabbar');
                    if (!tab) return false;
                    const opacity = Number(getComputedStyle(tab).opacity);
                    const hidden = tab.classList.contains('is-hidden');
                    if (hidden && opacity > 0.05) return false;
                    if (!hidden && opacity < 0.95) return false;
                    if (shell.dataset.chat === 'open') {
                        const chat = shell.querySelector('.vc-shell-chat');
                        const rect = chat?.getBoundingClientRect();
                        if (!rect || getComputedStyle(chat).transform !== 'none') return false;
                        if (rect.left > 1 || rect.right < window.innerWidth - 1) return false;
                    }
                }
                return true;
            }, null, { timeout: 8000 });
            await page.evaluate(() => new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            }));
            const file = path.join(dir, name);
            await page.screenshot({ path: file });
            ctx.screenshots.push(file);
        };
        const assertChatFit = async (viewport) => {
            const fit = await page.evaluate(() => {
                const shell = document.querySelector('#vc-shell');
                const doc = document.documentElement;
                const box = (el) => {
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: Math.round(r.x), w: Math.round(r.width), r: Math.round(r.right) };
                };
                const mes = [...document.querySelectorAll('.vc-shell-chat-body .mes')].slice(0, 12)
                    .map((el) => Math.round(el.getBoundingClientRect().right));
                const offenders = [];
                const seen = new Set();
                for (const el of document.body.querySelectorAll('*')) {
                    if (offenders.length >= 8) break;
                    const r = el.getBoundingClientRect();
                    if (r.width < 1 || r.right <= window.innerWidth + 1 && r.left >= -1) continue;
                    const id = el.id ? `#${el.id}` : '';
                    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 3).join('.') : '';
                    const key = `${el.tagName}${id}.${cls}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    offenders.push({ key, x: Math.round(r.x), w: Math.round(r.width), r: Math.round(r.right) });
                }
                return {
                    side: box(shell?.querySelector(':scope > .vc-sidebar')),
                    list: box(shell?.querySelector('.vc-shell-pages')),
                    chatCol: box(shell?.querySelector('.vc-shell-chat')),
                    sheld: box(document.querySelector('.vc-shell-chat-body #sheld')),
                    overflow: Math.max(doc.scrollWidth - doc.clientWidth, document.body.scrollWidth - document.body.clientWidth),
                    mesRight: mes.length ? Math.max(...mes) : 0,
                    inner: window.innerWidth,
                    sidebarVar: getComputedStyle(document.documentElement).getPropertyValue('--vc-sidebar').trim(),
                    listState: shell?.dataset.list || '',
                    back: (() => {
                        const el = shell?.querySelector('[data-back]');
                        if (!el) return false;
                        const style = getComputedStyle(el);
                        return style.display !== 'none' && el.getClientRects().length > 0;
                    })(),
                    offenders,
                };
            });
            if (fit.overflow > 1) throw new Error(`横向溢出 ${fit.overflow} ${JSON.stringify(fit)}`);
            if (fit.mesRight > fit.inner + 1) throw new Error(`消息超出视口 ${fit.mesRight}>${fit.inner}`);
            if (fit.sheld && fit.sheld.r > fit.inner + 1) throw new Error(`对话超出视口 ${JSON.stringify(fit.sheld)}`);
            if (viewport.width >= 1180) {
                if (!fit.side || Math.abs(fit.side.w - 240) > 8) throw new Error(`侧边栏宽度 ${fit.side?.w}`);
                if (!fit.list || Math.abs(fit.list.w - 320) > 8) throw new Error(`列表宽度 ${fit.list?.w}`);
                if (!fit.chatCol || Math.abs(fit.chatCol.x - 560) > 16) throw new Error(`对话区起点 ${JSON.stringify(fit.chatCol)}`);
                if (!fit.chatCol || fit.chatCol.w < 700) throw new Error(`对话区过窄 ${fit.chatCol?.w}`);
                if (!fit.sheld || fit.sheld.w < 480 || fit.sheld.w > 724) throw new Error(`阅读列 ${fit.sheld?.w}`);
                if (fit.sidebarVar !== '240px') throw new Error(`--vc-sidebar ${fit.sidebarVar}`);
            } else if (viewport.width >= 744) {
                const sheldMin = Math.min(720, viewport.width - 72) - 24;
                if (!fit.side || Math.abs(fit.side.w - 72) > 8) throw new Error(`中等侧边栏 ${fit.side?.w}`);
                if (fit.list && fit.list.w > 8) throw new Error(`打开会话后列表仍占宽 ${JSON.stringify(fit.list)}`);
                if (!fit.chatCol || Math.abs(fit.chatCol.x - 72) > 16) throw new Error(`中等对话起点 ${JSON.stringify(fit.chatCol)}`);
                if (!fit.chatCol || fit.chatCol.w < viewport.width - 96) throw new Error(`中等对话区 ${JSON.stringify(fit.chatCol)}`);
                if (!fit.sheld || fit.sheld.w < sheldMin || fit.sheld.w > 724) throw new Error(`中等阅读列 ${JSON.stringify(fit.sheld)}`);
                if (fit.sidebarVar !== '72px') throw new Error(`中等 --vc-sidebar ${fit.sidebarVar}`);
                if (fit.listState !== 'hidden') throw new Error(`中等列表未收起 ${fit.listState}`);
                if (!fit.back) throw new Error('中等宽度打开会话后没有返回列表按钮');
            } else {
                if (!fit.sheld || fit.sheld.w < viewport.width - 24) throw new Error(`手机对话宽度 ${JSON.stringify(fit.sheld)}`);
                if (fit.sidebarVar !== '0px') throw new Error(`手机 --vc-sidebar ${fit.sidebarVar}`);
            }
        };
        const fail = async (error) => {
            try { await shot('failure.png'); } catch { /* 截图失败不掩盖原错误 */ }
            const state = await page.evaluate(() => {
                const shell = document.querySelector('#vc-shell'), chat = document.querySelector('#chat');
                return { width: innerWidth, theme: document.documentElement.getAttribute('data-vc-theme'),
                    destination: shell?.dataset.destination, chat: shell?.dataset.chat,
                    messageCount: window.SillyTavern?.getContext?.()?.chat?.length,
                    renderedMessages: chat?.querySelectorAll(':scope > .mes').length,
                    chatHeight: chat?.clientHeight, scrollHeight: chat?.scrollHeight };
            }).catch(() => ({ unavailable: true }));
            throw new Error(`${error.message} state=${JSON.stringify(state)} consoleErrors=${consoleLines.length}`);
        };
        const closeOpen = async (selector, action) => {
            const open = page.locator(selector);
            if (!(await open.count())) return;
            await open.locator(action).first().click();
            await open.first().waitFor({ state: 'hidden' });
        };
        const closeDrawer = async () => {
            const open = await page.evaluate(() => document.querySelector('#left-nav-panel')?.classList.contains('openDrawer') === true);
            if (!open) return;
            await page.evaluate(() => document.querySelector('#ai-config-button .drawer-toggle')?.click());
            await page.waitForFunction(() => document.querySelector('#left-nav-panel')?.classList.contains('openDrawer') !== true);
        };
        const closeChrome = async () => {
            await closeDrawer();
            for (const tab of TABS) {
                if (tab.kind === 'dialog') await closeOpen(tab.selector, tab.action);
            }
            await closeOpen('.vc-data-dialog[open]', '[data-close]');
            await closeOpen('.vcms-overlay:not([hidden])', '[data-action="close"]');
            if (await page.locator('.vc-sheet').count()) {
                await page.locator('.vc-sheet-done').click();
                await page.locator('.vc-sheet').waitFor({ state: 'detached' });
            }
            const settingsPage = await page.evaluate(() => document.querySelector('#vc-shell')?.dataset.settings === 'page');
            if (settingsPage) await page.locator('#vc-shell [data-settings-done]:visible').click();
        };
        try {
            await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
            await waitFor(async () => page.evaluate(async () => (await import('/script.js')).settingsReady || Boolean(document.querySelector('dialog[open] .onboarding'))), { timeoutMs: 60000, label: 'ST 设置或欢迎页' });
            const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
            if (await onboarding.count()) {
                await onboarding.locator('textarea').fill('vc-ui-owner');
                await onboarding.locator('.popup-button-ok').click();
                await onboarding.waitFor({ state: 'hidden' });
            }
            await waitFor(async () => page.evaluate(() => document.body.classList.contains('vc-ui') && document.querySelector('#vc-shell') && document.querySelector('#send_textarea')), { timeoutMs: 60000, label: '外壳' });
            await waitFor(async () => page.evaluate((name) => window.SillyTavern.getContext().characters.some((item) => item.avatar === name), avatar), { timeoutMs: 30000, label: '合成角色出现' });
            await page.evaluate(async ({ name, file }) => {
                const native = await import('/script.js');
                const index = native.characters.findIndex((item) => item.avatar === name);
                if (index < 0) throw new Error('合成角色未加载');
                await native.selectCharacterById(index);
                await native.openCharacterChat(file);
            }, { name: avatar, file: chatFile });
            await waitFor(async () => page.evaluate(() => {
                const binding = window.SillyTavern.getContext().chatMetadata?.vc_binding;
                return Boolean(binding?.relationshipId) && Boolean(document.querySelector('#vc-shell .vc-convo'));
            }), { timeoutMs: 30000, label: '会话行' });
            const boundNow = await page.evaluate(() => String(window.SillyTavern.getContext().chatMetadata?.vc_binding?.relationshipId || ''));
            const cardRef = await page.evaluate(() => window.SillyTavern.getContext().chatMetadata.vc_binding.characterRef);
            const relationships = await ctx.admin.call('GET', '/api/v1/relationships');
            if (relationships.status !== 200 || relationships.json.find((row) => String(row.relationshipId) === boundNow)?.characterRef !== cardRef) {
                throw new Error('关系接口缺少持久化的角色卡归属');
            }
            await dropSameSecondTwins(ctx, [boundNow]);
            await new Promise((resolve) => setTimeout(resolve, 800));
            await page.evaluate(() => {
                const context = window.SillyTavern.getContext();
                context.eventSource.emit(context.eventTypes.CHAT_CHANGED);
            });
            await waitFor(async () => {
                const labels = await page.evaluate(() => [...document.querySelectorAll('#vc-shell .vc-convo')].map((el) => el.getAttribute('aria-label') || ''));
                const dupes = labels.filter((label, index) => labels.indexOf(label) !== index);
                return labels.length > 0 && dupes.length === 0;
            }, { timeoutMs: 10000, label: '去掉同时创建的重复会话' });

            for (const theme of THEMES) {
                await page.evaluate((mode) => {
                    localStorage.setItem('vc-theme', mode);
                    document.documentElement.setAttribute('data-vc-theme', mode);
                }, theme);
                for (const viewport of VIEWPORTS) {
                    console.log(`[vc-ui-shell] ${theme} ${viewport.name}`);
                    await closeChrome();
                    await page.setViewportSize({ width: viewport.width, height: viewport.height });
                    await page.waitForFunction((width) => {
                        const shell = document.querySelector('#vc-shell');
                        return shell && shell.dataset.chrome === (width < 744 ? 'tabbar' : 'sidebar');
                    }, viewport.width);
                    const nav = await page.evaluate(() => [...new Set([...document.querySelectorAll('#vc-shell [data-nav]')].map((el) => el.getAttribute('data-nav')))].sort());
                    if (nav.join(',') !== 'characters,chat,inbox,memory,story') throw new Error(`data-nav ${nav.join(',')}`);
                    const hiddenOld = await page.evaluate(() => {
                        const old = document.querySelector('#vc-chat-nav');
                        return Boolean(old) && getComputedStyle(old).pointerEvents === 'none'
                            && old.inert && old.getAttribute('aria-hidden') === 'true';
                    });
                    if (!hiddenOld) throw new Error('旧导航未同时退出视觉、键盘与辅助技术导航');
                    await page.setViewportSize({ width: 390, height: 844 });
                    await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.chrome === 'tabbar');
                    if (await page.evaluate(() => document.querySelector('#vc-shell')?.dataset.chat === 'open')) {
                        await page.locator('#vc-shell [data-back]:visible').click();
                        await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.chat === 'closed' && !document.querySelector('#vc-shell .is-pop'));
                    }
                    await page.setViewportSize({ width: viewport.width, height: viewport.height });
                    await page.waitForFunction((width) => {
                        const shell = document.querySelector('#vc-shell');
                        return shell && shell.dataset.chrome === (width < 744 ? 'tabbar' : 'sidebar') && shell.dataset.chat === 'closed';
                    }, viewport.width);
                    await page.locator('#vc-shell [data-nav="chat"]:visible').click();
                    if (viewport.width >= 744) {
                        const empty = await page.evaluate(() => {
                            const el = document.querySelector('#vc-shell .vc-chat-empty');
                            return Boolean(el) && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
                        });
                        if (!empty) throw new Error('未选会话时对话区没有空状态');
                    }
                    if (viewport.width >= 744 && viewport.width < 1180) {
                        const closed = await page.evaluate(() => {
                            const shell = document.querySelector('#vc-shell');
                            const box = (el) => {
                                if (!el) return null;
                                const r = el.getBoundingClientRect();
                                return { x: Math.round(r.x), w: Math.round(r.width) };
                            };
                            const back = shell?.querySelector('[data-back]');
                            const backStyle = back ? getComputedStyle(back) : null;
                            return {
                                side: box(shell?.querySelector(':scope > .vc-sidebar')),
                                list: box(shell?.querySelector('.vc-shell-pages')),
                                chatCol: box(shell?.querySelector('.vc-shell-chat')),
                                sidebarVar: getComputedStyle(document.documentElement).getPropertyValue('--vc-sidebar').trim(),
                                collapsed: shell?.querySelector(':scope > .vc-sidebar')?.classList.contains('is-collapsed') === true,
                                listState: shell?.dataset.list || '',
                                back: Boolean(backStyle && backStyle.display !== 'none' && back.getClientRects().length > 0),
                                who: Boolean(shell?.querySelector('.vc-shell-chat .vc-who-slot') && getComputedStyle(shell.querySelector('.vc-shell-chat .vc-who-slot')).display !== 'none' && shell.querySelector('.vc-shell-chat .vc-who-slot').getClientRects().length > 0),
                                memory: Boolean(shell?.querySelector('.vc-shell-chat [data-memory]') && getComputedStyle(shell.querySelector('.vc-shell-chat [data-memory]')).display !== 'none' && shell.querySelector('.vc-shell-chat [data-memory]').getClientRects().length > 0),
                                more: Boolean(shell?.querySelector('.vc-shell-chat [data-more]') && getComputedStyle(shell.querySelector('.vc-shell-chat [data-more]')).display !== 'none' && shell.querySelector('.vc-shell-chat [data-more]').getClientRects().length > 0),
                            };
                        });
                        if (!closed.collapsed) throw new Error(`中等宽度侧边栏默认应收起 ${JSON.stringify(closed)}`);
                        if (!closed.side || Math.abs(closed.side.w - 72) > 8) throw new Error(`未开会话侧边栏 ${closed.side?.w}`);
                        if (!closed.list || Math.abs(closed.list.w - 320) > 12) throw new Error(`未开会话列表 ${JSON.stringify(closed.list)}`);
                        if (!closed.chatCol || closed.chatCol.w < 240) throw new Error(`未开会话对话区 ${JSON.stringify(closed.chatCol)}`);
                        if (closed.sidebarVar !== '72px') throw new Error(`未开会话 --vc-sidebar ${closed.sidebarVar}`);
                        if (closed.listState !== 'open') throw new Error(`未开会话列表未展开 ${closed.listState}`);
                        if (closed.back) throw new Error('未开会话不应显示返回列表按钮');
                        if (closed.who || closed.memory || closed.more) throw new Error(`未开会话仍显示身份或会话操作 ${JSON.stringify({ who: closed.who, memory: closed.memory, more: closed.more })}`);
                    }
                    const convoState = await page.evaluate((cardName) => [...document.querySelectorAll('#vc-shell .vc-convo')].map((el) => ({
                        label: el.getAttribute('aria-label') || '',
                        img: Boolean(el.querySelector('img')),
                        text: el.innerText || '',
                        named: (el.getAttribute('aria-label') || '').includes(cardName),
                    })), cardName);
                    const labels = convoState.map((item) => item.label);
                    const dupes = labels.filter((label, index) => labels.indexOf(label) !== index);
                    if (dupes.length) throw new Error(`会话无法区分 ${dupes.join(' | ')}`);
                    if (convoState.some((item) => item.named && !item.img)) throw new Error('角色卡头像未用上');
                    await shot(`${theme}-${viewport.name}-list.png`);

                    const boundId = boundNow;
                    const boundRow = page.locator(`#vc-shell .vc-convo[data-relationship-id="${boundId}"]`);
                    if (!(await boundRow.count())) {
                        const ids = await page.evaluate(() => [...document.querySelectorAll('#vc-shell .vc-convo')].map((el) => el.getAttribute('data-relationship-id')));
                        throw new Error(`当前绑定 ${boundId} 不在会话列表 ${ids.join(',')}`);
                    }
                    await boundRow.click();
                    try {
                        await page.waitForFunction(() => {
                            const shell = document.querySelector('#vc-shell');
                            const layer = document.querySelector('#vc-fly-layer');
                            return shell?.dataset.chat === 'open'
                                && !shell.querySelector('.is-push, .is-pop')
                                && !(layer && layer.childElementCount > 0);
                        }, null, { timeout: 8000 });
                    } catch (error) {
                        const state = await page.evaluate(() => {
                            const shell = document.querySelector('#vc-shell');
                            const ctx = window.SillyTavern?.getContext?.() || {};
                            const row = document.querySelector('#vc-shell .vc-convo');
                            return {
                                openState: shell?.dataset.openState || '',
                                chat: shell?.dataset.chat || '',
                                chrome: shell?.dataset.chrome || '',
                                width: window.innerWidth,
                                characterId: ctx.characterId ?? null,
                                chatId: ctx.chatId || '',
                                binding: ctx.chatMetadata?.vc_binding?.relationshipId || '',
                                row: row?.getAttribute('data-relationship-id') || '',
                                sheldInChat: Boolean(document.querySelector('.vc-shell-chat-body #sheld')),
                            };
                        });
                        throw new Error(`未进入对话 ${JSON.stringify(state)} (${error.name})`);
                    }
                    await page.waitForFunction(({ id, file }) => {
                        const context = window.SillyTavern.getContext();
                        return String(context.chatMetadata?.vc_binding?.relationshipId || '') === id
                            && context.chatId === file && context.chat.length === 36
                            && Boolean(document.querySelector('#chat > .mes[mesid="35"]'));
                    }, { id: boundNow, file: chatFile }, { timeout: 15000 });
                    await assertChatFit(viewport);
                    await page.locator('.vc-shell-chat-body #send_textarea').focus();
                    const focused = await page.evaluate(() => document.activeElement?.id === 'send_textarea' && Boolean(document.activeElement.closest('.vc-shell-chat-body')));
                    if (!focused) throw new Error('对话页里的输入框未能聚焦');
                    const scrolled = await page.evaluate(() => {
                        const chat = document.querySelector('.vc-shell-chat-body #chat');
                        if (!chat) return { ok: false, overflow: -1 };
                        const overflow = chat.scrollHeight - chat.clientHeight;
                        const before = chat.scrollTop;
                        chat.scrollTop = before > 20 ? 0 : Math.min(240, chat.scrollHeight);
                        return { ok: overflow > 8 && chat.scrollTop !== before, overflow: Math.round(overflow) };
                    });
                    if (!scrolled.ok) throw new Error(`#chat 未能滚动 overflow=${scrolled.overflow}`);
                    await shot(`${theme}-${viewport.name}-chat.png`);
                    if (viewport.width < 744) {
                        await page.locator('#vc-shell [data-back]:visible').click();
                        await page.waitForFunction(() => {
                            const shell = document.querySelector('#vc-shell');
                            const tab = shell?.querySelector('.vc-tabbar');
                            return shell?.dataset.chat === 'closed' && tab && !tab.classList.contains('is-hidden') && getComputedStyle(tab).display !== 'none';
                        });
                    }

                    await page.locator('#vc-shell [data-settings]:visible').first().click();
                    if (viewport.width < 744) await page.locator('.vc-sheet').waitFor();
                    else await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.settings === 'page');
                    await shot(`${theme}-${viewport.name}-settings.png`);
                    const settingsRoot = viewport.width < 744 ? page.locator('.vc-sheet') : page.locator('#vc-shell .vc-settings-form');
                    const tavern = settingsRoot.locator('button', { hasText: 'AI 回复配置' });
                    await tavern.evaluate((el) => {
                        el.scrollIntoView({ block: 'center', inline: 'nearest' });
                        el.click();
                    });
                    try {
                        await page.waitForFunction(() => {
                            const open = document.querySelector('#left-nav-panel')?.classList.contains('openDrawer') === true;
                            const sheet = [...document.querySelectorAll('.vc-sheet')].some((el) => el.getClientRects().length > 0);
                            const pageOn = document.querySelector('#vc-shell')?.dataset.settings === 'page';
                            return open && !sheet && !pageOn;
                        }, null, { timeout: 8000 });
                    } catch (error) {
                        const state = await page.evaluate(() => ({
                            panel: document.querySelector('#left-nav-panel')?.className || '',
                            settings: document.querySelector('#vc-shell')?.dataset.settings || '',
                            sheet: [...document.querySelectorAll('.vc-sheet')].map((el) => el.getClientRects().length).join(','),
                        }));
                        throw new Error(`抽屉未保持打开 ${JSON.stringify(state)} (${error.name})`);
                    }
                    await shot(`${theme}-${viewport.name}-drawer.png`);
                    await closeDrawer();

                    for (const tab of TABS) {
                        const detail = '#vc-shell .vc-shell-page.is-on :is(.vc-characters,.vc-memory-tab,.vc-inbox-tab).is-detail';
                        const detailBack = page.locator(`${detail} [data-action="back"]:visible`).first();
                        if (await detailBack.count()) {
                            await detailBack.click();
                            await page.waitForFunction(() => !document.querySelector('#vc-shell .vc-shell-page.is-on :is(.vc-characters,.vc-memory-tab,.vc-inbox-tab).is-detail'));
                        }
                        await page.locator(`#vc-shell [data-nav="${tab.name}"]:visible`).click();
                        if (tab.kind === 'dialog') {
                            await page.locator(tab.selector).waitFor();
                            await shot(`${theme}-${viewport.name}-tab-${tab.name}.png`);
                            await closeOpen(tab.selector, tab.action);
                            continue;
                        }
                        try {
                            await page.waitForFunction(({ root, dialog, owned }) => {
                                const host = document.querySelector(`#vc-shell ${root}`);
                                const titles = [...document.querySelectorAll('#vc-shell .vc-shell-page.is-on .vc-large-title')].filter((el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0);
                                const ownedOk = !owned || titles.some((el) => el.hasAttribute('data-vc-owned-title'));
                                return Boolean(host) && !document.querySelector(dialog) && titles.length === 1 && ownedOk;
                            }, { root: tab.root, dialog: tab.dialog, owned: tab.owned === true }, { timeout: 15000 });
                        } catch (error) {
                            const state = await page.evaluate(({ root, dialog }) => ({
                                page: Boolean(document.querySelector(`#vc-shell ${root}`)),
                                dialog: Boolean(document.querySelector(dialog)),
                                titles: [...document.querySelectorAll('#vc-shell .vc-shell-page.is-on .vc-large-title')].map((el) => ({
                                    owned: el.hasAttribute('data-vc-owned-title'),
                                    display: getComputedStyle(el).display,
                                })),
                            }), { root: tab.root, dialog: tab.dialog });
                            throw new Error(`${tab.name} 未换成新页面 ${JSON.stringify(state)} (${error.name})`);
                        }
                        await shot(`${theme}-${viewport.name}-tab-${tab.name}.png`);
                        if (tab.name === 'characters' && theme === 'light' && viewport.name === '1440') {
                            await page.waitForFunction(() => {
                                const root = document.querySelector('#vc-shell .vc-characters');
                                return root && !root.querySelector('[aria-busy="true"]') && root.querySelector('[data-action="select-template"]');
                            }, null, { timeout: 15000 });
                            const found = await page.evaluate((name) => {
                                const buttons = [...document.querySelectorAll('#vc-shell .vc-characters [data-action="select-template"]')];
                                const card = buttons.find((el) => (el.textContent || '').includes(name));
                                if (!card) return false;
                                const count = [...card.querySelectorAll(':scope > span')].map((el) => (el.textContent || '').trim()).find((text) => text.endsWith('个实例'));
                                if (!count || count.startsWith('0')) return false;
                                card.scrollIntoView({ block: 'center', inline: 'nearest' });
                                card.click();
                                return true;
                            }, cardName);
                            if (!found) {
                                const details = await page.evaluate((name) => {
                                    const card = [...document.querySelectorAll('#vc-shell .vc-characters [data-action="select-template"]')].find((el) => el.textContent.includes(name));
                                    return { cardFound: Boolean(card), cardRef: card?.getAttribute('data-ref'),
                                        count: card?.querySelector(':scope > span:last-child')?.textContent,
                                        loading: Boolean(document.querySelector('.vc-characters [aria-busy="true"]')) };
                                }, cardName);
                                const currentRows = await ctx.admin.call('GET', '/api/v1/relationships');
                                details.boundExists = currentRows.json?.some((row) => String(row.relationshipId) === boundNow);
                                details.matchesCard = currentRows.json?.filter((row) => row.characterRef === details.cardRef).length;
                                throw new Error(`本场合成卡没有可进入的实例 ${JSON.stringify(details)}`);
                            }
                            const instance = page.locator(`#vc-shell .vc-characters > .vc-screen:not(.vc-characters-list) [data-action="select-instance"][data-id="${boundNow}"]`);
                            await instance.waitFor({ timeout: 15000 });
                            const relationshipId = await instance.getAttribute('data-id');
                            await instance.click();
                            try {
                                await page.waitForFunction((id) => {
                                    const shell = document.querySelector('#vc-shell');
                                    const binding = String(window.SillyTavern.getContext().chatMetadata?.vc_binding?.relationshipId || '');
                                    return shell?.dataset.destination === 'chat' && shell?.dataset.chat === 'open' && binding === id;
                                }, relationshipId, { timeout: 15000 });
                            } catch (error) {
                                const state = await page.evaluate(() => ({
                                    destination: document.querySelector('#vc-shell')?.dataset.destination || '',
                                    chat: document.querySelector('#vc-shell')?.dataset.chat || '',
                                    binding: String(window.SillyTavern.getContext().chatMetadata?.vc_binding?.relationshipId || ''),
                                }));
                                throw new Error(`角色详情实例未进入对话 ${JSON.stringify(state)} (${error.name})`);
                            }
                        }
                    }
                }
            }
            const leaked = await page.evaluate((needles) => {
                const surface = document.body.innerText || '';
                return needles.some((item) => item && surface.includes(item));
            }, secrets);
            if (leaked) throw new Error('页面正文含凭据');
        } catch (error) {
            await fail(error);
        }
    } finally {
        await browser.close();
    }
}

export const vcUiShellScene = {
    id: 'vc-ui-shell',
    title: 'F1 外壳：导航、会话列表、对话页与设置',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneVcUiShell,
};
export const scenes = [vcUiShellScene];
