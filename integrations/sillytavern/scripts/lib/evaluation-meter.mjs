import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import { StringDecoder } from 'node:string_decoder';

const REQUEST_LIMIT = 16 * 1024 * 1024;
const JSON_LIMIT = 16 * 1024 * 1024;
const EVENT_LIMIT = 1024 * 1024;
const CHAT_PATH = '/chat/completions';
const CHAT_FIELDS = new Set([
    'model', 'messages', 'max_tokens', 'max_completion_tokens', 'stream', 'stream_options', 'n',
    'temperature', 'top_p', 'top_k', 'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty',
    'stop', 'seed', 'logit_bias', 'logprobs', 'top_logprobs', 'response_format', 'reasoning_effort', 'thinking',
    'tools', 'tool_choice', 'parallel_tool_calls',
]);
const TEXT_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool', 'function']);
const MESSAGE_FIELDS = new Set([
    'role', 'content', 'name', 'tool_call_id', 'tool_calls', 'function_call', 'reasoning_content', 'reasoning', 'refusal',
]);
const BUDGET_ERRORS = new Map([
    ['BUDGET_STOP', 429], ['BUDGET_TOKEN_ANOMALY', 429], ['CONFIG_NOT_READY', 503], ['BUDGET_CLOSED', 503], ['BUDGET_JOURNAL_FAILED', 503],
]);

const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const tokenCount = (value) => Number.isSafeInteger(value) && value >= 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => Object.keys(value).every((key) => keys.has(key));

function prepareRoute(route) {
    if (route?.protocol !== 'OPENAI_CHAT_COMPLETIONS') throw new Error('METER_UNSUPPORTED_PROTOCOL');
    if (!positiveInteger(route.contextWindowTokens) || !positiveInteger(route.maxOutputTokens)
        || typeof route.modelId !== 'string' || !route.modelId.trim()
        || typeof route.credential !== 'string' || !/^[!-~]+$/.test(route.credential)) {
        throw new Error('METER_INVALID_ROUTE');
    }
    let upstream;
    try { upstream = new URL(route.baseUrl); }
    catch { throw new Error('METER_INVALID_ROUTE'); }
    const base = upstream.pathname.replace(/\/+$/, '');
    if ((upstream.protocol !== 'https:' && !(upstream.protocol === 'http:' && upstream.hostname === '127.0.0.1'))
        || upstream.username || upstream.password || upstream.search || upstream.hash
        || base.includes('//') || base.includes('%') || /\/(?:chat\/completions|responses|messages|models)$/.test(base)) {
        throw new Error('METER_INVALID_ROUTE');
    }
    upstream.pathname = (base.endsWith('/v1') ? base : `${base}/v1`) + CHAT_PATH;
    return {
        upstream,
        authorization: `Bearer ${route.credential}`,
        localCredential: randomBytes(32).toString('base64url'),
        modelId: route.modelId,
        maxOutputTokens: route.maxOutputTokens,
    };
}

function textMessage(message) {
    if (!object(message) || !TEXT_ROLES.has(message.role) || !onlyKeys(message, MESSAGE_FIELDS)) return false;
    if (message.tool_calls !== undefined
        && (!Array.isArray(message.tool_calls) || !message.tool_calls.every((call) => call?.type === 'function'))) return false;
    const content = message.content;
    return content == null || typeof content === 'string'
        || (Array.isArray(content) && content.every((part) => part?.type === 'text' && typeof part.text === 'string'));
}

function outputCapFor(body, route) {
    if (!object(body) || !onlyKeys(body, CHAT_FIELDS) || body.model !== route.modelId
        || (body.n !== undefined && body.n !== 1)
        || (body.stream !== undefined && typeof body.stream !== 'boolean')
        || !Array.isArray(body.messages) || !body.messages.length || !body.messages.every(textMessage)
        || (body.tools !== undefined && (!Array.isArray(body.tools) || !body.tools.every((tool) => tool?.type === 'function')))
        || (body.tool_choice !== undefined && !['none', 'auto', 'required'].includes(body.tool_choice)
            && body.tool_choice?.type !== 'function')
        || (body.response_format !== undefined && !['text', 'json_object', 'json_schema'].includes(body.response_format?.type))
        || (body.thinking !== undefined && (!object(body.thinking)
            || Object.keys(body.thinking).length !== 1 || !['enabled', 'disabled', 'auto'].includes(body.thinking.type)))
        || (body.stream_options !== undefined && (!object(body.stream_options)
            || Object.keys(body.stream_options).some((key) => key !== 'include_usage')))) return null;
    if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined) return null;
    const cap = body.max_completion_tokens ?? body.max_tokens;
    return positiveInteger(cap) && cap <= route.maxOutputTokens ? cap : null;
}

async function readRequest(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > REQUEST_LIMIT) return null;
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
    catch { return null; }
}

function readUsage(payload) {
    const usage = payload?.usage;
    if (!object(usage)) return null;
    const inputTokens = usage.prompt_tokens;
    const outputTokens = usage.completion_tokens;
    const cached = usage.prompt_tokens_details?.cached_tokens;
    const hit = usage.prompt_cache_hit_tokens;
    const cachedInputTokens = cached ?? hit;
    if (!tokenCount(inputTokens) || !tokenCount(outputTokens) || !tokenCount(usage.total_tokens)
        || usage.total_tokens !== inputTokens + outputTokens
        || (cachedInputTokens !== undefined && (!tokenCount(cachedInputTokens) || cachedInputTokens > inputTokens))
        || (cached !== undefined && hit !== undefined && cached !== hit)) return null;
    return cachedInputTokens === undefined ? { inputTokens, outputTokens } : { inputTokens, outputTokens, cachedInputTokens };
}

function observeText(record, message, elapsed) {
    const reasoning = message?.reasoning_content ?? message?.reasoning;
    if (typeof reasoning === 'string' && reasoning.length) record.firstReasoningMs ??= elapsed;
    if (typeof message?.content === 'string' && message.content.length) {
        record.firstBodyMs ??= elapsed;
        record.lastBodyMs = elapsed;
    }
}

function jsonObserver(record) {
    const chunks = [];
    let size = 0;
    let elapsed = 0;
    return {
        push(chunk, at) {
            elapsed = at;
            size += chunk.length;
            if (size <= JSON_LIMIT) chunks.push(chunk);
            else chunks.length = 0;
        },
        usage() {
            if (size > JSON_LIMIT) return null;
            let parsed;
            try { parsed = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
            catch { return null; }
            if (parsed?.success === false || parsed?.error) return null;
            const payload = parsed?.data ?? parsed;
            observeText(record, payload?.choices?.[0]?.message, elapsed);
            return readUsage(payload);
        },
    };
}

function streamObserver(record) {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let data = [];
    let dataSize = 0;
    let usage = null;
    let done = false;
    let invalid = false;

    function line(raw, elapsed) {
        if (raw.endsWith('\r')) raw = raw.slice(0, -1);
        if (raw.startsWith('data:')) {
            const value = raw.slice(5).replace(/^ /, '');
            dataSize += value.length + 1;
            if (dataSize > EVENT_LIMIT || done) invalid = true;
            else data.push(value);
        }
        if (raw || !data.length || invalid) return;
        const event = data.join('\n');
        data = [];
        dataSize = 0;
        if (event === '[DONE]') {
            done = true;
            return;
        }
        let payload;
        try { payload = JSON.parse(event); }
        catch { invalid = true; return; }
        if (payload?.error) invalid = true;
        observeText(record, payload?.choices?.[0]?.delta, elapsed);
        if (payload?.usage != null) {
            const parsed = readUsage(payload);
            // Chat Completions reports one final usage event for the whole request.
            if (!parsed || usage) invalid = true;
            else usage = parsed;
        }
    }

    return {
        push(chunk, elapsed) {
            if (invalid) return;
            const text = pending + decoder.write(chunk);
            let start = 0;
            for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
                if (end - start > EVENT_LIMIT) { invalid = true; break; }
                line(text.slice(start, end), elapsed);
                if (invalid) break;
                start = end + 1;
            }
            pending = invalid ? '' : text.slice(start);
            if (pending.length > EVENT_LIMIT) { invalid = true; pending = ''; }
        },
        usage() {
            return done && !invalid && !pending && !data.length ? usage : null;
        },
    };
}

function rejectRequest(res, status, code) {
    if (res.destroyed) return;
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify({ error: code }));
}

/**
 * Start a single-round, loopback-only model exit. A route exposes a local bearer
 * and URL. Only this process receives the upstream credentials. The caller must
 * preflight the provider's token/fee bounds and give budget the same route order.
 */
export async function startEvaluationMeter({
    routes, budget, onOutbound, fetchImpl = fetch, upstreamTimeoutMs = 120_000,
}) {
    if (!Array.isArray(routes) || !routes.length || !positiveInteger(upstreamTimeoutMs)
        || typeof fetchImpl !== 'function' || (onOutbound !== undefined && typeof onOutbound !== 'function')
        || upstreamTimeoutMs > 2_147_483_647
        || !['reserve', 'settle', 'unknown', 'notSent', 'snapshot'].every((method) => typeof budget?.[method] === 'function')) {
        throw new Error('METER_INVALID_CONFIG');
    }
    const prepared = routes.map(prepareRoute);
    const pathFor = (index) => `/meter/${index}/v1`;
    const routePaths = new Map(prepared.map((_, index) => [pathFor(index) + CHAT_PATH, index]));
    const active = new Map();
    const calls = [];
    let stopping;
    let journalFailed = false;

    async function handle(req, res, controller) {
        const signal = controller.signal;
        const index = routePaths.get(req.url);
        if (index === undefined) return rejectRequest(res, 404, 'METER_ROUTE_NOT_FOUND');
        if (req.method !== 'POST') return rejectRequest(res, 405, 'METER_METHOD');
        const route = prepared[index];
        if (req.headers.authorization !== `Bearer ${route.localCredential}`) {
            return rejectRequest(res, 401, 'METER_UNAUTHORIZED');
        }
        if (budget.signal?.aborted) return rejectRequest(res, 429, 'BUDGET_TOKEN_ANOMALY');
        if (journalFailed || stopping) return rejectRequest(res, 503, 'METER_UNAVAILABLE');
        const body = await readRequest(req);
        const outputCap = outputCapFor(body, route);
        if (!outputCap) return rejectRequest(res, 400, 'METER_UNBOUNDED_REQUEST');
        if (signal.aborted) return;
        if (journalFailed) return rejectRequest(res, 503, 'METER_UNAVAILABLE');

        // Request exactly one aggregate usage event. The outbound body and the
        // inspection callback share the same normalized request shape.
        if (body.stream) body.stream_options = { include_usage: true };
        const wireBody = JSON.stringify(body);
        let id;
        try {
            ({ id } = await budget.reserve({ route: index, outputCap }));
        } catch (error) {
            const code = BUDGET_ERRORS.has(error?.message) ? error.message : 'METER_UNAVAILABLE';
            if (code === 'BUDGET_JOURNAL_FAILED' || code === 'METER_UNAVAILABLE') journalFailed = true;
            return rejectRequest(res, BUDGET_ERRORS.get(code) ?? 503, code);
        }

        const record = {
            route: index, id, state: 'RESERVED', reason: null, status: null, outputCap,
            firstByteMs: null, firstReasoningMs: null, firstBodyMs: null, lastBodyMs: null, endMs: null,
        };
        calls.push(record);
        let sent = false;
        let failure = 'OTHER';
        let timer;
        let response;
        let unknownAttempted = false;
        try {
            signal.throwIfAborted();
            // The in-process inspection may reject before any send.
            if (onOutbound) await onOutbound({ route: index, id, body });
            signal.throwIfAborted();
            if (journalFailed) throw new Error('METER_UNAVAILABLE');
            const started = performance.now();
            timer = setTimeout(() => controller.abort('TIMEOUT'), upstreamTimeoutMs);
            sent = true;
            failure = 'TRANSPORT';
            response = await fetchImpl(route.upstream.href, {
                method: 'POST', redirect: 'manual', signal,
                headers: { authorization: route.authorization, 'content-type': 'application/json' },
                body: wireBody,
            });
            record.status = response.status;
            if (response.status >= 300 && response.status < 400) {
                failure = 'HTTP_ERROR';
                throw new Error('METER_REDIRECT');
            }
            const contentType = response.headers.get('content-type');
            const isStream = contentType?.split(';', 1)[0].trim().toLowerCase() === 'text/event-stream';
            const observer = isStream ? streamObserver(record) : jsonObserver(record);
            res.writeHead(response.status, contentType ? { 'content-type': contentType } : {});
            let completedUsage = null;
            if (response.body) {
                for await (const chunk of response.body) {
                    const elapsed = performance.now() - started;
                    record.firstByteMs ??= elapsed;
                    const writable = res.write(chunk);
                    if (response.ok) observer.push(chunk, elapsed);
                    if (!writable) await once(res, 'drain', { signal });
                    // [DONE] is the protocol boundary. A provider can leave its
                    // socket open afterwards; do not defer the durable usage
                    // settlement (and round abort) until a transport timeout.
                    if (isStream && response.ok && (completedUsage = observer.usage())) {
                        // Let the just-forwarded headers/body flush before a
                        // failed settlement can destroy the downstream socket.
                        await new Promise(setImmediate);
                        break;
                    }
                }
            }
            record.endMs = performance.now() - started;
            signal.throwIfAborted();
            clearTimeout(timer);
            const usage = response.ok ? completedUsage ?? observer.usage() : null;
            if (!usage) {
                failure = response.ok ? 'MISSING_USAGE' : 'HTTP_ERROR';
                unknownAttempted = true;
                const recorded = await budget.unknown(id, failure);
                record.state = 'UNKNOWN';
                record.reason = recorded === false ? 'SETTLEMENT_FAILED' : failure;
            } else {
                failure = 'SETTLEMENT_FAILED';
                const recorded = await budget.settle(id, usage);
                record.state = recorded === false ? 'UNKNOWN' : 'SETTLED';
                if (recorded === false) record.reason = failure;
            }
            res.end();
        } catch (error) {
            if (failure === 'SETTLEMENT_FAILED' && error?.message === 'BUDGET_USAGE_INVALID') failure = 'USAGE_INVALID';
            if (signal.aborted) failure = signal.reason;
            record.reason = failure;
            record.state = sent ? 'UNKNOWN' : 'NOT_SENT';
            let transitionFailed = unknownAttempted;
            if (!transitionFailed) {
                try {
                    const recorded = sent ? await budget.unknown(id, failure) : await budget.notSent(id);
                    if (recorded === false) {
                        record.state = 'UNKNOWN';
                        if (failure !== 'USAGE_INVALID') record.reason = 'SETTLEMENT_FAILED';
                    }
                } catch {
                    transitionFailed = true;
                }
            }
            if (transitionFailed) {
                // The earlier durable hold is still charged at its full bound.
                journalFailed = true;
                record.state = 'UNKNOWN';
                record.reason = 'SETTLEMENT_FAILED';
            }
            rejectRequest(res, failure === 'TIMEOUT' ? 504 : 502, 'METER_UPSTREAM');
        } finally {
            clearTimeout(timer);
            if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
        }
    }

    const server = http.createServer((req, res) => {
        const controller = new AbortController();
        res.once('close', () => {
            if (!res.writableFinished) controller.abort('ABORTED');
        });
        const task = handle(req, res, controller)
            .catch(() => rejectRequest(res, 400, 'METER_INVALID_REQUEST'))
            .finally(() => active.delete(controller));
        active.set(controller, task);
    });
    const abortForBudget = () => {
        for (const controller of active.keys()) controller.abort('TOKEN_ANOMALY');
    };
    budget.signal?.addEventListener('abort', abortForBudget, { once: true });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    return {
        routes: prepared.map((route, index) => ({ baseUrl: origin + pathFor(index), credential: route.localCredential })),
        snapshot: () => ({ calls: calls.map((call) => ({ ...call })), budget: budget.snapshot() }),
        stop() {
            if (!stopping) {
                budget.signal?.removeEventListener('abort', abortForBudget);
                stopping = new Promise((resolve) => server.close(resolve));
                for (const controller of active.keys()) controller.abort('CLOSED');
                server.closeAllConnections();
                stopping = Promise.all([stopping, ...active.values()]).then(() => undefined);
            }
            return stopping;
        },
    };
}
