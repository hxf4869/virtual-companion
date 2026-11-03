// DR-3：设置与共享账户/语音表单；只有本机合成 API，不触达运行实例。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { startPreview, settle } from './lib/ux11-preview.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = path.join(ROOT, '.review-queue/DR-3');
const REFERENCES = ['voice-settings.js', 'data-rights.js', 'desktop/settings-shell.js', 'consent.js', 'account.css', 'settings-pages.css'];

async function voiceInteraction(page, open) {
    await open(1440, 'light', 'settings', 'voice');
    await page.evaluate(() => {
        window.DR_VOICE_PUTS = [];
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => {
            if (String(url).endsWith('/voice/settings') && init.method === 'PUT') {
                const body = JSON.parse(init.body);
                window.DR_VOICE_PUTS.push({ expectedRevision: body.expectedRevision, dailyChatLimit: body.dailyChatLimit, kokoroEnabled: body.kokoroEnabled, rate: body.proactiveVoiceRates.care });
                if (window.DR_VOICE_CONFLICT) return Promise.resolve(new Response(JSON.stringify({ code: 'REVISION_CONFLICT' }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
                return new Promise(resolve => { window.DR_VOICE_RESUME = () => resolve(fetch(url, init)); });
            }
            return fetch(url, init);
        };
    });
    const daily = page.locator('[data-voice-field="dailyChatLimit"]');
    const save = page.locator('.vc-settings-header .vc-btn-fill');
    await daily.fill('61');
    await page.evaluate(() => { window.DR_VOICE_NODE = document.querySelector('[data-voice-field="dailyChatLimit"]'); });
    await page.locator('[data-voice-field="kokoroEnabled"]').click();
    assert.equal(await page.evaluate(() => window.DR_VOICE_NODE.isConnected), true, '开关变化不重建其他语音输入');
    await page.locator('.vc-settings-voice summary').filter({ hasText: '发送比例' }).click();
    await page.locator('[data-voice-field="rate:care"]').fill('37');
    await save.click();
    await page.waitForFunction(() => window.DR_VOICE_PUTS.length === 1);
    assert.equal(await daily.isDisabled(), true);
    assert.equal(await save.isDisabled(), true);
    await page.evaluate(() => window.VC_SETTINGS_PREVIEW.select('account'));
    assert.equal(await page.locator('.vc-settings-voice').count(), 1, '保存等待期间不能切走语音设置');
    await save.evaluate(el => el.click());
    assert.equal(await page.evaluate(() => window.DR_VOICE_PUTS.length), 1);
    await page.evaluate(() => window.DR_VOICE_RESUME());
    await page.waitForFunction(() => document.querySelector('.vc-settings-header .vc-btn-fill')?.textContent === '保存');
    assert.deepEqual(await page.evaluate(() => window.DR_VOICE_PUTS[0]), { expectedRevision: 1, dailyChatLimit: 61, kokoroEnabled: false, rate: .37 });
    assert.equal(await daily.isDisabled(), false);
    assert.equal(await save.isDisabled(), true);
    await daily.fill('62');
    await page.evaluate(() => { window.DR_VOICE_CONFLICT = true; });
    await save.click();
    await page.waitForFunction(() => document.querySelector('.vc-settings-body [role="status"]')?.textContent.includes('你的输入已保留'));
    assert.equal(await daily.inputValue(), '62');
    assert.equal(await daily.isDisabled(), false);
    await page.evaluate(() => { window.DR_RETIRED_VOICE_SAVE = document.querySelector('.vc-settings-header .vc-btn-fill'); });
    await page.locator('[data-category="account"]').click();
    await page.locator('[data-vc-ok]').click();
    await page.locator('.vc-settings-profile').waitFor();
    await page.evaluate(async () => {
        window.DR_RETIRED_VOICE_SAVE.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.evaluate(() => window.DR_VOICE_PUTS.length), 2, '卸载后的旧语音按钮不得再发出写请求');
    await open(1440, 'light', 'settings', 'voice');
    await page.locator('[data-voice-field="dailyChatLimit"]').fill('61');
    await page.evaluate(() => { window.DR_SIDEBAR_RETIRED_SAVE = document.querySelector('.vc-settings-header .vc-btn-fill'); });
    await page.locator('#vc-shell .vc-sidebar [data-nav="characters"]').click();
    await page.locator('[data-vc-ok]').click();
    await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.settings !== 'page');
    await page.evaluate(() => window.VC_SETTINGS_PREVIEW.select('account', { initial: true }));
    await page.evaluate(async () => {
        window.DR_SIDEBAR_RETIRED_SAVE.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.evaluate(() => window.__previewRequests.filter(row => row.method === 'PUT' && row.path.endsWith('/voice/settings')).length), 0, '侧栏放弃语音草稿后销毁旧保存动作');
}

async function sharedVoiceInteraction(page, open) {
    await open(390, 'light', 'voice', 'global');
    await page.evaluate(() => {
        window.DR_SHARED_PUTS = [];
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => {
            if (String(url).endsWith('/voice/settings') && init.method === 'PUT') {
                window.DR_SHARED_PUTS.push(JSON.parse(init.body).dailyChatLimit);
                return new Promise(resolve => { window.DR_SHARED_RESUME = () => resolve(fetch(url, init)); });
            }
            return fetch(url, init);
        };
    });
    const form = page.locator('[data-voice-settings="global"]');
    await form.locator('[data-voice-field="dailyChatLimit"]').fill('61');
    await page.locator('.vc-sheet-done').click();
    await page.waitForFunction(() => window.DR_SHARED_PUTS.length === 1);
    assert.equal(await form.locator('[data-voice-field="dailyChatLimit"]').isDisabled(), true, '共享语音表单保存等待时不可继续输入');
    await page.keyboard.press('Escape');
    assert.equal(await form.count(), 1, '保存等待期间不能关闭');
    await page.evaluate(() => window.DR_SHARED_RESUME());
    await form.waitFor({ state: 'detached' });
    await page.evaluate(async () => { const m = await import('/source/voice-settings.js'); await m.openGlobalVoiceSettings(); });
    await form.locator('[data-voice-field="dailyChatLimit"]').waitFor();
    assert.equal(await form.locator('[data-voice-field="dailyChatLimit"]').inputValue(), '61');
    await page.keyboard.press('Escape');
    await form.waitFor({ state: 'detached' });
    await page.evaluate(async () => { const m = await import('/source/voice-settings.js'); await m.openRelationshipVoiceSettings('11'); });
    const relationship = page.locator('[data-voice-settings="relationship"]');
    await relationship.locator('[data-voice-field="kokoroVoice"]').selectOption('zm_010');
    const speed = relationship.locator('[data-voice-field="speed"]');
    await speed.focus(); await speed.press('ArrowRight'); await speed.press('ArrowRight');
    assert.equal(await speed.inputValue(), '1.2');
    await relationship.locator('[data-voice-field="voiceFrequency"]').selectOption('HIGH');
    await page.locator('.vc-sheet-done').click();
    await relationship.waitFor({ state: 'detached' });
    await page.evaluate(async () => { const m = await import('/source/voice-settings.js'); await m.openRelationshipVoiceSettings('11'); });
    await relationship.locator('[data-voice-field="kokoroVoice"]').waitFor();
    assert.equal(await relationship.locator('[data-voice-field="kokoroVoice"]').inputValue(), 'zm_010');
    assert.equal(await relationship.locator('[data-voice-field="speed"]').inputValue(), '1.2');
    assert.equal(await relationship.locator('[data-voice-field="voiceFrequency"]').inputValue(), 'HIGH');
    await page.evaluate(() => {
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => String(url).endsWith('/voice/preview')
            ? new Promise(resolve => { window.DR_PREVIEW_RESUME = resolve; }) : fetch(url, init);
    });
    await relationship.locator('[data-preview-engine="kokoro"]').click();
    await page.waitForFunction(() => typeof window.DR_PREVIEW_RESUME === 'function');
    await relationship.locator('[data-voice-field="kokoroVoice"]').selectOption('zf_001');
    await page.evaluate(async () => {
        window.DR_PREVIEW_RESUME(new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await relationship.locator('[role="status"]').textContent(), '', '旧音色的试听结果不能覆盖新选择');
    await page.keyboard.press('Escape');
    await page.locator('.vc-alert').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.vc-alert').waitFor({ state: 'detached' });
    assert.equal(await relationship.locator('[data-voice-field="kokoroVoice"]').inputValue(), 'zf_001', '取消离开保留音色草稿');
    await page.evaluate(() => { window.DR_PREVIEW_RESUME = undefined; });
    await relationship.locator('[data-preview-engine="kokoro"]').click();
    await page.waitForFunction(() => typeof window.DR_PREVIEW_RESUME === 'function');
    await page.keyboard.press('Escape');
    await page.locator('[data-vc-ok]').click();
    await relationship.waitFor({ state: 'detached' });
    await page.evaluate(async () => {
        window.DR_PREVIEW_RESUME(new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.locator('.vc-sheet').count(), 0, '已关闭声音表单不因试听晚到而重挂载');
}

async function overviewInteraction(page, open) {
    await open(1440, 'light', 'settings', 'account');
    await page.evaluate(() => { window.DR_RETIRED_ACCOUNT = document.querySelector('[data-account-go="password"]'); });
    await page.locator('[data-category="notifications"]').click();
    await page.evaluate(() => window.DR_RETIRED_ACCOUNT.click());
    assert.equal(await page.locator('.vc-data-dialog[open]').count(), 0, '卸载后的账户入口不再打开旧账户流程');
    await page.evaluate(() => {
        window.DR_NOTIFY_CALLS = 0; window.DR_NOTIFY_CREATED = 0;
        class SyntheticNotification {
            static permission = 'default';
            static requestPermission() {
                window.DR_NOTIFY_CALLS += 1;
                return new Promise(resolve => { window.DR_NOTIFY_RESUME = permission => { SyntheticNotification.permission = permission; resolve(permission); }; });
            }
            constructor() { window.DR_NOTIFY_CREATED += 1; }
        }
        window.Notification = SyntheticNotification;
    });
    const toggle = page.getByRole('switch', { name: '桌面通知', exact: true });
    await toggle.click();
    await page.waitForFunction(() => typeof window.DR_NOTIFY_RESUME === 'function');
    assert.equal(await toggle.isDisabled(), true, '权限请求等待期间不重复触发开关');
    await page.locator('[data-category="account"]').click();
    await page.evaluate(async () => {
        window.DR_NOTIFY_RESUME('denied');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.locator('.vc-toast').count(), 0, '已卸载的通知页不再显示旧请求反馈');
    await page.locator('[data-category="notifications"]').click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await toggle.click();
    await page.getByText('浏览器没有允许通知，可在浏览器的网站设置里打开', { exact: true }).waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    assert.equal(await page.evaluate(() => window.DR_NOTIFY_CALLS), 1, '已拒绝的权限不再弹出请求');
    assert.equal(await page.evaluate(() => window.DR_NOTIFY_CREATED), 0, '设置不发送任何真实通知');
}

async function accountInteraction(page, open) {
    await open(1440, 'light', 'components', '');
    await page.evaluate(async () => {
        document.body.classList.remove('vc-ui');
        window.DR_ACCOUNT_RESETS = 0;
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => {
            if (String(url).endsWith('/auth/reauth')) return new Promise(resolve => { window.DR_ACCOUNT_AUTH_RESUME = resolve; });
            if (String(url).includes('/authenticator-reset')) { window.DR_ACCOUNT_RESETS += 1; return Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } })); }
            return fetch(url, init);
        };
        const { mountDataRights } = await import('/source/data-rights.js');
        window.DR_ACCOUNT = mountDataRights();window.DR_ACCOUNT.open();
    });
    await page.waitForFunction(() => document.querySelector('[data-auth]')?.textContent.includes('已启用'));
    await page.locator('[data-reset]').click();
    const password = page.locator('[data-reauth-password]');
    await password.fill('synthetic-password');
    assert.equal(await password.getAttribute('value'), null, '当前密码不得进入静态属性');
    await page.locator('[data-reauth] button[type="submit"]').click();
    await page.waitForFunction(() => typeof window.DR_ACCOUNT_AUTH_RESUME === 'function');
    assert.equal(await page.locator('[data-close]').isDisabled(), true, '敏感操作验证等待时不能从普通账户入口关闭');
    assert.equal(await password.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.DR_ACCOUNT_RESETS), 0, '先重认证，后执行敏感操作');
    await page.evaluate(() => window.DR_ACCOUNT.close());
    assert.equal(await page.locator('.vc-data-dialog').evaluate(el => el.open), true, '等待期间离开守卫仍有效');
    await page.evaluate(() => window.DR_ACCOUNT_AUTH_RESUME(new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    await page.waitForFunction(() => document.querySelector('[data-auth]')?.textContent.includes('未启用'));
    assert.equal(await page.evaluate(() => window.DR_ACCOUNT_RESETS), 1);
    assert.equal(await password.inputValue(), '');
    assert.equal(await password.getAttribute('value'), null);
    assert.equal(await page.locator('[data-close]').isDisabled(), false);
    await page.evaluate(() => window.DR_ACCOUNT.close());
    assert.equal(await page.locator('.vc-data-dialog').evaluate(el => el.open), false);
    await page.evaluate(() => {
        document.body.classList.add('vc-ui');
        const fetch = window.fetch;
        window.fetch = (url, init = {}) => String(url).endsWith('/auth/trusted-devices')
            ? Promise.resolve(new Response(JSON.stringify([{ id: '71', displayName: '合成设备' }]), { headers: { 'Content-Type': 'application/json' } })) : fetch(url, init);
        window.DR_ACCOUNT.open();
    });
    await page.waitForFunction(() => document.querySelector('[data-trusted-devices]')?.hidden === false);
    await page.locator('[data-vc-account-go="devices"]').click();
    await page.locator('[data-revoke-device]').click();
    await page.locator('.vc-alert').waitFor();
    await page.evaluate(async () => {
        window.DR_ACCOUNT.close();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.locator('.vc-alert').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.vc-alert').count(), 0, '关闭账户流程同时释放嵌套确认框及其键盘监听');
}

async function accountActionsInteraction(page, open) {
    for (const action of ['password', 'export', 'recover', 'consent-revoke', 'sessions', 'device', 'delete']) {
        await open(1440, 'light', 'components', '');
        await page.evaluate(async action => {
            window.DR_ACCOUNT_EVENTS = []; window.DR_ACCOUNT_BODY_OK = true;
            let consentGranted = true, deleting = false;
            const fetch = window.fetch;
            const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
            window.fetch = async (url, init = {}) => {
                const path = new URL(String(url), location.href).pathname, method = init.method || 'GET';
                if (method === 'GET' && path.endsWith('/auth/session') && deleting) return json({ accountId: '1', sessionId: '42', role: 'ADMIN', deletionPending: true });
                if (method === 'GET' && path.endsWith('/auth/sessions')) return json([{ id: '9007199254740993', current: true }, { id: '52', current: false }]);
                if (method === 'GET' && path.endsWith('/auth/trusted-devices')) return json([{ id: '71', displayName: '合成设备' }]);
                if (method === 'GET' && path.endsWith('/consents')) return json([{ consentType: 'SERVICE_TERMS', granted: consentGranted }]);
                if (path.endsWith('/auth/reauth')) { window.DR_ACCOUNT_EVENTS.push('reauth'); window.DR_ACCOUNT_BODY_OK &&= JSON.parse(init.body).password === 'synthetic-current'; return json({}); }
                if (path.endsWith('/auth/password') && method === 'POST') {
                    const body = JSON.parse(init.body);window.DR_ACCOUNT_EVENTS.push('password');window.DR_ACCOUNT_BODY_OK &&= body.currentPassword === 'synthetic-current' && body.newPassword === 'synthetic-next-password';return json({});
                }
                if (method === 'POST' && (path.endsWith('/exports') || path.endsWith('/exports/recover'))) {
                    window.DR_ACCOUNT_EVENTS.push(path.endsWith('/recover') ? 'recover' : 'export');window.DR_ACCOUNT_BODY_OK &&= JSON.parse(init.body).currentPassword === 'synthetic-current';return json({ exportId: 'synthetic-export', status: 'READY', downloadUrl: '/api/v1/exports/synthetic/download' });
                }
                if (method === 'PUT' && path.endsWith('/consents')) {
                    const body = JSON.parse(init.body);window.DR_ACCOUNT_EVENTS.push('consent-revoke');window.DR_ACCOUNT_BODY_OK &&= body.currentPassword === 'synthetic-current' && body.consentType === 'SERVICE_TERMS' && body.granted === false;consentGranted = false;return json({});
                }
                if (method === 'DELETE' && path.endsWith('/auth/sessions/52')) { window.DR_ACCOUNT_EVENTS.push('sessions');return json({}); }
                if (method === 'DELETE' && path.endsWith('/auth/trusted-devices/71')) { window.DR_ACCOUNT_EVENTS.push('device');return json({}); }
                if (method === 'DELETE' && path.endsWith('/auth/api/account')) { window.DR_ACCOUNT_EVENTS.push('delete');window.DR_ACCOUNT_BODY_OK &&= JSON.parse(init.body).currentPassword === 'synthetic-current';deleting = true;return json({ status: 'PENDING', pendingDomains: ['CHAT'] }); }
                return fetch(url, init);
            };
            const { mountDataRights } = await import('/source/data-rights.js');window.DR_ACCOUNT = mountDataRights();window.DR_ACCOUNT.open();
        }, action);
        await page.waitForFunction(() => document.querySelector('[data-auth]')?.textContent.includes('已启用'));
        if (action === 'password') {
            await page.locator('[data-vc-account-go="password"]').click();
            const input = page.locator('[name="newPassword"]');
            await input.fill('synthetic-next-password');assert.equal(await input.getAttribute('value'), null);
            await page.locator('[data-password] button[type="submit"]').click();
            assert.equal(await input.inputValue(), '', '进入重认证后清除新密码字段');
        } else if (action === 'export' || action === 'recover') {
            await page.locator('[data-vc-account-go="export"]').click();await page.locator(`[data-${action}]`).click();
        } else if (action === 'consent-revoke') {
            await page.locator('[data-vc-account-go="consent"]').click();await page.locator('[data-consent-revoke="SERVICE_TERMS"]').click();await page.locator('[data-vc-ok]').click();
        } else if (action === 'sessions') {
            await page.locator('[data-vc-account-go="sessions"]').click();await page.locator('[data-revoke-others]').click();
        } else if (action === 'device') {
            await page.locator('[data-vc-account-go="devices"]').click();await page.locator('[data-revoke-device="71"]').click();await page.locator('[data-vc-ok]').click();
        } else {
            await page.locator('[data-vc-account-go="delete"]').click();await page.locator('[data-delete] button[type="submit"]').click();await page.locator('[data-vc-ok]').click();
        }
        const sensitive = !['sessions', 'device'].includes(action);
        if (sensitive) {
            await page.locator('[data-reauth-password]').fill('synthetic-current');
            assert.equal(await page.locator('[data-reauth-password]').getAttribute('value'), null);
            await page.locator('[data-reauth] button[type="submit"]').click();
        }
        try {
            await page.waitForFunction(action => window.DR_ACCOUNT_EVENTS.includes(action) && (action === 'sessions'
                ? document.querySelector('[data-session-status]')?.textContent === '其他会话已登出'
                : action === 'device' ? !document.querySelector('[data-revoke-device]') : document.querySelector('.vc-account-reauth').hidden), action, { timeout: 6000 });
        } catch (error) {
            const status = await page.evaluate(() => ({ events: window.DR_ACCOUNT_EVENTS, open: document.querySelector('.vc-data-dialog')?.open, session: document.querySelector('[data-session-status]')?.textContent, rows: document.querySelectorAll('.vc-account-session').length, device: document.querySelector('[data-device-status]')?.textContent }));
            throw new Error(`账户 ${action} 未完成：${JSON.stringify(status)}`, { cause: error });
        }
        assert.deepEqual(await page.evaluate(() => window.DR_ACCOUNT_EVENTS), sensitive ? ['reauth', action] : [action], `${action} 沿用原动作和验证顺序`);
        assert.equal(await page.evaluate(() => window.DR_ACCOUNT_BODY_OK), true, `${action} 沿用原载荷`);
        if (action === 'password') assert.equal(await page.locator('[data-password-status]').textContent(), '密码已修改，请重新登录。');
        if (action === 'export' || action === 'recover') assert.equal(await page.locator('[data-download]').isVisible(), true);
        if (action === 'consent-revoke') await page.waitForFunction(() => document.querySelector('[data-consent-type="SERVICE_TERMS"] .vc-consent-meta')?.textContent === '未同意');
        if (action === 'sessions') assert.equal(await page.locator('.vc-account-session').count(), 1);
        if (action === 'device') assert.equal(await page.locator('[data-revoke-device]').count(), 0);
        if (action === 'delete') {
            assert.equal(await page.locator('[data-delete]').getAttribute('hidden'), '');
            assert.ok((await page.locator('[data-delete-status]').textContent()).includes('账号删除未完成'));
        }
    }
}

export async function runDesktopSettings({ captureReference = false, compareReference = false, voiceOnly = false, sharedOnly = false, overviewOnly = false, accountOnly = false } = {}) {
    await mkdir(path.join(OUT, captureReference ? 'before' : 'after'), { recursive: true });
    const preview = await startPreview();
    let browser;
    try {
        const { chromium } = await import('playwright-core');
        browser = await chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : { channel: 'chrome' }), args: ['--disable-partial-raster', '--disable-gpu', '--disable-lcd-text', '--force-color-profile=srgb'] });
        const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' });
        await context.addInitScript(() => { localStorage.clear(); localStorage.setItem('vc-reduced-motion', 'true'); });
        const page = await context.newPage();
        await page.clock.install({ time: new Date('2026-11-02T04:00:00Z') });
        if (captureReference) {
            const sources = new Map(await Promise.all(REFERENCES.map(async file => [file, await readFile(path.join(OUT, 'reference', file), 'utf8')])));
            await page.route('**/source/**', route => {
                const file = new URL(route.request().url()).pathname.split('/source/')[1];
                return sources.has(file) ? route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', body: sources.get(file) }) : route.continue();
            });
        }
        // DR-3冻结时，共享语音表单背后还是旧角色样板（搜索占位为“搜索”）。
        // 只为历史截图回放同一Git背景；当前角色生产实现另由DR-5验收，交互前解除路由。
        const backdropRoutes = [
            ['**/views/characters.js', 'docs/product/v2-redesign/ux11/views/characters.js'],
            ['**/source/instance-page.js', 'integrations/sillytavern/extension/vc-model-settings/instance-page.js'],
            ['**/source/persona.js', 'integrations/sillytavern/extension/vc-model-settings/persona.js'],
        ];
        if (captureReference || compareReference) for (const [pattern, file] of backdropRoutes) {
            const body = execFileSync('git', ['show', `a8b240e2:${file}`], {cwd:ROOT, encoding:'utf8'});
            await page.route(pattern, route => route.fulfill({contentType:'text/javascript', body}));
        }
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        async function open(width, theme, view, screen, state = '') {
            await page.setViewportSize({ width, height: width < 744 ? 844 : 900 });
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await page.goto(`${preview.url}frame.html?view=${view}&screen=${screen}&theme=${theme}${state ? `&state=${state}` : ''}`);
            await settle(page);
        }
        let shots = 0;
        async function snapshot(name) {
            const png = await page.screenshot({ animations: 'disabled' });
            const target = path.join(OUT, captureReference ? 'before' : 'after', name);
            if (captureReference) {
                try { await writeFile(target, png, { flag: 'wx' }); }
                catch (error) {
                    if (error.code !== 'EEXIST') throw error;
                    const a = PNG.sync.read(png), b = PNG.sync.read(await readFile(target));
                    assert.ok(a.width === b.width && a.height === b.height && a.data.equals(b.data), `${name} 冻结旧实现不匹配，禁止覆盖参照`);
                }
            } else await writeFile(target, png);
            // DR-4修复的6个旧异常：祖先[hidden]曾把图标隐藏、文案挤进40px首列。
            // 保留旧图；这些异常改验正确两列几何，其余正常状态仍全图零差异。
            const repairedAlert = /^account-1440-(light|dark)-(device|delete|consent)-confirm\.png$/.test(name);
            if (!captureReference && repairedAlert) {
                const geometry = await page.locator('.vc-alert').evaluate(el => { const a=el.getBoundingClientRect(), c=el.querySelector('.vc-alert-copy').getBoundingClientRect(), i=el.querySelector('.vc-alert-icon').getBoundingClientRect(); return { width:a.width, copy:c.width, icon:i.width, aligned:c.left>=i.right }; });
                assert.ok(geometry.icon===40 && geometry.copy>geometry.width/2 && geometry.aligned, `${name} 恢复图标/文案两列`);
            }
            if (compareReference && !repairedAlert) {
                const a = PNG.sync.read(png), b = PNG.sync.read(await readFile(path.join(OUT, 'before', name)));
                assert.ok(a.width === b.width && a.height === b.height && a.data.equals(b.data), `${name} 与迁移前状态不同`);
            }
            shots += 1;
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name} 文档不得横向溢出`);
        }
        if (!voiceOnly && !sharedOnly && !overviewOnly && !accountOnly) {
        for (const width of [1440, 864]) for (const theme of ['light', 'dark']) for (const screen of ['voice', 'account', 'notifications', 'data']) {
            await open(width, theme, 'settings', screen);
            await snapshot(`settings-${width}-${theme}-${screen}.png`);
        }
        for (const theme of ['light', 'dark']) for (const state of ['loading', 'error']) {
            await open(1440, theme, 'settings', 'voice', state);
            await snapshot(`settings-1440-${theme}-voice-${state}.png`);
        }
        for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const screen of ['global', 'relationship']) {
            await open(width, theme, 'voice', screen);
            await snapshot(`voice-${width}-${theme}-${screen}.png`);
        }
        for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const screen of ['home', 'password', 'auth', 'sessions', 'consent', 'export', 'delete', 'reauth']) {
            await open(width, theme, 'components', '');
            await page.evaluate(async () => {
                const { mountDataRights } = await import('/source/data-rights.js');
                window.DR_ACCOUNT = mountDataRights();
                window.DR_ACCOUNT.open();
            });
            await page.waitForFunction(() => document.querySelector('[data-auth]')?.textContent.includes('已启用'));
            if (screen !== 'home') {
                await page.locator(`[data-vc-account-go="${screen === 'reauth' ? 'auth' : screen}"]`).click();
                if (screen === 'reauth') await page.locator('[data-reset]').click();
            }
            await settle(page);
            await snapshot(`account-${width}-${theme}-${screen}.png`);
        }
        for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const state of ['loading', 'error']) {
            await open(width, theme, 'components', '', state);
            await page.evaluate(async () => { const { mountDataRights } = await import('/source/data-rights.js'); window.DR_ACCOUNT = mountDataRights(); window.DR_ACCOUNT.open(); });
            await settle(page);
            await snapshot(`account-${width}-${theme}-${state}.png`);
        }
        for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const screen of ['devices', 'device-confirm', 'delete-confirm', 'consent-confirm']) {
            await open(width, theme, 'components', '');
            await page.evaluate(async () => {
                const fetch = window.fetch;
                window.fetch = (url, init = {}) => String(url).endsWith('/auth/trusted-devices')
                    ? Promise.resolve(new Response(JSON.stringify([{ id: '71', displayName: '合成设备', lastUsedAt: '2026-11-01T04:00:00Z', expiresAt: '2026-12-01T04:00:00Z' }]), { headers: { 'Content-Type': 'application/json' } })) : fetch(url, init);
                const { mountDataRights } = await import('/source/data-rights.js');window.DR_ACCOUNT = mountDataRights();window.DR_ACCOUNT.open();
            });
            await page.waitForFunction(() => document.querySelector('[data-trusted-devices]')?.hidden === false);
            if (screen.startsWith('device')) {
                await page.locator('[data-vc-account-go="devices"]').click();
                if (screen === 'device-confirm') await page.locator('[data-revoke-device]').click();
            } else if (screen === 'delete-confirm') {
                await page.locator('[data-vc-account-go="delete"]').click();
                await page.locator('[data-delete] button[type="submit"]').click();
            } else {
                await page.locator('[data-vc-account-go="consent"]').click();
                await page.locator('[data-consent-revoke]').first().click();
            }
            if (screen !== 'devices') await page.locator('.vc-alert').waitFor();
            await settle(page);await snapshot(`account-${width}-${theme}-${screen}.png`);
        }
        }
        const checked = [];
        if (!captureReference) {
            for (const [pattern] of backdropRoutes) await page.unroute(pattern);
            if (!sharedOnly && !overviewOnly && !accountOnly) { await voiceInteraction(page, open); checked.push('桌面语音'); }
            if (!voiceOnly && !overviewOnly && !accountOnly) { await sharedVoiceInteraction(page, open); checked.push('共享语音/试听'); }
            if (!voiceOnly && !sharedOnly && !accountOnly) { await overviewInteraction(page, open); checked.push('账户入口/通知'); }
            if (!voiceOnly && !sharedOnly && !overviewOnly) { await accountInteraction(page, open); await accountActionsInteraction(page, open); checked.push('敏感操作/密码边界'); }
        }
        assert.deepEqual(errors, [], '设置表单不得出现脚本错误');
        console.log(captureReference ? `[dr-settings] REFERENCE CAPTURED：${shots} 张旧视觉参照` : `[dr-settings] PASS：${shots} 张${compareReference ? '对照（正常状态逐像素；6个旧确认框验修复几何）' : '截图'}；${checked.join('、')}回归`);
    } finally {
        await browser?.close();
        await preview.close();
    }
}

export const desktopSettingsScene = { id: 'dr-settings', title: 'DR-3 语音与账户设置', needs: ['browser'], default: false, run: () => runDesktopSettings() };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runDesktopSettings({ captureReference: process.argv.includes('--capture-reference'), compareReference: process.argv.includes('--compare-reference'), voiceOnly: process.argv.includes('--check-voice'), sharedOnly: process.argv.includes('--check-shared'), overviewOnly: process.argv.includes('--check-overview'), accountOnly: process.argv.includes('--check-account') });
