// W14-T5：真实叙事的出站结构检查与本地计量。只保留布尔、标签、用量和判定，不保留正文或凭据。
import http from 'node:http';

const MODEL_ID = 'cline-pass/deepseek-v4.1-flash-1017';

const OWNED = [
    { id: 'lin', label: 'LIN_FACT', text: '19:55把维修柜钥匙借给周澈，并有借用记录。' },
    { id: 'lin', label: 'LIN_MARKER', text: 'PRIVATE_LIN_LOAN_31' },
    { id: 'zhou', label: 'ZHOU_FACT', text: '自己把怀表藏在维修柜，钥匙还在自己手里。' },
    { id: 'zhou', label: 'ZHOU_MARKER', text: 'PRIVATE_ZHOU_WATCH_44' },
    { id: 'su', label: 'SU_FACT', text: '20:13只看见蓝色衣袖进入维修间，没有看清脸。' },
    { id: 'su', label: 'SU_MARKER', text: 'PRIVATE_SU_WITNESS_57' },
];

const ALWAYS = [
    { label: 'LIN_GOAL', text: '找回怀表并澄清自己未离开厨房的时间。' },
    { label: 'ZHOU_GOAL', text: '避免承认擅自拿走怀表；证据充分时可归还钥匙。' },
    { label: 'SU_GOAL', text: '如实提供有限目击信息，不把推测说成亲眼所见。' },
    { label: 'GM_MOTIVE', text: '周澈因维修报酬争议擅自暂藏怀表。' },
    { label: 'GM_MARKER', text: 'GM_ONLY_WATCH_TRUTH_92' },
    { label: 'GM_LOAN', text: '林岚把维修柜钥匙借给周澈修灯。' },
    { label: 'GM_OUTAGE', text: '大堂短暂停电。' },
    { label: 'GM_TAKE', text: '周澈取走怀表并藏在维修柜。' },
    { label: 'GM_SLEEVE', text: '苏禾看到蓝色衣袖的人进入维修间，没看清脸。' },
    { label: 'GM_ANNOUNCE', text: '林岚宣布怀表失踪。' },
];

const NAMES = [
    { id: 'lin', name: '林岚' },
    { id: 'zhou', name: '周澈' },
    { id: 'su', name: '苏禾' },
];

function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function list(value) {
    return Array.isArray(value) ? value : [];
}

export function decodeAgentFile(bytes) {
    return new TextDecoder('gb18030').decode(bytes);
}

export function parseAgentLines(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    const value = (label) => {
        const line = lines.find((item) => item.toLowerCase().startsWith(label));
        return line ? line.replace(/^[^:：]*[:：]\s*/, '').trim() : '';
    };
    return {
        baseUrl: value('api 地址'),
        apiKey: value('api key'),
        protocol: value('协议'),
        modelId: value('模型id'),
        reasoningMax: lines.some((item) => item.includes('思考深度默认用 max')),
    };
}

export function publicModelConfig(parsed) {
    const protocol = typeof parsed?.protocol === 'string' ? parsed.protocol : '';
    return {
        basePresent: typeof parsed?.baseUrl === 'string' && parsed.baseUrl.startsWith('https://'),
        keyPresent: typeof parsed?.apiKey === 'string' && parsed.apiKey.length > 0,
        modelMatched: parsed?.modelId === MODEL_ID,
        chatCompletions: /chat/i.test(protocol) && /completion/i.test(protocol),
        reasoningMax: parsed?.reasoningMax === true,
    };
}

// 与 story-guard canonicalView 的键序一致。调用方传入已经解析的视图，事件 body 原样保留。
export function storyCanonicalView(view) {
    return JSON.stringify({
        conversationId: typeof view?.conversationId === 'string' ? view.conversationId : '',
        runId: view?.runId,
        branchId: view?.branchId,
        actorId: view?.actorId,
        worldVersion: view?.worldVersion,
        publicLore: {
            setting: view?.publicLore?.setting ?? '',
            locations: list(view?.publicLore?.locations),
            knownEvent: view?.publicLore?.knownEvent ?? '',
        },
        knowledge: list(view?.knowledge).map((item) => ({ id: item?.id ?? '', fact: item?.fact ?? '', marker: item?.marker ?? '' })),
        events: list(view?.events).map((item) => ({
            eventId: item?.eventId ?? '', actorId: item?.actorId ?? '', worldVersion: item?.worldVersion ?? 0, body: item?.body ?? {},
        })),
        participants: list(view?.participants).map((item) => ({
            actorId: item?.actorId ?? '', name: item?.name ?? '', publicPersona: item?.publicPersona ?? '',
        })),
    });
}

export function forbiddenForActor(actorId, extra = []) {
    const owned = new Set(OWNED.filter((item) => item.id === actorId).map((item) => item.label));
    const items = [
        ...OWNED.filter((item) => !owned.has(item.label)).map(({ label, text }) => ({ label, text })),
        ...ALWAYS,
    ];
    for (const item of extra) {
        if (item && typeof item.label === 'string' && typeof item.text === 'string' && item.text) items.push({ label: item.label, text: item.text });
    }
    return items;
}

function textOf(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((part) => (typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : ''))).join('');
}

function toolShape(messages) {
    const out = [];
    for (const message of messages) {
        if (message?.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            out.push({ role: 'assistant', names: message.tool_calls.map((call) => String(call?.function?.name ?? '')) });
        } else if (message?.role === 'tool') out.push({ role: 'tool' });
    }
    return out;
}

function sameTools(actual, expected) {
    if (actual.length !== expected.length) return false;
    return actual.every((item, index) => {
        const want = expected[index];
        if (!want || item.role !== want.role) return false;
        if (item.role !== 'assistant') return true;
        const names = Array.isArray(want.names) ? want.names : [];
        return item.names.length === names.length && item.names.every((name, nameIndex) => name === names[nameIndex]);
    });
}

function hitsOf(raw, forbidden) {
    const hits = [];
    for (const item of forbidden) {
        if (item?.text && raw.includes(item.text)) hits.push(item.label);
    }
    return hits;
}

export function inspectChatUpstream(body, expected = {}) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const roles = messages.map((message) => (typeof message?.role === 'string' ? message.role : 'unknown'));
    const systems = messages.filter((message) => message?.role === 'system');
    const users = messages.filter((message) => message?.role === 'user');
    const toolRecords = Array.isArray(expected.toolRecords) ? expected.toolRecords : [];
    const systemMatchesView = systems.length === 1 && systems[0].content === expected.viewText;
    const userIsCurrentPlayerLine = users.length === 1 && users[0].content === expected.playerLine;
    const actualTools = toolShape(messages);
    const toolRecordsMatch = sameTools(actualTools, toolRecords);
    const assistantClean = messages.every((message) => {
        if (message?.role !== 'assistant') return true;
        const content = textOf(message.content);
        const hasCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
        return content.trim() === '' && hasCalls;
    });
    const onlyKnownRoles = messages.every((message) => ['system', 'user', 'assistant', 'tool'].includes(message?.role));
    const expectedLength = 2 + toolRecords.length;
    const onlyCurrentSlots = Boolean(systemMatchesView && userIsCurrentPlayerLine && toolRecordsMatch && assistantClean && onlyKnownRoles && messages.length === expectedLength);
    return {
        onlyCurrentSlots,
        systemMatchesView,
        userIsCurrentPlayerLine,
        toolRecordsMatch,
        forbiddenHits: hitsOf(JSON.stringify(body ?? {}), Array.isArray(expected.forbidden) ? expected.forbidden : []),
        roles,
        reasoningEffort: typeof body?.reasoning_effort === 'string' ? body.reasoning_effort : null,
        modelMatched: body?.model === expected.modelId,
    };
}

function claimsOther(actorId, text) {
    const others = NAMES.filter((item) => item.id !== actorId);
    return others.some((item) => text.includes(`我是${item.name}`) || text.includes(`我叫${item.name}`));
}

export function judgeReply(actorId, text, extra) {
    const raw = typeof text === 'string' ? text : '';
    const trimmed = raw.trim();
    const forbidden = extra === undefined ? forbiddenForActor(actorId) : [...forbiddenForActor(actorId), ...extra];
    const empty = trimmed.length === 0;
    const other = !empty && claimsOther(actorId, trimmed);
    let reason = '回复非空，以当前角色发言，未自称其他角色。';
    if (empty) reason = '回复为空，不能视为该角色发言。';
    else if (other) reason = '回复自称成了其他角色。';
    return {
        inCharacter: !empty && !other,
        reason,
        leakedLabels: hitsOf(raw, forbidden),
        chars: [...trimmed].length,
    };
}

export function sealStoryReport(report, banned) {
    const raw = JSON.stringify(report);
    let hits = 0;
    for (const secret of banned ?? []) {
        if (typeof secret === 'string' && secret && raw.includes(secret)) hits += 1;
    }
    if (hits > 0) return { ok: false, hits };
    return { ok: true, report };
}

function completionOf(body) {
    if (!body || typeof body !== 'object') return null;
    if (body.success != null || body.data != null) return body.data && typeof body.data === 'object' ? body.data : null;
    return body;
}

function usageOf(raw) {
    if (!raw || typeof raw !== 'object') return { promptTokens: null, completionTokens: null, totalTokens: null, cost: null, present: false };
    const promptTokens = numeric(raw.prompt_tokens);
    const completionTokens = numeric(raw.completion_tokens);
    const totalTokens = numeric(raw.total_tokens);
    const cost = numeric(raw.cost ?? raw.total_cost);
    return { promptTokens, completionTokens, totalTokens, cost, present: promptTokens != null || completionTokens != null || totalTokens != null || cost != null };
}

function parseSse(raw) {
    let content = '';
    let reasoning = '';
    let usage = null;
    for (const line of raw.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        const choice = json?.choices?.[0] ?? {};
        const delta = choice.delta ?? choice.message ?? {};
        if (typeof delta.content === 'string') content += delta.content;
        const thought = delta.reasoning_content ?? delta.reasoning;
        if (typeof thought === 'string') reasoning += thought;
        if (json?.usage && typeof json.usage === 'object') usage = json.usage;
    }
    return { content, reasoning, usage };
}

function emptyInspection() {
    return { onlyCurrentSlots: false, systemMatchesView: false, userIsCurrentPlayerLine: false, toolRecordsMatch: false, forbiddenHits: [], roles: [], reasoningEffort: null, modelMatched: false };
}

function replyCharacter(actorId, content, reasoning, forbidden) {
    const spoken = content.trim() ? content : reasoning;
    const verdict = judgeReply(actorId, spoken);
    const scanned = hitsOf(`${content}\n${reasoning}`, Array.isArray(forbidden) ? forbidden : []);
    const leakedLabels = [];
    for (const label of [...verdict.leakedLabels, ...scanned]) {
        if (!leakedLabels.includes(label)) leakedLabels.push(label);
    }
    return { inCharacter: verdict.inCharacter, reason: verdict.reason, leakedLabels, chars: [...content.trim()].length, reasoningChars: [...reasoning].length };
}

export function startStoryCapture(upstreamBase, options = {}) {
    const upstream = new URL(upstreamBase);
    const requested = Number.isInteger(options.maxCalls) ? options.maxCalls : 8;
    const maxCalls = Math.min(Math.max(requested, 1), 20);
    const calls = [];
    let pending = null;
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const requestBody = Buffer.concat(chunks);
        const incoming = new URL(req.url || '/', 'http://127.0.0.1');
        let parsed = null;
        try { parsed = JSON.parse(requestBody.toString('utf8')); } catch { parsed = null; }
        const counted = req.method === 'POST' && (incoming.pathname.includes('chat/completions') || Array.isArray(parsed?.messages) || incoming.pathname.endsWith('/stream'));
        if (counted && calls.length >= maxCalls) {
            res.writeHead(429, { 'content-type': 'application/json' });
            res.end('{"error":"meter call budget"}');
            return;
        }
        const target = new URL(upstream.origin);
        target.pathname = incoming.pathname;
        target.search = incoming.search;
        const headers = {};
        if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
        if (req.headers.authorization) headers.authorization = req.headers.authorization;
        if (req.headers.accept) headers.accept = req.headers.accept;
        let upstreamResponse;
        try {
            upstreamResponse = await fetch(target, { method: req.method || 'GET', headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : requestBody, redirect: 'manual' });
        } catch {
            if (counted) {
                const armed = pending;
                pending = null;
                calls.push({ status: 502, stream: false, ...emptyInspection(), usage: usageOf(null), character: replyCharacter(armed?.actorId, '', '', armed?.forbidden) });
            }
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end('{"error":"upstream"}');
            return;
        }
        const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
        const rawText = responseBody.toString('utf8');
        const contentType = upstreamResponse.headers.get('content-type') || '';
        const stream = contentType.includes('text/event-stream') || rawText.startsWith('data:');
        if (counted) {
            const armed = pending;
            pending = null;
            const inspection = parsed ? inspectChatUpstream(parsed, armed || { viewText: '', playerLine: '', toolRecords: [], forbidden: [], modelId: '' }) : emptyInspection();
            let content = '';
            let reasoning = '';
            let usage = usageOf(null);
            if (stream) {
                const sse = parseSse(rawText);
                content = sse.content;
                reasoning = sse.reasoning;
                usage = usageOf(sse.usage);
            } else {
                try {
                    const payload = completionOf(JSON.parse(rawText));
                    const message = payload?.choices?.[0]?.message ?? {};
                    content = textOf(message.content);
                    const thought = message.reasoning_content ?? message.reasoning;
                    reasoning = typeof thought === 'string' ? thought : '';
                    usage = usageOf(payload?.usage);
                } catch { /* 响应不是 JSON 时只留状态 */ }
            }
            calls.push({
                status: upstreamResponse.status,
                stream,
                ...inspection,
                usage,
                character: replyCharacter(armed?.actorId, content, reasoning, armed?.forbidden),
            });
        }
        const responseHeaders = {};
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
                arm(expected) { pending = expected; },
                snapshot: () => calls.map((call) => ({ ...call, roles: [...(call.roles || [])], forbiddenHits: [...(call.forbiddenHits || [])], usage: { ...call.usage }, character: { ...call.character, leakedLabels: [...(call.character?.leakedLabels || [])] } })),
                stop: () => new Promise((done) => server.close(() => done())),
            });
        });
    });
}
