// V2-W03-S3 · 模型设置页独立验证 harness。
// 运行：node harness/server.mjs [--port 8873]  → http://127.0.0.1:8873/?scenario=sample
// scenario: sample（2 供应商示例）| empty | conflict（首次 PUT 409）| unauth（401）| error（500）
// 合成服务端按后端真实规则拒绝非法形状（endpoint.go / V119 / V140 / S2 契约），不产生任何外部网络调用。
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEndpoint } from '../model-logic.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = dirname(HERE); // .../extension/vc-model-settings
const STATIC_ROOT = dirname(EXT); // URL 空间以 extension/ 为根：/vc-model-settings/**
const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8873);
const BRIDGE = '/api/plugins/virtual-companion/go';
const GO = '/api/v1/admin';

const REASONING_LEVEL_RE = /^[a-z0-9_-]{1,32}$/;
const PROVIDER_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const CAP_KEYS = ['imageInput', 'videoInput', 'pdfInput', 'structuredOutput', 'toolCalls', 'nativeWebSearch', 'systemMessage', 'temperature', 'topP'];
const PURPOSE_IDS = ['FOREGROUND_CHAT', 'MEMORY_EXTRACTION_DEDUP_SUMMARY', 'BACKGROUND_GREETINGS', 'STORY_DIRECTOR', 'NPC_DIALOGUE', 'EMBEDDING'];

let now = '2026-10-28T10:00:00+08:00';

function sampleProviders() {
    return [
        {
            providerId: 'main-relay', displayName: '主中转服务', protocol: 'OPENAI_CHAT_COMPLETIONS',
            baseUrl: 'https://relay.example.com/v1', credentialConfigured: true, state: 'ENABLED',
            revision: 12, updatedAt: now,
            models: [
                {
                    profileKey: 'daily-chat', modelId: 'vendor/daily-chat', displayName: '日常对话',
                    contextWindowTokens: 128000, maxOutputTokens: 8192, state: 'ENABLED', priority: 1,
                    capabilities: { imageInput: 'VERIFIED', videoInput: 'UNSUPPORTED', pdfInput: 'DECLARED', structuredOutput: 'DECLARED', toolCalls: 'VERIFIED', nativeWebSearch: 'UNKNOWN', systemMessage: 'DECLARED' },
                    reasoningLevels: ['low', 'medium', 'minimal'],
                    generationParams: { temperature: 0.8, topP: 0.95, reasoningEffort: 'low' },
                    pricing: { currency: 'USD', inputPerMillionTokens: 3, outputPerMillionTokens: 15, verifiedOn: '2026-10-01' },
                    updatedAt: now,
                },
                {
                    profileKey: 'long-context', modelId: 'vendor/long-context', displayName: '长上下文',
                    contextWindowTokens: null, maxOutputTokens: 16384, state: 'ENABLED', priority: 2,
                    capabilities: {}, reasoningLevels: [], generationParams: {}, pricing: {},
                    updatedAt: now,
                },
            ],
        },
        {
            providerId: 'backup-anthropic', displayName: '备用 Anthropic', protocol: 'ANTHROPIC_MESSAGES',
            baseUrl: 'https://api.anthropic.example', credentialConfigured: false, state: 'DISABLED',
            revision: 3, updatedAt: now,
            models: [
                {
                    profileKey: 'claude-alike', modelId: 'claude-alike-v2', displayName: 'Claude 兼容',
                    contextWindowTokens: 200000, maxOutputTokens: 32768, state: 'ENABLED', priority: 3,
                    capabilities: { toolCalls: 'DECLARED', systemMessage: 'DECLARED' },
                    reasoningLevels: ['high'],
                    generationParams: { reasoningEffort: 'high' },
                    pricing: { currency: 'USD', inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
                    updatedAt: now,
                },
            ],
        },
    ];
}

function samplePurposes(providers) {
    const bound = (providerId, profileKey, rev) => ({
        providerId, profileKey, modelId: providers.find((p) => p.providerId === providerId)?.models.find((m) => m.profileKey === profileKey)?.modelId ?? '',
        state: 'ENABLED', status: 'READY', revision: rev, updatedAt: now,
    });
    const pending = (rev) => ({ state: 'ENABLED', status: 'PENDING_CONFIGURATION', revision: rev, updatedAt: now });
    return [
        { purpose: 'FOREGROUND_CHAT', ...bound('main-relay', 'daily-chat', 8) },
        { purpose: 'MEMORY_EXTRACTION_DEDUP_SUMMARY', ...bound('main-relay', 'daily-chat', 5) },
        { purpose: 'BACKGROUND_GREETINGS', ...pending(2) },
        { purpose: 'STORY_DIRECTOR', ...bound('backup-anthropic', 'claude-alike', 4) },
        { purpose: 'NPC_DIALOGUE', ...pending(2) },
        { purpose: 'EMBEDDING', ...pending(1) },
    ];
}

const sessions = new Map(); // scenario → {providers, purposes, conflictOnce}

function stateFor(scenario) {
    if (!sessions.has(scenario)) {
        const providers = scenario === 'empty' ? [] : sampleProviders();
        sessions.set(scenario, { providers, purposes: samplePurposes(providers) });
    }
    return sessions.get(scenario);
}

function bad(res, status, code, message, details) {
    const body = { code, message };
    if (details) body.details = details;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}

function ok(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}

function boundPurposesOf(state, providerId, profileKey) {
    return state.purposes.filter((b) => b.providerId === providerId && b.profileKey === profileKey).map((b) => b.purpose);
}

function providerView(state, p) {
    const endpoint = normalizeEndpoint(p.baseUrl, p.protocol);
    return {
        providerId: p.providerId, displayName: p.displayName, protocol: p.protocol, baseUrl: p.baseUrl,
        credentialConfigured: p.credentialConfigured, state: p.state, revision: p.revision,
        updatedAt: p.updatedAt, endpointUrl: endpoint.ok ? endpoint.finalUrl : null,
        models: p.models.map((m) => ({ ...m, boundPurposes: boundPurposesOf(state, p.providerId, m.profileKey) })),
    };
}

function recomputeStatuses(state) {
    for (const b of state.purposes) {
        if (!b.providerId || !b.profileKey) {
            b.status = 'PENDING_CONFIGURATION';
            continue;
        }
        const provider = state.providers.find((p) => p.providerId === b.providerId);
        const model = provider?.models.find((m) => m.profileKey === b.profileKey);
        if (!provider || !model) { b.status = 'PENDING_CONFIGURATION'; continue; }
        b.status = provider.state === 'ENABLED' && model.state === 'ENABLED' ? 'READY' : 'UNAVAILABLE';
        b.modelId = model.modelId;
    }
}

function validateProviderPut(state, providerId, body, res) {
    if (!PROVIDER_ID_RE.test(providerId)) return bad(res, 400, 'INVALID_REQUEST', 'invalid provider id'), false;
    const name = String(body.displayName ?? '').trim();
    if (!name || name.length > 80) return bad(res, 400, 'INVALID_REQUEST', 'invalid display name'), false;
    if (!['ANTHROPIC_MESSAGES', 'OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES'].includes(body.protocol)) {
        return bad(res, 400, 'INVALID_REQUEST', 'invalid protocol'), false;
    }
    const endpoint = normalizeEndpoint(String(body.baseUrl ?? ''), body.protocol);
    if (!endpoint.ok) return bad(res, 400, 'INVALID_REQUEST', 'invalid base url'), false;
    const existing = state.providers.find((p) => p.providerId === providerId);
    if (!existing && body.state === 'ENABLED' && !body.credential) {
        return bad(res, 400, 'INVALID_REQUEST', 'new provider without credential must stay disabled'), false;
    }
    if (body.clearCredential && body.state === 'ENABLED') {
        return bad(res, 400, 'INVALID_REQUEST', 'clear credential requires disabled state'), false;
    }
    if (body.credential && body.clearCredential) {
        return bad(res, 400, 'INVALID_REQUEST', 'credential and clearCredential are exclusive'), false;
    }
    if (typeof body.expectedRevision !== 'number' || (existing && body.expectedRevision !== existing.revision)) {
        return bad(res, 409, 'REVISION_CONFLICT', 'revision conflict', { currentRevision: existing?.revision ?? 0 }), false;
    }
    for (const m of body.models ?? []) {
        const modelId = String(m.modelId ?? '').trim();
        if (!modelId || modelId.length > 200) return bad(res, 400, 'INVALID_REQUEST', 'invalid model id'), false;
        const dn = String(m.displayName ?? '').trim();
        if (!dn || dn.length > 100) return bad(res, 400, 'INVALID_REQUEST', 'invalid model display name'), false;
        const maxOut = Number(m.maxOutputTokens);
        if (!Number.isInteger(maxOut) || maxOut < 1 || maxOut > 262144) return bad(res, 400, 'INVALID_REQUEST', 'invalid max output'), false;
        if (m.contextWindowTokens !== undefined && (!Number.isInteger(m.contextWindowTokens) || m.contextWindowTokens < 1 || m.contextWindowTokens > 2000000)) {
            return bad(res, 400, 'INVALID_REQUEST', 'invalid context window'), false;
        }
        if (m.reasoningLevels !== undefined) {
            if (!Array.isArray(m.reasoningLevels) || m.reasoningLevels.some((v) => !REASONING_LEVEL_RE.test(String(v)))) {
                return bad(res, 400, 'INVALID_REQUEST', 'invalid reasoning level'), false;
            }
        }
        if (m.generationParams?.reasoningEffort !== undefined) {
            const levels = m.reasoningLevels ?? existing?.models.find((x) => x.profileKey === m.profileKey)?.reasoningLevels ?? [];
            if (!levels.includes(m.generationParams.reasoningEffort)) {
                return bad(res, 400, 'INVALID_REQUEST', 'reasoning effort not in levels'), false;
            }
        }
        if (m.capabilities !== undefined) {
            for (const key of Object.keys(m.capabilities)) {
                if (!CAP_KEYS.includes(key)) return bad(res, 400, 'INVALID_REQUEST', 'unknown capability'), false;
                const value = m.capabilities[key];
                if (!['UNKNOWN', 'DECLARED', 'VERIFIED', 'UNSUPPORTED'].includes(value)) {
                    return bad(res, 400, 'INVALID_REQUEST', 'invalid capability state'), false;
                }
                if (value === 'VERIFIED') {
                    const stored = existing?.models.find((x) => x.profileKey === m.profileKey)?.capabilities?.[key];
                    if (stored !== 'VERIFIED') {
                        return bad(res, 400, 'INVALID_REQUEST', 'cannot self-declare VERIFIED'), false;
                    }
                }
            }
        }
    }
    return true;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const scenario = req.headers['x-vc-harness-scenario'] ?? url.searchParams.get('scenario') ?? 'sample';

    // ---- 合成 Go 管理桥 ----
    if (url.pathname.startsWith(BRIDGE)) {
        const goPath = url.pathname.slice(BRIDGE.length);
        const state = stateFor(scenario);
        if (scenario === 'unauth') return bad(res, 401, 'AUTHENTICATION_REQUIRED', 'authentication required');
        if (scenario === 'error') return bad(res, 500, 'INTERNAL', 'synthetic failure');

        if (req.method === 'GET' && goPath === `${GO}/providers`) {
            return ok(res, 200, state.providers.map((p) => providerView(state, p)));
        }
        if (req.method === 'GET' && goPath === `${GO}/model-purposes`) {
            recomputeStatuses(state);
            return ok(res, 200, state.purposes);
        }

        // 写操作：双提交校验（cookie vc_csrf == 头 X-VC-CSRF-Token）
        if (req.method === 'PUT' || req.method === 'POST') {
            const cookie = (req.headers.cookie ?? '').match(/vc_csrf=([^;]+)/)?.[1] ?? '';
            const header = req.headers['x-vc-csrf-token'] ?? '';
            if (!cookie || !header || cookie !== header) {
                return bad(res, 403, 'ACCESS_DENIED', 'csrf rejected');
            }
        }

        const body = await readBody(req);
        // 最小 reauth（真实形状：POST /api/v1/auth/reauth {password}；用于 403 再验证交互的独立验证）
        if (req.method === 'POST' && goPath === '/api/v1/auth/reauth') {
            if (typeof body.password !== 'string' || !body.password) {
                return bad(res, 400, 'INVALID_REQUEST', 'password required');
            }
            return ok(res, 200, { ok: true });
        }
        const putProvider = goPath.match(new RegExp(`^${GO}/providers/([^/]+)$`));
        if (req.method === 'PUT' && putProvider) {
            const providerId = decodeURIComponent(putProvider[1]);
            if (!validateProviderPut(state, providerId, body, res)) return;
            if (scenario === 'conflict') {
                // 确定性冲突场景：每次保存都返回 409，验证「保留草稿 / 查看最新」可重复。
                const existing = state.providers.find((p) => p.providerId === providerId);
                return bad(res, 409, 'REVISION_CONFLICT', 'revision conflict', { currentRevision: (existing?.revision ?? 0) + 1 });
            }
            let provider = state.providers.find((p) => p.providerId === providerId);
            if (!provider) {
                provider = { providerId, revision: 0, credentialConfigured: false, models: [], updatedAt: now };
                state.providers.push(provider);
            }
            provider.displayName = body.displayName;
            provider.protocol = body.protocol;
            provider.baseUrl = String(body.baseUrl).trim();
            provider.state = body.state;
            provider.updatedAt = now;
            if (body.credential) provider.credentialConfigured = true;
            if (body.clearCredential) provider.credentialConfigured = false;
            provider.models = (body.models ?? []).map((m) => {
                const prev = provider.models.find((x) => x.profileKey === m.profileKey) ?? {};
                return {
                    profileKey: m.profileKey || m.modelId, modelId: m.modelId, displayName: m.displayName,
                    contextWindowTokens: m.contextWindowTokens ?? null, maxOutputTokens: m.maxOutputTokens,
                    state: m.state ?? 'ENABLED', priority: m.priority ?? prev.priority ?? 1,
                    capabilities: m.capabilities !== undefined ? { ...prev.capabilities, ...m.capabilities } : prev.capabilities ?? {},
                    reasoningLevels: m.reasoningLevels !== undefined ? m.reasoningLevels : prev.reasoningLevels ?? [],
                    generationParams: m.generationParams !== undefined ? m.generationParams : prev.generationParams ?? {},
                    pricing: m.pricing !== undefined ? m.pricing : prev.pricing ?? {},
                    updatedAt: now,
                };
            });
            provider.revision += 1;
            recomputeStatuses(state);
            return ok(res, 200, { ok: true, revision: provider.revision });
        }

        const putPurpose = goPath.match(new RegExp(`^${GO}/model-purposes/([^/]+)$`));
        if (req.method === 'PUT' && putPurpose) {
            const purpose = decodeURIComponent(putPurpose[1]);
            const binding = state.purposes.find((b) => b.purpose === purpose);
            if (!binding) return bad(res, 404, 'NOT_FOUND_OR_FORBIDDEN', 'not found');
            if (purpose === 'EMBEDDING' && (body.providerId || body.profileKey)) {
                return bad(res, 400, 'INVALID_REQUEST', 'embedding cannot bind chat models'), false;
            }
            if (typeof body.expectedRevision !== 'number' || body.expectedRevision !== binding.revision) {
                return bad(res, 409, 'REVISION_CONFLICT', 'revision conflict', { currentRevision: binding.revision });
            }
            binding.providerId = body.providerId ?? '';
            binding.profileKey = body.profileKey ?? '';
            binding.state = body.state ?? 'ENABLED';
            binding.revision += 1;
            binding.updatedAt = now;
            recomputeStatuses(state);
            return ok(res, 200, binding);
        }

        const discover = goPath.match(new RegExp(`^${GO}/providers/([^/]+)/models/discover$`));
        if (req.method === 'POST' && discover) {
            const providerId = decodeURIComponent(discover[1]);
            const provider = state.providers.find((p) => p.providerId === providerId);
            if (!provider) return bad(res, 404, 'NOT_FOUND_OR_FORBIDDEN', 'not found');
            if (!provider.credentialConfigured && !body.credential) {
                return bad(res, 400, 'INVALID_REQUEST', 'credential required for discovery');
            }
            // 合成目录；不产生任何外部网络调用。
            return ok(res, 200, [
                { modelId: 'synthetic-swift', displayName: '合成模型 · 快速' },
                { modelId: 'synthetic-deep', displayName: '合成模型 · 深度' },
            ]);
        }

        return bad(res, 404, 'NOT_FOUND_OR_FORBIDDEN', 'not found');
    }

    // ---- 静态文件 ----
    if (url.pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
    }
    let file = null;
    if (url.pathname === '/' || url.pathname === '/index.html') file = join(HERE, 'harness.html');
    else if (!url.pathname.includes('..')) file = join(STATIC_ROOT, url.pathname.replace(/^\/+/, ''));
    if (file && existsSync(file)) {
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
        res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
        return res.end(readFileSync(file));
    }
    res.writeHead(404);
    res.end('not found');
});

function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
            try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
        });
    });
}

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[vc-model-settings harness] http://127.0.0.1:${PORT}/?scenario=sample  (sample | empty | conflict | unauth | error)`);
});
