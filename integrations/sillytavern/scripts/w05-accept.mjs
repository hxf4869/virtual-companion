// W05 scenarios, consumed only by accept-managed's existing isolated lifecycle.
// All accounts/messages are synthetic. Secrets remain in memory; no request or
// response body is included in diagnostics or artifacts.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createStClient } from './managed-lib.mjs';
import { pinVcUi } from './vc-ui-pin.mjs';
import { failClosedWaitMs } from './lib/fail-closed-wait.mjs';
import { deviceNameFromUA } from '../server-plugin/virtual-companion/auth/index.js';
const base = () => ({ id: crypto.randomUUID(), revision: 0 });
const rows = (token, text = '合成测试消息', extra = {}) => [{ user_name: 'unused', character_name: 'unused', chat_metadata: { vc_f2: token, ...extra } }, { name: '合成角色', is_user: false, mes: text, swipe_id: 0, swipes: [text, '合成候选二'] }];
const expect = (result, status, label) => { assert.equal(result.status, status, `${label}: HTTP ${result.status} (${result.json?.code || 'native'})`); return result.json; };
const client = (ctx, session = ctx.secrets.session) => createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: session, extraCookies: `vc_session=${session.vcSession}; vc_csrf=${session.vcCsrf}` });
const cardPath = (avatar, file) => `chats/${avatar.replace(/\.png$/, '')}/${file.replace(/\.jsonl$/, '')}.jsonl`;
const multipart = (text, fields) => { const form = new FormData(); for (const [key, value] of Object.entries(fields)) form.append(key, value); form.append('avatar', new Blob([text], { type: 'application/json' }), 'synthetic.json'); return form; };
export async function importSyntheticCard(st, label = 'W05 合成角色') {
    const name = `${label} ${crypto.randomUUID().slice(0, 8)}`;
    const card = { name, description: '仅用于本地自动验收', first_mes: '这是一次合成测试对话。', personality: '', scenario: '', mes_example: '' };
    const result = expect(await st.call('POST', '/api/characters/import', multipart(JSON.stringify(card), { file_type: 'json' })), 200, '导入合成卡');
    assert.ok(result.file_name, '原生导入应返回卡片名');
    return { name, avatar: `${result.file_name.replace(/\.png$/, '')}.png` };
}

export async function sceneF2Native(ctx) {
    const a = client(ctx), b = client(ctx), card = await importSyntheticCard(a);
    let avatar = card.avatar;
    const file = `W05-main-${crypto.randomUUID()}`;
    const read = async (name = file, who = a) => expect(await who.call('POST', '/api/chats/get', { avatar_url: avatar, file_name: name.replace(/\.jsonl$/, '') }), 200, '读取聊天');
    const save = (chat, name = file, who = a, force = false) => who.call('POST', '/api/chats/save', { avatar_url: avatar, file_name: name.replace(/\.jsonl$/, ''), chat, force });
    let token = expect(await save(rows(base())), 200, '初始保存').vc_f2;
    const first = await read(), second = await read(file, b);
    first[1].mes = '手机侧新消息'; second[1].mes = '电脑侧旧完整快照';
    const results = await Promise.all([save(first), save(second, file, b)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], '相同base并发只允许一次提交');
    let current = await read(); token = current[0].chat_metadata.vc_f2;
    for (const [kind, edit] of [
        ['message', (d) => d.push({ is_user: true, mes: '迟到消息' })], ['edit', (d) => { d[1].mes = '旧编辑'; }],
        ['swipe', (d) => { d[1].swipe_id = 1; }], ['MVU', (d) => { d[1].variables = [{ trust: 99 }]; }],
        ['metadata', (d) => { d[0].chat_metadata.variables = { trust: 99 }; }], ['delete-message', (d) => d.splice(1)],
    ]) {
        const stale = structuredClone(first); edit(stale);
        expect(await save(stale, file, b, true), 409, `${kind}旧完整快照/force拒绝`);
    }
    expect(await save([{ chat_metadata: {} }, { mes: '缺基线' }]), 428, '缺基线拒绝');
    const renamed = `${file}-renamed`;
    expect(await a.call('POST', '/api/chats/rename', { avatar_url: avatar, original_file: `${file}.jsonl`, renamed_file: `${renamed}.jsonl`, vc_f2: first[0].chat_metadata.vc_f2 }), 409, '旧改名拒绝');
    token = expect(await a.call('POST', '/api/chats/rename', { avatar_url: avatar, original_file: `${file}.jsonl`, renamed_file: `${renamed}.jsonl`, vc_f2: token }), 200, '合法改名').vc_f2;
    expect(await save(first), 409, '改名前旧路径不能复写');
    const branch = `${file}-branch`;
    expect(await save(rows(base(), '旧父分支', { vc_f2_parent: first[0].chat_metadata.vc_f2 }), branch), 409, '旧父基线拒绝');
    const branchToken = expect(await save(rows(base(), '有效分支', { vc_f2_parent: token }), branch), 200, '新分支').vc_f2;
    assert.notEqual(branchToken.id, token.id);
    current = await read(renamed);
    expect(await a.call('POST', '/api/chats/delete', { avatar_url: avatar, chatfile: `${renamed}.jsonl`, vc_f2: token }), 200, '删除聊天');
    expect(await save(current, renamed), 409, '墓碑拒绝迟到保存');
    const recreated = expect(await save(rows(base(), '相同路径的新身份'), renamed), 200, '相同路径新身份').vc_f2;
    assert.notEqual(recreated.id, token.id);

    // Every group write uses the same authority; group metadata never holds revision.
    const groupFile = `W05-group-${crypto.randomUUID()}`;
    const groupBody = rows(base());
    const groupToken = expect(await a.call('POST', '/api/chats/group/save', { id: groupFile, chat: groupBody }), 200, '群聊创建').vc_f2;
    groupBody[0].chat_metadata.vc_f2 = groupToken;
    const groupRace = await Promise.all([a.call('POST', '/api/chats/group/save', { id: groupFile, chat: groupBody }), b.call('POST', '/api/chats/group/save', { id: groupFile, chat: groupBody, force: true })]);
    assert.deepEqual(groupRace.map((r) => r.status).sort(), [200, 409]);
    expect(await a.call('POST', '/api/chats/group/delete', { id: groupFile, vc_f2: groupToken }), 409, '群聊旧删除拒绝');
    const groupRead = expect(await a.call('POST', '/api/chats/group/get', { id: groupFile }), 200, '群聊读取');
    const groupCurrent = groupRead[0].chat_metadata.vc_f2;
    const group = expect(await a.call('POST', '/api/groups/create', { name: 'W05 合成群组', members: [], chat_id: groupFile, chats: [groupFile] }), 200, '群组创建');
    expect(await a.call('POST', '/api/groups/delete', { id: group.id }), 428, '群组删除缺基线拒绝');
    expect(await a.call('POST', '/api/groups/delete', { id: group.id, vc_f2_chats: [{ path: `group chats/${groupFile}.jsonl`, expected: groupCurrent }] }), 200, '群组删除经F2');
    expect(await a.call('POST', '/api/chats/group/save', { id: groupFile, chat: groupRead, force: true }), 409, '群聊删除后旧身份拒绝');

    // Whole-directory operations prevalidate every child before changing the card.
    const bases = [{ path: cardPath(avatar, renamed), expected: recreated }, { path: cardPath(avatar, branch), expected: branchToken }];
    const newName = `${card.name}-改名`;
    expect(await a.call('POST', '/api/characters/rename', { avatar_url: avatar, new_name: newName }), 428, '角色改名缺子聊天基线拒绝');
    const renamedCard = expect(await a.call('POST', '/api/characters/rename', { avatar_url: avatar, new_name: newName, vc_f2_chats: bases }), 200, '角色目录改名');
    avatar = renamedCard.avatar;
    const newBases = renamedCard.vc_f2_chats.map((row) => ({ path: row.to, expected: row.vc_f2 }));
    assert.equal(newBases.length, 2);
    expect(await a.call('POST', '/api/characters/delete', { avatar_url: avatar, delete_chats: true, vc_f2_chats: bases }), 428, '角色删除旧路径拒绝');
    expect(await a.call('POST', '/api/characters/delete', { avatar_url: avatar, delete_chats: true, vc_f2_chats: newBases }), 200, '角色和子聊天删除');
    expect(await save(current, renamed, b, true), 409, '角色删除后不能复活子聊天');

    // Imports deliberately create fresh identities even if the uploaded backup has tokens.
    const upload = rows({ id: crypto.randomUUID(), revision: 88 });
    const imported = expect(await a.call('POST', '/api/chats/import', multipart(upload.map((r) => JSON.stringify(r)).join('\n'), { avatar_url: avatar, file_type: 'jsonl', character_name: 'W05 orphan', user_name: 'Synthetic' })), 200, '原生导入');
    const importFile = imported.fileNames[0], importedToken = imported.vc_f2_chats[0].vc_f2;
    assert.notEqual(importedToken.id, upload[0].chat_metadata.vc_f2.id); assert.equal(importedToken.revision, 1);
    const importedRows = await read(importFile);
    const report = expect(await a.call('POST', '/api/data-maid/report'), 200, 'Data Maid报告');
    const record = report.report.chats.find((r) => r.name === importFile);
    assert.ok(record, '孤立合成聊天应出现在清理报告');
    importedRows[1].mes = '报告后的新修改'; expect(await save(importedRows, importFile), 200, '报告后修改');
    expect(await a.call('POST', '/api/data-maid/delete', { token: report.token, hashes: [record.hash], vc_f2_chats: report.vc_f2_chats }), 409, '旧清理报告拒绝');
    const fresh = expect(await a.call('POST', '/api/data-maid/report'), 200, '重新读取清理报告');
    expect(await a.call('POST', '/api/data-maid/delete', { token: fresh.token, hashes: [record.hash], vc_f2_chats: fresh.vc_f2_chats }), 200, '清理经F2墓碑');
}

async function launchBrowser() {
    const { chromium } = await import('playwright-core');
    return chromium.launch({ headless: true, ...(process.env.VC_W03_CHROMIUM_PATH ? { executablePath: process.env.VC_W03_CHROMIUM_PATH } : {}) });
}
async function logoutFromPage(page, stBase) {
    const status = await page.evaluate(async () => {
        const csrfPair = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('vc_csrf='));
        const response = await fetch('/auth/api/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfPair ? csrfPair.slice('vc_csrf='.length) : '',
                'X-VC-Expected-Account-ID': document.querySelector('meta[name="vc-account-id"]')?.getAttribute('content') || '',
                'X-VC-Expected-Session-ID': document.querySelector('meta[name="vc-session-id"]')?.getAttribute('content') || '',
            },
            body: '{}',
        });
        return response.status;
    });
    assert.equal(status, 200);
    await page.goto(`${stBase}/auth/`);
    await page.waitForSelector('#login-form:not([hidden])');
}
async function nativeReady(page) {
    await page.waitForFunction(() => {
        try { return Boolean(window.SillyTavern?.getContext?.()?.eventSource); }
        catch { return false; }
    });
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
export async function sceneAuthBrowser(ctx) {
    const { stBase, secondId, ownerId, totpCode, dataRoot } = ctx.w05;
    // 扩展只装配在 default-user。第二账号的账户页从自己的 extensions 目录提供同一份扩展。
    const extensionSrc = path.join(dataRoot, 'default-user/extensions/vc-model-settings');
    const extensionDest = path.join(dataRoot, 'vc-w05-second/extensions/vc-model-settings');
    fs.mkdirSync(path.dirname(extensionDest), { recursive: true });
    fs.cpSync(extensionSrc, extensionDest, { recursive: true });
    const st = client(ctx), privateFile = `W05-private-${crypto.randomUUID()}`;
    const privateToken = expect(await st.call('POST', '/api/chats/save', { avatar_url: 'B01-private.png', file_name: privateFile, chat: rows(base(), '仅第一个账号可见的合成消息') }), 200, '账号隔离种子').vc_f2;
    const browser = await launchBrowser();
    try {
        const bc = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await pinVcUi(bc, 'off');
        const page = await bc.newPage();
        await page.goto(stBase); await page.waitForSelector('#login-form:not([hidden])');
        assert.equal(new URL(page.url()).pathname, '/auth/');
        for (const url of ['/script.js', '/version', '/scripts/extensions/third-party/vc-model-settings/index.js', '/characters/synthetic.png']) {
            const r = await bc.request.get(stBase + url, { headers: { 'Remote-User': 'default-user', 'X-Authentik-Username': 'default-user' } });
            assert.equal(r.status(), 401, `匿名/伪造头 ${url}`);
        }
        await page.screenshot({ path: path.join(ctx.artifactsDir, 'B01-login-390.png') });
        ctx.screenshots.push('B01-login-390.png');
        await page.fill('#account', 'w05-accept-second'); await page.fill('#password', ctx.secrets.password); await page.click('#login-form button[type=submit]');
        await page.waitForFunction(() => document.querySelector('#setup-secret')?.textContent?.length > 10);
        assert.equal((await bc.request.get(stBase + '/script.js')).status(), 401, '未完成TOTP仍拒绝');
        const key = await page.evaluate(() => (document.querySelector('#setup-secret')?.textContent || '').replace(/[^A-Z2-7]/gi, ''));
        const grouped = await page.evaluate(() => /[A-Z2-7]{4}( [A-Z2-7]{4})+/.test(document.querySelector('#setup-secret')?.textContent || ''));
        assert.equal(grouped, true);
        assert.equal(key.length > 10, true);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.locator('#add-authenticator').isVisible(), true);
        assert.equal(await page.locator('#setup-qr-frame').isVisible(), false);
        await page.click('#show-qr');
        assert.equal(await page.locator('#setup-qr-frame').isVisible(), true);
        await page.click('#show-qr');
        assert.equal(await page.locator('#setup-qr-frame').isVisible(), false);
        for (const [name, width, height, scheme] of [
            ['B01-verify-390-light.png', 390, 844, 'light'],
            ['B01-verify-390-dark.png', 390, 844, 'dark'],
            ['B01-verify-1440-light.png', 1440, 900, 'light'],
            ['B01-verify-1440-dark.png', 1440, 900, 'dark'],
        ]) {
            await page.setViewportSize({ width, height });
            await page.emulateMedia({ colorScheme: scheme });
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            if (width >= 1440) {
                assert.equal(await page.locator('#setup-qr-frame').isVisible(), true);
                assert.equal(await page.locator('#add-authenticator').isVisible(), false);
            }
            await page.screenshot({ path: path.join(ctx.artifactsDir, name) });
            ctx.screenshots.push(name);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.emulateMedia({ colorScheme: 'light' });
        await bc.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.click('#copy-secret');
        await page.waitForFunction(() => document.querySelector('#copy-secret')?.textContent === '已复制');
        await page.fill('#code', String((Number(totpCode(key)) + 1) % 1000000).padStart(6, '0'));
        await page.waitForFunction(() => {
            const error = document.querySelector('#auth-error');
            return Boolean(error && !error.hidden && document.querySelector('#code')?.value === '' && document.activeElement?.id === 'code');
        });
        const confirmWait = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/authenticator-confirm'));
        const enrolledAt = Date.now();
        await page.fill('#code', totpCode(key, enrolledAt));
        const confirmBody = (await confirmWait).postDataJSON();
        assert.equal(confirmBody.trustDevice, false);
        assert.equal(Object.hasOwn(confirmBody, 'deviceName'), false);
        await page.waitForSelector('#recovery-step:not([hidden])');
        assert.equal(await page.locator('#finish-login').isDisabled(), true);
        const downloadPromise = page.waitForEvent('download');
        await page.click('#download-recovery');
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), 'recovery-codes.txt');
        assert.equal(await page.locator('#finish-login').isDisabled(), false);
        await page.click('#finish-login'); await page.waitForURL(stBase + '/'); await nativeReady(page);
        assert.equal(await page.locator('meta[name=vc-account-id]').getAttribute('content'), secondId);
        const isolated = await page.evaluate(async (file) => {
            const { getRequestHeaders } = await import('/script.js');
            const me = await (await fetch('/api/users/me')).json();
            const chat = await (await fetch('/api/chats/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ avatar_url: 'B01-private.png', file_name: file }) })).json();
            return { handle: me.handle, empty: !Array.isArray(chat) || chat.length === 0 };
        }, privateFile);
        assert.deepEqual(isolated, { handle: 'vc-w05-second', empty: true }, '第二账号只读取自己的ST目录');
        const stale = await bc.newPage(); await stale.goto(stBase); await nativeReady(stale);
        const oldStatus = await stale.evaluate(async () => {
            const { getRequestHeaders } = await import('/script.js');
            return (await fetch('/api/characters/all', { method: 'POST', headers: getRequestHeaders() })).status;
        });
        assert.equal(oldStatus, 200);
        // Go logout revokes access even while the signed native ST cookie still exists.
        await page.click('#user-settings-button .drawer-toggle');
        await page.waitForSelector('#logout_button', { state: 'visible' });
        const logoutResponse = page.waitForResponse((r) => r.url().endsWith('/auth/api/logout') && r.request().method() === 'POST');
        await page.click('#logout_button'); assert.equal((await logoutResponse).status(), 200);
        await page.waitForURL(stBase + '/auth/');
        assert.equal((await bc.request.get(stBase + '/script.js')).status(), 401, '旧ST cookie不能绕过Go注销');
        await page.goto(`${stBase}/auth/`);
        await page.waitForSelector('#login-form:not([hidden])');
        await page.fill('#account', 'w05-accept-second');
        await page.fill('#password', ctx.secrets.password);
        await page.click('#login-form button[type=submit]');
        await page.waitForSelector('#verify-step:not([hidden])');
        assert.equal(await page.locator('#trust-device').isChecked(), false);
        const expectedName = deviceNameFromUA(await page.evaluate(() => navigator.userAgent));
        await page.getByText('信任此设备 90 天', { exact: true }).click();
        assert.equal(await page.locator('#trust-device').isChecked(), true);
        const enrolledStep = Math.floor(enrolledAt / 30000);
        while (Math.floor(Date.now() / 30000) <= enrolledStep) {
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const trustedWait = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/totp'));
        const [, trustedResponse] = await Promise.all([
            page.fill('#code', totpCode(key)),
            trustedWait,
        ]);
        const trustedBody = trustedResponse.request().postDataJSON();
        assert.equal(trustedResponse.status(), 200);
        assert.equal(trustedBody.trustDevice, true);
        assert.equal(trustedBody.deviceName, expectedName);
        assert.equal([...String(trustedBody.deviceName || '')].length <= 120, true);
        await page.waitForFunction(() => Boolean(document.querySelector('meta[name="vc-account-id"]')));
        await logoutFromPage(page, stBase);
        await page.fill('#account', 'w05-accept-second');
        await page.fill('#password', ctx.secrets.password);
        await page.click('#login-form button[type=submit]');
        await page.waitForFunction(() => Boolean(document.querySelector('meta[name="vc-account-id"]')));
        assert.equal(await page.locator('#verify-step').count(), 0);
        await nativeReady(page);
        const accountState = await page.waitForFunction(async () => {
            try {
                const mod = await import('/scripts/extensions/third-party/vc-model-settings/index.js');
                mod.openAccountData();
                return document.querySelector('.vc-data-dialog') ? 'ok' : false;
            } catch (error) {
                return `fail:${error.message}`;
            }
        });
        assert.equal(await accountState.jsonValue(), 'ok');
        await page.locator('.vc-data-dialog[open] [data-trusted-devices]:not([hidden])').waitFor();
        const deviceText = await page.locator('[data-trusted-devices]').innerText();
        assert.equal(deviceText.includes(expectedName), true);
        assert.equal(deviceText.includes('最近使用'), true);
        assert.equal(deviceText.includes('到期'), true);
        await page.locator('[data-revoke-device]').click();
        await page.locator('.vc-alert [data-vc-ok]').click();
        await page.locator('[data-trusted-devices]').waitFor({ state: 'hidden' });
        await page.locator('[data-logout]').click();
        await page.waitForURL(`${stBase}/auth/`);
        await page.fill('#account', 'w05-accept-second');
        await page.fill('#password', ctx.secrets.password);
        await page.click('#login-form button[type=submit]');
        await page.waitForSelector('#verify-step:not([hidden])');
        await page.click('#back-login');
        await page.waitForSelector('#login-form:not([hidden])');
        await page.goto(stBase + '/auth/'); await page.fill('#account', 'w03-accept-owner'); await page.fill('#password', ctx.secrets.password); await page.click('#login-form button[type=submit]');
        await page.waitForSelector('#use-recovery:not([hidden])'); await page.click('#use-recovery');
        await page.fill('#code', ctx.secrets.recoveryCodes.shift()); await page.click('#verify-submit');
        await page.waitForURL(stBase + '/'); await nativeReady(page);
        assert.equal(await page.locator('meta[name=vc-account-id]').getAttribute('content'), ownerId);
        const own = await page.evaluate(async (file) => {
            const { getRequestHeaders } = await import('/script.js');
            return (await (await fetch('/api/chats/get', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ avatar_url: 'B01-private.png', file_name: file }) })).json())[1]?.mes;
        }, privateFile);
        assert.equal(own, '仅第一个账号可见的合成消息');
        const switched = await stale.evaluate(async () => { const { getRequestHeaders } = await import('/script.js'); return (await fetch('/api/characters/all', { method: 'POST', headers: getRequestHeaders() })).status; });
        assert.equal(switched, 409, '旧标签页不能借新账号共享cookie写入');
        const nativeLogin = await bc.request.post(stBase + '/api/users/login', { data: { handle: 'default-user' } });
        assert.equal(nativeLogin.status(), 403);
        // A read of an authenticated native resource must fail closed during Go failure.
        process.kill(ctx.secrets.goPid, 'SIGSTOP');
        try { assert.equal((await bc.request.get(stBase + '/script.js', { timeout: failClosedWaitMs() })).status(), 503); }
        finally { process.kill(ctx.secrets.goPid, 'SIGCONT'); }
        const activeSession = await page.locator('meta[name=vc-session-id]').getAttribute('content');
        ctx.w05.expireSession(activeSession);
        assert.equal((await bc.request.get(stBase + '/script.js')).status(), 401, '过期Go cookie不能借旧ST会话准入');
        expect(await st.call('POST', '/api/chats/delete', { avatar_url: 'B01-private.png', chatfile: `${privateFile}.jsonl`, vc_f2: privateToken }), 200, '清理隔离种子');
        await bc.close();
    } finally { await browser.close(); }
}

export async function sceneF2Browser(ctx) {
    const st = client(ctx), card = await importSyntheticCard(st, 'W05 双标签页');
    const file = `W05-browser-${crypto.randomUUID()}`;
    expect(await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat: rows(base()) }), 200, '双页初始聊天');
    const browser = await launchBrowser();
    try {
        const bc = await browser.newContext();
        await pinVcUi(bc, 'off');
        await bc.addCookies([{ name: 'vc_session', value: ctx.secrets.session.vcSession, url: ctx.w05.stBase }, { name: 'vc_csrf', value: ctx.secrets.session.vcCsrf, url: ctx.w05.stBase }]);
        const pages = [await bc.newPage(), await bc.newPage()];
        for (const page of pages) {
            await page.goto(ctx.w05.stBase); await nativeReady(page);
            await page.waitForFunction((avatar) => window.SillyTavern.getContext().characters.some((c) => c.avatar === avatar), card.avatar);
            await page.evaluate(async ({ avatar, file }) => {
                const s = await import('/script.js');
                const index = s.characters.findIndex((c) => c.avatar === avatar); assertCard(index);
                function assertCard(i) { if (i < 0) throw Error('Synthetic card missing'); }
                await s.selectCharacterById(index); await s.openCharacterChat(file);
            }, { avatar: card.avatar, file });
            await page.waitForFunction(() => typeof window.SillyTavern.getContext().chatMetadata?.vc_binding?.conversationId === 'string');
            await page.evaluate(() => window.SillyTavern.getContext().saveChat());
        }
        // Binding writes may have raced during load. Reload both once after their
        // actual binding ACK so the intentional edit race begins on one baseline.
        for (const page of pages) { await page.evaluate(async (file) => (await import('/script.js')).openCharacterChat(file), file); }
        const tokens = await Promise.all(pages.map((page) => page.evaluate(() => window.SillyTavern.getContext().chatMetadata.vc_f2)));
        assert.deepEqual(tokens[0], tokens[1]);
        await pages[0].evaluate(async () => { const c = window.SillyTavern.getContext(); c.chat[0].mes = '页面A新编辑'; await c.saveChat(); });
        const outcome = await pages[1].evaluate(async () => {
            const c = window.SillyTavern.getContext(); c.chat[0].mes = '页面B冲突草稿';
            try { await c.saveChat(); return 'unexpected-success'; } catch (error) { return error.code; }
        });
        assert.equal(outcome, 'VC_REVISION_CONFLICT');
        await pages[1].waitForSelector('#vc-f2-conflict[open]');
        assert.equal(await pages[1].locator('#vc-f2-conflict textarea').count(), 0);
        assert.equal(await pages[1].locator('#vc-f2-conflict button').filter({ hasText: '重新加载最新版本' }).count(), 0);
        assert.equal(await pages[1].locator('#vc-f2-conflict button').filter({ hasText: '强制覆盖' }).count(), 0);
        assert.equal(await pages[1].evaluate(() => window.SillyTavern.getContext().chat[0].mes), '页面B冲突草稿');
        const copied = await pages[1].evaluate(async () => {
            let written = '';
            const stub = { writeText: async (text) => { written = text; } };
            const clipboard = navigator.clipboard;
            let restore = () => {};
            try {
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: stub });
                restore = () => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
            } catch {
                if (clipboard) clipboard.writeText = stub.writeText;
            }
            document.querySelector('#vc-f2-conflict [data-action="copy-input"]').click();
            await new Promise((resolve) => setTimeout(resolve, 0));
            restore();
            return written;
        });
        assert.match(copied, /页面B冲突草稿/);
        assert.equal(copied.includes('chat_metadata'), false);
        assert.equal(copied.includes('{'), false);
        await pages[1].screenshot({ path: path.join(ctx.artifactsDir, 'B07-draft-conflict.png') }); ctx.screenshots.push('B07-draft-conflict.png');
        const persisted = expect(await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file }), 200, '确认服务端赢家');
        assert.equal(persisted[1].mes, '页面A新编辑');
        await pages[1].evaluate(() => {
            window.__vcStay = 1;
            const box = document.querySelector('#send_textarea');
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, '已有输入');
        });
        await pages[1].locator('#vc-f2-conflict [data-action="view-latest"]').click();
        // 正文在 reload 中途就换上，对话框要等 reload 返回后才关闭。
        await pages[1].waitForFunction(() => window.__vcStay === 1
            && window.SillyTavern.getContext().chat[0]?.mes === '页面A新编辑'
            && document.querySelector('#vc-f2-conflict')?.open !== true);
        const kept = await pages[1].evaluate(() => ({
            stay: window.__vcStay,
            input: document.querySelector('#send_textarea').value,
            mes: window.SillyTavern.getContext().chat[0].mes,
            open: document.querySelector('#vc-f2-conflict')?.open === true,
        }));
        assert.equal(kept.stay, 1, '查看最新不应整页刷新');
        assert.equal(kept.open, false);
        assert.equal(kept.mes, '页面A新编辑');
        assert.match(kept.input, /已有输入/);
        assert.match(kept.input, /页面B冲突草稿/);
        assert.ok(kept.input.indexOf('已有输入') < kept.input.indexOf('页面B冲突草稿'), kept.input);
        // Run the real shipped Helper callback, holding its awaited updater across a swipe.
        const delayed = await pages[1].evaluate(async () => {
            const helper = window.TavernHelper;
            if (typeof helper?.updateVariablesWith !== 'function') throw Error('Real Helper updater unavailable');
            const c = window.SillyTavern.getContext();
            let release; const gate = new Promise((r) => { release = r; });
            const pending = helper.updateVariablesWith(async () => { await gate; return { late: 'must-not-apply' }; }, { type: 'message', message_id: 0 });
            c.chat[0].swipe_id = 1; release();
            try { await pending; return 'unexpected-success'; } catch (error) { return error.code; }
        });
        assert.equal(delayed, 'VC_STALE_SOURCE');
        assert.equal(await pages[1].evaluate(() => window.SillyTavern.getContext().chat[0].variables?.[1]?.late), undefined);
        await bc.close();
    } finally { await browser.close(); }
}

export const authBrowserScene = {
    id: 'auth-browser',
    title: 'W05 B01 唯一登录、TOTP、全入口保护与账号切换',
    needs: ['go', 'stack', 'browser'],
    default: false,
    run: sceneAuthBrowser,
};

export const f2NativeScene = {
    id: 'f2-native',
    title: 'W05 B05/B07 原生写入口CAS、删除身份与分支父版本',
    needs: ['go', 'stack'],
    default: false,
    run: sceneF2Native,
};

export const f2BrowserScene = {
    id: 'f2-browser',
    title: 'W05 B07 两个真实页面冲突保留草稿与迟到脚本拒绝',
    needs: ['go', 'stack', 'browser'],
    default: false,
    run: sceneF2Browser,
};
export const scenes = [authBrowserScene, f2NativeScene, f2BrowserScene];
