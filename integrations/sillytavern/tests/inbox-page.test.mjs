// W15-2：通知与 inbox 页。假 fetch，不启浏览器、不发真实邮件或飞书。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as api from '../extension/vc-model-settings/api.js';
import { ADMIN_BRIDGE_ROUTES } from '../server-plugin/virtual-companion/lib/admin-bridge.js';
import * as inboxRoutes from '../server-plugin/virtual-companion/lib/inbox-ui-routes.js';
const { INBOX_UI_ROUTES } = inboxRoutes;
import { createInboxPage, renderInboxPage } from '../extension/vc-model-settings/inbox-page.js';

const SECRET = 'super-secret-value';
const WEBHOOK = 'https://hooks.example.test/secret-path';
const SIGN = 'sign-secret-value';
const MARKER = 'PRIVATE_LIN_LOAN_31';
const GM = 'GM_ONLY_WATCH_TRUTH_92';
const realFetch = globalThis.fetch;
const realDocument = globalThis.document;
const realStorage = globalThis.localStorage;
let calls;
let route;
let storage;

const policy = {
    relationshipId: '11', enabled: true, quietHoursStart: '22:00', quietHoursEnd: '08:00',
    quietHoursTimezone: 'Asia/Shanghai', dailyLimit: 2, recentInteractionMinutes: 120,
    allowedModes: ['COMPANION'], offlineCapable: false,
};
const followUps = [
    {
        followUpId: '41', relationshipId: '11', status: 'SCHEDULED', body: '周末散步待跟进',
        normalizationStatus: 'explicit_date', reminderRuleConfirmed: true, eventDate: '2026-11-02',
        eventTime: '09:30', eventTimezone: 'Asia/Shanghai', triggerAt: '2026-11-01T01:30:00Z',
        eventId: 'evt-walk', deliverable: 'DELIVERABLE', sourceRef: '/tmp/secret-source',
    },
    {
        followUpId: '42', relationshipId: '11', status: 'CANCELLED', body: '已取消的跟进',
        normalizationStatus: 'none', reminderRuleConfirmed: false, eventDate: null, eventTime: null,
        eventTimezone: null, triggerAt: null, eventId: 'evt-old', deliverable: 'NOT_DELIVERABLE',
    },
];
const inbox = [
    {
        inboxId: '1', eventId: 'evt-pending', relationshipId: '11', conversationId: '21',
        intent: 'BODY', body: '湖边散步后续', persisted: true, stDelivered: false, linkStatus: 'present',
        link: { relationshipId: '11', conversationId: '21' }, read: false, leaseToken: 'lease-secret',
    },
    {
        inboxId: '2', eventId: 'evt-written', relationshipId: '11', conversationId: '21',
        intent: 'BODY', body: '夜间阅读', persisted: true, stDelivered: true, linkStatus: 'present',
        link: { relationshipId: '11', conversationId: '21' }, read: true,
    },
    {
        inboxId: '3', eventId: 'evt-removed', relationshipId: '11', conversationId: '21',
        intent: 'BODY', body: '链接已移除的正文', persisted: true, stDelivered: true, linkStatus: 'removed',
        link: { relationshipId: '11', conversationId: '21' }, read: false,
    },
    {
        inboxId: '4', eventId: 'evt-invalid', relationshipId: '11', conversationId: '21',
        intent: 'BODY', body: '链接失效的正文', persisted: true, stDelivered: false, linkStatus: 'invalidated',
        link: { relationshipId: '11', conversationId: '21' }, read: false,
    },
    {
        inboxId: '5', eventId: 'evt-wait', relationshipId: '11', conversationId: '21',
        intent: 'WAITING_HOST', body: `不应出现的问候 ${MARKER} ${GM}`, persisted: true, stDelivered: false,
        linkStatus: 'present', link: { relationshipId: '11', conversationId: '21' }, read: false,
    },
];
const channels = [
    {
        channelId: '7', channel: 'EMAIL', enabled: true, configuredTarget: 'owner@example.invalid',
        previewBody: false, relationshipIds: ['11'], credential: SECRET, webhookUrl: WEBHOOK, signSecret: SIGN,
    },
    {
        channelId: '8', channel: 'FEISHU', enabled: false, configuredTarget: '澄夏日常群',
        previewBody: false, relationshipIds: ['11'], credential: SECRET,
    },
];
const deliveries = [
    { deliveryId: '1', eventId: 'evt-pending', channel: 'EMAIL', configuredTarget: 'owner@example.invalid', status: 'accepted', attemptCount: 1, failureCode: 'SMTP_REJECTED', correlationId: 'corr-secret' },
    { deliveryId: '2', eventId: 'evt-pending', channel: 'FEISHU', configuredTarget: '澄夏日常群', status: 'unknown', attemptCount: 1 },
    { deliveryId: '3', eventId: 'evt-written', channel: 'EMAIL', configuredTarget: 'owner@example.invalid', status: 'pending', attemptCount: 0 },
    { deliveryId: '4', eventId: 'evt-removed', channel: 'EMAIL', configuredTarget: 'owner@example.invalid', status: 'failed', attemptCount: 2, failureCode: 'SMTP_REJECTED' },
    { deliveryId: '5', eventId: 'evt-invalid', channel: 'EMAIL', configuredTarget: 'owner@example.invalid', status: 'stopped', attemptCount: 0, stoppedReason: 'cancelled' },
    { deliveryId: '6', eventId: 'evt-wait', channel: 'FEISHU', configuredTarget: WEBHOOK, status: 'stopped', attemptCount: 0, stoppedReason: 'expired' },
    { deliveryId: '7', eventId: 'evt-pending', channel: 'EMAIL', configuredTarget: 'owner@example.invalid', status: 'sending', attemptCount: 1 },
];

function install(next) {
    calls = [];
    storage = new Map();
    route = next;
    globalThis.document = { cookie: 'vc_csrf=go-token', body: { innerHTML: '' } };
    globalThis.localStorage = {
        get length() { return storage.size; },
        key: (index) => [...storage.keys()][index] ?? null,
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(String(key), String(value)),
        removeItem: (key) => storage.delete(key),
        clear: () => storage.clear(),
    };
    api.setStHeadersProvider(() => ({ 'X-CSRF-Token': 'st-token' }));
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers, body: init.body, credentials: init.credentials });
        const result = await route(String(url), init);
        return new Response(JSON.stringify(result.body), { status: result.status || 200, headers: result.headers });
    };
}

test.beforeEach(() => {
    install((url) => {
        if (url.endsWith('/auth/session')) return { body: { accountId: '9007199254740993', sessionId: '42' } };
        if (url.endsWith('/relationships')) return { body: [{ relationshipId: '11', companionName: '澄夏' }, { relationshipId: '12', companionName: '周澈' }] };
        if (url.endsWith('/proactive-policy')) return { body: url.includes('/relationships/12/') ? { ...policy, relationshipId: '12', enabled: false, quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: null } : policy };
        if (url.endsWith('/follow-ups')) return { body: url.includes('/relationships/12/') ? [] : followUps };
        if (url.endsWith('/inbox')) return { body: inbox };
        if (url.endsWith('/notification-channels')) return { body: channels };
        if (url.endsWith('/notification-deliveries')) return { body: deliveries };
        return { status: 500, body: { code: 'UNEXPECTED', message: url } };
    });
});

test.after(() => {
    globalThis.fetch = realFetch;
    globalThis.document = realDocument;
    globalThis.localStorage = realStorage;
});

function pathOf(url) {
    return new URL(url, 'https://example.invalid').pathname.replace(api.BRIDGE_PREFIX, '');
}

function allowed(method, path) {
    return [...ADMIN_BRIDGE_ROUTES, ...INBOX_UI_ROUTES].some((item) => item.method === method && item.path.test(path));
}

async function opened() {
    const page = createInboxPage();
    await page.open();
    return page;
}

function html(page) {
    return renderInboxPage(page.state);
}

function assertNoSecrets(label, text) {
    for (const secret of [SECRET, WEBHOOK, SIGN, MARKER, GM, 'lease-secret', 'corr-secret', 'smtp-secret', '手机已收到', '诊断日志']) {
        assert.equal(text.includes(secret), false, `${label} 含 ${secret}`);
    }
}

test('路由常量只覆盖本页需要放行的方法与路径', () => {
    assert.deepEqual(Object.keys(inboxRoutes).sort(), ['INBOX_UI_ROUTES']);
    const seen = INBOX_UI_ROUTES.map((item) => `${item.method} ${item.path}`);
    assert.equal(new Set(seen).size, seen.length);
    for (const item of INBOX_UI_ROUTES) {
        assert.equal(typeof item.where, 'string');
        assert.match(item.where, /W15/);
    }
    const expectPath = (method, path) => assert.equal(INBOX_UI_ROUTES.some((item) => item.method === method && item.path.test(path)), true, `${method} ${path}`);
    expectPath('GET', '/api/v1/relationships/11/proactive-policy');
    expectPath('PUT', '/api/v1/relationships/11/proactive-policy');
    expectPath('GET', '/api/v1/relationships/11/follow-ups');
    expectPath('POST', '/api/v1/follow-ups/41/cancel');
    expectPath('GET', '/api/v1/inbox');
    expectPath('POST', '/api/v1/inbox/evt-pending/read');
    expectPath('GET', '/api/v1/notification-channels');
    expectPath('PUT', '/api/v1/notification-channels');
    expectPath('GET', '/api/v1/notification-deliveries');
    assert.equal(INBOX_UI_ROUTES.some((item) => item.path.test('/api/v1/inbox/evt-pending/claim')), false);
    assert.equal(INBOX_UI_ROUTES.some((item) => item.path.test('/api/v1/inbox/evt-pending/ack')), false);
});

test('打开页面读取策略、跟进、inbox、渠道与投递，凭据不进页面、状态或 localStorage', async () => {
    const page = await opened();
    const text = html(page);
    for (const item of ['澄夏', '22:00', '08:00', 'Asia/Shanghai', '周末散步待跟进', '待跟进', '取消跟进', '已取消', '待写入', '已写入', '当前链接已移除', '链接失效', '需要打开此会话继续', '渠道已接受', '结果未知', '待发送', '发送中', '失败', '已停止', '过期', '已启用', '已关闭', '不回显', '群成员可见', '应用未读', '应用已读']) {
        assert.ok(text.includes(item), item);
    }
    assert.match(text, /data-preview="false"/);
    assert.match(text, /正文预览/);
    assert.doesNotMatch(text, /强制覆盖|测试通知|诊断日志|手机已收到/);
    assert.equal(text.includes('已取消的跟进') && !text.includes('data-action="ask-cancel" data-follow-up-id="42"'), true);
    assertNoSecrets('渲染', text);
    assertNoSecrets('状态', JSON.stringify(page.state));
    assert.equal(storage.size, 0);
    assert.equal(calls.some((call) => call.url.includes('/claim') || call.url.includes('/ack')), false);
    for (const call of calls) assert.equal(allowed(call.method, pathOf(call.url)), true, call.url);
    page.close();
});

test('保存主动策略不带版本号；静默时段缺一时不发出请求', async () => {
    const page = await opened();
    calls = [];
    page.setPolicy({ quietHoursStart: '21:00', quietHoursEnd: '', quietHoursTimezone: '' });
    await page.savePolicy();
    assert.equal(calls.length, 0);
    assert.match(html(page), /静默时段需要同时填写开始、结束和时区/);
    page.setPolicy({ quietHoursStart: '21:00', quietHoursEnd: '07:00', quietHoursTimezone: 'Asia/Shanghai', dailyLimit: 2, recentInteractionMinutes: 120, allowedModes: ['COMPANION'], offlineCapable: false, enabled: true });
    await page.savePolicy();
    const put = calls.find((call) => call.method === 'PUT');
    assert.equal(pathOf(put.url), '/api/v1/relationships/11/proactive-policy');
    assert.equal(put.credentials, 'same-origin');
    assert.equal(put.headers['X-CSRF-Token'], 'st-token');
    assert.equal(put.headers['X-VC-CSRF-Token'], 'go-token');
    assert.equal(put.headers['X-VC-Expected-Account-ID'], '9007199254740993');
    const body = JSON.parse(put.body);
    assert.equal(Object.hasOwn(body, 'expectedRevision'), false);
    assert.deepEqual(body, {
        enabled: true, quietHoursStart: '21:00', quietHoursEnd: '07:00', quietHoursTimezone: 'Asia/Shanghai',
        dailyLimit: 2, recentInteractionMinutes: 120, allowedModes: ['COMPANION'], offlineCapable: false,
    });
    page.close();
});

test('版本冲突保留草稿，不能强制覆盖', async () => {
    const page = await opened();
    page.setPolicy({ quietHoursStart: '21:00', quietHoursEnd: '07:00', quietHoursTimezone: 'Asia/Shanghai' });
    const base = route;
    route = (url, init) => (init.method === 'PUT' && url.includes('/proactive-policy')
        ? { status: 409, body: { code: 'REVISION_CONFLICT' } }
        : base(url, init));
    await page.savePolicy();
    assert.equal(page.state.policyDraft.quietHoursStart, '21:00');
    assert.equal(page.state.policyConflict, true);
    const text = html(page);
    assert.match(text, /输入已保留/);
    assert.match(text, /查看最新/);
    assert.match(text, /保留草稿/);
    assert.doesNotMatch(text, /强制覆盖/);
    const puts = calls.filter((call) => call.method === 'PUT').length;
    await page.savePolicy();
    assert.equal(calls.filter((call) => call.method === 'PUT').length, puts);
    page.keepPolicyDraft();
    assert.equal(page.state.policyConflict, false);
    assert.equal(page.state.policyDraft.quietHoursStart, '21:00');
    page.close();
});

test('取消跟进走取消接口；打开会话只记应用已读', async () => {
    let openedConversation = null;
    const page = createInboxPage({ onOpenConversation: (value) => { openedConversation = value; } });
    await page.open();
    const base = route;
    route = (url, init) => (init.method === 'POST' && url.endsWith('/cancel')
        ? { body: { ...followUps[0], status: 'CANCELLED' } }
        : init.method === 'POST' && url.endsWith('/read')
            ? { body: { ...inbox[0], read: true } }
            : base(url, init));
    page.askCancel('41');
    assert.match(html(page), /取消这条跟进/);
    await page.confirmCancel();
    const cancel = calls.find((call) => call.method === 'POST' && call.url.endsWith('/cancel'));
    assert.equal(pathOf(cancel.url), '/api/v1/follow-ups/41/cancel');
    assert.equal(cancel.body, undefined);
    assert.equal(page.state.followUps.find((item) => item.followUpId === '41').status, 'CANCELLED');
    await page.openConversation('evt-pending');
    assert.equal(pathOf(calls.find((call) => call.url.endsWith('/read')).url), '/api/v1/inbox/evt-pending/read');
    assert.deepEqual(openedConversation, { eventId: 'evt-pending', conversationId: '21', relationshipId: '11' });
    assert.equal(JSON.stringify(openedConversation).includes('湖边散步后续'), false);
    assert.equal(calls.some((call) => call.url.includes('/claim') || call.url.includes('/ack')), false);
    page.close();
});

test('渠道保存只提交本次凭据，成功后不再出现在页面里', async () => {
    const page = await opened();
    calls = [];
    page.setChannel('7', { credential: SECRET, previewBody: false, enabled: true, configuredTarget: 'owner@example.invalid', relationshipIds: ['11'] });
    assert.doesNotMatch(html(page), new RegExp(SECRET));
    const base = route;
    route = (url, init) => (init.method === 'PUT' ? { body: { channelId: '7', channel: 'EMAIL', enabled: true, configuredTarget: 'owner@example.invalid', previewBody: false, relationshipIds: ['11'], credential: SECRET, webhookUrl: WEBHOOK } } : base(url, init));
    await page.saveChannel('7');
    const put = calls.find((call) => call.method === 'PUT');
    assert.equal(pathOf(put.url), '/api/v1/notification-channels');
    assert.deepEqual(JSON.parse(put.body), {
        channel: 'EMAIL', enabled: true, configuredTarget: 'owner@example.invalid', previewBody: false,
        relationshipIds: ['11'], credential: SECRET,
    });
    assert.equal(page.state.channelDrafts.find((item) => item.key === '7').credential, '');
    assert.match(html(page), /已配置/);
    assertNoSecrets('保存后', html(page));
    assertNoSecrets('保存后状态', JSON.stringify(page.state));
    page.setChannel('7', { configuredTarget: WEBHOOK });
    await page.saveChannel('7');
    assert.equal(calls.filter((call) => call.method === 'PUT').length, 1);
    assert.match(html(page), /地址不能是链接/);
    page.close();
});

test('未配置的渠道默认关闭正文预览，空凭据不覆盖已保存的凭据', async () => {
    const base = route;
    route = (url, init) => (url.endsWith('/notification-channels') && init.method !== 'PUT' ? { body: [] } : base(url, init));
    const page = await opened();
    const text = html(page);
    assert.match(text, /未配置/);
    assert.match(text, /data-channel="EMAIL" data-preview="false"/);
    assert.match(text, /data-channel="FEISHU" data-preview="false"/);
    assert.match(text, /群成员可见/);
    calls = [];
    page.setChannel('new:EMAIL', { configuredTarget: 'owner@example.invalid', enabled: false, relationshipIds: ['11'] });
    route = (url, init) => (init.method === 'PUT' ? { body: { channelId: '9', channel: 'EMAIL', enabled: false, configuredTarget: 'owner@example.invalid', previewBody: false, relationshipIds: ['11'] } } : base(url, init));
    await page.saveChannel('new:EMAIL');
    const body = JSON.parse(calls.find((call) => call.method === 'PUT').body);
    assert.equal(Object.hasOwn(body, 'credential'), false);
    assert.equal(body.previewBody, false);
    assert.equal(body.enabled, false);
    assert.match(html(page), /已关闭/);
    page.close();
});

test('开关、状态徽标、静默摘要卡和凭据占位表达当前状态', async () => {
    const page = await opened();
    const text = html(page);
    assert.match(text, /class="vc-inbox-switch" role="switch" data-action="toggle-enabled" data-field="enabled" aria-checked="true" aria-pressed="true"/);
    assert.match(text, /class="vc-inbox-switch" role="switch" data-action="toggle-preview" data-key="7" data-field="previewBody" aria-checked="false" aria-pressed="false"/);
    assert.match(text, /主动问候<\/span>/);
    assert.match(text, /正文预览<\/span>/);
    assert.doesNotMatch(text, /主动问候开|主动问候关|正文预览 开|正文预览 关/);
    assert.match(text, /class="vc-inbox-badge"[^>]*>渠道已接受</);
    assert.match(text, /data-status="sending"/);
    assert.match(text, /class="vc-inbox-badge"[^>]*>发送中</);
    assert.doesNotMatch(text, /手机已收到/);
    assert.match(text, /class="vc-inbox-badge"[^>]*>待写入</);
    assert.match(text, /class="vc-inbox-badge"[^>]*>不回显</);
    assert.match(text, /class="vc-inbox-summary"/);
    assert.match(text, /静默时段/);
    assert.match(text, /<h3>时区<\/h3>/);
    assert.match(text, /<h3>每日上限<\/h3>/);
    assert.match(text, /placeholder="已配置，留空不修改"/);
    assert.match(text, /aria-label="凭据"/);
    const css = await readFile(new URL('../extension/vc-model-settings/inbox.css', import.meta.url), 'utf8');
    assert.match(css, /--SmartThemeBlurTintColor/);
    assert.match(css, /--SmartThemeBodyColor/);
    assert.match(css, /#14181F/);
    assert.match(css, /#9AB9FF/);
    page.close();
});

test('写入被拒绝时保留草稿，重新验证后才再次提交', async () => {
    const page = await opened();
    page.setPolicy({ quietHoursStart: '21:00', quietHoursEnd: '07:00', quietHoursTimezone: 'Asia/Shanghai' });
    const base = route;
    let puts = 0;
    route = (url, init) => {
        if (init.method === 'PUT' && url.includes('/proactive-policy')) {
            puts += 1;
            if (puts === 1) return { status: 403, body: { code: 'ACCESS_DENIED' } };
            return { body: { ...policy, quietHoursStart: '21:00', quietHoursEnd: '07:00' } };
        }
        if (init.method === 'POST' && url.endsWith('/reauth')) return { body: { ok: true } };
        return base(url, init);
    };
    await page.savePolicy();
    assert.equal(page.state.reauth.open, true);
    assert.equal(page.state.policyDraft.quietHoursStart, '21:00');
    page.setReauthPassword('current-password-value');
    assert.doesNotMatch(html(page), /current-password-value/);
    assert.equal(storage.size, 0);
    await page.authenticate();
    assert.equal(puts, 2);
    assert.equal(page.state.reauth.open, false);
    assert.equal(page.state.reauth.password, '');
    assert.equal(JSON.stringify(page.state).includes('current-password-value'), false);
    const reauth = calls.find((call) => call.url.endsWith('/reauth'));
    assert.deepEqual(JSON.parse(reauth.body), { password: 'current-password-value' });
    assert.equal(calls.filter((call) => call.method === 'PUT').every((call) => !String(call.body).includes('current-password-value')), true);
    page.close();
});
