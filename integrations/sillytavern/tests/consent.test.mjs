import './react-dom-bootstrap.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installReactDom } from './react-dom.mjs';
import { ApiError } from '../extension/vc-model-settings/api.js';
import { executeSensitiveAction } from '../extension/vc-model-settings/data-rights.js';
import { accountFixture } from './account-dom.mjs';
import { ACCOUNT_UI_ROUTES } from '../extension/vc-model-settings/account-ui-routes.js';
import { ADMIN_BRIDGE_ROUTES } from '../server-plugin/virtual-companion/lib/admin-bridge.js';
import {
    CONSENT_ERROR_COPY,
    CONSENT_VERSION,
    REQUIRED_CONSENTS,
    consentOutstanding,
    consentStatusText,
    mountConsentGate,
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

test('同意页只有标题、五项和两个按钮', async (t) => {
    const document = installReactDom(t);
    const gate = await mountConsentGate({ document, listConsents: async () => [], captureSession: async () => ({}), recordConsent: async body => body });
    assert.equal(gate.querySelector('#vc-consent-title').textContent, '开始之前');
    for (const item of REQUIRED_CONSENTS) {
        const toggle = gate.querySelector(`[data-consent-toggle="${item.type}"]`);
        assert.ok(toggle); assert.equal(toggle.textContent, item.label);
        assert.ok(toggle.querySelector(`use[href$="#${item.icon}"]`));
        const copy = toggle.parentElement.querySelector('.vc-consent-copy'); assert.equal(copy.hidden, true); assert.equal(copy.textContent, item.body);
    }
    assert.equal(gate.querySelector('[data-consent-accept]').textContent, '同意并继续');
    assert.equal(gate.querySelector('[data-consent-logout]').textContent, '退出登录');
    assert.equal(gate.querySelectorAll('.vc-consent-copy').length, 5);
    assert.equal(gate.querySelector('.vc-consent-scroll').querySelectorAll('p').length, 6);
    assert.equal(gate.querySelector('[data-consent-error]').hidden, true);
    gate.querySelector('[data-consent-accept]').click(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(gate.isConnected, false);
});

test('状态行写已同意或未同意，并带上日期', async (t) => {
    const grantedText = consentStatusText({ granted: true, grantedAt: '2026-10-30T01:02:03Z' });
    assert.match(grantedText, /^已同意 /);
    const revoked = consentStatusText({ granted: false, revokedAt: '2026-10-30T04:05:06Z', grantedAt: '2026-10-30T01:02:03Z' });
    assert.match(revoked, /^未同意 /);
    assert.equal(consentStatusText(null), '未同意');
    assert.equal(consentStatusText({ granted: false }), '未同意');
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async url => new Response(JSON.stringify(String(url).endsWith('/auth/session') ? { accountId: '1', sessionId: '2' } : String(url).endsWith('/consents') ? [granted('SERVICE_TERMS'), { consentType: 'PRIVACY_POLICY', granted: false, revokedAt: '2026-10-30T04:05:06Z' }] : []), { status: 200 });
    const { account, root } = await accountFixture(t);
    try {
        account.open();
        for (let i = 0; i < 30 && !root.querySelector('[data-consent-type]'); i++) await new Promise(resolve => setTimeout(resolve, 0));
        assert.match(root.querySelector('[data-consent-type="SERVICE_TERMS"]').textContent, /已同意/);
        assert.match(root.querySelector('[data-consent-type="PRIVACY_POLICY"]').textContent, /未同意/);
        assert.ok(root.querySelector('[data-consent-revoke="SENSITIVE_DATA_PROCESSING"]'));
    } finally { account.close(); globalThis.fetch = previousFetch; }
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

test('同意层不可关闭，展开正文，失败后留在页面并可重试', async (t) => {
    const document = installReactDom(t);
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
    const cancel = new document.defaultView.Event('cancel', { cancelable: true }); gate.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(gate.open, true);
    const toggle = document.querySelector('[data-consent-toggle="AI_CONTENT_NOTICE"]');
    toggle.click(); await new Promise(resolve => setTimeout(resolve, 0));
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

    const reauthDoc = document;
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
    reauthDoc.querySelector('[data-consent-reauth]').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(reauthSeen[0], 'current-secret');
    assert.deepEqual(reauthSeen.slice(1), ['recorded', 'recorded', 'recorded', 'recorded', 'recorded']);
    assert.equal(input.value, '');
    assert.equal(reauthGate.open, false);

    const loggedOut = await mountConsentGate({
        document, captureSession: async () => ({}), recordConsent: async body => body,
        listConsents: async () => [],
        logout: async () => { logout.push('bye'); },
        assign: (url) => { logout.push(url); },
    });
    loggedOut.querySelector('[data-consent-logout]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(logout, ['bye', '/auth/']);
    loggedOut.querySelector('[data-consent-accept]').click(); await new Promise(resolve => setTimeout(resolve, 0));
});

test('账户页有隐私与同意入口，样式与路由只覆盖 consents', async (t) => {
    const { root, document, account } = await accountFixture(t, { vc: true });
    const html = root.innerHTML;
    assert.match(html, /aria-label="隐私与同意"/);
    assert.match(html, /data-consent-account-list/);
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    try {
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
    const gateComponent = await readFile(new URL('../desktop-ui/src/features/settings/ConsentGate.tsx', import.meta.url), 'utf8');
    assert.match(gateComponent, /preventDefault/);
    assert.match(gateComponent, /details.cancel\(\)/);
});
