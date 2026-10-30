// 无陪伴实例时出现引导，完成后建卡、开聊天并看到开场白；陪伴风格可改并可恢复默认。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackPageErrors } from './lib/page-errors.mjs';
import { reauthForWrite } from './lib/reauth-write.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';

const FIRST_MES = '在吗～ 刚下班，累瘫了。对了，以后我怎么叫你比较好？';
const SHOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dev-managed/artifacts/hl-persona');

function stBase() {
    return `http://127.0.0.1:${process.env.VC_W03_ST_PORT || 8752}`;
}

async function dismissWelcome(page) {
    const welcome = page.locator('dialog[open].popup').filter({ has: page.locator('.onboarding') });
    if (!(await welcome.count())) return;
    const name = welcome.locator('textarea, input[type="text"]');
    if (await name.first().isVisible().catch(() => false)) await name.first().fill('hl-persona');
    const ok = welcome.locator('.popup-button-ok');
    if (await ok.first().isVisible().catch(() => false)) {
        await ok.first().click();
        await welcome.first().waitFor({ state: 'hidden', timeout: 10000 });
    }
}

async function acceptConsent(page) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        const which = await page.evaluate(() => {
            const consent = document.getElementById('vc-consent');
            if (consent?.open) return 'consent';
            if (document.querySelector('.vc-onboarding input[name="name"]')) return 'onboarding';
            return '';
        });
        if (which === 'onboarding') return;
        if (which === 'consent') {
            await page.locator('[data-consent-accept]').click();
            await page.waitForFunction(() => {
                const node = document.getElementById('vc-consent');
                return !node || node.open === false;
            }, undefined, { timeout: 15000 });
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

async function shoot(page, name) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const files = [];
    for (const theme of ['light', 'dark']) {
        for (const [width, height] of [[390, 844], [1440, 900]]) {
            await page.setViewportSize({ width, height });
            await page.evaluate((mode) => {
                document.documentElement.setAttribute('data-vc-theme', mode);
                try { localStorage.setItem('vc-theme', mode); } catch { /* 截图仍写在属性上 */ }
            }, theme);
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const file = path.join(SHOT_DIR, `hl-persona-live-${width}-${theme}-${name}.png`);
            await page.screenshot({ path: file });
            files.push(file);
        }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
        document.documentElement.setAttribute('data-vc-theme', 'light');
        try { localStorage.setItem('vc-theme', 'light'); } catch { /* 流程继续用浅色 */ }
    });
    return files;
}

function relationshipRows(body) {
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.items)) return body.items;
    if (Array.isArray(body?.relationships)) return body.relationships;
    return [];
}

async function clearStCharacters(ctx) {
    if (typeof ctx.st?.call !== 'function') throw new Error('宿主客户端缺失');
    const listed = await ctx.st.call('POST', '/api/characters/all');
    if (listed.status !== 200 || !Array.isArray(listed.json)) throw new Error(`角色列表 HTTP ${listed.status}`);
    for (const card of listed.json) {
        const avatar = card?.avatar;
        if (!avatar) continue;
        const chats = await ctx.st.call('POST', '/api/characters/chats', { avatar_url: avatar, simple: true });
        const files = Array.isArray(chats.json) ? chats.json : [];
        const baselines = [];
        for (const item of files) {
            const fileName = String(item?.file_id || item?.file_name || '').replace(/\.jsonl$/, '');
            if (!fileName) continue;
            const got = await ctx.st.call('POST', '/api/chats/get', { avatar_url: avatar, file_name: fileName });
            if (got.status !== 200 || !Array.isArray(got.json)) throw new Error(`读取角色聊天 HTTP ${got.status}`);
            const token = got.json[0]?.chat_metadata?.vc_f2;
            if (!token?.id) throw new Error('角色聊天缺少读取基线');
            baselines.push({
                path: `chats/${String(avatar).replace(/\.png$/, '')}/${fileName}.jsonl`,
                expected: token,
            });
        }
        const deleted = await ctx.st.call('POST', '/api/characters/delete', {
            avatar_url: avatar,
            delete_chats: true,
            vc_f2_chats: baselines,
        });
        if (deleted.status !== 200) throw new Error(`清掉已有角色 HTTP ${deleted.status}`);
    }
}

async function clearCompanionInstances(ctx) {
    await reauthForWrite(ctx);
    const listed = await ctx.admin.call('GET', '/api/v1/relationships');
    if (listed.status !== 200) throw new Error(`读取关系 HTTP ${listed.status}`);
    const rows = relationshipRows(listed.json).filter((row) => row?.personaRef === 'st-character' || row?.persona_ref === 'st-character');
    for (const row of rows) {
        const id = row.relationshipId ?? row.relationship_id;
        const deleted = await ctx.admin.call('DELETE', `/api/v1/relationships/${id}?retainImportable=false`);
        if (deleted.status !== 200) throw new Error(`清掉已有陪伴 HTTP ${deleted.status}`);
    }
}

export async function sceneHlPersona(ctx) {
    await clearStCharacters(ctx);
    await clearCompanionInstances(ctx);
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
    let page = null;
    let pageErrors = { errors: [], assertNone() {} };
    const notes = [];
    const pending = new Set();
    try {
        const browserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await pinVcUi(browserContext, 'on');
        await browserContext.addInitScript(() => {
            localStorage.setItem('vc-theme', 'light');
        });
        await browserContext.addCookies([
            { name: 'vc_session', value: ctx.secrets.session.vcSession, url: base },
            { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: base },
        ]);
        page = await browserContext.newPage();
        pageErrors = trackPageErrors(page);
        page.on('console', (msg) => {
            if (msg.type() === 'error' || msg.type() === 'warning') notes.push(msg.text().slice(0, 160));
        });
        page.on('request', (req) => {
            if (req.url().includes('/api/')) pending.add(req.url().replace(base, ''));
        });
        page.on('requestfinished', (req) => pending.delete(req.url().replace(base, '')));
        page.on('requestfailed', (req) => {
            notes.push(`fail ${req.url().replace(base, '').slice(0, 120)}`);
            pending.delete(req.url().replace(base, ''));
        });
        await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => {
            const area = document.querySelector('dialog[open].popup textarea');
            const shown = area && area.getClientRects().length > 0 && getComputedStyle(area).visibility !== 'hidden';
            const app = document.body.classList.contains('vc-ui') || document.querySelector('.vc-onboarding') || document.getElementById('vc-consent');
            return shown || app;
        }, undefined, { timeout: 45000 });
        await dismissWelcome(page);
        await page.waitForFunction(() => document.body.classList.contains('vc-ui'), undefined, { timeout: 20000 });
        await acceptConsent(page);
        await page.waitForSelector('.vc-onboarding input[name="name"]', { state: 'visible', timeout: 20000 });
        await page.waitForFunction(() => !document.querySelector('.splash-screen'), undefined, { timeout: 20000 });
        const shots = await shoot(page, 'onboarding');
        ctx.screenshots?.push(...shots);
        await page.locator('.vc-onboarding input[name="name"]').fill('小满');
        await page.locator('.vc-onboarding [data-action="finish-onboarding"]').click();
        await page.waitForFunction((text) => {
            const alert = document.querySelector('.vc-onboarding [role="alert"]');
            if (alert?.textContent) return true;
            return [...document.querySelectorAll('.mes_text')].some((el) => (el.textContent || '').includes(text));
        }, '刚下班，累瘫了', { timeout: 60000 });
        const failed = await page.locator('.vc-onboarding [role="alert"]').textContent().catch(() => '');
        if (failed) throw new Error('引导没有完成');
        await page.waitForFunction(() => !document.querySelector('.vc-onboarding'), undefined, { timeout: 20000 });
        const chat = await page.evaluate((text) => {
            const messages = [...document.querySelectorAll('.mes_text')].map((el) => el.textContent || '');
            const ctxNow = window.SillyTavern?.getContext?.();
            const names = (ctxNow?.characters || []).map((card) => card?.name || card?.data?.name || '');
            return { messages: messages.some((item) => item.includes(text)), names: names.includes('小满') };
        }, FIRST_MES);
        assert.equal(chat.names, true, '导入后应有名为小满的角色卡');
        assert.equal(chat.messages, true, '开场白应出现在聊天里');
        const listed = await ctx.admin.call('GET', '/api/v1/relationships');
        assert.equal(listed.status, 200, '读取关系');
        const rows = relationshipRows(listed.json).filter((row) => row?.personaRef === 'st-character' || row?.persona_ref === 'st-character');
        assert.equal(rows.length, 1, '同一次引导只应建立一条陪伴关系');
        if (await page.evaluate(() => window.innerWidth < 744 && document.querySelector('#vc-shell')?.dataset.chat === 'open')) {
            await page.locator('#vc-shell [data-back]').first().click();
            await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.chat !== 'open');
        }
        await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('#vc-shell [data-settings]')];
            const visible = buttons.find((el) => el.getClientRects().length > 0);
            (visible || buttons[0])?.click();
        });
        await page.waitForSelector('.vc-settings-form [data-action="companion-style"]', { timeout: 10000 });
        await page.locator('.vc-settings-form [data-action="companion-style"]').click();
        const rules = page.locator('.vc-sheet textarea[data-field="rules"]');
        await rules.waitFor({ state: 'visible', timeout: 10000 });
        await rules.fill('临时风格');
        assert.equal(await rules.inputValue(), '临时风格');
        await page.locator('.vc-sheet [data-action="restore-rules"]').click();
        const restored = await rules.inputValue();
        assert.equal(restored.startsWith('你正在和{{user}}用手机聊天'), true, '恢复默认应写回全局规则');
        assert.equal(restored.includes('临时风格'), false);
        const styleShots = await shoot(page, 'style');
        ctx.screenshots?.push(...styleShots);
        pageErrors.assertNone();
        console.log('[accept] ✓ 引导建卡开聊，陪伴风格可恢复默认');
    } catch (error) {
        if (page) {
            fs.mkdirSync(SHOT_DIR, { recursive: true });
            await page.screenshot({ path: path.join(SHOT_DIR, 'hl-persona-failure.png') }).catch(() => {});
            const status = await page.evaluate(() => ({
                vc: document.body.classList.contains('vc-ui'),
                onboard: Boolean(document.querySelector('.vc-onboarding')),
                consent: Boolean(document.getElementById('vc-consent')),
                popups: [...document.querySelectorAll('dialog[open]')].map((el) => el.id || el.className).slice(0, 4),
            })).catch(() => null);
            if (status) error.message = `${error.message} status=${JSON.stringify(status)} pending=${JSON.stringify([...pending].slice(0, 6))} notes=${notes.slice(-4).join(' | ')} pageErrors=${pageErrors.errors.slice(0, 3).join(' | ')}`;
        }
        throw error;
    } finally {
        await browser.close();
    }
}

export const hlPersonaScene = {
    id: 'hl-persona',
    title: '首次引导、建卡开聊与陪伴风格',
    needs: ['catalog', 'stack', 'browser'],
    default: false,
    run: sceneHlPersona,
};
export const scenes = [hlPersonaScene];
