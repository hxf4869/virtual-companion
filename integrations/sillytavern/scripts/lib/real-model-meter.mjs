// Local shape/cost meter. Forwards Chat Completions and keeps only counts.
// Never writes request or response text, headers, or credentials.
import http from 'node:http';

function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function classifyContent(content) {
    if (typeof content !== 'string') return { kind: content == null ? 'absent' : 'non-string', chars: 0, keys: [] };
    const text = content.trim();
    const parsed = (raw) => {
        try { return JSON.parse(raw); }
        catch { return null; }
    };
    const keysOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).slice(0, 8) : [];
    const direct = parsed(text);
    if (keysOf(direct).length || (direct && typeof direct === 'object' && !Array.isArray(direct))) {
        return { kind: 'json', chars: text.length, keys: keysOf(direct) };
    }
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
    if (fence) {
        const inner = parsed(fence[1]);
        return { kind: keysOf(inner).length || (inner && typeof inner === 'object') ? 'fenced-json' : 'fence', chars: text.length, keys: keysOf(inner) };
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        const inner = parsed(text.slice(start, end + 1));
        if (inner && typeof inner === 'object') return { kind: 'embedded-json', chars: text.length, keys: keysOf(inner), leadingChars: start };
    }
    return { kind: text.length === 0 ? 'empty' : 'prose', chars: text.length, keys: [] };
}

function completionOf(body) {
    if (!body || typeof body !== 'object') return null;
    if (body.success != null || body.data != null) return body.data && typeof body.data === 'object' ? body.data : null;
    return body;
}

export function startMeter(upstreamBase, options = {}) {
    const upstream = new URL(upstreamBase);
    const calls = [];
    const maxCalls = Number.isInteger(options.maxCalls) ? options.maxCalls : Infinity;
    const server = http.createServer(async (req, res) => {
        if (calls.length >= maxCalls) {
            res.writeHead(429, { 'content-type': 'application/json' });
            res.end('{"error":"meter call budget"}');
            return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const requestBody = Buffer.concat(chunks);
        let roles = [];
        try {
            const parsed = JSON.parse(requestBody.toString('utf8'));
            if (Array.isArray(parsed.messages)) roles = parsed.messages.map((message) => (typeof message?.role === 'string' ? message.role : 'unknown'));
        } catch { /* shape only */ }
        const target = new URL(upstream.origin);
        const incoming = new URL(req.url || '/', 'http://127.0.0.1');
        target.pathname = incoming.pathname;
        target.search = incoming.search;
        const headers = { 'content-type': req.headers['content-type'] || 'application/json' };
        if (req.headers.authorization) headers.authorization = req.headers.authorization;
        let upstreamResponse;
        try {
            upstreamResponse = await fetch(target, { method: req.method, headers, body: requestBody, redirect: 'manual' });
        } catch {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end('{"error":"upstream"}');
            calls.push({ status: 502, roles, kind: 'transport' });
            return;
        }
        const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
        const record = { status: upstreamResponse.status, roles, kind: 'unparsed', chars: 0, keys: [], finish: null, reasoningChars: 0, promptTokens: null, completionTokens: null, totalTokens: null, cost: null, wire: { contentType: upstreamResponse.headers.get('content-type'), envelope: false, outerObject: null, object: null, choices: 0, index: null, content: 'absent', usageBalanced: false } };
        try {
            const body = JSON.parse(responseBody.toString('utf8'));
            const payload = completionOf(body);
            const message = payload?.choices?.[0]?.message || {};
            const shape = classifyContent(typeof message.content === 'string' ? message.content : null);
            const reasoning = message.reasoning_content ?? message.reasoning;
            const usage = payload?.usage && typeof payload.usage === 'object' ? payload.usage : {};
            const prompt = numeric(usage.prompt_tokens);
            const completion = numeric(usage.completion_tokens);
            const total = numeric(usage.total_tokens);
            record.kind = shape.kind;
            record.chars = shape.chars;
            record.keys = shape.keys;
            if (shape.leadingChars != null) record.leadingChars = shape.leadingChars;
            record.finish = typeof payload?.choices?.[0]?.finish_reason === 'string' ? payload.choices[0].finish_reason : null;
            record.reasoningChars = typeof reasoning === 'string' ? reasoning.length : 0;
            record.promptTokens = prompt;
            record.completionTokens = completion;
            record.totalTokens = total;
            record.cost = numeric(usage.cost ?? usage.total_cost ?? payload?.cost);
            record.wire = {
                contentType: upstreamResponse.headers.get('content-type'),
                envelope: Boolean(body && typeof body === 'object' && (body.success != null || body.data != null)),
                outerObject: typeof body?.object === 'string' ? body.object : null,
                object: typeof payload?.object === 'string' ? payload.object : null,
                choices: Array.isArray(payload?.choices) ? payload.choices.length : 0,
                index: Number.isInteger(payload?.choices?.[0]?.index) ? payload.choices[0].index : null,
                content: typeof message.content === 'string' ? (message.content.length ? 'string' : 'empty') : (message.content == null ? 'absent' : typeof message.content),
                usageBalanced: Number.isInteger(prompt) && Number.isInteger(completion) && Number.isInteger(total) && prompt + completion === total,
            };
        } catch { /* keep unparsed */ }
        calls.push(record);
        const responseHeaders = {};
        const contentType = upstreamResponse.headers.get('content-type');
        if (contentType) responseHeaders['content-type'] = contentType;
        res.writeHead(upstreamResponse.status, responseHeaders);
        res.end(responseBody);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const base = new URL(upstream.href);
            base.protocol = 'http:';
            base.hostname = '127.0.0.1';
            base.port = String(address.port);
            base.username = '';
            base.password = '';
            base.search = '';
            base.hash = '';
            resolve({
                baseUrl: base.toString().replace(/\/$/, ''),
                snapshot: () => calls.map((call) => ({ ...call, roles: [...call.roles], keys: [...(call.keys || [])] })),
                stop: () => new Promise((done) => server.close(() => done())),
            });
        });
    });
}
