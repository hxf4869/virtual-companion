#!/usr/bin/env node
// V2-W03-S1 本地固定 provider（OpenAI Chat Completions 兼容 mock），仅 127.0.0.1，不调用任何真实模型。
// 捕获只在进程内存（环形缓冲）中保存，供验收用例经本地接口读取断言"实际发给模型的内容"；
// 不落盘任何请求正文或请求头，日志只有计数与结果。Authorization 只与合成预期值比较并记录布尔 authMatched。
// 参数（由 start.mjs 传入，用于 stop.mjs 进程归属匹配）：--dev <DEV 目录> --port <端口>
// 环境：VC_ST_MOCK_EXPECT_KEY（合成预期 key，默认 vc03-synthetic-key）
import http from 'node:http';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(arg('--port', process.env.VC_ST_MOCK_PORT || 8743));
const EXPECT_KEY = process.env.VC_ST_MOCK_EXPECT_KEY || 'vc03-synthetic-key';
const FIXED_REPLY = '【固定回复】收到。这是本地 mock provider 的确定性输出，用于 V2-W03 验收。';
const SLOW_MODEL = 'vc03-slow-model';   // 该模型名触发 250ms/片慢速流，供"停止生成"用例观察
const MAX_CAPTURES = 200;

const captures = [];   // { seq, receivedAt, method, url, model, stream, authMatched, body }
let seq = 0;
const startedAt = Date.now();

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

function capture(req, bodyText) {
    seq += 1;
    let body = null;
    try { body = JSON.parse(bodyText); } catch { body = { _unparsed_length: bodyText.length }; }
    const auth = req.headers.authorization || req.headers['x-api-key'] || '';
    const rec = {
        seq, receivedAt: Date.now(), method: req.method, url: req.url,
        model: body?.model ?? null, stream: !!body?.stream,
        authMatched: auth === `Bearer ${EXPECT_KEY}` || auth === EXPECT_KEY,
        body,
    };
    captures.push(rec);
    if (captures.length > MAX_CAPTURES) captures.shift();
    return rec;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/__health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, since: startedAt, captured: captures.length, port: PORT }));
        return;
    }
    if (req.method === 'GET' && p === '/__captures') {
        const since = Number(url.searchParams.get('since') || 0);
        const kind = url.searchParams.get('kind');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(captures.filter((c) => c.receivedAt >= since && (!kind || c.url.endsWith(kind)))));
        return;
    }
    if (req.method === 'POST' && p === '/__captures/clear') {
        captures.length = 0;
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
        return;
    }
    if (req.method === 'GET' && /\/models$/.test(p)) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'vc03-fixed-model', object: 'model', owned_by: 'local-mock' }, { id: SLOW_MODEL, object: 'model', owned_by: 'local-mock' }] }));
        return;
    }
    if (req.method === 'POST' && /\/chat\/completions$/.test(p)) {
        const rec = capture(req, await readBody(req));
        const body = rec.body || {};
        console.log(`[mock] #${rec.seq} chat/completions stream=${rec.stream} messages=${Array.isArray(body.messages) ? body.messages.length : '?'} auth=${rec.authMatched}`);
        const id = `chatcmpl-vc03-${rec.seq}`;
        const created = Math.floor(Date.now() / 1000);
        const model = body.model || 'vc03-fixed-model';
        if (body.stream) {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
            const pieces = FIXED_REPLY.match(/.{1,6}/gu) || [FIXED_REPLY];
            const delay = model === SLOW_MODEL ? 250 : 30;
            for (const [i, piece] of pieces.entries()) {
                if (res.writableEnded || res.destroyed) return;
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: i === 0 ? { role: 'assistant', content: piece } : { content: piece }, finish_reason: null }] })}\n\n`);
                await new Promise((r) => setTimeout(r, delay));
            }
            if (!res.writableEnded && !res.destroyed) {
                res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
            }
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: FIXED_REPLY }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
        return;
    }
    const rec = capture(req, req.method === 'POST' ? await readBody(req) : '');
    console.log(`[mock] #${rec.seq} ${req.method} ${p} -> 404（无此路由）`);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `mock has no route for ${req.method} ${p}` } }));
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[mock] fixed provider listening on http://127.0.0.1:${PORT}（捕获仅内存，GET /__captures 读取）`);
});
