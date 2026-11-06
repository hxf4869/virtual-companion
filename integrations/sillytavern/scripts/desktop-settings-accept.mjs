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

// NF-06：同源正式候选、真实受管Go/ST边界；延迟聊天准备时产品设置仍可工作。
export async function sceneDesktopProductSettings(ctx) {
    const { createStClient, waitFor } = await import('./managed-lib.mjs');
    const { seedDesktopBenchmark, desktopBenchmarkContext } = await import('./desktop-startup-accept.mjs');
    const { openDesktopFixture } = await import('./desktop-chat-accept.mjs');
    const fixture = await seedDesktopBenchmark(ctx), other = await seedDesktopBenchmark(ctx);
    const st = createStClient({baseUrl:ctx.w05.stBase,expectedIdentity:ctx.secrets.session,
        extraCookies:`vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}`});
    const settings = JSON.parse((await st.call('POST','/api/settings/get',{})).json.settings);
    settings.extension_settings.vc_reply_planner = false; settings.extension_settings.EjsTemplate ||= {};
    Object.assign(settings.extension_settings.EjsTemplate,{compile_workers:false,sandbox:false});
    assert.equal((await st.call('POST','/api/settings/save',settings)).status,200);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({headless:true,...(process.env.VC_W03_CHROMIUM_PATH?{executablePath:process.env.VC_W03_CHROMIUM_PATH}:{})});
    const context = await desktopBenchmarkContext(browser,ctx), page = await context.newPage(), errors = [], forbidden = [];
    page.on('pageerror',error=>errors.push(error.name+': '+error.message));
    page.on('request',request=>{const pathname=new URL(request.url()).pathname;if(['/', '/script.js','/scripts/extensions.js','/scripts/st-context.js'].includes(pathname))forbidden.push(pathname);});
    let releaseRuntime;const runtimeGate=new Promise(resolve=>{releaseRuntime=resolve;});
    await page.route(url=>url.pathname.endsWith('/desktop/standalone/runtime.js')||url.pathname==='/version',async route=>{await runtimeGate;await route.continue();});
    const open = async category => {
        const shell = page.locator('#vc-shell');
        if (await shell.getAttribute('data-settings') !== 'open') {
            await page.locator('#vc-shell .vc-sidebar [data-settings]').click();
            await page.waitForFunction(() => document.querySelector('#vc-shell')?.dataset.settings === 'open');
        }
        await page.locator(`.vc-settings-categories [data-category="${category}"]`).click();
        await page.waitForFunction(cat => document.querySelector('.vc-settings-shell')?.dataset.category === cat, category);
    };
    const discard = async () => {
        const dialog = page.locator('[role="alertdialog"][data-open]');
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByRole('button', { name: '放弃', exact: true }).click();
        await page.locator('[role="alertdialog"]').waitFor({ state: 'hidden' });
    };
    const keep = async () => {
        const dialog = page.locator('[role="alertdialog"][data-open]');
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
        await page.locator('[role="alertdialog"]').waitFor({ state: 'hidden' });
    };
    const go = destination => page.locator(`#vc-shell .vc-sidebar [data-nav="${destination}"]`).click();
    const waitChat=()=>page.waitForFunction(()=>document.querySelector('#vc-shell')?.dataset.destination==='chat'&&document.querySelector('#vc-shell')?.dataset.settings!=='open');
    const provider = () => page.locator('[data-action="select-provider"][data-id="vc03m-chat"]');
    const selectProvider = async()=>{await open('model');await provider().click();await page.locator('#vcms-f-display').waitFor({state:'visible'});};
    const models = async()=>await ctx.fixtureHttp.count({protocol:'chat'})+await ctx.fixtureHttp.count({protocol:'responses'})+await ctx.fixtureHttp.count({protocol:'claude'});
    let stage='held-runtime';
    const at=value=>{stage=value;console.log(`[nf-settings] ${value}`);};
    const shots = async(category)=>{
        at(`screenshots-${category}`);
        for(const viewport of [{width:1440,height:900},{width:390,height:844}])for(const theme of ['light','dark']){
            await page.setViewportSize(viewport);
            await page.evaluate(async theme=>(await import('/scripts/extensions/third-party/vc-model-settings/ui/theme.js')).setThemeMode(theme),theme);
            await page.evaluate(async()=>{await document.fonts.ready;});
            await page.waitForFunction(()=>!document.getAnimations().some(animation=>
                animation.playState==='running'&&animation.effect?.getComputedTiming().iterations!==Infinity));
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            const geometry=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,
                inputs:[...document.querySelectorAll('.vc-settings-shell input:not([type="hidden"]),.vc-settings-shell select')].filter(node=>node.getClientRects().length).map(node=>{const b=node.getBoundingClientRect();return{left:b.left,right:b.right};})}));
            await page.screenshot({path:path.join(ctx.artifactsDir,`nf-settings-${category}-${viewport.width}-${theme}.png`)});
            assert.ok(geometry.overflow<=1);assert.ok(geometry.inputs.every(row=>row.left>=0&&row.right<=geometry.width+1),`设置控件不能越出窗口 ${JSON.stringify(geometry)}`);
            if(viewport.width===390&&category==='model'){
                const details=await page.evaluate(()=>({names:[...document.querySelectorAll('.vcms-protocol-name')].map(node=>{const range=document.createRange();range.selectNodeContents(node);const box=node.getBoundingClientRect();return [...range.getClientRects()].every(rect=>rect.right<=box.right+1&&rect.left>=box.left-1);}),
                    fields:['vcms-f-display','vcms-f-base'].map(id=>document.getElementById(id).getBoundingClientRect().width)}));
                assert.ok(details.names.every(Boolean),'窄窗口协议名称不得裁切');assert.ok(details.fields.every(width=>width>=240),'窄窗口配置值需要可核对的输入宽度');
            }
            if(viewport.width===390&&category==='appearance'){
                const right=await page.locator('[data-vc-appearance] .vc-switch').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().right));
                assert.ok(Math.max(...right)-Math.min(...right)<1,'外观开关应沿同一列对齐');
            }
        }
        await page.setViewportSize({width:1440,height:900});
    };
    try {
        await openDesktopFixture(page,ctx.w05.stBase,fixture);
        const voiceApi='**/api/v1/voice/settings';
        await page.route(voiceApi,route=>route.abort());
        await open('voice');await page.getByText('没有完成，请重试。',{exact:true}).waitFor();
        await page.unroute(voiceApi);
        await page.getByRole('button',{name:'加载最新',exact:true}).click();
        await page.locator('[data-voice-field="dailyChatLimit"]').waitFor({state:'visible'});
        await go('chat');await waitChat();
        await page.locator(`[data-convo-list] [data-relationship-id="${fixture.chat[0].chat_metadata.vc_binding.relationshipId}"]`).click();
        await page.waitForFunction(()=>document.querySelectorAll('#chat>.mes').length===24);
        await page.locator('#send_textarea').fill('NF06 保留草稿');
        await selectProvider();
        const before=await models();await page.locator('#vcms-f-display').fill('NF06 合成聊天服务');
        const saved=page.waitForResponse(response=>response.url().endsWith('/admin/providers/vc03m-chat')&&response.request().method()==='PUT');
        await page.locator('#vcms-save').click();assert.equal((await saved).status(),200);
        await waitFor(async()=> (await ctx.admin.listProviders()).json.find(row=>row.providerId==='vc03m-chat')?.displayName==='NF06 合成聊天服务',{label:'Go模型保存'});
        assert.equal(await models(),before,'保存设置不得自动生成');
        assert.equal(await page.locator('html').getAttribute('data-vc-runtime'),null,'聊天模块仍被真实延迟');
        at('leave-guard');
        await page.locator('#vcms-f-display').fill('NF06 尚未保存');await go('memory');await keep();
        assert.equal(await page.locator('#vc-shell').getAttribute('data-settings'),'open');assert.equal(await page.locator('#vcms-f-display').inputValue(),'NF06 尚未保存');
        const choosing=page.locator('.vc-settings-categories [data-category="voice"]').click();await discard();await choosing;
        const daily=page.locator('[data-voice-field="dailyChatLimit"]');await daily.waitFor({state:'visible'});
        const limit=Number(await daily.inputValue());await daily.fill(String(limit+1));
        let voiceRelease,voiceEntered;const voiceGate=new Promise(resolve=>{voiceRelease=resolve;}),voiceSeen=new Promise(resolve=>{voiceEntered=resolve;});
        await page.route('**/api/v1/voice/settings',async route=>{if(route.request().method()!=='PUT'){await route.continue();return;}const response=await route.fetch();voiceEntered(response.status());await voiceGate;await route.fulfill({response});});
        await page.locator('[data-voice-save]').click();assert.equal(await voiceSeen,200,'受管语音设置PUT必须成功');await go('chat');
        assert.equal(await page.locator('#vc-shell').getAttribute('data-settings'),'open','保存中程序导航不能离开');
        at('voice-save-settled');voiceRelease();await page.unroute('**/api/v1/voice/settings');
        await page.waitForFunction(()=>document.querySelector('[data-voice-save]')?.disabled&&!document.querySelector('[data-voice-field="dailyChatLimit"]')?.disabled);
        assert.equal((await ctx.admin.call('GET','/api/v1/voice/settings')).json.dailyChatLimit,limit+1);
        await shots('voice');
        at('account/appearance');
        await open('account');await page.locator('[data-open-account="password"]').click();
        await page.locator('[data-vc-screen="password"]').waitFor({state:'visible'});await page.keyboard.press('Escape');
        await page.locator('[data-vc-screen="password"]').waitFor({state:'hidden'});
        await open('appearance');
        const themePreferences=await page.evaluate(async key=>{const theme=await import('/scripts/extensions/third-party/vc-model-settings/desktop/theme.js');theme.setCharacterThemePreference(key,'aurora');return theme.readThemePreferences();},fixture.chat[0].chat_metadata.vc_binding.characterRef);
        await page.getByRole('radiogroup',{name:'外观',exact:true}).getByRole('radio',{name:'深色',exact:true}).click();
        await page.getByRole('radiogroup',{name:'回复样式',exact:true}).getByRole('radio',{name:'铺开',exact:true}).click();
        await open('account');await open('appearance');
        assert.equal(await page.getByRole('radio',{name:'深色',exact:true}).getAttribute('aria-checked'),'true');
        assert.equal(await page.evaluate(()=>localStorage.getItem('vc-reply-style')),'spread');
        assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('vc-desktop-theme'))),themePreferences,'外观保存保留已有角色覆盖');
        await shots('appearance');
        await open('notifications');await page.locator('[data-open-inbox]').waitFor({state:'visible'});assert.equal(await page.locator('[data-open-inbox]').count(),1);
        await open('data');assert.equal(await page.locator('[data-open-data]').count(),1);
        assert.equal(await models(),before);assert.deepEqual(forbidden,[]);
        at('hot-binding');
        releaseRuntime();await page.waitForFunction(()=>document.documentElement.dataset.vcRuntime==='prepared');
        await go('chat');await waitChat();await page.waitForFunction(()=>!document.querySelector('#send_but')?.disabled);
        await open('model');
        const listeners=await page.evaluate(()=>Object.fromEntries(Object.entries(SillyTavern.getContext().eventSource.events).map(([key,value])=>[key,value.length])));
        await page.getByRole('tab',{name:'用途绑定',exact:true}).click();
        const binding=page.locator('select[data-bind="binding.FOREGROUND_CHAT"]');await binding.selectOption('vc03m-resp::reasoning');
        const bound=page.waitForResponse(response=>response.url().endsWith('/model-purposes/FOREGROUND_CHAT')&&response.request().method()==='PUT');
        await page.locator('[data-action="save-bindings"]').click();assert.equal((await bound).status(),200);
        await page.locator('[data-action="save-bindings"]').waitFor({state:'hidden'});
        await go('chat');await waitChat();await page.waitForFunction(()=>!document.querySelector('#send_but')?.disabled);
        assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(SillyTavern.getContext().eventSource.events).map(([key,value])=>[key,value.length]))),listeners,'目录刷新不得重复注册钩子');
        assert.equal(await page.locator('#send_textarea').inputValue(),'NF06 保留草稿');
        await ctx.fixtureHttp.setOverride('vc03m-reasoning',{text:'NF06 合成新绑定回复。',chunks:2,tool:null});
        await page.locator('#send_but').click();await page.waitForFunction(()=>document.body.dataset.generating!=='true'&&SillyTavern.getContext().chat.at(-1).mes==='NF06 合成新绑定回复。');
        const responseCaptures=await ctx.fixtureHttp.captures({protocol:'responses'});assert.equal(responseCaptures.at(-1).model,'vc03m-reasoning');
        const steadyListeners=await page.evaluate(()=>Object.fromEntries(Object.entries(SillyTavern.getContext().eventSource.events).map(([key,value])=>[key,value.length])));
        at('disabled-binding');
        await open('model');await page.getByRole('tab',{name:'用途绑定',exact:true}).click();await page.locator('[data-bind="bindingState.FOREGROUND_CHAT"]').uncheck();
        const disabled=page.waitForResponse(response=>response.url().endsWith('/model-purposes/FOREGROUND_CHAT')&&response.request().method()==='PUT');
        await page.locator('[data-action="save-bindings"]').click();assert.equal((await disabled).status(),200);
        await page.locator('[data-action="save-bindings"]').waitFor({state:'hidden'});
        await go('chat');await page.getByRole('button',{name:'去设置',exact:true}).waitFor({state:'visible'});
        assert.equal(await page.locator('#send_but').isDisabled(),true);
        const noModelsBefore=await models(),unconfigured=await context.newPage();
        try{
            unconfigured.on('pageerror',error=>errors.push(error.name+': '+error.message));
            at('unconfigured-history');await openDesktopFixture(unconfigured,ctx.w05.stBase,fixture,26);
            await unconfigured.waitForFunction(()=>document.documentElement.dataset.vcRuntime==='prepared'&&SillyTavern.getContext().chat.length===26);
            await unconfigured.locator('#send_textarea').fill('NF06 未配置模型草稿');
            assert.equal(await unconfigured.locator('#send_textarea').isEnabled(),true);assert.equal(await unconfigured.locator('#send_but').isDisabled(),true);
            await unconfigured.getByRole('button',{name:'去设置',exact:true}).click();await unconfigured.locator('[data-action="select-provider"][data-id="vc03m-chat"]').waitFor({state:'visible'});
            assert.equal(await models(),noModelsBefore,'未配置模型仍能打开历史和设置，不能发生成');
        }finally{await unconfigured.close();}
        at('restore-binding');await open('model');await page.getByRole('tab',{name:'用途绑定',exact:true}).click();await page.locator('[data-bind="bindingState.FOREGROUND_CHAT"]').check();
        const enabled=page.waitForResponse(response=>response.url().endsWith('/model-purposes/FOREGROUND_CHAT')&&response.request().method()==='PUT');
        await page.locator('[data-action="save-bindings"]').click();assert.equal((await enabled).status(),200);
        await page.locator('[data-action="save-bindings"]').waitFor({state:'hidden'});
        await go('chat');await waitChat();await page.locator('#send_textarea').fill('NF06 配置恢复草稿');await page.waitForFunction(()=>!document.querySelector('#send_but')?.disabled);
        assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(SillyTavern.getContext().eventSource.events).map(([key,value])=>[key,value.length]))),steadyListeners,'多次保存模型设置后运行模块仍只有一个owner');
        at('late-conversation');
        await page.locator('#send_textarea').fill('NF06 原会话草稿');
        for(const failed of [false,true]){
            at(failed?'late-conversation-failure':'late-conversation-success');
            let readRelease,readStarted=false,readFinished=false;const gate=new Promise(resolve=>{readRelease=resolve;});
            await page.route('**/api/chats/get',async route=>{if(route.request().postDataJSON()?.avatar_url!==other.avatar){await route.continue();return;}readStarted=true;await gate;
                try{if(failed)await route.fulfill({status:500,contentType:'application/json',body:'{}'});else await route.continue();}finally{readFinished=true;}});
            await page.locator(`[data-convo-list] [data-relationship-id="${other.chat[0].chat_metadata.vc_binding.relationshipId}"]`).click();
            await waitFor(()=>readStarted,{label:'迟到会话读取已发出'});
            await selectProvider();await page.locator('#vcms-f-display').fill('NF06 读取期间的新草稿');
            readRelease();await waitFor(()=>readFinished,{label:'迟到会话读取已返回'});await page.unroute('**/api/chats/get');
            assert.equal(await page.locator('#vc-shell').getAttribute('data-settings'),'open');
            assert.equal(await page.evaluate(()=>SillyTavern.getContext().characters[SillyTavern.getContext().characterId].avatar),fixture.avatar);
            assert.equal(await page.locator('#vcms-f-display').inputValue(),'NF06 读取期间的新草稿');
            const leaving=go('chat');await discard();await leaving;await waitChat();
            await page.waitForFunction(()=>!document.querySelector('#send_but')?.disabled);assert.equal(await page.locator('#send_textarea').inputValue(),'NF06 原会话草稿');
        }
        at('budget/identity');
        let genRequests=0;
        await page.route('**/api/backends/chat-completions/generate',async route=>{
            genRequests+=1;
            await route.fulfill({
                status:429,
                contentType:'application/json',
                body:JSON.stringify({error:{code:'VC_USAGE_REFUSED',message:'本月额度已用完，本次生成未发送',reason:'OVER_LIMIT'}}),
            });
        });
        await page.locator('#send_but').click();
        await page.waitForFunction(()=>document.querySelector('#send_but')?.disabled===true&&document.body.dataset.generating!=='true');
        assert.equal(genRequests,1);
        assert.equal(await page.locator('#send_but').isDisabled(),true);
        assert.deepEqual(await page.evaluate(()=>SillyTavern.getContext().chat.filter(m=>m.is_user&&m.mes==='NF06 原会话草稿').map(m=>m.mes)),['NF06 原会话草稿']);
        assert.equal(await page.locator('#send_textarea').inputValue(),'');
        await page.getByRole('button',{name:'去设置',exact:true}).waitFor({state:'visible'});
        assert.match(await page.locator('#vc-chat-gen').textContent()||'',/当月可用额度不足，测试与发送暂不可用。设置仍可保存/);
        await page.locator('#send_textarea').fill('NF06 预算不足未发送草稿');
        assert.equal(await page.locator('#send_but').isDisabled(),true);
        const modelsBeforeBudgetEnter=await models();
        await page.locator('#send_textarea').press('Enter');
        assert.equal(await models(),modelsBeforeBudgetEnter);
        assert.equal(genRequests,1);
        assert.equal(await page.locator('#send_textarea').inputValue(),'NF06 预算不足未发送草稿');
        await page.unroute('**/api/backends/chat-completions/generate');
        await openDesktopFixture(page,ctx.w05.stBase,fixture,27);
        await page.waitForFunction(()=>document.documentElement.dataset.vcRuntime==='prepared'&&!document.querySelector('#send_but')?.disabled);
        assert.deepEqual(await page.evaluate(()=>SillyTavern.getContext().chat.filter(m=>m.is_user&&m.mes==='NF06 原会话草稿').map(m=>m.mes)),['NF06 原会话草稿']);
        assert.equal(await page.locator('#send_textarea').inputValue(),'NF06 预算不足未发送草稿');
        assert.equal(await page.locator('#send_but').isDisabled(),false);
        await selectProvider();
        await shots('model');
        await open('account');
        let writes=0;page.on('request',request=>{if(request.method()==='PUT'&&new URL(request.url()).pathname.includes('/admin/'))writes++;});
        await page.route('**/api/v1/auth/session',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({accountId:'9007199254740993',sessionId:'9007199254740995'})}));
        const sessionChanged=page.waitForResponse(r=>r.url().includes('/api/v1/auth/session'));
        await selectProvider();await sessionChanged;
        await page.locator('#vcms-f-display').fill('NF06 身份失效保留输入');await page.locator('#vcms-save').click();
        await page.locator('[data-action="context-reload"]').waitFor({state:'visible'});
        assert.equal(writes,0);assert.equal(await page.locator('#vcms-f-display').inputValue(),'NF06 身份失效保留输入');
        assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
        return {heldRuntime:true,saveGenerates:0,leaveGuard:true,voiceSave:true,account:true,appearance:true,notifications:true,data:true,hotBinding:'responses',unconfiguredHistory:true,singleRuntime:true,lateReadCancel:true,lateReadFailureCancel:true,budget:true,fixedIdentity:true,nativeRequests:0};
    }catch(error){const state=await page.evaluate(()=>({category:document.querySelector('.vc-settings-shell')?.dataset.category,settings:document.querySelector('#vc-shell')?.dataset.settings,destination:document.querySelector('#vc-shell')?.dataset.destination,voiceSaveDisabled:document.querySelector('[data-voice-save]')?.disabled,voiceSaveLabel:document.querySelector('[data-voice-save]')?.textContent,voiceInputDisabled:document.querySelector('[data-voice-field="dailyChatLimit"]')?.disabled,voiceStatus:document.querySelector('.vc-settings-body>p[role=status],.vc-voice-settings>p[role=status]')?.textContent}));throw new Error(`NF06 ${stage}: ${error.message}; ${JSON.stringify({state,errors,forbidden})}`);}
    finally{releaseRuntime();await browser.close();await ctx.fixtureHttp.setOverride('vc03m-reasoning',null);}
}
export const desktopProductSettingsScene={id:'nf-settings',title:'NF-06 独立产品设置、身份与目录刷新',needs:['catalog','stack','browser'],default:false,run:sceneDesktopProductSettings};
