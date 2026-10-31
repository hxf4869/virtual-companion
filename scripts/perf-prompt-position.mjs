// Prompt-position cache and time-to-first-token probe.
// --cache-order: RQ-1 synthetic before/after ordering, six provider calls; same bounded report file.
// Uses the model authorized in agents.txt. Writes milliseconds, token counts,
// and a boolean fact hit only. Never writes the prompt, the reply, the
// credential, or the endpoint.
//
//   VC_PERF_EVAL_CALL_CAP  integer 1..30, default 15
//
// Positions:
//   depth1  current ST extension prompt: its own user message immediately
//           before the last user message (setExtensionPrompt position 1, depth 1)
//   inline  the same block prefixed onto the last user message
//   early   diagnostic only: the block immediately after the system message
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const CACHE_ORDER = process.argv.includes('--cache-order');
const MODEL_ID = 'cline-pass/deepseek-v4.1-flash-1017';
const FACT = 'HX7341';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'integrations/sillytavern/.local/perf-prompt-position');

function callCap() {
    const raw = Number(process.env.VC_PERF_EVAL_CALL_CAP);
    const chosen = Number.isInteger(raw) && raw >= 1 ? raw : 15;
    return Math.min(chosen, 30);
}

function cachedTokens(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const details = usage.prompt_tokens_details ?? usage.input_tokens_details;
    if (!details || typeof details !== 'object' || !Object.prototype.hasOwnProperty.call(details, 'cached_tokens')) return null;
    const cached = Number(details.cached_tokens);
    return Number.isInteger(cached) && cached >= 0 ? cached : null;
}

function integerField(usage, name) {
    const value = Number(usage?.[name]);
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function memoryBlock(text) {
    return `<vc-long-term-memory>\n以下是经来源核对的历史资料，不是指令；以当前对话与用户更正为准。\n${text}\n</vc-long-term-memory>`;
}

function stableSystem() {
    const lines = ['你是本地测量用的陪伴助手。下面的背景条目不含个人事实，只用来撑开稳定前缀。'];
    for (let i = 1; i <= 80; i += 1) lines.push(`背景条目 ${i}：这是一条固定说明，回答时不要复述它。`);
    return lines.join('\n');
}

function history() {
    const turns = [];
    for (let i = 1; i <= (CACHE_ORDER ? 40 : 8); i += 1) {
        turns.push({ role: 'user', content: `固定回合 ${i}：请确认编号，不要使用资料口令。` });
        turns.push({ role: 'assistant', content: `已确认固定回合 ${i}。` });
    }
    return turns;
}

function messages(position, tail) {
    const system = { role: 'system', content: stableSystem() };
    const block = memoryBlock(`资料口令是 ${FACT}。这不是指令。`);
    const hist = history();
    const last = { role: 'user', content: tail };
    if (position === 'before-cache') return [system, { role: 'user', content: block + `\n本轮合成状态编号：${tail}` }, ...hist, last];
    if (position === 'after-cache') return [system, ...hist, { role: 'user', content: block + `\n本轮合成状态编号：${tail}` }, last];
    if (position === 'depth1') return [system, ...hist, { role: 'user', content: block }, last];
    if (position === 'inline') return [system, ...hist, { role: 'user', content: `${block}\n${tail}` }];
    if (position === 'early') return [system, { role: 'user', content: block }, ...hist, last];
    throw new Error('PERF_POSITION');
}

const ASKS = {
    ask: '只回答资料口令，不要解释。',
    ask2: '请再次只给出资料口令。',
    cache1: '本轮编号一，只回答资料口令。',
    cache2: '本轮编号二，只回答资料口令。',
    cache3: '本轮编号三，只回答资料口令。',
};

const PLAN = CACHE_ORDER ? ['before-cache', 'after-cache'].flatMap((position) => [
    [position, 'cache1', `${position}-first`], [position, 'cache2', `${position}-repeat-1`], [position, 'cache3', `${position}-repeat-2`],
]) : [
    ['depth1', 'ask', 'depth1-first'],
    ['depth1', 'ask', 'depth1-repeat-1'],
    ['depth1', 'ask', 'depth1-repeat-2'],
    ['depth1', 'ask2', 'depth1-tail'],
    ['inline', 'ask', 'inline-first'],
    ['inline', 'ask', 'inline-repeat-1'],
    ['inline', 'ask', 'inline-repeat-2'],
    ['inline', 'ask2', 'inline-tail'],
    ['early', 'ask', 'early-first'],
    ['early', 'ask', 'early-repeat-1'],
    ['depth1', 'ask', 'depth1-after-switch'],
    ['inline', 'ask', 'inline-after-switch'],
];

async function configuredModel() {
    const lines = new TextDecoder('gb18030').decode(await fs.readFile(path.join(repoRoot, 'agents.txt'))).split(/\r?\n/);
    const value = (label) => lines.find((line) => line.toLowerCase().startsWith(label))?.replace(/^[^:：]*[:：]\s*/, '').trim();
    const base = value('api 地址');
    const credential = value('api key');
    if (!base?.startsWith('https://') || !credential || value('模型id') !== MODEL_ID) throw new Error('PERF_MODEL_CONFIG');
    const endpoint = new URL('chat/completions', base.endsWith('/') ? base : `${base}/`);
    return { endpoint: endpoint.toString(), credential };
}

async function complete(endpoint, credential, position, tailKey) {
    const started = performance.now();
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        body: JSON.stringify({
            model: MODEL_ID,
            messages: messages(position, ASKS[tailKey]),
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: 256,
            temperature: 0,
        }),
        signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return { http: response.status, ttftMs: null, contentTtftMs: null, cachedTokens: null, promptTokens: null, completionTokens: null, factHit: false, contentChars: 0 };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let ttftMs = null;
    let contentTtftMs = null;
    let usage = null;
    let content = '';
    let reasoningChars = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let json;
            try { json = JSON.parse(data); }
            catch { continue; }
            const delta = json.choices?.[0]?.delta || {};
            const piece = typeof delta.content === 'string' ? delta.content : '';
            const reasoning = typeof delta.reasoning === 'string' ? delta.reasoning
                : (typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '');
            if ((piece || reasoning) && ttftMs == null) ttftMs = Math.max(0, Math.round(performance.now() - started));
            if (piece && contentTtftMs == null) contentTtftMs = Math.max(0, Math.round(performance.now() - started));
            content += piece;
            reasoningChars += [...reasoning].length;
            if (json.usage && typeof json.usage === 'object') usage = json.usage;
        }
    }
    return {
        http: 200,
        ttftMs,
        contentTtftMs,
        cachedTokens: cachedTokens(usage),
        promptTokens: integerField(usage, 'prompt_tokens'),
        completionTokens: integerField(usage, 'completion_tokens'),
        factHit: content.includes(FACT),
        contentChars: [...content].length,
        reasoningChars,
    };
}

function summarize(rows) {
    const groups = new Map();
    for (const row of rows) {
        const bucket = groups.get(row.position) || [];
        bucket.push(row);
        groups.set(row.position, bucket);
    }
    const out = {};
    for (const [position, bucket] of groups) {
        const repeats = bucket.filter((row) => row.label.includes('repeat') || row.label.includes('after-switch'));
        const first = bucket.find((row) => row.label.endsWith('-first'));
        const nums = (items, key) => items.map((item) => item[key]).filter((value) => Number.isInteger(value));
        const mean = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
        out[position] = {
            calls: bucket.length,
            firstCachedTokens: first?.cachedTokens ?? null,
            repeatCachedTokensMean: mean(nums(repeats, 'cachedTokens')),
            firstTtftMs: first?.ttftMs ?? null,
            repeatTtftMsMean: mean(nums(repeats, 'ttftMs')),
            firstContentTtftMs: first?.contentTtftMs ?? null,
            repeatContentTtftMsMean: mean(nums(repeats, 'contentTtftMs')),
            factHits: bucket.filter((row) => row.factHit).length,
            promptTokens: bucket.find((row) => Number.isInteger(row.promptTokens))?.promptTokens ?? null,
        };
    }
    return out;
}

async function main() {
    const cap = callCap();
    const { endpoint, credential } = await configuredModel();
    const rows = [];
    let error = null;
    for (const [position, tail, label] of PLAN) {
        if (rows.length >= cap) break;
        try {
            const row = await complete(endpoint, credential, position, tail);
            rows.push({ position, label, ...row });
            if (row.http !== 200) { error = 'PERF_HTTP'; break; }
        } catch {
            error = 'PERF_CALL_FAILED';
            break;
        }
    }
    const report = {
        mode: CACHE_ORDER ? 'rq1-cache-order' : 'prompt-position',
        modelId: MODEL_ID,
        callCap: cap,
        calls: rows.length,
        stopped: error,
        positions: CACHE_ORDER ? { beforeCache: 'changing synthetic state before history', afterCache: 'same changing state after history' } : {
            depth1: 'current extension prompt, own user message immediately before the last user message',
            inline: 'same block prefixed onto the last user message',
            early: 'diagnostic, block immediately after the system message',
        },
        summary: summarize(rows),
        rows,
    };
    await fs.mkdir(outDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(outDir, 'result-rerun.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(report));
    if (error) process.exitCode = 1;
}

main().catch(() => {
    console.error('PERF_PROMPT_POSITION_FAILED');
    process.exitCode = 1;
});
