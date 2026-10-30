// Shared setup for the voice UI scenarios: a real isolated ST chat and Go owner.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createStClient, waitFor } from './managed-lib.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { openStCharacterChat } from './lib/open-st-chat.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { ownerBudgetResetSql } from './lib/owner-budget.mjs';

export const voiceExtension = '/scripts/extensions/third-party/vc-model-settings';
export async function voiceCall(ctx, method, route, body, status = 200) {
    const result = await ctx.admin.call(method, route, body);
    assert.equal(result.status, status, `voice API ${method} HTTP status`);
    return result.json;
}
export async function voiceControl(engine, plan = {}) {
    const base = `http://127.0.0.1:${process.env.VC_W03_FIXTURE_PORT}`;
    await waitFor(async () => !(await (await fetch(`${base}/__voice/state`)).json())[engine]?.active, { label: 'voice idle', timeoutMs: 30000 });
    const result = await fetch(`${base}/__voice/ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine, ...plan }) });
    assert.equal(result.status, 200);
}
export async function voiceShots(page, ctx, id, name) {
    const dir = path.resolve(process.cwd(), '.review-queue', id);
    fs.mkdirSync(dir, { recursive: true });
    for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.evaluate((value) => { localStorage.setItem('vc-theme', value); document.documentElement.setAttribute('data-vc-theme', value); }, theme);
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), 'voice viewport overflow');
        const file = path.join(dir, `${name}-${width}-${theme}.png`);
        await page.screenshot({ path: file }); ctx.screenshots?.push(file);
    }
    fs.writeFileSync(path.join(dir, 'NOTES.md'), `# ${id}\n\n语音条与设置沿用现有组件、语义颜色和 44px 触控区。截图只含合成验收数据。\n390/1440 浅深色、横向溢出及对应场景交互断言已检查；请结合本批次受管结果复核。\n`);
}
export async function openVoiceChat(ctx, label = '语音验收') {
    await reauthForWrite(ctx);
    const purposes = await ctx.admin.listPurposes();
    const purpose = purposes.json.find((item) => item.purpose === 'FOREGROUND_CHAT');
    assert.equal((await ctx.admin.savePurpose('FOREGROUND_CHAT', { providerId: 'vc03m-chat', profileKey: 'chat', state: 'ENABLED', expectedRevision: purpose.revision })).status, 200);
    for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
        await voiceCall(ctx, 'PUT', '/api/v1/consents', { consentType, version: 'voice-fixture', granted: true });
    }
    ctx.w10.psql(ownerBudgetResetSql(ctx.w05.ownerId));
    let settings = await voiceCall(ctx, 'GET', '/api/v1/voice/settings');
    const { revision, updatedAt, ...values } = settings;
    settings = await voiceCall(ctx, 'PUT', '/api/v1/voice/settings', { ...values, kokoroEnabled: true, dailyChatLimit: 60, kokoroTimeoutSeconds: 60, expectedRevision: revision });
    await voiceControl('kokoro');
    const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session,
        extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
    const card = await importSyntheticCard(st, label);
    const file = `voice-${crypto.randomUUID()}`;
    const identity = crypto.randomUUID();
    const result = await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file,
        chat: [{ user_name: 'unused', character_name: card.name, chat_metadata: { vc_f2: { id: identity, revision: 0 }, vc_binding: { mode: 'COMPANION', displayName: label } } },
            { name: card.name, is_user: false, mes: '合成语音验收。', extra: {} }], force: false });
    assert.equal(result.status, 200);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
    try {
        const bc = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await bc.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase },
        ]);
        await bc.addInitScript(() => { localStorage.setItem('vc-ui', 'on'); localStorage.setItem('vc-theme', 'light'); });
        const page = await bc.newPage();
        await page.goto(ctx.w05.stBase);
        await page.waitForFunction(() => Boolean(window.SillyTavern?.getContext?.()?.eventSource));
        await page.waitForFunction(async () => (await import('/script.js')).settingsReady || document.querySelector('dialog[open] .onboarding'));
        const onboarding = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
        if (await onboarding.count()) { await onboarding.locator('textarea').fill('合成验收用户'); await onboarding.locator('.popup-button-ok').click(); }
        await page.waitForFunction(async () => (await import('/script.js')).settingsReady);
        await page.waitForSelector('#preloader', { state: 'hidden' });
        await openStCharacterChat(page, { avatar: card.avatar, file });
        await page.waitForFunction(() => typeof document.querySelector('#vc-shell')?.openConversation === 'function');
        await page.evaluate(async () => {
            const c = SillyTavern.getContext();
            await document.querySelector('#vc-shell').openConversation({ characterIndex: Number(c.characterId), file: c.chatId, name: c.characters[c.characterId].name, avatar: c.characters[c.characterId].avatar });
        });
        await page.waitForFunction(() => Boolean(SillyTavern.getContext().chatMetadata.vc_binding?.relationshipId));
        await page.waitForFunction(() => !document.querySelector('#send_form')?.classList.contains('no-connection'));
        return { browser, page, st, card, file, identity, settings };
    } catch (error) { await browser.close(); throw error; }
}
export async function sendVoiceTurn(page, ctx, { text = '想听你的声音', reply = '我在呀<voice/>' } = {}) {
    await ctx.fixtureHttp.setOverride('vc03m-chat', { text: reply, chunks: 1, delay: { firstMs: 20, perChunkMs: 10 } });
    const count = await page.locator('#chat > .mes').count();
    await page.locator('#send_textarea').fill(text);
    await page.locator('#send_but').click();
    await page.waitForFunction((before) => SillyTavern.getContext().chat.length >= before + 2 && !SillyTavern.getContext().chat.at(-1)?.is_user && document.body.getAttribute('data-generating') !== 'true', count, { timeout: 45000 });
}
