// W08 real-model effect evaluation. Explicit --filter only.
// Artifacts keep case ids, judgments, ids, and usage. Never keys or dialogue.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createStClient, waitFor } from './managed-lib.mjs';
import { importSyntheticCard } from './w05-accept.mjs';
import { prepareSourceIdentities } from '../server-plugin/virtual-companion/lib/source-identity.js';
import { REPO_ROOT, MANAGED_MEMORYCORE_DATA } from './lib/paths.mjs';
import { startMeter } from './lib/real-model-meter.mjs';

export const CALL_CAP = 300;
export function callCap(env = process.env) {
    const raw = Number(env.VC_W08_EVAL_CALL_CAP);
    if (!Number.isInteger(raw) || raw < 1) return CALL_CAP;
    return raw;
}
export const RESULT_RELATIVE = 'integrations/sillytavern/.local/w08-real-eval/result.json';
const MODEL_ID = 'cline-pass/deepseek-v4.1-flash-1017';
const FINISH_OK = new Set(['stop', 'length', 'content_filter']);
const STAGE_LABEL = {
    'l1-extraction': 'L1',
    'l1-conflict-detection': '冲突检测',
    'l2-scene': 'L2',
    'l3-persona': 'L3',
};
const BANNED_KEYS = new Set(['summary', 'block', 'content', 'text', 'mes', 'messages', 'credential', 'apiKey', 'authorization', 'profile', 'persona', 'prompt', 'body', 'output_payload']);

export const SOURCE_SAMPLES = [
    { id: 'M02-old', caseId: 'M02', group: 'daily', text: '我现在住在北京。', at: '2026-10-01T10:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M02-new', caseId: 'M02', group: 'daily', text: '我已经搬到上海了，以后说我现在的城市请用上海。', at: '2026-10-21T10:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M05', caseId: 'M05', group: 'daily', text: '我收藏过一枚蓝色帆船徽章。', at: '2026-10-18T10:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M01', caseId: 'M01', group: 'daily', text: '用户计划于2026年10月30日去厦门参加朋友婚礼。', at: '2026-10-20T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M11', caseId: 'M11', group: 'daily', text: '下周五去杭州看望外婆。', at: '2026-10-20T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M12', caseId: 'M12', group: 'daily', text: '明天晚上提醒我带书。', at: '2026-10-20T16:30:00Z', zone: '' },
    { id: 'M09', caseId: 'M09', group: 'daily', text: '我们正在讨论一份蓝窗书店的读书计划，下一步还没决定读哪一本。', at: '2026-10-19T15:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M06', caseId: 'M06', group: 'story', mode: 'STORY', text: '在这局故事中，我扮演一名钟表修复师。', at: '2026-10-19T12:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M04', caseId: 'M04', group: 'private', text: '这次我们把旅行计划叫作海鸥计划。', at: '2026-10-18T09:00:00+08:00', zone: 'Asia/Shanghai' },
];
export const OPTIONAL_SAMPLES = [
    { id: 'M10', caseId: 'M10', group: 'story-b', mode: 'STORY', text: '本局的怀表藏在维修柜中。', at: '2026-10-19T12:30:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'noise-001', caseId: 'M01', group: 'daily', text: '用户在编号1的阅读记录中收藏了一枚图案1的书签。', at: '2026-09-01T10:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'noise-002', caseId: 'M01', group: 'daily', text: '用户在编号2的阅读记录中收藏了一枚图案2的书签。', at: '2026-09-02T10:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'noise-003', caseId: 'M01', group: 'daily', text: '用户在编号3的阅读记录中收藏了一枚图案3的书签。', at: '2026-09-03T10:00:00+08:00', zone: 'Asia/Shanghai' },
];
export const QUERIES = [
    { id: 'M01-direct', caseId: 'M01', kind: 'positive', group: 'daily', needs: ['M01'], text: '我在2026年10月30日准备去哪里，为什么？', tokens: ['厦门', '婚礼'], queryDate: '2026-10-30', at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M01-rewrite', caseId: 'M01', kind: 'positive', group: 'daily', needs: ['M01'], text: '十月三十号我打算去哪、参加什么？', tokens: ['厦门', '婚礼'], queryDate: null, at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M02-direct', caseId: 'M02', kind: 'positive', group: 'daily', needs: ['M02-new'], text: '我现在住哪儿？', tokens: ['上海'], forbid: ['北京'], queryDate: null, at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M02-rewrite', caseId: 'M02', kind: 'positive', group: 'daily', needs: ['M02-new'], text: '目前我定居的城市是哪一座？', tokens: ['上海'], forbid: ['北京'], queryDate: null, at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M11-direct', caseId: 'M11', kind: 'positive', group: 'daily', needs: ['M11'], text: '10月30日我要去哪里？', tokens: ['杭州'], queryDate: '2026-10-30', at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M11-rewrite', caseId: 'M11', kind: 'positive', group: 'daily', needs: ['M11'], text: '去杭州看望外婆是哪一天的安排？', tokens: ['外婆'], queryDate: null, at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M09-direct', caseId: 'M09', kind: 'positive', group: 'daily', needs: ['M09'], text: '我们上次谈到哪一步了？', tokens: ['读书', '蓝窗'], queryDate: null, at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M09-rewrite', caseId: 'M09', kind: 'positive', group: 'daily', needs: ['M09'], text: '上次的阅读计划进展如何？', tokens: ['读书', '蓝窗'], queryDate: null, at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M11-other-week', caseId: 'M11', kind: 'negative', group: 'daily', needs: ['M11'], text: '我下周五有什么安排？', absentTokens: ['杭州', '外婆', '厦门', '婚礼'], excludeSamples: ['M01', 'M11'], queryDate: '2026-11-06', at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M04-other', caseId: 'M04', kind: 'negative', group: 'other', needs: ['M04'], text: '我们之前一起做的旅行计划叫什么？', absentTokens: ['海鸥'], at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M06-daily', caseId: 'M06', kind: 'negative', group: 'daily', needs: ['M06'], text: '我的现实职业是什么？', absentTokens: ['钟表'], at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M05-after', caseId: 'M05', kind: 'negative', group: 'daily', needs: ['M05'], text: '我收藏过什么徽章？', absentTokens: ['帆船', '徽章'], at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M03-absent', caseId: 'M03', kind: 'negative', group: 'daily', needs: [], text: '我的幸运颜色是什么？', absentTokens: ['青色', '橙色'], at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
    { id: 'M10-other', caseId: 'M10', kind: 'negative', group: 'story-c', needs: ['M10'], text: '怀表在哪里？', absentTokens: ['维修柜', '怀表'], at: '2026-10-27T20:00:00+08:00', zone: 'Asia/Shanghai' },
];

export function cleanupSettled(state) {
    return state === 'DONE';
}

export function canAddSample(callsUsed, { cap = callCap(), floor = 6, peak = 0 } = {}) {
    const need = Math.max(floor, peak);
    return Number.isFinite(callsUsed) && callsUsed + need <= cap;
}

export function recallHit(tokens, includes) {
    const expected = [...new Set((tokens || []).filter((token) => typeof token === 'string' && token !== ''))];
    return expected.length > 0 && expected.every((token) => includes(token));
}

export function classifyMiss({ hit, extracted, dateGated, recallEligible, inRecall }) {
    if (hit) return null;
    if (!extracted) return '未提取';
    if (dateGated) return '日期门禁';
    if (recallEligible && !inRecall) return '低相关拒绝';
    return '提取未召回';
}

export function judgeAcross({ caseId, layer, required = [], forbidden = [], texts = [], mode = 'all', expect = 'hold' }) {
    const present = texts.filter((text) => typeof text === 'string' && text.trim());
    const combined = present.join('\n');
    const hits = required.filter((token) => combined.includes(token)).length;
    const enough = mode === 'any' ? hits > 0 : hits === required.length;
    const forbiddenHit = forbidden.some((token) => present.some((text) => text.includes(token)));
    if (forbiddenHit) return { caseId, layer, verdict: '错误', reason: required.length > 0 && enough ? '新事实已覆盖，但仍保留过期事实' : '画像包含已过期或不应进入的事实' };
    if (expect === 'absent') return { caseId, layer, verdict: '贴切', reason: '未发现不应进入的事实' };
    if (!present.length) {
        return expect === 'may-omit'
            ? { caseId, layer, verdict: '部分', reason: '该层未形成画像' }
            : { caseId, layer, verdict: '错误', reason: '未形成该层画像' };
    }
    if (!required.length) return { caseId, layer, verdict: '贴切', reason: '未发现禁止事实' };
    if (enough) return { caseId, layer, verdict: '贴切', reason: '用例事实有覆盖且无禁止项' };
    if (hits > 0 || expect === 'may-omit') return { caseId, layer, verdict: '部分', reason: hits > 0 ? '只覆盖了部分用例事实' : '该层未收录这条事件事实' };
    return { caseId, layer, verdict: '错误', reason: '画像未覆盖用例事实' };
}

export function latencyStats(values) {
    const nums = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
    if (!nums.length) return { p50Ms: null, maxMs: null, n: 0 };
    return { p50Ms: nums[Math.ceil(nums.length * 0.5) - 1], maxMs: nums.at(-1), n: nums.length };
}

// A late profile response must not discard the remaining recall matrix.
// A new extraction attempt would write the question back into memory, so that still stops the run.
export function queryPhaseStop({ callsNow, cap, stages = [] } = {}) {
    if (Number.isFinite(callsNow) && Number.isFinite(cap) && callsNow >= cap) return 'call-budget';
    if (stages.some((stage) => stage === 'l1-extraction' || stage === 'l1-conflict-detection')) return 'query-called-model';
    return null;
}

export function zipCost(attempts, calls) {
    const rows = [];
    const count = Math.min(attempts.length, calls.length);
    for (let i = 0; i < count; i++) {
        rows.push({
            stage: attempts[i].stage || 'unspecified',
            input: calls[i].promptTokens || 0,
            output: calls[i].completionTokens || 0,
            cost: calls[i].cost,
            billing: attempts[i].billing || '',
        });
    }
    return { rows, attemptCount: attempts.length, callCount: calls.length, aligned: attempts.length === calls.length };
}

export function summarizeCost(rows, userMessages) {
    const buckets = new Map();
    for (const row of rows) {
        const label = STAGE_LABEL[row.stage] || '未分阶段';
        const bucket = buckets.get(label) || { stage: label, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, costMissing: 0 };
        bucket.calls += 1;
        bucket.inputTokens += row.input || 0;
        bucket.outputTokens += row.output || 0;
        if (typeof row.cost === 'number') bucket.cost += row.cost;
        else bucket.costMissing += 1;
        buckets.set(label, bucket);
    }
    const order = ['L1', '冲突检测', 'L2', 'L3', '未分阶段'];
    const stages = [...buckets.values()].sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
    const totals = stages.reduce((sum, stage) => ({
        calls: sum.calls + stage.calls,
        inputTokens: sum.inputTokens + stage.inputTokens,
        outputTokens: sum.outputTokens + stage.outputTokens,
        cost: sum.cost + stage.cost,
        costMissing: sum.costMissing + stage.costMissing,
    }), { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, costMissing: 0 });
    const perUserMessage = userMessages > 0 ? {
        inputTokens: totals.inputTokens / userMessages,
        outputTokens: totals.outputTokens / userMessages,
        cost: totals.cost / userMessages,
        costCurrency: 'undeclared',
    } : null;
    const daily100 = perUserMessage ? {
        messageCount: 100,
        inputTokens: perUserMessage.inputTokens * 100,
        outputTokens: perUserMessage.outputTokens * 100,
        cost: perUserMessage.cost * 100,
        costCurrency: 'undeclared',
    } : null;
    return { stages, totals, perUserMessage, daily100, costCurrency: 'undeclared' };
}

export function decodeRefusalHint(call) {
    const wire = call?.wire || {};
    const structure = call?.structure || {};
    const shapes = structure.usageShapes || {};
    const reasons = [];
    if (wire.envelope && wire.outerObject) reasons.push('envelope-and-object');
    if (wire.object !== 'chat.completion') reasons.push('object');
    if (wire.choices !== 1 || wire.index !== 0) reasons.push('choice');
    if (wire.content !== 'string') reasons.push('content');
    if (structure.toolCalls && wire.content !== 'string') reasons.push('tool-calls-without-content');
    if (!FINISH_OK.has(structure.finishReason)) reasons.push('finish');
    if (!wire.usageBalanced || ['decimal', 'other'].includes(shapes.prompt) || ['decimal', 'other'].includes(shapes.completion) || ['decimal', 'other'].includes(shapes.total)) reasons.push('usage');
    return reasons;
}

export function publicQuery(row) {
    return {
        caseId: row.caseId,
        queryId: row.id,
        kind: row.kind,
        hit: row.hit === true,
        empty: row.empty === true,
        leaked: row.leaked === true,
        tokenSeen: row.tokenSeen === true,
        count: row.count || 0,
        memoryIds: [...(row.memoryIds || [])],
        summaryIds: [...(row.summaryIds || [])],
        missReason: row.missReason || null,
        datedFactsExcluded: row.datedFactsExcluded ?? null,
    };
}

export function runCap(env = process.env) {
    const cap = callCap(env);
    const raw = Number(env.VC_W08_EVAL_REMAINING || cap);
    if (!Number.isInteger(raw) || raw < 1) return cap;
    return Math.min(raw, cap);
}

function sampleRecallTokens(sample) {
    const tokens = QUERIES.filter((query) => query.kind === 'positive' && Array.isArray(query.tokens) && (query.needs || []).includes(sample.id)).flatMap((query) => query.tokens);
    return [...new Set(tokens)];
}

function withoutBannedKeys(value) {
    const walk = (node) => {
        if (Array.isArray(node)) return node.map(walk);
        if (!node || typeof node !== 'object') return node;
        const out = {};
        for (const [key, child] of Object.entries(node)) {
            if (BANNED_KEYS.has(key)) continue;
            out[key] = walk(child);
        }
        return out;
    };
    return walk(value);
}

function sealValue(node, bannedSubstrings, seen) {
    if (typeof node === 'string') {
        if ([...node].length > 180) return undefined;
        for (const secret of bannedSubstrings) if (secret && node.includes(secret)) return undefined;
        return node;
    }
    if (node === null || typeof node !== 'object') return node;
    if (seen.has(node)) return node;
    seen.add(node);
    if (Array.isArray(node)) return node.map((item) => sealValue(item, bannedSubstrings, seen)).filter((item) => item !== undefined);
    const out = {};
    for (const [key, child] of Object.entries(node)) {
        const next = sealValue(child, bannedSubstrings, seen);
        if (next !== undefined) out[key] = next;
    }
    return out;
}

export function sealReport(value, bannedSubstrings = []) {
    return sealValue(withoutBannedKeys(value), bannedSubstrings, new WeakSet());
}

const expectStatus = (response, status, label) => {
    assert.equal(response.status, status, `${label}: HTTP ${response.status} (${response.json?.code || 'native'})`);
    return response.json;
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function configuredModel() {
    return fs.readFile(path.join(REPO_ROOT, 'agents.txt')).then((buf) => {
        const lines = new TextDecoder('gb18030').decode(buf).split(/\r?\n/);
        const value = (label) => lines.find((line) => line.toLowerCase().startsWith(label))?.replace(/^[^:：]*[:：]\s*/, '').trim();
        const base = value('api 地址');
        const credential = value('api key');
        assert.ok(base?.startsWith('https://') && credential && value('模型id') === MODEL_ID, '私有模型配置必须完整匹配已授权模型');
        return { base, credential };
    });
}

async function profileLayers(owner) {
    const base = path.join(MANAGED_MEMORYCORE_DATA, 'owners', String(owner));
    let names = [];
    try { names = await fs.readdir(path.join(base, 'operations')); } catch { return []; }
    const layers = [];
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        let status = '';
        let instanceId = '';
        let mode = '';
        try {
            const op = JSON.parse(await fs.readFile(path.join(base, 'operations', name), 'utf8'));
            status = op?.status || '';
            instanceId = String(op?.scope?.instanceId || '');
            mode = String(op?.scope?.mode || '');
        } catch { continue; }
        if (status !== 'profile-published') continue;
        const dir = path.join(base, 'profiles', name.replace(/\.json$/, ''));
        const read = async (file) => {
            try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
        };
        let scene = '';
        let mtime = 0;
        try { mtime = (await fs.stat(path.join(base, 'operations', name))).mtimeMs; } catch { /* keep 0 */ }
        try {
            const files = (await fs.readdir(path.join(dir, 'scene_blocks'))).filter((file) => file.endsWith('.md')).sort();
            scene = (await Promise.all(files.map((file) => read(path.join(dir, 'scene_blocks', file))))).join('\n');
        } catch { /* no scene layer */ }
        layers.push({ id: name.replace(/\.json$/, ''), instanceId, mode, mtime, l2: scene, l3: await read(path.join(dir, 'persona.md')) });
    }
    return layers;
}

function layerText(layers, instanceId, layer) {
    return layers.filter((item) => item.instanceId === String(instanceId)).map((item) => item[layer] || '');
}

function latestLayerText(layers, instanceId, layer) {
    const rows = layers.filter((item) => item.instanceId === String(instanceId));
    if (!rows.length) return [];
    const newest = rows.reduce((best, item) => ((item.mtime || 0) >= (best.mtime || 0) ? item : best));
    return [newest[layer] || ''];
}

function publicWire(wire = {}) {
    return {
        contentType: wire.contentType || null, envelope: wire.envelope === true, outerObject: wire.outerObject ?? null,
        object: wire.object ?? null, choices: wire.choices || 0, index: wire.index ?? null, contentKind: wire.content || null, usageBalanced: wire.usageBalanced === true,
    };
}
function publicCall(call, stage) {
    return {
        status: call.status, stage: stage || null, kind: call.kind, promptTokens: call.promptTokens,
        completionTokens: call.completionTokens, cost: call.cost, finish: call.finish,
        structure: call.structure, wire: publicWire(call.wire), hint: decodeRefusalHint(call),
    };
}

export async function sceneMemoryRealEval(ctx) {
    const { base, credential } = await configuredModel();
    const effectiveCap = callCap();
    const meterCap = runCap();
    const meter = await startMeter(base, { maxCalls: meterCap });
    ctx.w08.meter = meter;
    const spec = {
        displayName: 'Owner 已授权私有模型', protocol: 'OPENAI_CHAT_COMPLETIONS', baseUrl: meter.baseUrl, state: 'ENABLED',
        models: [{ profileKey: 'memory', modelId: MODEL_ID, displayName: 'W08 效果评估', contextWindowTokens: 32768, maxOutputTokens: 4096, state: 'ENABLED', capabilities: { systemMessage: 'DECLARED' }, reasoningLevels: ['max'], generationParams: { reasoningEffort: 'max' } }],
    };
    let provider;
    const written = [];
    const skipped = [
        { id: 'M07', reason: 'source-writer-cannot-express' },
        { id: 'M08', reason: 'source-writer-cannot-express' },
        { id: 'M03-cross-user', reason: 'second-account-not-staged' },
        { id: 'M01-noise-100', reason: 'preextracted-records-not-injected' },
    ];
    const queries = [];
    const callbackFailures = [];
    let budgetStop = false;
    let peak = 0;
    let userMessages = 0;
    const rel = {};
    const cards = {};
    let decisionOffset = 0;
    const report = {};
    try {
        const embedding = (await (await fetch('http://127.0.0.1:11438/api/tags')).json()).models.find((model) => model.name === 'qwen3-embedding:0.6b');
        assert.ok(embedding, '本机 embedding 不可用');
        ctx.w08.seedRealEstimate();
        if (typeof ctx.w10?.psql !== 'function') throw new Error('受管数据库入口不可用');
        // 测试环境价格，不是 Owner 价格，也不代表供应商账单。
        ctx.w10.psql(`INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active, effective_from)
            VALUES ('vc08-real', '${MODEL_ID}', 1, 0.01, 0.02, true, now())
            ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
            SET input_usd_per_1k = EXCLUDED.input_usd_per_1k, output_usd_per_1k = EXCLUDED.output_usd_per_1k, active = true, effective_from = now();`);
        for (const consentType of ['SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE', 'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING']) {
            expectStatus(await ctx.admin.call('PUT', '/api/v1/consents', { consentType, version: 'w08-real-eval', granted: true }), 200, 'consent');
        }
        provider = expectStatus(await ctx.admin.saveProvider('vc08-real', { ...spec, credential, expectedRevision: 0 }), 200, 'provider');
        const previous = await ctx.admin.call('GET', '/api/v1/admin/embedding-config');
        expectStatus(await ctx.admin.call('PUT', '/api/v1/admin/embedding-config', {
            model: embedding.name, artifactVersion: embedding.digest, dimensions: 1024, queryPreprocessingVersion: 'qwen3-retrieval-v1',
            documentPreprocessingVersion: 'identity-v1', normalization: 'l2', state: 'ENABLED', expectedRevision: previous.status === 200 ? previous.json.revision : 0,
        }), 200, 'embedding');
        const purposes = expectStatus(await ctx.admin.listPurposes(), 200, 'purposes');
        const purpose = purposes.find((item) => item.purpose === 'MEMORY_EXTRACTION_DEDUP_SUMMARY');
        expectStatus(await ctx.admin.savePurpose(purpose.purpose, { providerId: 'vc08-real', profileKey: 'memory', state: 'ENABLED', expectedRevision: purpose.revision }), 200, 'purpose');
        const st = createStClient({ baseUrl: ctx.w05.stBase, expectedIdentity: ctx.secrets.session, extraCookies: `vc_session=${ctx.secrets.session.vcSession}; vc_csrf=${ctx.secrets.session.vcCsrf}` });
        cards.daily = await importSyntheticCard(st, 'W08 评估陪伴');
        cards.story = await importSyntheticCard(st, 'W08 评估剧情');
        cards.private = await importSyntheticCard(st, 'W08 评估私有');
        cards['story-b'] = await importSyntheticCard(st, 'W08 评估剧情乙');
        const queue = [...SOURCE_SAMPLES, ...OPTIONAL_SAMPLES];
        for (const sample of queue) {
            const story = sample.mode === 'STORY';
            const calls = meter.snapshot().length;
            if (!story && (budgetStop || !canAddSample(calls, { cap: Math.max(1, meterCap - 8), peak }))) {
                budgetStop = true;
                skipped.push({ id: sample.id, reason: 'call-budget' });
                continue;
            }
            const beforeCalls = calls;
            const beforeCodes = await decisionText(ctx.artifactsDir);
            decisionOffset = beforeCodes.length;
            const beforeMax = ctx.w08.extractJobs().reduce((max, job) => Math.max(max, Number(job.id)), 0);
            const card = cards[sample.group] || cards.daily;
            const identity = crypto.randomUUID();
            const file = `W08-eval-${crypto.randomUUID()}`;
            const rows = [{ chat_metadata: { vc_f2: { id: identity, revision: 0 } } }, { name: '合成用户', is_user: true, mes: sample.text, send_date: sample.at, extra: {} }];
            prepareSourceIdentities(rows, { settled: true, sourceTimezone: sample.zone });
            expectStatus(await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat: rows }), 200, sample.id);
            const persistedAt = Date.now();
            const binding = expectStatus(await ctx.admin.call('POST', '/api/v1/st/bindings', {
                chatIdentity: identity, characterRef: card.avatar, mode: sample.mode || 'COMPANION', displayName: 'W08评估样本',
                ...(rel[sample.group] ? { relationshipId: rel[sample.group] } : {}),
            }), 200, sample.id);
            rel[sample.group] = binding.relationshipId;
            expectStatus(await ctx.admin.call('POST', '/api/v1/st/sources/reconcile', { chatIdentities: [identity] }), 200, sample.id);
            const saved = expectStatus(await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file }), 200, sample.id);
            const token = saved[0]?.chat_metadata?.vc_f2;
            const beforeRows = await listMemories(ctx, rel[sample.group]);
            if (story) {
                written.push({
                    id: sample.id, caseId: sample.caseId, group: sample.group, relationshipId: String(rel[sample.group]),
                    extracted: false, enqueued: false, ready: true, providerCalls: 0, memoryIds: [], recallableMs: null,
                    eventDate: null, normalizationStatus: null, reminderAt: null, recallEligible: false,
                });
                continue;
            }
            let extracted = false;
            const terminal = new Set(['DONE', 'FAILED', 'DEAD_LETTERED', 'CANCELLED']);
            try {
                await waitFor(() => {
                    const jobs = ctx.w08.extractJobs().filter((job) => Number(job.id) > beforeMax);
                    return jobs.length > 0 && jobs.every((job) => terminal.has(job.status));
                }, { timeoutMs: 240000, intervalMs: 500, label: sample.id });
                extracted = ctx.w08.extractJobs().some((job) => Number(job.id) > beforeMax && job.status === 'DONE');
            } catch {
                budgetStop = true;
                skipped.push({ id: sample.id, reason: 'extract-timeout' });
                const callsNow = meter.snapshot().length;
                const codes = await decisionText(ctx.artifactsDir);
                if (codes.slice(decisionOffset).includes('MEMORYCORE_CALLBACK_FAILED')) {
                    callbackFailures.push({ sampleId: sample.id, calls: meter.snapshot().slice(beforeCalls, callsNow).map((call) => publicCall(call)) });
                }
                written.push({
                    id: sample.id, caseId: sample.caseId, group: sample.group, relationshipId: String(rel[sample.group] || ''),
                    extracted: false, enqueued: true, ready: false, providerCalls: callsNow - beforeCalls, memoryIds: [], recallableMs: null,
                    eventDate: null, normalizationStatus: null, reminderAt: null, recallEligible: false,
                });
                userMessages += 1;
                continue;
            }
            const afterRows = await listMemories(ctx, rel[sample.group]);
            const created = afterRows.filter((row) => !beforeRows.some((prior) => prior.memoryId === row.memoryId));
            const active = created.filter((row) => row.lifecycle === 'ACTIVE');
            const memory = active[0] || created[0] || null;
            let recallableMs = null;
            if (token && active.length) {
                const deadline = Date.now() + 30000;
                while (Date.now() < deadline) {
                    const probed = await recall(ctx, token, sample.at, sample.zone);
                    const tokens = sampleRecallTokens(sample);
                    if (active.some((row) => probed.memoryIds.includes(row.memoryId)) || recallHit(tokens, (tokenText) => probed.has(tokenText))) {
                        recallableMs = Date.now() - persistedAt;
                        break;
                    }
                    await delay(1000);
                }
            }
            const callsNow = meter.snapshot().length;
            peak = Math.max(peak, callsNow - beforeCalls);
            userMessages += 1;
            written.push({
                id: sample.id, caseId: sample.caseId, group: sample.group, relationshipId: String(rel[sample.group]),
                extracted, enqueued: true, ready: true, providerCalls: callsNow - beforeCalls,
                memoryIds: active.map((row) => row.memoryId), recallableMs,
                eventDate: memory?.time?.eventDate ?? null,
                normalizationStatus: memory?.time?.normalizationStatus ?? null,
                reminderAt: memory?.time?.reminderAt ?? null,
                recallEligible: memory?.recallEligible === true,
            });
            const codes = await decisionText(ctx.artifactsDir);
            if (codes.slice(decisionOffset).includes('MEMORYCORE_CALLBACK_FAILED')) {
                callbackFailures.push({
                    sampleId: sample.id,
                    calls: meter.snapshot().slice(beforeCalls, callsNow).map((call) => publicCall(call)),
                });
            }
            if (callsNow >= meterCap) budgetStop = true;
        }
        const profilesBeforeForget = await profileLayers(ctx.w05.ownerId);
        const judgments = judgeSamples(written, profilesBeforeForget);
        const forget = await forgetSample(ctx, written, profilesBeforeForget);
        if (!(await ctx.admin.reauth(ctx.secrets.password)).ok) throw new Error('重新认证失败');
        const purposesNow = expectStatus(await ctx.admin.listPurposes(), 200, 'purposes-off');
        const enabled = purposesNow.find((item) => item.purpose === 'MEMORY_EXTRACTION_DEDUP_SUMMARY');
        if (enabled) expectStatus(await ctx.admin.savePurpose(enabled.purpose, { providerId: 'vc08-real', profileKey: 'memory', state: 'DISABLED', expectedRevision: enabled.revision }), 200, 'purpose-off');
        const callsAtQueries = meter.snapshot().length;
        const attemptsAtQueries = ctx.w08.realAttempts().length;
        let queryProviderCalls = 0;
        for (const query of QUERIES) {
            if (query.needs.some((id) => !written.some((sample) => sample.id === id && sample.ready))) {
                skipped.push({ id: query.id, reason: 'source-not-ready' });
                continue;
            }
            const stopReason = queryPhaseStop({
                callsNow: meter.snapshot().length,
                cap: meterCap,
                stages: ctx.w08.realAttempts().slice(attemptsAtQueries).map((row) => row.stage || ''),
            });
            if (stopReason) {
                budgetStop = true;
                for (const pending of QUERIES.slice(QUERIES.indexOf(query))) {
                    if (!queries.some((done) => done.queryId === pending.id) && !skipped.some((item) => item.id === pending.id)) skipped.push({ id: pending.id, reason: stopReason });
                }
                break;
            }
            const group = query.group;
            if (!rel[group]) {
                const card = cards[group] || await importSyntheticCard(st, 'W08 评估对照');
                cards[group] = card;
                const identity = crypto.randomUUID();
                const file = `W08-eval-${crypto.randomUUID()}`;
                const rows = [{ chat_metadata: { vc_f2: { id: identity, revision: 0 } } }, { name: '合成用户', is_user: true, mes: '你好。', send_date: query.at, extra: {} }];
                prepareSourceIdentities(rows, { settled: true, sourceTimezone: query.zone });
                expectStatus(await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat: rows }), 200, query.id);
                const binding = expectStatus(await ctx.admin.call('POST', '/api/v1/st/bindings', { chatIdentity: identity, characterRef: card.avatar, mode: 'COMPANION', displayName: 'W08评估对照' }), 200, query.id);
                rel[group] = binding.relationshipId;
            }
            const card = cards[group] || cards.daily;
            const identity = crypto.randomUUID();
            const file = `W08-eval-${crypto.randomUUID()}`;
            const rows = [{ chat_metadata: { vc_f2: { id: identity, revision: 0 } } }, { name: '合成用户', is_user: true, mes: query.text, send_date: query.at, extra: {} }];
            prepareSourceIdentities(rows, { settled: true, sourceTimezone: query.zone });
            expectStatus(await st.call('POST', '/api/chats/save', { avatar_url: card.avatar, file_name: file, chat: rows }), 200, query.id);
            const binding = expectStatus(await ctx.admin.call('POST', '/api/v1/st/bindings', {
                chatIdentity: identity, characterRef: card.avatar, mode: 'COMPANION', displayName: 'W08评估提问', relationshipId: rel[group],
            }), 200, query.id);
            assert.equal(String(binding.relationshipId), String(rel[group]));
            const saved = expectStatus(await st.call('POST', '/api/chats/get', { avatar_url: card.avatar, file_name: file }), 200, query.id);
            const probed = await recall(ctx, saved[0].chat_metadata.vc_f2, query.at, query.zone);
            queryProviderCalls = meter.snapshot().length - callsAtQueries;
            const sources = written.filter((sample) => query.needs.includes(sample.id));
            const expected = sources.flatMap((sample) => sample.memoryIds);
            const source = sources[0];
            const memory = source ? (await listMemories(ctx, source.relationshipId)).find((row) => expected.includes(row.memoryId)) : null;
            const eventDate = memory?.time?.eventDate ?? source?.eventDate ?? null;
            const contentHit = recallHit(query.tokens, (tokenText) => probed.has(tokenText));
            const inRecall = contentHit;
            const dateGated = Boolean(query.queryDate) && (!eventDate || eventDate !== query.queryDate);
            const hit = query.kind === 'positive' && contentHit;
            const tokenSeen = (query.tokens || []).some((token) => probed.has(token));
            const leaked = (query.absentTokens || query.forbid || []).some((token) => probed.has(token));
            const empty = probed.count === 0 && !leaked;
            const excluded = (query.excludeSamples || []).flatMap((id) => written.filter((sample) => sample.id === id).flatMap((sample) => sample.memoryIds));
            queries.push(publicQuery({
                ...query,
                hit,
                empty: query.kind === 'negative' ? empty : false,
                leaked,
                tokenSeen,
                count: probed.count,
                memoryIds: probed.memoryIds,
                summaryIds: probed.summaryIds,
                datedFactsExcluded: excluded.length ? excluded.every((id) => !probed.memoryIds.includes(id)) : null,
                missReason: query.kind === 'positive' ? classifyMiss({
                    hit, extracted: expected.length > 0, dateGated, recallEligible: memory?.recallEligible === true, inRecall,
                }) : null,
            }));
        }
        const direct = queries.find((query) => query.queryId === 'M02-direct');
        const forgottenIds = written.find((sample) => sample.id === 'M05')?.memoryIds || [];
        const afterForget = queries.find((query) => query.queryId === 'M05-after');
        if (forget && !forget.skipped) {
            const absent = Boolean(afterForget) && !afterForget.leaked && forgottenIds.every((id) => !afterForget.memoryIds.includes(id) && !afterForget.summaryIds.includes(id));
            forget.outboundSurface = 'st-memory-recall-block';
            forget.outboundAbsent = afterForget ? absent : null;
            forget.recallAbsent = forget.outboundAbsent;
        }
        const correction = direct ? {
            caseId: 'M02',
            outboundSurface: 'st-memory-recall-block',
            currentFactOnly: Boolean(direct.tokenSeen) && !direct.leaked,
            currentFactRecalled: Boolean(direct.tokenSeen),
            oldFactInOutbound: Boolean(direct.leaked),
        } : { caseId: 'M02', skipped: true, outboundSurface: 'st-memory-recall-block' };
        const zipped = zipCost(ctx.w08.realAttempts(), meter.snapshot());
        const cost = summarizeCost(zipped.rows, userMessages);
        const dates = ['M01', 'M11', 'M12'].map((caseId) => {
            const sample = written.find((item) => item.id === caseId);
            if (!sample) return { caseId, skipped: true };
            const needsClarification = sample.normalizationStatus === 'needs_clarification';
            return {
                caseId, eventDate: sample.eventDate, normalizationStatus: sample.normalizationStatus, reminderAt: sample.reminderAt, needsClarification,
                matchesFixture: caseId === 'M12'
                    ? needsClarification && sample.eventDate == null && sample.reminderAt == null
                    : sample.eventDate === '2026-10-30' && sample.reminderAt == null && sample.normalizationStatus === (caseId === 'M01' ? 'explicit_date' : 'normalized'),
            };
        });
        const positive = queries.filter((query) => query.kind === 'positive');
        const negative = queries.filter((query) => query.kind === 'negative');
        const calls = meter.snapshot();
        const reportBody = {
            model: MODEL_ID,
            reasoningEffort: 'max',
            callCap: effectiveCap,
            runCap: meterCap,
            priorProviderCalls: effectiveCap - meterCap,
            providerCalls: calls.length,
            budgetStop,
            costAligned: zipped.aligned,
            usage: { ...cost.totals, costCurrency: 'undeclared', unknownUsage: (ctx.w08.realUsage() || []).reduce((sum, row) => sum + Number(row.unknown_usage || 0), 0) },
            byStage: cost.stages,
            perUserMessage: cost.perUserMessage,
            daily100: cost.daily100,
            userMessages,
            userMessageBasis: 'companion-sources-submitted',
            queryProviderCalls,
            engineModes: scopeNotes(profilesBeforeForget, written),
            latency: latencyStats(written.map((sample) => sample.recallableMs).filter((value) => value != null)),
            recall: {
                positive: { executed: positive.length, hits: positive.filter((query) => query.hit).length, rate: positive.length ? positive.filter((query) => query.hit).length / positive.length : null },
                negative: { executed: negative.length, empty: negative.filter((query) => query.empty).length, rate: negative.length ? negative.filter((query) => query.empty).length / negative.length : null },
                queries,
            },
            correction,
            forget,
            dates,
            profiles: judgments,
            samples: written.map(({ id, caseId, extracted, enqueued, ready, providerCalls, memoryIds, recallableMs, eventDate, normalizationStatus }) => ({ id, caseId, extracted, enqueued, ready, providerCalls, memoryIds, recallableMs, eventDate, normalizationStatus })),
            skipped,
            callbackFailures,
            decisionCodes: [...new Set(await decisionText(ctx.artifactsDir))],
            calls: calls.map((call, index) => publicCall(call, zipped.rows[index]?.stage)),
        };
        try {
            const sealed = sealReport(reportBody, [credential]);
            if (JSON.stringify(sealed) !== JSON.stringify(reportBody)) sealed.sealStripped = true;
            Object.assign(report, sealed);
        } catch {
            const partial = {
                providerCalls: calls.length, completed: false, sealStripped: true, budgetStop,
                callCap: effectiveCap, runCap: meterCap, queryProviderCalls, queries, callbackFailures,
            };
            try {
                Object.assign(report, sealReport(partial, [credential]));
            } catch {
                Object.assign(report, { providerCalls: calls.length, completed: false, sealStripped: true, budgetStop, queryProviderCalls, callbackFailures: callbackFailures.length });
            }
        }
    } finally {
        try {
            if (ctx.admin && ctx.secrets?.password) await ctx.admin.reauth(ctx.secrets.password);
            const purposes = await ctx.admin.listPurposes();
            const purpose = purposes.status === 200 ? purposes.json.find((item) => item.purpose === 'MEMORY_EXTRACTION_DEDUP_SUMMARY') : null;
            if (purpose) await ctx.admin.savePurpose(purpose.purpose, { providerId: 'vc08-real', profileKey: 'memory', state: 'DISABLED', expectedRevision: purpose.revision });
            if (provider) await ctx.admin.saveProvider('vc08-real', { ...spec, state: 'DISABLED', clearCredential: true, expectedRevision: provider.revision });
        } catch { /* teardown still removes the disposable database */ }
        const dir = path.join(REPO_ROOT, path.dirname(RESULT_RELATIVE));
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const payload = Object.keys(report).length ? report : { providerCalls: meter.snapshot().length, completed: false, callbackFailures };
        await fs.writeFile(path.join(REPO_ROOT, RESULT_RELATIVE), JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
        ctx.results.memoryRealEval = payload;
        await meter.stop();
    }
}

function judgeSamples(written, layers) {
    const specs = [
        { sampleId: 'M02-new', caseId: 'M02', required: ['上海'], forbidden: ['北京'], mode: 'all', expect: 'hold' },
        { sampleId: 'M01', caseId: 'M01', required: ['厦门', '婚礼'], forbidden: [], mode: 'all', l3: 'may-omit' },
        { sampleId: 'M11', caseId: 'M11', required: ['杭州', '外婆', '2026-10-30'], forbidden: [], mode: 'all', l3: 'may-omit' },
        { sampleId: 'M12', caseId: 'M12', required: [], forbidden: ['2026-10-21', '2026-10-22'], mode: 'all', expect: 'hold' },
        { sampleId: 'M05', caseId: 'M05', required: ['帆船', '徽章'], forbidden: [], mode: 'any', l3: 'may-omit' },
        { sampleId: 'M09', caseId: 'M09', required: ['蓝窗', '读书'], forbidden: [], mode: 'any', l3: 'may-omit' },
        { sampleId: 'M04', caseId: 'M04', required: ['海鸥'], forbidden: [], mode: 'all', l3: 'may-omit' },
    ];
    const out = [];
    for (const spec of specs) {
        const sample = written.find((item) => item.id === spec.sampleId);
        if (!sample) continue;
        for (const layer of ['L2', 'L3']) {
            const key = layer === 'L2' ? 'l2' : 'l3';
            const expect = layer === 'L3' && spec.l3 ? spec.l3 : (spec.expect || 'hold');
            const current = judgeAcross({
                caseId: spec.caseId, layer, required: spec.required, forbidden: spec.forbidden, mode: spec.mode, expect,
                texts: latestLayerText(layers, sample.relationshipId, key),
            });
            const historical = judgeAcross({
                caseId: spec.caseId, layer, required: spec.required, forbidden: spec.forbidden, mode: spec.mode, expect,
                texts: layerText(layers, sample.relationshipId, key),
            });
            if (spec.forbidden.length > 0 && historical.verdict === '错误' && current.verdict === '贴切') {
                current.verdict = '部分';
                current.reason = '当前层已覆盖新事实，历史文件仍保留过期事实';
            }
            out.push(current);
        }
    }
    const daily = written.find((item) => item.group === 'daily');
    const story = written.find((item) => item.id === 'M06');
    if (daily) {
        for (const layer of ['L2', 'L3']) {
            const judgment = judgeAcross({ caseId: 'M06', layer, required: [], forbidden: ['钟表'], texts: layerText(layers, daily.relationshipId, layer === 'L2' ? 'l2' : 'l3'), expect: 'absent' });
            if (story && story.enqueued === false && judgment.verdict === '贴切') judgment.reason = '剧情来源未进入提取队列，日常画像未见虚构身份';
            out.push(judgment);
        }
    }
    return out;
}

function scopeNotes(layers, written) {
    const story = written.find((sample) => sample.id === 'M06');
    const storyModes = story ? [...new Set(layers.filter((item) => item.instanceId === String(story.relationshipId)).map((item) => item.mode).filter(Boolean))] : [];
    return {
        publishedModes: [...new Set(layers.map((item) => item.mode).filter(Boolean))],
        storyEnqueued: story ? story.enqueued === true : false,
        storyProfileModes: storyModes,
    };
}

async function forgetSample(ctx, written, layersBefore) {
    const sample = written.find((item) => item.id === 'M05' && item.memoryIds.length);
    if (!sample) return { caseId: 'M05', skipped: true };
    if (!(await ctx.admin.reauth(ctx.secrets.password)).ok) return { caseId: 'M05', skipped: true, reason: 'reauth' };
    const deleted = await ctx.admin.call('DELETE', `/api/v1/memories/${sample.memoryIds[0]}`);
    let cleanup = deleted.status === 202 ? 'PENDING' : `HTTP_${deleted.status}`;
    if (deleted.status === 202) {
        try {
            await waitFor(async () => {
                const row = await ctx.admin.call('GET', `/api/v1/memories/${sample.memoryIds[0]}`);
                cleanup = row.json?.cleanup?.state || cleanup;
                return cleanupSettled(cleanup);
            }, { timeoutMs: 240000, intervalMs: 500, label: 'M05-cleanup' });
        } catch { /* keep the last observed state */ }
    }
    const listed = await listMemories(ctx, sample.relationshipId);
    const row = listed.find((item) => item.memoryId === sample.memoryIds[0]);
    const listHasFact = listed.some((item) => ['帆船', '徽章'].some((token) => (item.summary || '').includes(token)));
    const layers = await profileLayers(ctx.w05.ownerId);
    const hasFact = (texts) => texts.some((text) => text.includes('帆船') || text.includes('徽章'));
    void layersBefore;
    return {
        caseId: 'M05',
        cleanup,
        lifecycle: row?.lifecycle || null,
        listAbsent: !listHasFact,
        recallEligible: row?.recallEligible === true,
        l2Absent: !hasFact(latestLayerText(layers, sample.relationshipId, 'l2')),
        l3Absent: !hasFact(latestLayerText(layers, sample.relationshipId, 'l3')),
        historicalProfileContains: hasFact(layerText(layers, sample.relationshipId, 'l2')) || hasFact(layerText(layers, sample.relationshipId, 'l3')),
        validSummaryAbsent: ctx.w08.probeSummary('帆船') === 'no' && ctx.w08.probeSummary('徽章') === 'no',
    };
}

async function listMemories(ctx, relationshipId) {
    const listed = await ctx.admin.call('GET', `/api/v1/relationships/${relationshipId}/memories?limit=100`);
    return listed.status === 200 && Array.isArray(listed.json) ? listed.json : [];
}

async function recall(ctx, token, at, zone) {
    const response = await ctx.admin.call('POST', '/api/v1/st/memory/recall', {
        chatIdentity: token.id, revision: token.revision, enabled: true, budgetTokens: 2048,
        queryTimestamp: at, queryTimezone: zone,
    });
    const json = response.status === 200 && response.json ? response.json : {};
    const block = typeof json.block === 'string' ? json.block : '';
    return {
        http: response.status,
        memoryIds: Array.isArray(json.memoryIds) ? json.memoryIds : [],
        summaryIds: Array.isArray(json.summaryIds) ? json.summaryIds : [],
        count: (json.memoryIds?.length || 0) + (json.summaryIds?.length || 0),
        has: (tokenText) => block.includes(tokenText),
    };
}

async function decisionText(artifactsDir) {
    try {
        const text = await fs.readFile(path.join(artifactsDir, 'go.log'), 'utf8');
        return [...text.matchAll(/"decision_code":"(MEMORYCORE_[A-Z0-9_]+)"/g)].map((match) => match[1]);
    } catch {
        return [];
    }
}
