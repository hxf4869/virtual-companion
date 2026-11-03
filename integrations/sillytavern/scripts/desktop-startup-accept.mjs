// NF-00 启动基线；复用受管栈、原生公开聊天入口和同一合成输入，不发起模型调用。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createStClient } from './managed-lib.mjs';
import { bindForeground } from './lib/accept-scene-helpers.mjs';
import { openStCharacterChat } from './lib/open-st-chat.mjs';

export async function seedDesktopBenchmark(ctx) {
    await bindForeground(ctx, 'vc03m-chat', 'chat', 'vc03m-chat');
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        const result = await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'nf-synthetic', granted: true });
        assert.equal(result.status, 200, '合成授权必须成功');
    }
    const session = ctx.secrets.session;
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: session,
        extraCookies: `vc_session=${session.vcSession}; vc_csrf=${session.vcCsrf}` });
    const characterRef = crypto.randomUUID(), chatIdentity = crypto.randomUUID();
    const bound = await ctx.admin.call('POST', '/api/v1/st/bindings', { characterRef, chatIdentity, displayName: '合成实例', mode: 'COMPANION' });
    assert.equal(bound.status, 200, '合成实例绑定必须成功');
    const card = { name: 'NF 合成角色', description: '只用于启动测量。', first_mes: '合成问候。', personality: '', scenario: '', mes_example: '', extensions: { vc_character_ref: characterRef } };
    const data = new FormData();
    data.append('file_type', 'json');
    data.append('avatar', new Blob([JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: card })], { type: 'application/json' }), 'synthetic.json');
    const imported = await st.call('POST', '/api/characters/import', data);
    assert.equal(imported.status, 200, '合成卡导入必须成功');
    const avatar = imported.json.file_name.replace(/\.png$/, '') + '.png';
    const file = 'NF-fixed-history';
    const chat = [
        { user_name: '合成用户', character_name: card.name, chat_metadata: {
            vc_f2: { id: chatIdentity, revision: 0 }, vc_binding: { ...bound.json, mode: 'COMPANION', displayName: '合成实例' },
        } },
        ...Array.from({ length: 24 }, (_, i) => ({ name: i % 2 ? card.name : '合成用户', is_user: i % 2 === 0,
            mes: `合成基准消息 ${i + 1}。`, send_date: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString() })),
    ];
    const saved = await st.call('POST', '/api/chats/save', { avatar_url: avatar, file_name: file, chat });
    assert.equal(saved.status, 200, '合成历史保存必须成功');
    return { avatar, file, chat };
}

export async function desktopBenchmarkContext(browser, ctx) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await context.addCookies([
        { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
        { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
    ]);
    await context.addInitScript(() => { localStorage.setItem('vc-ui', 'on'); localStorage.setItem('vc-theme', 'light'); });
    return context;
}

async function sceneNativeStartup(ctx) {
    const fixture = await seedDesktopBenchmark(ctx);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    try {
        const context = await desktopBenchmarkContext(browser, ctx);
        const page = await context.newPage();
        page.setDefaultTimeout(90000);
        let generated = 0;
        page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/generate')) generated++; });
        const samples = [];
        for (const cache of ['cold', 'warm']) {
            await page.goto(ctx.w05.stBase, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#preloader', { state: 'hidden' });
            await page.locator('#vc-shell .vc-sidebar [data-nav="characters"]').click();
            await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.destination === 'characters');
            const uiMs = await page.evaluate(() => Math.round(performance.now()));
            const opening = await page.evaluate(() => performance.now());
            await openStCharacterChat(page, fixture);
            await page.waitForFunction(() => document.querySelectorAll('#chat > .mes').length === 24);
            const historyMs = await page.evaluate(() => Math.round(performance.now()));
            await page.locator('#vc-shell .vc-sidebar [data-nav="chat"]').click();
            await page.waitForFunction(() => !document.querySelector('#send_form')?.classList.contains('no-connection')
                && Boolean(window.SillyTavern?.getContext?.().chatMetadata?.vc_binding?.relationshipId));
            await page.locator('#send_textarea').fill('合成草稿');
            assert.equal(await page.locator('#send_textarea').inputValue(), '合成草稿');
            const sendMs = await page.evaluate(() => Math.round(performance.now()));
            await page.locator('#send_textarea').fill('');
            samples.push({ cache, uiMs, historyMs, openMs: Math.round(historyMs - opening), sendMs });
        }
        assert.equal(generated, 0, '启动测量不应发起模型生成');
        const result = { surface: 'native-baseline', viewport: '1440x900@1', messages: 24, modelRequests: generated,
            cache: 'cold=新浏览器上下文；warm=同上下文再次导航；服务器与数据库均预热；不清 OS 缓存', samples };
        fs.writeFileSync(path.join(ctx.artifactsDir, 'nf-startup.json'), JSON.stringify(result, null, 2) + '\n');
        return result;
    } finally { await browser.close(); }
}

export const nativeStartupScene = { id: 'nf-startup', title: 'NF-00 固定合成历史下原生桌面冷/热启动基线', needs: ['catalog', 'stack', 'browser'], default: false, run: sceneNativeStartup };
