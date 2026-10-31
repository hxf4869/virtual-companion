// 表情包受管场景：fixture 回复带 sticker 标签时出现表情气泡，冷却内第二次被剥离。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ownerBudgetResetSql } from './lib/owner-budget.mjs';
import { openStCharacterChat } from './lib/open-st-chat.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const VIEWPORTS = [
    { name: '390', width: 390, height: 844 },
    { name: '1440', width: 1440, height: 900 },
];

function stClient(ctx) {
    const session = ctx.secrets.session;
    return ctx.st || {
        call(method, urlPath, body) {
            return fetch(`${ctx.w05.stBase}${urlPath}`, {
                method,
                headers: { 'content-type': 'application/json', cookie: `vc_session=${session.vcSession}; vc_csrf=${session.vcCsrf}` },
                body: body instanceof FormData ? undefined : JSON.stringify(body),
            }).then(async (response) => ({ status: response.status, json: await response.json().catch(() => null) }));
        },
    };
}

async function bindForeground(ctx) {
    await reauthForWrite(ctx);
    const purposes = await ctx.admin.listPurposes();
    if (purposes.status !== 200) throw new Error(`用途列表 HTTP ${purposes.status}`);
    const row = purposes.json.find((item) => item.purpose === 'FOREGROUND_CHAT');
    if (!row) throw new Error('FOREGROUND_CHAT 缺失');
    const bound = await ctx.admin.savePurpose('FOREGROUND_CHAT', {
        providerId: 'vc03m-chat', profileKey: 'chat', state: 'ENABLED', expectedRevision: row.revision,
    });
    if (bound.status !== 200) throw new Error(`前台绑定 HTTP ${bound.status}`);
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        const granted = await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'hl-stickers', granted: true });
        if (granted.status !== 200) throw new Error(`授权 ${consentType} HTTP ${granted.status}`);
    }
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
    await page.waitForFunction(() => document.body.classList.contains('vc-ui'), null, { timeout: 15000 });
}

async function theme(page, mode) {
    await page.evaluate((value) => {
        localStorage.setItem('vc-theme', value);
        document.documentElement.setAttribute('data-vc-theme', value);
    }, mode);
}

async function shot(page, dir, name, ctx) {
    await page.evaluate(async () => {
        const fonts = document.fonts?.ready ?? Promise.resolve();
        await Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, 2000))]);
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`${name} 横向溢出 ${overflow}px`);
    const file = path.join(dir, name);
    await page.screenshot({ path: file, fullPage: false });
    ctx.screenshots?.push(file);
}

async function openStickers(page) {
    await page.waitForFunction(() => {
        const root = document.querySelector('#vc-shell');
        if (!root) return false;
        const phone = window.innerWidth < 744;
        return phone ? root.dataset.chrome === 'tabbar' : root.dataset.chrome === 'sidebar';
    }, null, { timeout: 8000 });
    const clicked = await page.evaluate(() => {
        const shown = (el) => {
            if (!el) return false;
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const buttons = [...document.querySelectorAll('#vc-shell [data-settings]')];
        const visible = buttons.find(shown);
        (visible || buttons[0])?.click();
        return Boolean(visible || buttons[0]);
    });
    if (!clicked) throw new Error('没有设置按钮');
    const ready = await page.waitForFunction(() => {
        const shown = (el) => el && el.getClientRects().length > 0;
        const narrow = window.innerWidth < 744;
        const form = [...document.querySelectorAll('.vc-settings-form')].find(shown);
        if (!form) return false;
        if (narrow) return Boolean(form.closest('.vc-sheet'));
        return document.querySelector('#vc-shell')?.dataset.settings === 'page';
    }, null, { timeout: 10000 }).then(() => true).catch(async (error) => {
        const state = await page.evaluate(() => {
            const rect = (el) => {
                const box = el.getBoundingClientRect();
                return { w: Math.round(box.width), h: Math.round(box.height), t: Math.round(box.top) };
            };
            return {
                width: window.innerWidth,
                chrome: document.querySelector('#vc-shell')?.dataset.chrome || '',
                settings: document.querySelector('#vc-shell')?.dataset.settings || '',
                forms: [...document.querySelectorAll('.vc-settings-form')].map((el) => ({
                    parent: el.parentElement?.className || '',
                    rect: rect(el),
                })),
                sheets: [...document.querySelectorAll('.vc-sheet')].map((el) => rect(el)),
            };
        });
        throw new Error(`设置页没有出现 ${JSON.stringify(state)} (${error.name})`);
    });
    if (!ready) throw new Error('设置页没有出现');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-vc-sticker-entry]')].some((el) => el.getClientRects().length > 0), null, { timeout: 10000 });
    await page.evaluate(() => {
        const button = [...document.querySelectorAll('[data-vc-sticker-entry]')].find((el) => el.getClientRects().length > 0);
        button?.scrollIntoView({ block: 'center', inline: 'nearest' });
        button?.click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-vc-sticker-page]')].some((el) => el.getClientRects().length > 0), null, { timeout: 10000 });
}

async function closeSettings(page) {
    await page.evaluate(() => {
        const shown = (el) => el && el.getClientRects().length > 0;
        [...document.querySelectorAll('[data-vc-sticker-back]')].find(shown)?.click();
        [...document.querySelectorAll('.vc-sheet-done, [data-settings-done]')].find(shown)?.click();
    });
    await page.waitForFunction(() => !document.querySelector('.vc-sheet') && document.querySelector('#vc-shell')?.dataset.settings !== 'page', null, { timeout: 8000 });
}

async function revealChat(page, avatar, file) {
    await openStCharacterChat(page, { avatar, file, switchMenu: false });
    await page.waitForFunction(() => typeof document.querySelector('#vc-shell')?.openConversation === 'function', null, { timeout: 20000 });
    const status = await page.evaluate(async () => {
        const root = document.querySelector('#vc-shell');
        const context = window.SillyTavern.getContext();
        const id = context.characterId;
        const characterIndex = typeof id === 'number' ? id : Number(id);
        const opened = await root.openConversation({
            relationshipId: context.chatMetadata?.vc_binding?.relationshipId || '',
            file: context.chatId || '',
            characterIndex: Number.isInteger(characterIndex) ? characterIndex : undefined,
            name: context.characters?.[characterIndex]?.name || '',
            avatar: context.characters?.[characterIndex]?.avatar || '',
        });
        return opened === true && root.dataset.chat === 'open';
    });
    if (!status) throw new Error('对话列没有展开');
}

async function compose(page, text) {
    const result = await page.evaluate(async (value) => {
        const script = await import('/script.js');
        const box = document.querySelector('#send_textarea');
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const deadline = Date.now() + 2000;
            while (script.swipeState !== 'none' || script.is_send_press) {
                if (Date.now() > deadline) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            set.call(box, value);
            box.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('#send_but').click();
            await new Promise((resolve) => setTimeout(resolve, 400));
            const started = (box.value || '') !== value || document.body.getAttribute('data-generating') === 'true';
            if (started) return { ok: true };
        }
        return { ok: false };
    }, text);
    if (!result.ok) throw new Error('发送没有开始');
}

async function stickerState(page) {
    return page.evaluate(() => {
        const context = window.SillyTavern.getContext();
        const gate = context.chatMetadata?.vc_sticker_gate || {};
        return {
            bubbles: document.querySelectorAll('[data-vc-sticker]').length,
            tagged: (context.chat || []).some((item) => String(item?.mes || '').includes('<sticker')),
            assistants: (context.chat || []).filter((item) => item && item.is_user === false).length,
            count: Number(gate.assistantCount) || 0,
            last: Number(gate.lastStickerAt) || 0,
        };
    });
}

export async function sceneHlStickers(ctx) {
    if (!Array.isArray(ctx.screenshots)) ctx.screenshots = [];
    await bindForeground(ctx);
    if (ctx.w10?.psql && ctx.w05?.ownerId) ctx.w10.psql(ownerBudgetResetSql(ctx.w05.ownerId));
    const st = typeof ctx.st?.call === 'function' ? ctx.st : stClient(ctx);
    const cardName = `表情 ${crypto.randomUUID().slice(0, 8)}`;
    const form = new FormData();
    form.append('file_type', 'json');
    form.append('avatar', new Blob([JSON.stringify({
        name: cardName, description: '合成表情卡，只供本场验收。', first_mes: '合成开场。', personality: '', scenario: '', mes_example: '',
    })], { type: 'application/json' }), 'synthetic.json');
    const imported = await st.call('POST', '/api/characters/import', form);
    if (imported.status !== 200 || !imported.json?.file_name) throw new Error(`导入合成卡 HTTP ${imported.status}`);
    const avatar = `${imported.json.file_name.replace(/\.png$/, '')}.png`;
    const file = `hl-stickers-${crypto.randomUUID()}`;
    const saved = await st.call('POST', '/api/chats/save', {
        avatar_url: avatar,
        file_name: file,
        chat: [
            { user_name: 'unused', character_name: cardName, chat_metadata: { vc_f2: { id: crypto.randomUUID(), revision: 0 }, vc_binding: { mode: 'COMPANION', displayName: '合成实例' } } },
            { name: cardName, is_user: false, mes: '合成开场。', send_date: new Date().toISOString() },
        ],
    });
    if (saved.status !== 200) throw new Error(`保存聊天 HTTP ${saved.status}`);
    const uploaded = await st.call('POST', '/api/images/upload', {
        image: PNG, format: 'png', ch_name: 'vc-stickers', filename: '开心',
    });
    if (uploaded.status !== 200 || !uploaded.json?.path) throw new Error(`上传表情 HTTP ${uploaded.status}`);
    const imagePath = uploaded.json.path;

    const dir = path.join(ctx.artifactsDir, 'hl-stickers');
    fs.mkdirSync(dir, { recursive: true });
    const browser = await launchBrowser();
    try {
        const bc = await browser.newContext({ viewport: VIEWPORTS[0] });
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
        await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
        await nativeReady(page);
        await page.evaluate((itemPath) => {
            const context = window.SillyTavern.getContext();
            context.extensionSettings.vc_stickers = {
                enabled: true,
                frequency: 'high',
                uploads: [{ id: 'hl-happy', tag: '开心', path: itemPath, name: '开心.png' }],
            };
            context.saveSettingsDebounced?.();
        }, imagePath);

        for (const mode of ['light', 'dark']) {
            await theme(page, mode);
            for (const viewport of VIEWPORTS) {
                await page.setViewportSize(viewport);
                await openStickers(page);
                await page.waitForSelector('[data-vc-sticker-id="hl-happy"]', { timeout: 8000 });
                const layout = await page.evaluate(() => {
                    const page = document.querySelector('[data-vc-sticker-page]');
                    const list = page.querySelector('[data-vc-sticker-list]').getBoundingClientRect();
                    const upload = page.querySelector('[data-vc-sticker-upload]').getBoundingClientRect();
                    const title = page.querySelector('[data-vc-sticker-title]');
                    const host = page.closest('.vc-sheet,.vc-shell-settings');
                    const outerNav = host?.querySelector(':scope > .vc-sheet-head,:scope > .vc-navbar');
                    return { insetX: upload.left - list.left, insetY: upload.top - list.top,
                        width: page.getBoundingClientRect().width,
                        duplicateNav: Boolean(outerNav?.getClientRects().length),
                        titleVisible: title.getClientRects().length > 0 && Number(getComputedStyle(title).opacity) >= 0.99 };
                });
                if (layout.insetX < 15 || layout.insetY < 9 || !layout.titleVisible || layout.duplicateNav || layout.width > 721) throw new Error(`表情包标题、内容列或上传间距异常 ${JSON.stringify(layout)}`);
                await shot(page, dir, `settings-${viewport.name}-${mode}.png`, ctx);
                await closeSettings(page);
            }
        }

        await page.setViewportSize(VIEWPORTS[0]);
        await theme(page, 'light');
        await revealChat(page, avatar, file);
        await page.waitForFunction(() => !document.querySelector('#send_form')?.classList.contains('no-connection'), null, { timeout: 30000 });

        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: '在呢<sticker tag="开心"/>', chunks: 1, delay: { firstMs: 20, perChunkMs: 10 } });
        await compose(page, '今天天气不错');
        await page.waitForFunction(() => {
            const context = window.SillyTavern.getContext();
            const assistants = (context.chat || []).filter((item) => item && item.is_user === false).length;
            return assistants >= 2 && document.body.getAttribute('data-generating') !== 'true' && document.querySelector('[data-vc-sticker]');
        }, null, { timeout: 90000 });
        const first = await stickerState(page);
        if (first.bubbles !== 1 || first.tagged || first.last < 1) throw new Error(`首次表情不符合 ${JSON.stringify(first)}`);

        await ctx.fixtureHttp.setOverride('vc03m-chat', { text: '好呀<sticker tag="开心"/>', chunks: 1, delay: { firstMs: 20, perChunkMs: 10 } });
        await compose(page, '那你呢');
        await page.waitForFunction(() => {
            const context = window.SillyTavern.getContext();
            const assistants = (context.chat || []).filter((item) => item && item.is_user === false).length;
            return assistants >= 3 && document.body.getAttribute('data-generating') !== 'true';
        }, null, { timeout: 90000 });
        const second = await stickerState(page);
        if (second.bubbles !== 1 || second.tagged || second.count < 2) throw new Error(`冷却内第二次仍在发送 ${JSON.stringify(second)}`);

        for (const mode of ['light', 'dark']) {
            await theme(page, mode);
            for (const viewport of VIEWPORTS) {
                await page.setViewportSize(viewport);
                await page.evaluate(() => {
                    const chat = document.querySelector('#chat');
                    if (chat) chat.scrollTop = chat.scrollHeight;
                });
                await shot(page, dir, `chat-${viewport.name}-${mode}.png`, ctx);
            }
        }
    } finally {
        await ctx.fixtureHttp.setOverride('vc03m-chat', null);
        await browser.close();
    }
}

export const hlStickersScene = {
    id: 'hl-stickers',
    title: '表情包：标签变成表情气泡，冷却内第二次剥离',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneHlStickers,
};
export const scenes = [hlStickersScene];
