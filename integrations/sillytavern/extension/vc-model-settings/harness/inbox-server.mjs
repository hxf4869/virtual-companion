// W15-2 主动陪伴页独立验证。只监听 127.0.0.1，桩数据不出网。
// 运行：node harness/inbox-server.mjs [--port 9465]
// scenario（请求头 X-Vc-Harness-Scenario）：sample | empty | conflict | reauth
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = dirname(HERE);
const STATIC_ROOT = dirname(EXT);
const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 9465);
const BRIDGE = '/api/plugins/virtual-companion/go';

const SECRET = 'super-secret-value';
const WEBHOOK = 'https://hooks.example.test/secret-path';
const SIGN = 'sign-secret-value';
const MARKER = 'PRIVATE_LIN_LOAN_31';
const GM = 'GM_ONLY_WATCH_TRUTH_92';

function sampleState() {
    return {
        policyPuts: 0,
        policies: {
            '11': {
                relationshipId: '11', enabled: true, quietHoursStart: '22:00', quietHoursEnd: '08:00',
                quietHoursTimezone: 'Asia/Shanghai', dailyLimit: 2, recentInteractionMinutes: 120,
                allowedModes: ['COMPANION'], offlineCapable: false, credential: SECRET,
            },
            '12': {
                relationshipId: '12', enabled: false, quietHoursStart: null, quietHoursEnd: null,
                quietHoursTimezone: null, dailyLimit: 0, recentInteractionMinutes: 0,
                allowedModes: ['COMPANION'], offlineCapable: false,
            },
        },
        followUps: [
            {
                followUpId: '41', relationshipId: '11', status: 'SCHEDULED', body: '周末散步待跟进',
                eventDate: '2026-11-02', eventTime: '09:30', eventTimezone: 'Asia/Shanghai',
                triggerAt: '2026-11-01T01:30:00Z', eventId: 'evt-walk', sourceRef: '/tmp/secret-source',
                leaseToken: 'lease-secret',
            },
            {
                followUpId: '42', relationshipId: '11', status: 'CANCELLED', body: '已取消的跟进',
                eventDate: null, eventTime: null, eventTimezone: null, triggerAt: null, eventId: 'evt-old',
            },
        ],
        inbox: [
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
        ],
        channels: [
            {
                channelId: '7', channel: 'EMAIL', enabled: true, configuredTarget: 'owner@example.invalid',
                previewBody: false, relationshipIds: ['11'], credential: SECRET, webhookUrl: WEBHOOK, signSecret: SIGN,
            },
            {
                channelId: '8', channel: 'FEISHU', enabled: false, configuredTarget: '澄夏日常群',
                previewBody: false, relationshipIds: ['11'], credential: SECRET,
            },
        ],
        deliveries: [
            { deliveryId: '1', eventId: 'evt-pending', channel: 'EMAIL', configuredTarget: 'owner@example.invalid', status: 'accepted', attemptCount: 1, failureCode: 'SMTP_REJECTED', correlationId: 'corr-secret' },
            { deliveryId: '2', eventId: 'evt-pending', channel: 'FEISHU', configuredTarget: '澄夏日常群', status: 'unknown', attemptCount: 1 },
            { deliveryId: '3', eventId: 'evt-written', channel: 'EMAIL', configuredTarget: 'owner@example.invalid', status: 'pending', attemptCount: 0 },
            { deliveryId: '4', eventId: 'evt-removed', channel: 'EMAIL', configuredTarget: 'owner@example.invalid', status: 'failed', attemptCount: 2, failureCode: 'SMTP_REJECTED' },
            { deliveryId: '5', eventId: 'evt-invalid', channel: 'EMAIL', configuredTarget: 'owner@example.invalid', status: 'stopped', attemptCount: 0, stoppedReason: 'cancelled' },
            { deliveryId: '6', eventId: 'evt-wait', channel: 'FEISHU', configuredTarget: WEBHOOK, status: 'stopped', attemptCount: 0, stoppedReason: 'expired', correlationId: 'corr-secret' },
        ],
    };
}

function emptyState() {
    const state = sampleState();
    state.policies['11'] = {
        relationshipId: '11', enabled: false, quietHoursStart: null, quietHoursEnd: null,
        quietHoursTimezone: null, dailyLimit: 0, recentInteractionMinutes: 0,
        allowedModes: ['COMPANION'], offlineCapable: false,
    };
    state.followUps = [];
    state.inbox = [];
    state.channels = [];
    state.deliveries = [];
    return state;
}

const sessions = new Map();

function stateFor(scenario) {
    if (!sessions.has(scenario)) sessions.set(scenario, scenario === 'empty' ? emptyState() : sampleState());
    return sessions.get(scenario);
}

function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}

function policyView(row) {
    return {
        relationshipId: row.relationshipId, enabled: row.enabled, quietHoursStart: row.quietHoursStart,
        quietHoursEnd: row.quietHoursEnd, quietHoursTimezone: row.quietHoursTimezone,
        dailyLimit: row.dailyLimit, recentInteractionMinutes: row.recentInteractionMinutes,
        allowedModes: row.allowedModes, offlineCapable: row.offlineCapable,
    };
}

function handle(req, res, goPath, scenario, state, body) {
    if (req.method === 'GET' && goPath === '/api/v1/auth/session') {
        return send(res, 200, { accountId: '9007199254740993', sessionId: '42' });
    }
    if (req.method === 'POST' && goPath === '/api/v1/auth/reauth') return send(res, 200, { ok: true });
    if (req.method === 'GET' && goPath === '/api/v1/relationships') {
        return send(res, 200, [
            { relationshipId: '11', personaRef: 'st-character', companionName: '澄夏' },
            { relationshipId: '12', personaRef: 'st-character', companionName: '周澈' },
        ]);
    }
    const policyPath = goPath.match(/^\/api\/v1\/relationships\/([1-9][0-9]{0,18})\/proactive-policy$/);
    if (policyPath && req.method === 'GET') return send(res, 200, policyView(state.policies[policyPath[1]]));
    if (policyPath && req.method === 'PUT') {
        state.policyPuts += 1;
        if (scenario === 'conflict' && state.policyPuts === 1) return send(res, 409, { code: 'REVISION_CONFLICT', message: 'conflict' });
        if (scenario === 'reauth' && state.policyPuts === 1) return send(res, 403, { code: 'ACCESS_DENIED', message: 'reauth' });
        const current = state.policies[policyPath[1]];
        Object.assign(current, {
            enabled: body.enabled === true,
            quietHoursStart: body.quietHoursStart ?? null,
            quietHoursEnd: body.quietHoursEnd ?? null,
            quietHoursTimezone: body.quietHoursTimezone ?? null,
            dailyLimit: body.dailyLimit,
            recentInteractionMinutes: body.recentInteractionMinutes,
            allowedModes: body.allowedModes,
            offlineCapable: body.offlineCapable === true,
        });
        delete current.credential;
        return send(res, 200, policyView(current));
    }
    const followPath = goPath.match(/^\/api\/v1\/relationships\/([1-9][0-9]{0,18})\/follow-ups$/);
    if (followPath && req.method === 'GET') {
        return send(res, 200, state.followUps.filter((item) => item.relationshipId === followPath[1]));
    }
    const cancelPath = goPath.match(/^\/api\/v1\/follow-ups\/([1-9][0-9]{0,18})\/cancel$/);
    if (cancelPath && req.method === 'POST') {
        const row = state.followUps.find((item) => item.followUpId === cancelPath[1]);
        if (!row) return send(res, 404, { code: 'NOT_FOUND', message: 'missing' });
        row.status = 'CANCELLED';
        return send(res, 200, row);
    }
    if (req.method === 'GET' && goPath === '/api/v1/inbox') return send(res, 200, state.inbox);
    const readPath = goPath.match(/^\/api\/v1\/inbox\/([A-Za-z0-9_.:-]{1,128})\/read$/);
    if (readPath && req.method === 'POST') {
        const row = state.inbox.find((item) => item.eventId === readPath[1]);
        if (!row) return send(res, 404, { code: 'NOT_FOUND', message: 'missing' });
        row.read = true;
        return send(res, 200, row);
    }
    if (req.method === 'GET' && goPath === '/api/v1/notification-channels') return send(res, 200, state.channels);
    if (req.method === 'PUT' && goPath === '/api/v1/notification-channels') {
        const target = String(body.configuredTarget || '');
        if (target.includes('://')) return send(res, 400, { code: 'INVALID_REQUEST', message: '地址不能是链接' });
        const saved = {
            channelId: String(body.channelId || state.channels.find((item) => item.channel === body.channel && item.configuredTarget === target)?.channelId || '9'),
            channel: body.channel, enabled: body.enabled === true, configuredTarget: target,
            previewBody: body.previewBody === true, relationshipIds: body.relationshipIds || [],
            credential: SECRET, webhookUrl: WEBHOOK, signSecret: SIGN,
        };
        state.channels = state.channels.filter((item) => item.channelId !== saved.channelId).concat(saved);
        return send(res, 200, saved);
    }
    if (req.method === 'GET' && goPath === '/api/v1/notification-deliveries') return send(res, 200, state.deliveries);
    return send(res, 404, { code: 'NOT_FOUND', message: goPath });
}

function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
            try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
        });
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname.startsWith(BRIDGE)) {
        const scenario = String(req.headers['x-vc-harness-scenario'] || 'sample');
        const body = await readBody(req);
        return handle(req, res, url.pathname.slice(BRIDGE.length), scenario, stateFor(scenario), body);
    }
    if (url.pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
    }
    let file = null;
    if (url.pathname === '/' || url.pathname === '/inbox.html') file = join(HERE, 'inbox.html');
    else if (!url.pathname.includes('..')) file = join(STATIC_ROOT, url.pathname.replace(/^\/+/, ''));
    if (file && existsSync(file) && !file.endsWith('.mjs')) {
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
        res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        return res.end(readFileSync(file));
    }
    res.writeHead(404);
    res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[vc-inbox harness] listening http://127.0.0.1:${PORT}/?scenario=sample`);
});
