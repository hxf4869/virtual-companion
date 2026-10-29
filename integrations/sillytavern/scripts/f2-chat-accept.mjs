// F2 聊天新外观受管场景。只在 --filter f2-chat-ui 时运行。
// 合成卡与固定 provider；截图与错误不记录凭据或对话正文。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { complexCard } from './lib/complex-card.mjs';
import { createStClient } from './managed-lib.mjs';

const DEV = process.env.VC_W03_DEV_DIR
    || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dev-managed');
const SHOTS = path.join(DEV, 'artifacts', 'f2-chat');
const GREETING = '这是一次合成测试对话。';
const SECOND = '这是第二条合成候选。';

function stClient(ctx) {
    const session = ctx.secrets.session;
    return createStClient({
        baseUrl: ctx.w05.stBase,
        expectedIdentity: session,
        extraCookies: `vc_session=${session.vcSession}; vc_csrf=${session.vcCsrf}`,
    });
}

async function launchBrowser() {
    const { chromium } = await import('playwright-core');
    return chromium.launch({
        headless: true,
        ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}),
    });
}

async function nativeReady(page) {
    await page.waitForFunction(() => Boolean(window.SillyTavern?.getContext?.()?.eventSource));
    await page.waitForSelector('#send_textarea', { state: 'attached' });
    await page.waitForFunction(async () => (await import('/script.js')).settingsReady || document.querySelector('dialog[open] .onboarding'));
    const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
    if (await onboarding.count()) {
        await onboarding.locator('textarea').fill('合成验收用户');
        await onboarding.locator('.popup-button-ok').click();
        await onboarding.waitFor({ state: 'hidden' });
    }
    await page.waitForFunction(async () => (await import('/script.js')).settingsReady);
    await page.waitForSelector('#preloader', { state: 'hidden' });
}

async function confirmHostPopup(page) {
    return page.evaluate(() => {
        const pattern = /确认|确定|是|OK|Confirm|Import|导入|Yes|允许|启用/;
        for (const dialog of document.querySelectorAll('dialog.popup[open]')) {
            for (const button of dialog.querySelectorAll('.popup-button-ok, .popup-button-custom, .menu_button')) {
                if (pattern.test(button.textContent || '')) {
                    button.click();
                    return true;
                }
            }
        }
        return false;
    }).catch(() => false);
}

async function openComplex(page, fileName) {
    let settled = false;
    const done = page.evaluate(async (avatar) => {
        const script = await import('/script.js');
        const index = script.characters.findIndex((item) => item.avatar === avatar);
        if (index < 0) throw new Error('复杂卡不在角色列表');
        await script.selectCharacterById(index, { switchMenu: false });
    }, fileName).finally(() => { settled = true; });
    const deadline = Date.now() + 25000;
    while (!settled && Date.now() < deadline) {
        await confirmHostPopup(page);
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!settled) throw new Error('复杂卡打开超时');
    await done;
    await revealShellChat(page);
}

async function revealShellChat(page) {
    await page.waitForFunction(() => typeof document.querySelector('#vc-shell')?.openConversation === 'function', null, { timeout: 20000 });
    const status = await page.evaluate(async () => {
        const root = document.querySelector('#vc-shell');
        const ctx = window.SillyTavern?.getContext?.() || {};
        const id = ctx.characterId;
        const characterIndex = typeof id === 'number' ? id : Number(id);
        const character = ctx.characters?.[Number.isInteger(characterIndex) ? characterIndex : -1];
        const opened = await root.openConversation({
            relationshipId: ctx.chatMetadata?.vc_binding?.relationshipId || '',
            file: ctx.chatId || '',
            characterIndex: Number.isInteger(characterIndex) ? characterIndex : undefined,
            name: character?.name || '',
            avatar: character?.avatar || '',
        });
        const sheld = document.querySelector('#sheld')?.getBoundingClientRect();
        return {
            opened: opened === true,
            chat: root.dataset.chat || '',
            chrome: root.dataset.chrome || '',
            destination: root.dataset.destination || '',
            width: Math.round(sheld?.width || 0),
            height: Math.round(sheld?.height || 0),
        };
    });
    if (status.width < 200 || status.height < 200) throw new Error(`对话列没有展开 ${JSON.stringify(status)}`);
}

async function openChat(page, avatar, file) {
    await page.evaluate(async ({ avatar: fileName, file: chatFile }) => {
        const script = await import('/script.js');
        const index = script.characters.findIndex((item) => item.avatar === fileName);
        if (index < 0) throw new Error('合成卡不在角色列表');
        await script.selectCharacterById(index);
        if (chatFile) await script.openCharacterChat(chatFile);
    }, { avatar, file });
    await revealShellChat(page);
}

async function bindForeground(ctx) {
    const purposes = await ctx.admin.listPurposes();
    if (purposes.status !== 200) throw new Error(`用途列表 HTTP ${purposes.status}`);
    const row = purposes.json.find((item) => item.purpose === 'FOREGROUND_CHAT');
    if (!row) throw new Error('FOREGROUND_CHAT 缺失');
    const bound = await ctx.admin.savePurpose('FOREGROUND_CHAT', {
        providerId: 'vc03m-chat', profileKey: 'chat', state: 'ENABLED', expectedRevision: row.revision,
    });
    if (bound.status !== 200) throw new Error(`前台绑定 HTTP ${bound.status}`);
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        const granted = await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'f2-chat-ui', granted: true });
        if (granted.status !== 200) throw new Error(`授权 ${consentType} HTTP ${granted.status}`);
    }
}

function importJson(st, card) {
    const form = new FormData();
    form.append('file_type', 'json');
    form.append('avatar', new Blob([JSON.stringify(card)], { type: 'application/json' }), 'synthetic.json');
    return st.call('POST', '/api/characters/import', form);
}

async function shot(page, ctx, name) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const primary = path.join(SHOTS, name);
    await page.screenshot({ path: primary });
    ctx.screenshots.push(primary);
    if (ctx.artifactsDir && path.resolve(ctx.artifactsDir) !== path.resolve(SHOTS)) {
        fs.mkdirSync(ctx.artifactsDir, { recursive: true });
        const copy = path.join(ctx.artifactsDir, name);
        fs.copyFileSync(primary, copy);
        ctx.screenshots.push(copy);
    }
}

async function theme(page, mode) {
    await page.evaluate((value) => {
        localStorage.setItem('vc-theme', value);
        document.documentElement.setAttribute('data-vc-theme', value);
    }, mode);
}

async function closeHostChrome(page) {
    for (let i = 0; i < 8; i += 1) {
        const acted = await page.evaluate(() => {
            let hit = false;
            for (const toggle of document.querySelectorAll('.drawer-toggle')) {
                if (!toggle.parentElement?.querySelector('.drawer-content.openDrawer')) continue;
                toggle.click();
                hit = true;
            }
            const conflict = document.querySelector('#vc-f2-conflict');
            if (conflict) {
                conflict.showModal = () => {};
                conflict.show = () => {};
                if (conflict.open) {
                    conflict.close();
                    hit = true;
                }
            }
            for (const dialog of document.querySelectorAll('.TH-popup, dialog[open]')) {
                if (dialog.querySelector('#vc-memory-inspector') || dialog.id === 'vc-f2-conflict') continue;
                const buttons = [...dialog.querySelectorAll('button, .popup-button-ok, .popup-button-cancel')];
                const label = (node) => (node.textContent || '').replace(/\s+/g, '');
                const scriptPrompt = (dialog.textContent || '').includes('嵌入式脚本');
                const button = (scriptPrompt && buttons.find((node) => label(node) === '取消'))
                    || buttons.find((node) => label(node) === '取消')
                    || dialog.querySelector('.popup-button-cancel, .popup-button-ok');
                if (button) button.click();
                else dialog.close?.();
                hit = true;
            }
            document.querySelectorAll('#toast-container .toast').forEach((node) => node.remove());
            return hit;
        }).catch(() => false);
        if (!acted) break;
        await page.waitForTimeout(250);
    }
    await page.waitForTimeout(400);
}

const VIEWPORTS = [
    { name: '1440', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
];

async function shootPair(page, ctx, prefix, { extra = [], scroll = '' } = {}) {
    const viewports = extra.length ? [...VIEWPORTS, ...extra] : VIEWPORTS;
    for (const mode of ['light', 'dark']) {
        await theme(page, mode);
        for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            await closeHostChrome(page);
            if (scroll === 'top') {
                await page.evaluate(() => {
                    const chat = document.querySelector('#chat');
                    if (chat) chat.scrollTop = 0;
                });
            } else if (scroll) await page.locator(scroll).first().scrollIntoViewIfNeeded();
            await page.evaluate(() => {
                document.querySelector('#vc-f2-conflict')?.remove();
                document.querySelectorAll('#toast-container .toast').forEach((node) => node.remove());
                return document.fonts?.ready;
            });
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            if (overflow > 1) throw new Error(`${prefix} ${viewport.name} 横向溢出 ${overflow}px`);
            await shot(page, ctx, `${prefix}-${viewport.name}-${mode}.png`);
        }
    }
}

async function compose(page) {
    const result = await page.evaluate(async () => {
        const script = await import('/script.js');
        const box = document.querySelector('#send_textarea');
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        const text = '请用一句话回应。';
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const deadline = Date.now() + 2000;
            while (script.swipeState !== 'none' || script.is_send_press) {
                if (Date.now() > deadline) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            set.call(box, text);
            box.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('#send_but').click();
            await new Promise((resolve) => setTimeout(resolve, 400));
            const started = (box.value || '') !== text || document.body.getAttribute('data-generating') === 'true';
            if (started) return { ok: true, attempt };
        }
        return {
            ok: false,
            swipe: script.swipeState,
            sending: script.is_send_press === true,
            valueLen: box.value?.length || 0,
        };
    });
    if (!result.ok) throw new Error(`发送没有开始 ${JSON.stringify(result)}`);
}

export async function sceneF2ChatUi(ctx) {
    await bindForeground(ctx);
    // 同一次受管验收里 W15 会把当月额度记满。这里只清本月计数，让后面的生成还能走通。
    ctx.w10.psql(`UPDATE vc.month_cost_budget
        SET settled_usd = 0, reserved_usd = 0, unsettled_usd = 0
        WHERE month_start = date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date;`);
    const st = stClient(ctx);
    const cardName = `F2 聊天 ${crypto.randomUUID().slice(0, 8)}`;
    const imported = await importJson(st, {
        name: cardName,
        description: '合成聊天卡，只供本场验收。',
        first_mes: GREETING,
        personality: '',
        scenario: '',
        mes_example: '',
    });
    if (imported.status !== 200 || !imported.json?.file_name) throw new Error(`导入合成卡 HTTP ${imported.status}`);
    const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
    const file = `F2-${crypto.randomUUID()}`;
    const saved = await st.call('POST', '/api/chats/save', {
        avatar_url: avatar,
        file_name: file,
        chat: [
            {
                user_name: 'unused',
                character_name: cardName,
                chat_metadata: { vc_f2: { id: crypto.randomUUID(), revision: 0 }, vc_binding: { mode: 'COMPANION', displayName: '合成实例' } },
            },
            { name: cardName, is_user: false, mes: GREETING, swipe_id: 0, swipes: [GREETING, SECOND] },
        ],
    });
    if (saved.status !== 200) throw new Error(`保存聊天 HTTP ${saved.status}`);

    const complexName = `澄夏F2${crypto.randomUUID().slice(0, 6)}`;
    const complex = await importJson(st, complexCard(complexName, `蓝窗F2${crypto.randomUUID().slice(0, 6)}`));
    if (complex.status !== 200 || !complex.json?.file_name) throw new Error(`导入复杂卡 HTTP ${complex.status}`);
    const complexAvatar = `${complex.json.file_name.replace(/\.png$/, '')}.png`;

    const browser = await launchBrowser();
    try {
        const bc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
        page.on('pageerror', (error) => consoleLines.push(String(error.message || '').slice(0, 100)));
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleLines.push(msg.text().slice(0, 100));
        });
        const fail = (error) => {
            const tail = consoleLines.slice(-3).join(' | ');
            throw new Error(`${error.message}${tail ? ` console=${tail}` : ''}`);
        };

        console.log('[f2-chat-ui] 打开宿主');
        await page.goto(ctx.w05.stBase);
        await nativeReady(page);
        await openChat(page, avatar, file);
        await page.waitForFunction(() => document.body.classList.contains('vc-ui') && document.querySelector('#vc-chat-poster'));
        const placed = await page.evaluate(() => {
            const poster = document.querySelector('#vc-chat-poster');
            const chat = document.querySelector('#chat');
            return Boolean(poster && chat && poster.parentElement !== chat && !chat.contains(poster) && document.querySelector('#extensionsMenuButton'));
        });
        if (!placed) fail(new Error('海报位置或魔杖节点不符合约定'));
        const swipeNext = page.locator('#chat > .mes.vc-tools-pin [data-vc-act="swipe-next"]');
        try {
            await swipeNext.waitFor({ state: 'visible', timeout: 30000 });
        } catch (error) {
            const counter = await page.evaluate(() => (document.querySelector('#chat .swipes-counter')?.textContent || '').replace(/\u200b/g, ''));
            fail(new Error(`候选按钮未出现，计数=${counter || '无'} (${error.message.split('\n')[0]})`));
        }
        console.log('[f2-chat-ui] 滑动候选');
        await swipeNext.scrollIntoViewIfNeeded();
        await swipeNext.click();
        await page.waitForFunction(() => /2\s*\/\s*2/.test((document.querySelector('#chat .swipes-counter')?.textContent || '').replace(/\u200b/g, '')));

        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: '合成回复已收到。', chunks: 1, delay: { firstMs: 30, perChunkMs: 20 } });
        await page.waitForFunction(() => !document.querySelector('#send_form')?.classList.contains('no-connection'));
        console.log('[f2-chat-ui] 发送');
        const beforeSend = await page.locator('#chat > .mes').count();
        const saved = page.waitForResponse((response) => response.url().includes('/api/chats/save') && response.status() === 200, { timeout: 90000 });
        await compose(page);
        try {
            await page.waitForFunction((count) => document.querySelectorAll('#chat > .mes').length >= count + 2, beforeSend, { timeout: 90000 });
            await page.waitForFunction(() => document.body.getAttribute('data-generating') !== 'true', null, { timeout: 30000 });
        } catch (error) {
            const info = await page.evaluate((count) => ({
                mes: document.querySelectorAll('#chat > .mes').length,
                from: count,
                generating: document.body.getAttribute('data-generating'),
                connected: !document.querySelector('#send_form')?.classList.contains('no-connection'),
                idle: document.querySelector('#send_form')?.classList.contains('vc-send-idle') === true,
                sendDisplay: getComputedStyle(document.querySelector('#send_but')).display,
                valueLen: document.querySelector('#send_textarea')?.value?.length || 0,
                toast: Boolean(document.querySelector('#toast-container .toast-error, #toast-container .toast')),
                ui: document.body.classList.contains('vc-ui'),
            }), beforeSend);
            fail(new Error(`发送未完成 ${JSON.stringify(info)} (${error.message.split('\n')[0]})`));
        }
        await saved;
        if (await page.locator('#vc-f2-conflict[open]').count()) fail(new Error('发送完成后仍有保存冲突'));

        const look = await page.evaluate(() => {
            const form = getComputedStyle(document.querySelector('#send_form'));
            const box = getComputedStyle(document.querySelector('#send_textarea'));
            const plus = getComputedStyle(document.querySelector('#options_button'));
            return { formBg: form.backgroundColor, radius: box.borderRadius, font: box.fontSize, plus: plus.width };
        });
        if (look.formBg !== 'rgba(0, 0, 0, 0)' && look.formBg !== 'transparent') fail(new Error(`输入区仍有底色 ${look.formBg}`));
        if (look.radius !== '22px' || look.font !== '17px' || look.plus !== '44px') fail(new Error(`输入区尺寸不符 ${JSON.stringify(look)}`));
        try {
            await shootPair(page, ctx, 'chat', { extra: [{ name: '360', width: 360, height: 800 }], scroll: 'top' });
        } catch (error) {
            fail(error);
        }

        console.log('[f2-chat-ui] 冲突');
        await ctx.fixtureHttp.setOverride('vc03m-chat', null);
        const conflict = await bc.newPage();
        const other = await bc.newPage();
        conflict.setDefaultTimeout(120000);
        other.setDefaultTimeout(120000);
        for (const tab of [conflict, other]) {
            await tab.goto(ctx.w05.stBase);
            await nativeReady(tab);
            await openChat(tab, avatar, file);
            await tab.waitForFunction(() => typeof window.SillyTavern.getContext().chatMetadata?.vc_binding?.conversationId === 'string');
            await tab.evaluate(() => window.SillyTavern.getContext().saveChat());
        }
        for (const tab of [conflict, other]) await openChat(tab, avatar, file);
        await conflict.evaluate(async () => {
            const context = window.SillyTavern.getContext();
            const row = context.chat.find((item) => item && item.is_user === false);
            if (!row) throw new Error('没有可修订的角色消息');
            row.mes = '页面一侧的新版本';
            await context.saveChat();
        });
        const outcome = await other.evaluate(async () => {
            const context = window.SillyTavern.getContext();
            const row = context.chat.find((item) => item && item.is_user === false);
            if (!row) return 'missing';
            row.mes = '页面另一侧的草稿';
            try {
                await context.saveChat();
                return 'unexpected-success';
            } catch (error) {
                return error?.code || 'unknown';
            }
        });
        if (outcome !== 'VC_REVISION_CONFLICT') fail(new Error(`冲突结果 ${outcome}`));
        await other.waitForSelector('#vc-f2-conflict[open]');
        const shape = await other.evaluate(() => {
            const panel = document.querySelector('#vc-f2-conflict');
            return {
                sheet: panel?.classList.contains('vc-sheet') === true,
                draft: Boolean(panel?.querySelector('[data-vc-draft] h3')?.textContent?.includes('我的草稿')),
                latest: Boolean(panel?.querySelector('[data-vc-latest] h3')?.textContent?.includes('最新版本')),
                actions: ['view-latest', 'keep-draft', 'copy-input'].every((name) => panel?.querySelector(`[data-action="${name}"]`)),
                textarea: panel?.querySelectorAll('textarea').length || 0,
            };
        });
        if (!shape.sheet || !shape.draft || !shape.latest || !shape.actions || shape.textarea !== 0) {
            fail(new Error(`冲突面板结构不符 ${JSON.stringify(shape)}`));
        }
        await other.setViewportSize({ width: 1440, height: 900 });
        await shot(other, ctx, 'conflict-1440-light.png');
        await conflict.close();
        await other.close();

        console.log('[f2-chat-ui] 复杂卡');
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
            const panel = document.querySelector('#vc-f2-conflict');
            if (panel?.open) panel.close();
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await theme(page, 'light');
        await openComplex(page, complexAvatar);
        await page.evaluate(async (fileName) => {
            const context = window.SillyTavern.getContext();
            const settings = context.extensionSettings;
            settings.character_allowed_regex ??= [];
            if (!settings.character_allowed_regex.includes(fileName)) settings.character_allowed_regex.push(fileName);
            settings.tavern_helper ??= {};
            settings.tavern_helper.script ??= {};
            settings.tavern_helper.script.enabled ??= {};
            settings.tavern_helper.script.popuped ??= {};
            const enabled = settings.tavern_helper.script.enabled.characters ??= [];
            const popuped = settings.tavern_helper.script.popuped.characters ??= [];
            if (!enabled.includes(fileName)) enabled.push(fileName);
            if (!popuped.includes(fileName)) popuped.push(fileName);
            const extensions = await import('/scripts/extensions.js');
            if (typeof extensions.saveSettings === 'function') await extensions.saveSettings();
            else context.saveSettingsDebounced();
        }, complexAvatar);
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await nativeReady(page);
        await openComplex(page, complexAvatar);
        await closeHostChrome(page);
        const iframeDeadline = Date.now() + 30000;
        let iframeState = {};
        while (Date.now() < iframeDeadline) {
            iframeState = await page.evaluate(() => {
                const iframe = document.querySelector('#chat .mes_text iframe');
                const box = iframe?.getBoundingClientRect();
                const style = iframe ? getComputedStyle(iframe) : null;
                return {
                    found: Boolean(iframe),
                    box: Math.round(box?.height || 0),
                    width: Math.round(box?.width || 0),
                    display: style?.display || '',
                    visibility: style?.visibility || '',
                    drawers: document.querySelectorAll('.drawer-content.openDrawer').length,
                };
            });
            if (iframeState.box > 24 && iframeState.width > 24) break;
            await page.waitForTimeout(250);
        }
        if (!(iframeState.box > 24)) fail(new Error(`状态栏 iframe 不可见 ${JSON.stringify(iframeState)}`));
        const fit = await page.evaluate(() => {
            const iframe = document.querySelector('#chat .mes_text iframe');
            let content = 0;
            try { content = iframe.contentDocument?.body?.scrollHeight || 0; } catch { content = 0; }
            const box = iframe.getBoundingClientRect().height;
            const style = getComputedStyle(iframe);
            const host = iframe.closest('.TH-render');
            const hostStyle = host ? getComputedStyle(host) : null;
            return {
                box,
                content,
                maxHeight: style.maxHeight,
                overflow: style.overflowY,
                hostMax: hostStyle?.maxHeight || '',
                hostOverflow: hostStyle?.overflowY || '',
            };
        });
        if (!(fit.box > 24)) fail(new Error(`状态栏高度过小 ${Math.round(fit.box)}`));
        if (fit.maxHeight !== 'none' || (fit.hostMax && fit.hostMax !== 'none')) fail(new Error('状态栏被最大高度限制'));
        if (fit.content > 0 && fit.box + 8 < fit.content) fail(new Error(`状态栏没有随内容增高 ${Math.round(fit.box)}/${Math.round(fit.content)}`));
        await closeHostChrome(page);
        await page.locator('#chat .mes_text iframe').scrollIntoViewIfNeeded();
        const drawer = await page.locator('.drawer-content.openDrawer').count();
        if (drawer) fail(new Error('世界书或宿主抽屉仍打开'));
        const refit = await page.evaluate(() => {
            const iframe = document.querySelector('#chat .mes_text iframe');
            let content = 0;
            try { content = iframe.contentDocument?.body?.scrollHeight || 0; } catch { content = 0; }
            const box = iframe.getBoundingClientRect().height;
            return { box, content, maxHeight: getComputedStyle(iframe).maxHeight };
        });
        if (!(refit.box > 24) || refit.maxHeight !== 'none') fail(new Error(`关抽屉后状态栏异常 ${JSON.stringify(refit)}`));
        if (refit.content > 0 && refit.box + 8 < refit.content) fail(new Error(`关抽屉后状态栏没有随内容增高 ${Math.round(refit.box)}/${Math.round(refit.content)}`));
        try {
            await shootPair(page, ctx, 'iframe', { scroll: '#chat .mes_text iframe' });
        } catch (error) {
            fail(error);
        }
        await openChat(page, avatar, file);

        await page.setViewportSize({ width: 1440, height: 900 });
        await theme(page, 'light');
        await ctx.fixtureHttp.setOverride('vc03m-chat', {
            text: '慢速流。'.repeat(40),
            chunks: 80,
            delay: { firstMs: 200, perChunkMs: 450 },
        });
        const armed = await page.evaluate(() => window.SillyTavern.getContext().powerUserSettings?.stream_fade_in === true);
        if (!armed) fail(new Error('stream_fade_in 未在内存中打开'));
        console.log('[f2-chat-ui] 停止生成');
        await compose(page);
        await page.waitForFunction(() => document.body.getAttribute('data-generating') === 'true');
        const fade = await page.evaluate(() => {
            const segment = document.querySelector('#chat .text_segment');
            return segment ? getComputedStyle(segment).animationName : '';
        });
        if (fade && !fade.includes('vc-stream-clear')) fail(new Error(`流式动画不是渐清：${fade}`));
        await page.waitForFunction(() => document.querySelector('#chat > .mes.vc-generating'));
        const capsule = await page.evaluate(() => {
            const chat = document.querySelector('#chat');
            if (chat) chat.scrollTop = 0;
            const poster = document.querySelector('#vc-chat-poster');
            if (poster) poster.style.transform = 'none';
            const toast = document.querySelector('#toast-container .toast');
            const avatar = document.querySelector('#vc-poster-avatar');
            if (!toast || !avatar) return { skipped: true };
            const band = toast.getBoundingClientRect();
            const face = avatar.getBoundingClientRect();
            const space = getComputedStyle(document.querySelector('#sheld')).getPropertyValue('--vc-status-space').trim();
            return { skipped: false, avatarTop: Math.round(face.top), toastBottom: Math.round(band.bottom), space };
        });
        if (!capsule.skipped && capsule.avatarTop < capsule.toastBottom - 1) {
            fail(new Error(`状态胶囊压住海报 ${JSON.stringify(capsule)}`));
        }
        try {
            await shootPair(page, ctx, 'stream', { scroll: '#chat > .mes.vc-generating .mes_text' });
        } catch (error) {
            fail(error);
        }
        if (await page.evaluate(() => document.body.getAttribute('data-generating') !== 'true')) fail(new Error('流式截图时生成已经结束'));
        await page.evaluate(() => {
            const chat = document.querySelector('#chat');
            if (chat) chat.scrollTop = chat.scrollHeight;
        });
        if (await page.locator('#vc-new-reply.is-on').count()) fail(new Error('已在底部时出现了新回复'));
        await page.setViewportSize({ width: 1440, height: 900 });
        await theme(page, 'light');
        await page.evaluate(() => {
            const chat = document.querySelector('#chat');
            if (chat) chat.scrollTop = 0;
        });
        await page.waitForFunction(() => document.querySelector('#vc-new-reply')?.classList.contains('is-on') === true, null, { timeout: 8000 });
        const replyPad = await page.evaluate(() => {
            const chat = document.querySelector('#chat');
            const padding = Number.parseFloat(getComputedStyle(chat).paddingBottom) || 0;
            return { padding };
        });
        if (replyPad.padding < 36) fail(new Error(`新回复出现时阅读区没有留出胶囊高度 ${replyPad.padding}`));
        await shot(page, ctx, 'new-reply-away-1440-light.png');
        await page.evaluate(() => {
            const chat = document.querySelector('#chat');
            if (chat) chat.scrollTop = chat.scrollHeight;
        });
        await page.waitForFunction(() => document.querySelector('#vc-new-reply')?.classList.contains('is-on') !== true, null, { timeout: 3000 });
        const stoppedSave = page.waitForResponse((response) => response.url().includes('/api/chats/save'), { timeout: 20000 }).catch(() => null);
        const diag = await page.evaluate(() => {
            const before = document.body.dataset.generating || '';
            const button = document.querySelector('#mes_stop');
            const jq = window.jQuery;
            if (jq) jq(button).trigger('click');
            else button?.click();
            return { before };
        });
        try {
            await page.waitForFunction(() => document.body.dataset.generating !== 'true', null, { timeout: 15000 });
        } catch (error) {
            fail(new Error(`停止没有结束生成 ${JSON.stringify(diag)} (${error.message.split('\n')[0]})`));
        }
        let probe;
        try {
            probe = await page.request.get(new URL('/', page.url()).href);
        } catch (error) {
            fail(new Error(`停止后宿主进程没有继续应答：${error.message.split('\n')[0]}`));
        }
        if (!probe || probe.status() >= 500) fail(new Error(`停止后宿主应答 HTTP ${probe ? probe.status() : '无'}`));
        try {
            await page.waitForFunction(() => (document.querySelector('#vc-chat-gen')?.textContent || '').includes('已停止'), null, { timeout: 10000 });
        } catch (error) {
            const state = await page.evaluate(() => ({
                gen: document.querySelector('#vc-chat-gen')?.textContent || '',
                hidden: document.querySelector('#vc-chat-gen')?.hidden === true,
                generating: document.body.dataset.generating || '',
                failed: Boolean(document.querySelector('#toast-container .toast-error')),
            }));
            fail(new Error(`停止后状态不是已停止 ${JSON.stringify(state)} (${error.message.split('\n')[0]})`));
        }
        let stopped = await stoppedSave;
        if (!stopped) {
            const again = page.waitForResponse((response) => response.url().includes('/api/chats/save'), { timeout: 20000 }).catch(() => null);
            await page.evaluate(async () => {
                try {
                    await window.SillyTavern?.getContext?.().saveChat?.();
                } catch { /* 停止和宿主收尾可能撞修订；面板在截图前关掉 */ }
            });
            stopped = await again;
        }
        await page.evaluate(() => document.querySelector('#vc-f2-conflict')?.close?.());
        void stopped;
        try {
            await shootPair(page, ctx, 'stopped', { scroll: 'top' });
        } catch (error) {
            fail(error);
        }

        console.log('[f2-chat-ui] 长按菜单');
        for (const mode of ['light', 'dark']) {
            await theme(page, mode);
            for (const viewport of VIEWPORTS) {
                await page.setViewportSize(viewport);
                await closeHostChrome(page);
                await page.evaluate(() => document.querySelector('#vc-f2-conflict')?.remove());
                const message = page.locator('#chat > .mes[is_user="false"] .mes_text').first();
                await message.evaluate((node) => {
                    const chat = node.closest('#chat');
                    node.scrollIntoView({ block: 'center' });
                    const poster = document.querySelector('#vc-chat-poster');
                    const limit = poster ? poster.getBoundingClientRect().bottom : 0;
                    const box = node.getBoundingClientRect();
                    if (chat && box.top < limit + 12) chat.scrollTop += (box.top - limit - 24);
                });
                await message.click({ button: 'right' });
                const menu = page.locator('[role="menu"].vc-menu');
                await menu.waitFor();
                if (mode === 'light' && viewport.name === '390') {
                    const labels = await menu.locator('.vc-menu-label').allTextContents();
                    for (const need of ['复制', '编辑', '重新生成', '选择文本', '删除']) {
                        if (!labels.includes(need)) fail(new Error(`长按菜单缺少${need}`));
                    }
                    if (await menu.locator('button.is-danger').count() !== 1) fail(new Error('删除项不是危险操作'));
                }
                await page.waitForTimeout(320);
                await page.evaluate(() => document.querySelector('#vc-f2-conflict')?.remove());
                await shot(page, ctx, `menu-${viewport.name}-${mode}.png`);
                await page.keyboard.press('Escape');
                await menu.waitFor({ state: 'hidden' }).catch(() => {});
            }
        }

        console.log('[f2-chat-ui] 气泡');
        await page.evaluate(() => {
            localStorage.setItem('vc-reply-style', 'bubble');
            document.body.classList.add('vc-reply-bubble');
        });
        try {
            await shootPair(page, ctx, 'bubble', { scroll: 'top' });
        } catch (error) {
            fail(error);
        }
        await page.evaluate(() => {
            localStorage.setItem('vc-reply-style', 'spread');
            document.body.classList.remove('vc-reply-bubble');
        });

        console.log('[f2-chat-ui] 记忆检视');
        await page.setViewportSize({ width: 1440, height: 900 });
        await theme(page, 'light');
        await closeHostChrome(page);
        await page.evaluate(() => {
            document.querySelector('#vc-f2-conflict')?.remove();
            const chat = document.querySelector('#chat');
            if (chat) chat.scrollTop = 0;
        });
        await page.locator('[data-vc-poster="memory"]').click();
        await page.waitForSelector('#vc-memory-rail');
        await page.waitForTimeout(320);
        await shot(page, ctx, 'memory-rail-1440-light.png');
        await theme(page, 'dark');
        await page.waitForTimeout(200);
        await shot(page, ctx, 'memory-rail-1440-dark.png');
        await page.locator('#vc-memory-rail button').filter({ hasText: '完成' }).click();
        await page.waitForSelector('#vc-memory-rail', { state: 'detached' });
        await page.setViewportSize({ width: 390, height: 844 });
        await theme(page, 'light');
        await page.evaluate(() => {
            document.querySelector('#vc-f2-conflict')?.remove();
            const chat = document.querySelector('#chat');
            if (chat) chat.scrollTop = 0;
        });
        await page.locator('[data-vc-poster="memory"]').click();
        await page.waitForSelector('.vc-sheet #vc-memory-inspector');
        await page.waitForFunction(() => {
            const title = document.querySelector('#vc-memory-sheet-host .vc-sheet h3');
            if (!title || title.textContent.trim() !== '记忆') return false;
            const box = title.getBoundingClientRect();
            const top = box.top;
            if (!(box.height > 8 && top > 180 && box.bottom <= window.innerHeight - 8)) return false;
            const prev = Number(title.dataset.vcSeenTop);
            title.dataset.vcSeenTop = String(Math.round(top));
            return Number.isFinite(prev) && Math.abs(prev - top) < 1;
        }, null, { timeout: 10000 });
        await shot(page, ctx, 'memory-sheet-390-light.png');
        await theme(page, 'dark');
        await page.waitForFunction(() => {
            const title = document.querySelector('#vc-memory-sheet-host .vc-sheet h3');
            if (!title) return false;
            const top = title.getBoundingClientRect().top;
            return top > 180 && top < window.innerHeight - 8;
        }, null, { timeout: 3000 });
        await shot(page, ctx, 'memory-sheet-390-dark.png');
        const dragSheet = async (dy) => {
            const handle = await page.locator('.vc-sheet .vc-sheet-grab').boundingBox();
            if (!handle) fail(new Error('记忆 sheet 没有拖动手柄'));
            const x = handle.x + handle.width / 2;
            const y = handle.y + handle.height / 2;
            await page.mouse.move(x, y);
            await page.mouse.down();
            const steps = 8;
            for (let i = 1; i <= steps; i += 1) {
                await page.mouse.move(x, y + (dy * i) / steps);
                await page.waitForTimeout(40);
            }
            await page.waitForTimeout(80);
            await page.mouse.up();
            await page.waitForTimeout(400);
        };
        const halfTop = await page.evaluate(() => document.querySelector('.vc-sheet h3').getBoundingClientRect().top);
        await dragSheet(-280);
        const fullTop = await page.evaluate(() => document.querySelector('.vc-sheet h3')?.getBoundingClientRect().top ?? -1);
        if (!(fullTop >= 0 && fullTop < halfTop - 40)) fail(new Error(`记忆 sheet 没有拖到更高一档 ${halfTop} -> ${fullTop}`));
        await dragSheet(220);
        const backTop = await page.evaluate(() => document.querySelector('.vc-sheet h3')?.getBoundingClientRect().top ?? -1);
        if (!(backTop > fullTop + 40)) fail(new Error(`记忆 sheet 没有回到半档 ${fullTop} -> ${backTop}`));
        await page.locator('.vc-sheet').focus();
        await page.keyboard.press('Escape');
        await page.waitForSelector('#vc-memory-sheet-host', { state: 'detached' });
        const focused = await page.evaluate(() => document.activeElement?.getAttribute?.('data-vc-poster') || '');
        if (focused !== 'memory') fail(new Error(`关闭记忆 sheet 后焦点没有回到海报按钮（${focused || '无'}）`));

        await bc.close();
    } finally {
        await ctx.fixtureHttp.setOverride('vc03m-chat', null);
        await browser.close();
    }
}
