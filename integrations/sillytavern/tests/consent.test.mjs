import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installMiniDom } from './mini-dom.mjs';
import { ApiError } from '../extension/vc-model-settings/api.js';
import { executeSensitiveAction, renderAccountShell } from '../extension/vc-model-settings/data-rights.js';
import { ACCOUNT_UI_ROUTES } from '../extension/vc-model-settings/account-ui-routes.js';
import { ADMIN_BRIDGE_ROUTES } from '../server-plugin/virtual-companion/lib/admin-bridge.js';
import {
    CONSENT_ERROR_COPY,
    CONSENT_VERSION,
    REQUIRED_CONSENTS,
    consentOutstanding,
    consentStatusText,
    mountConsentGate,
    renderConsentAccount,
    renderConsentSheet,
    revokeConsent,
    submitConsentGrants,
} from '../extension/vc-model-settings/consent.js';

const REQUIRED_TYPES = [
    'SERVICE_TERMS',
    'PRIVACY_POLICY',
    'AI_CONTENT_NOTICE',
    'THIRD_PARTY_MODEL_PROCESSING',
    'SENSITIVE_DATA_PROCESSING',
];

function sentences(text) {
    return String(text).split(/[。！？]/).map((part) => part.trim()).filter(Boolean);
}

function granted(type, extra = {}) {
    return { consentType: type, version: CONSENT_VERSION, granted: true, grantedAt: '2026-10-30T01:02:03Z', ...extra };
}

test('五项缺任意一项或最新未同意时需要同意页', () => {
    assert.deepEqual(consentOutstanding([]), REQUIRED_TYPES);
    assert.deepEqual(consentOutstanding(null), REQUIRED_TYPES);
    assert.deepEqual(consentOutstanding(REQUIRED_TYPES.slice(0, 4).map((type) => granted(type))), ['SENSITIVE_DATA_PROCESSING']);
    assert.deepEqual(consentOutstanding(REQUIRED_TYPES.map((type) => granted(type, type === 'PRIVACY_POLICY' ? { granted: false, revokedAt: '2026-10-30T02:00:00Z' } : {}))), ['PRIVACY_POLICY']);
    const older = granted('SERVICE_TERMS', { granted: false, grantedAt: '2026-10-29T00:00:00Z' });
    const newer = granted('SERVICE_TERMS', { grantedAt: '2026-10-30T00:00:00Z' });
    const rest = REQUIRED_TYPES.slice(1).map((type) => granted(type));
    assert.deepEqual(consentOutstanding([older, ...rest, newer]), []);
    assert.deepEqual(consentOutstanding(REQUIRED_TYPES.map((type) => granted(type))), []);
});

test('同意正文不超过两句，版本是后端接受的非空字符串', () => {
    assert.equal(REQUIRED_CONSENTS.map((item) => item.type).join(','), REQUIRED_TYPES.join(','));
    assert.deepEqual(REQUIRED_CONSENTS.map((item) => item.icon), ['file-text', 'shield', 'sparkles', 'cpu', 'lock']);
    assert.equal(CONSENT_VERSION.length > 0 && [...CONSENT_VERSION].length <= 64, true);
    for (const item of REQUIRED_CONSENTS) {
        assert.equal(sentences(item.body).length <= 2, true, item.type);
        assert.equal(item.body.includes('第'), false);
    }
});

test('同意页只有标题、五项和两个按钮', () => {
    const html = renderConsentSheet();
    assert.match(html, /id="vc-consent-title"[^>]*>开始之前</);
    assert.equal(html.includes('开始之前</h1>'), true);
    for (const item of REQUIRED_CONSENTS) {
        assert.match(html, new RegExp(`data-consent-toggle="${item.type}"`));
        assert.match(html, new RegExp(item.label));
        assert.match(html, new RegExp(`#${item.icon}"`));
        assert.match(html, new RegExp(`class="vc-consent-copy"[^>]*hidden[^>]*>${item.body}`));
    }
    assert.match(html, /data-consent-accept[^>]*>同意并继续</);
    assert.match(html, /data-consent-logout[^>]*>退出登录</);
    assert.equal((html.match(/class="vc-consent-copy"/g) || []).length, 5);
    const scroll = html.slice(html.indexOf('vc-consent-scroll'), html.indexOf('vc-consent-bar'));
    assert.equal((scroll.match(/<p/g) || []).length, 6);
    assert.match(html, /data-consent-error[^>]*hidden/);
});

test('状态行写已同意或未同意，并带上日期', () => {
    const grantedText = consentStatusText({ granted: true, grantedAt: '2026-10-30T01:02:03Z' });
    assert.match(grantedText, /^已同意 /);
    const revoked = consentStatusText({ granted: false, revokedAt: '2026-10-30T04:05:06Z', grantedAt: '2026-10-30T01:02:03Z' });
    assert.match(revoked, /^未同意 /);
    assert.equal(consentStatusText(null), '未同意');
    assert.equal(consentStatusText({ granted: false }), '未同意');
    const account = renderConsentAccount([granted('SERVICE_TERMS'), { consentType: 'PRIVACY_POLICY', granted: false, revokedAt: '2026-10-30T04:05:06Z' }]);
    assert.match(account, /data-consent-type="SERVICE_TERMS"[\s\S]*已同意/);
    assert.match(account, /data-consent-type="PRIVACY_POLICY"[\s\S]*未同意/);
    assert.match(account, /data-consent-revoke="SENSITIVE_DATA_PROCESSING"/);
});

test('全部同意成功才算完成；失败留下可重试错误；403 要求重新验证', async () => {
    const seen = [];
    const ok = await submitConsentGrants({
        record: async (body) => { seen.push(body); return { consentType: body.consentType, granted: true }; },
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(seen.map((body) => body.consentType), REQUIRED_TYPES);
    assert.equal(seen.every((body) => body.granted === true && body.version === CONSENT_VERSION && body.currentPassword === undefined), true);

    let fails = 0;
    const failed = await submitConsentGrants({
        record: async () => {
            fails += 1;
            if (fails === 2) throw new Error('down');
        },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.reauth, undefined);
    assert.equal(failed.errorCopy, CONSENT_ERROR_COPY);

    const forbidden = await submitConsentGrants({
        record: async () => { throw new ApiError('forbidden', '需要重新验证身份', { status: 403 }); },
    });
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.reauth, true);
});

test('撤回先重新验证，再带当前密码写入未同意', async () => {
    const seen = [];
    await revokeConsent({
        type: 'AI_CONTENT_NOTICE',
        password: 'current-secret',
        reauth: async (password) => { seen.push(['reauth', password]); },
        record: async (body) => { seen.push(['record', body]); return body; },
    });
    assert.deepEqual(seen, [
        ['reauth', 'current-secret'],
        ['record', {
            consentType: 'AI_CONTENT_NOTICE',
            version: CONSENT_VERSION,
            granted: false,
            currentPassword: 'current-secret',
        }],
    ]);
    const deps = {
        reauth: async (password) => { seen.push(['deps-reauth', password]); },
        recordConsent: async (body) => { seen.push(['deps-record', body.granted, body.currentPassword, body.consentType]); },
    };
    await executeSensitiveAction({
        action: 'consent-revoke',
        password: 'current-secret',
        consentType: 'LOCK',
        deps,
    });
    assert.deepEqual(seen.slice(2), [
        ['deps-reauth', 'current-secret'],
        ['deps-record', false, 'current-secret', 'LOCK'],
    ]);
});

test('同意层不可关闭，展开正文，失败后留在页面并可重试', async () => {
    const document = installMiniDom();
    const seen = [];
    let failOnce = true;
    const logout = [];
    const gate = await mountConsentGate({
        document,
        listConsents: async () => [],
        captureSession: async () => ({ accountId: '7', sessionId: '8' }),
        recordConsent: async (body) => {
            seen.push(body.consentType);
            if (failOnce && seen.length === 1) {
                failOnce = false;
                throw new Error('down');
            }
            return body;
        },
        logout: async () => { logout.push('out'); },
        assign: (url) => { logout.push(url); },
    });
    assert.equal(gate.open, true);
    const cancel = gate.dispatch('cancel');
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(gate.open, true);
    const toggle = document.querySelector('[data-consent-toggle="AI_CONTENT_NOTICE"]');
    toggle.click();
    const copy = toggle.parentNode.querySelector('.vc-consent-copy');
    assert.equal(copy.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.match(copy.textContent, /模型生成/);
    document.querySelector('[data-consent-accept]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(gate.open, true);
    const error = document.querySelector('[data-consent-error]');
    assert.equal(error.hidden, false);
    assert.equal(error.textContent, CONSENT_ERROR_COPY);
    document.querySelector('[data-consent-accept]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(gate.open, false);
    assert.equal(document.querySelector('#vc-consent'), null);
    assert.equal(seen.length, 1 + 5);

    const again = await mountConsentGate({
        document,
        listConsents: async () => REQUIRED_TYPES.map((type) => granted(type)),
    });
    assert.equal(again, null);
    assert.equal(document.querySelector('#vc-consent'), null);

    const reauthDoc = installMiniDom();
    let blocked = true;
    const reauthSeen = [];
    const reauthGate = await mountConsentGate({
        document: reauthDoc,
        listConsents: async () => [],
        captureSession: async () => ({ accountId: '7', sessionId: '8' }),
        recordConsent: async () => {
            if (blocked) throw new ApiError('forbidden', '需要重新验证身份', { status: 403 });
            reauthSeen.push('recorded');
            return {};
        },
        reauth: async (password) => { reauthSeen.push(password); blocked = false; },
    });
    reauthDoc.querySelector('[data-consent-accept]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(reauthGate.open, true);
    assert.equal(reauthDoc.querySelector('[data-consent-reauth]').hidden, false);
    const input = reauthDoc.querySelector('[data-consent-reauth-password]');
    input.value = 'current-secret';
    reauthDoc.querySelector('[data-consent-reauth]').dispatch('submit');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(reauthSeen[0], 'current-secret');
    assert.deepEqual(reauthSeen.slice(1), ['recorded', 'recorded', 'recorded', 'recorded', 'recorded']);
    assert.equal(input.value, '');
    assert.equal(reauthGate.open, false);

    const loggedOut = await mountConsentGate({
        document: installMiniDom(),
        listConsents: async () => [],
        logout: async () => { logout.push('bye'); },
        assign: (url) => { logout.push(url); },
    });
    loggedOut.querySelector('[data-consent-logout]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(logout, ['bye', '/auth/']);
});

test('账户页有隐私与同意入口，样式与路由只覆盖 consents', async () => {
    const html = renderAccountShell();
    assert.match(html, /aria-label="隐私与同意"/);
    assert.match(html, /data-consent-account-list/);
    const document = installMiniDom();
    document.body.classList.add('vc-ui');
    const { mountDataRights } = await import('../extension/vc-model-settings/data-rights.js');
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    let account;
    try {
        account = mountDataRights();
        account.open();
        assert.match(document.body.innerHTML, /data-vc-account-go="consent"/);
        assert.match(document.body.innerHTML, /隐私与同意/);
    } finally {
        account?.close();
        globalThis.fetch = previousFetch;
    }

    const css = await readFile(new URL('../extension/vc-model-settings/consent.css', import.meta.url), 'utf8');
    assert.match(css, /\[data-consent-accept\][\s\S]*height:\s*50px/);
    assert.match(css, /var\(--vc-sheet/);
    assert.match(css, /var\(--vc-z-alert\)/);
    assert.equal(/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/.test(css), false);
    assert.equal(css.includes('rgb('), false);
    assert.match(css, /data-vc-screen="consent"/);

    const sprite = await readFile(new URL('../extension/vc-model-settings/ui/icons/lucide.svg', import.meta.url), 'utf8');
    assert.match(sprite, /id="file-text"/);
    assert.match(sprite, /id="cpu"/);

    const index = await readFile(new URL('../extension/vc-model-settings/index.js', import.meta.url), 'utf8');
    assert.match(index, /mountConsentGate\(/);
    assert.ok(index.indexOf('mountConsentGate(') > index.indexOf('mountShell({'));

    const rights = await readFile(new URL('../extension/vc-model-settings/data-rights.js', import.meta.url), 'utf8');
    assert.match(rights, /撤回这项同意/);
    assert.match(rights, /下次进入需要重新同意/);
    assert.match(rights, /consent-revoke/);

    const paths = ACCOUNT_UI_ROUTES.map((route) => `${route.method} ${route.sample}`);
    assert.equal(paths.includes('GET /api/v1/consents'), true);
    assert.equal(paths.includes('PUT /api/v1/consents'), true);
    const consentRoutes = ACCOUNT_UI_ROUTES.filter((route) => route.sample === '/api/v1/consents');
    assert.deepEqual(consentRoutes.map((route) => route.method).sort(), ['GET', 'PUT']);
    for (const route of consentRoutes) {
        assert.equal(ADMIN_BRIDGE_ROUTES.some((item) => item.method === route.method && item.path.test(route.sample)), true, route.method);
    }
    const consentJs = await readFile(new URL('../extension/vc-model-settings/consent.js', import.meta.url), 'utf8');
    assert.equal(consentJs.includes('selectDetent'), false);
    assert.equal(consentJs.includes('openSheet'), false);
    assert.match(consentJs, /preventDefault/);
});
