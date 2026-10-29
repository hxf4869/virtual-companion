import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    buildProviderPut, cloneModelDraft, ledgerCalloutHtml, ledgerPriceCopy, modelDraftFromApi,
    modelPriceMissing, NO_PRICE_COPY, providerDraftFromApi, UNSUPPORTED_CURRENCY_COPY,
} from '../extension/vc-model-settings/model-logic.js';
import {
    SESSION_EMPTY_COPY, sessionRowText,
} from '../extension/vc-model-settings/account-logic.js';
import { executeSensitiveAction, renderAccountShell } from '../extension/vc-model-settings/data-rights.js';
import { ACCOUNT_UI_ROUTES } from '../extension/vc-model-settings/account-ui-routes.js';
import { ADMIN_BRIDGE_ROUTES } from '../server-plugin/virtual-companion/lib/admin-bridge.js';

test('发送提示只看 ledgerPrice，目录缺价不再单独拦发送', () => {
    assert.equal(ledgerPriceCopy('MISSING'), NO_PRICE_COPY);
    assert.equal(ledgerPriceCopy('UNSUPPORTED_CURRENCY'), UNSUPPORTED_CURRENCY_COPY);
    assert.equal(UNSUPPORTED_CURRENCY_COPY, '非美元单价：照常发送，费用记为未知');
    assert.equal(ledgerPriceCopy('ACTIVE'), '');
    assert.equal(ledgerPriceCopy(''), '');
    assert.equal(ledgerPriceCopy('FREE'), '');
    const active = modelDraftFromApi({
        profileKey: 'usd', modelId: 'usd', displayName: '美元', maxOutputTokens: 128,
        pricing: { currency: 'USD', inputPerMillionTokens: 1 },
        ledgerPrice: 'ACTIVE',
    });
    assert.equal(modelPriceMissing(active.pricing), true);
    assert.equal(ledgerCalloutHtml(active), '');
    const missing = modelDraftFromApi({
        profileKey: 'empty', modelId: 'empty', displayName: '空价', maxOutputTokens: 128,
        pricing: { currency: 'USD', inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
        ledgerPrice: 'MISSING',
    });
    assert.equal(modelPriceMissing(missing.pricing), false);
    assert.match(ledgerCalloutHtml(missing), /id="vcms-no-price"/);
    assert.match(ledgerCalloutHtml(missing), /未配置单价：照常发送，费用记为未知/);
    const cny = modelDraftFromApi({
        profileKey: 'cny', modelId: 'cny', displayName: '人民币', maxOutputTokens: 128,
        pricing: { currency: 'CNY', inputPerMillionTokens: 1, outputPerMillionTokens: 1 },
        ledgerPrice: 'UNSUPPORTED_CURRENCY',
    });
    assert.match(ledgerCalloutHtml(cny), /id="vcms-currency-price"/);
    assert.match(ledgerCalloutHtml(cny), /非美元单价：照常发送，费用记为未知/);
    assert.equal(ledgerCalloutHtml(cny).includes('未配置单价'), false);
});

test('保存请求不回写 ledgerPrice，克隆配置不沿用原状态', () => {
    const draft = providerDraftFromApi({
        providerId: 'priced', displayName: '计价', protocol: 'OPENAI_CHAT_COMPLETIONS',
        baseUrl: 'https://priced.example/v1', state: 'ENABLED', revision: 3,
        models: [{
            profileKey: 'chat', modelId: 'chat', displayName: '聊天', maxOutputTokens: 128,
            ledgerPrice: 'MISSING', pricing: { currency: 'USD', inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
        }],
    });
    assert.equal(draft.models[0].ledgerPrice, 'MISSING');
    assert.equal(JSON.stringify(buildProviderPut(draft)).includes('ledgerPrice'), false);
    const cloned = cloneModelDraft(draft.models[0], { profileKey: 'copy', displayName: '副本' });
    assert.equal(cloned.ledgerPrice, '');
    assert.equal(modelDraftFromApi({ profileKey: 'x', modelId: 'x', displayName: 'x', maxOutputTokens: 1, ledgerPrice: 'NO_PRICE' }).ledgerPrice, '');
});

test('账户页分区不再重复当前密码，密码不进静态属性', () => {
    const html = renderAccountShell();
    const reauthAt = html.indexOf('vc-account-reauth');
    assert.ok(reauthAt > 0);
    const page = html.slice(0, reauthAt);
    assert.equal(page.includes('当前密码'), false);
    assert.equal((html.match(/当前密码/g) || []).length, 1);
    for (const label of ['修改密码', '验证器', '当前会话', '导出数据', '删除账号及在线数据']) {
        assert.match(html, new RegExp(`aria-label="${label}"`));
    }
    assert.match(html, /class="vc-account-cards"/);
    assert.equal(html.includes('name="currentPassword"'), false);
    assert.equal(html.includes('name="password"'), false);
    assert.doesNotMatch(html, /type="password"[^>]*value=/);
    assert.match(html, /data-sessions/);
    assert.match(html, /登出其他会话/);
    assert.equal(html.includes('revoke-all'), false);
});

test('会话行只用时间与当前标记，空列表有空态', () => {
    const when = new Date('2026-10-28T02:00:00Z');
    const formatted = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(when);
    const row = sessionRowText({
        id: '11', current: true, createdAt: '2026-10-28T02:00:00Z',
        accountId: '9007199254740993', role: 'ADMIN', passwordMustChange: false,
    });
    assert.equal(row, `当前会话 · ${formatted}`);
    assert.equal(row.includes('9007199254740993'), false);
    assert.equal(row.includes('ADMIN'), false);
    assert.equal(sessionRowText({ id: '12', current: false, createdAt: '2026-10-28T03:00:00Z' }).startsWith('其他会话'), true);
    assert.equal(sessionRowText({ current: true }), '当前会话');
    assert.equal(SESSION_EMPTY_COPY, '没有进行中的会话');
});

test('敏感操作先走 reauth，密码只出现在对应请求里', async () => {
    const seen = [];
    const deps = {
        reauth: async (password) => { seen.push(['reauth', password]); },
        changePassword: async (currentPassword, newPassword) => { seen.push(['changePassword', currentPassword, newPassword]); return { ok: true }; },
        resetAuthenticator: async (accountId) => { seen.push(['resetAuthenticator', accountId]); return { ok: true }; },
        createDataExport: async (password) => { seen.push(['createDataExport', password]); return { status: 'PENDING', exportId: '1' }; },
        recoverDataExport: async (password) => { seen.push(['recoverDataExport', password]); return { status: 'READY', exportId: '1' }; },
        deleteOwnAccount: async (password) => { seen.push(['deleteOwnAccount', password]); return { ok: true }; },
    };
    await executeSensitiveAction({ action: 'password', password: 'current-secret', newPassword: 'next-secret', accountId: '7', deps });
    await executeSensitiveAction({ action: 'reset', password: 'current-secret', accountId: '7', deps });
    await executeSensitiveAction({ action: 'export', password: 'current-secret', accountId: '7', deps });
    await executeSensitiveAction({ action: 'recover', password: 'current-secret', accountId: '7', deps });
    await executeSensitiveAction({ action: 'delete', password: 'current-secret', accountId: '7', deps });
    assert.deepEqual(seen, [
        ['reauth', 'current-secret'],
        ['changePassword', 'current-secret', 'next-secret'],
        ['reauth', 'current-secret'],
        ['resetAuthenticator', '7'],
        ['reauth', 'current-secret'],
        ['createDataExport', 'current-secret'],
        ['reauth', 'current-secret'],
        ['recoverDataExport', 'current-secret'],
        ['reauth', 'current-secret'],
        ['deleteOwnAccount', 'current-secret'],
    ]);
    assert.equal(seen.some((call) => call[0] === 'revoke-all'), false);
});

test('账户样式把分区拉开，重新验证层可滚动且不写 style.css', async () => {
    const css = await readFile(new URL('../extension/vc-model-settings/account.css', import.meta.url), 'utf8');
    assert.match(css, /\.vc-account-cards\s*\{[^}]*gap:\s*24px/);
    assert.match(css, /\.vc-account-reauth/);
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /overflow-y:\s*auto/);
    const rights = await readFile(new URL('../extension/vc-model-settings/data-rights.js', import.meta.url), 'utf8');
    assert.match(rights, /account\.css/);
    assert.match(rights, /data-vc-account/);
});

test('账户路由常量覆盖改密、会话、导出和删除，且不包含 revoke-all', () => {
    const paths = ACCOUNT_UI_ROUTES.map((route) => `${route.method} ${route.sample}`);
    for (const sample of [
        'POST /api/v1/auth/reauth',
        'POST /api/v1/auth/password',
        'GET /api/v1/auth/sessions',
        'DELETE /api/v1/auth/sessions/12',
        'POST /api/v1/auth/logout',
        'POST /api/v1/exports',
        'POST /api/v1/exports/recover',
        'DELETE /api/v1/auth/account',
        'POST /api/v1/admin/accounts/7/authenticator-reset',
    ]) {
        assert.equal(paths.includes(sample), true, sample);
    }
    assert.equal(paths.some((item) => item.includes('revoke-all')), false);
    const missing = [];
    for (const route of ACCOUNT_UI_ROUTES) {
        const covered = ADMIN_BRIDGE_ROUTES.some((item) => item.method === route.method && item.path.test(route.sample));
        if (!covered) missing.push(`${route.method} ${route.sample}`);
    }
    assert.deepEqual(missing, ['DELETE /api/v1/auth/account']);
});
