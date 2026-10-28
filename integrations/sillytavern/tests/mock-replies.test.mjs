// W04 一次性响应队列的真实本地 HTTP 回归；独立随机端口/进程，不触碰运行中的 ST。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { complexReply } from '../scripts/lib/complex-card.mjs';

const key = 'vc04-synthetic-test-key';
let child, exited, base;

before(async () => {
    const reservation = net.createServer();
    await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/mock-provider.mjs', import.meta.url)), '--port', String(port)], {
        env: { ...process.env, VC_ST_MOCK_EXPECT_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    exited = new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve, reject) => {
        let output = '', errors = '';
        const timeout = setTimeout(() => reject(new Error('合成 provider 未在 5 秒内启动')), 5000);
        const finish = (error) => { clearTimeout(timeout); error ? reject(error) : resolve(); };
        child.stdout.on('data', (data) => {
            output = (output + data).slice(-600);
            if (output.includes('fixed provider listening')) finish();
        });
        child.stderr.on('data', (data) => { errors = (errors + data).slice(-600); });
        child.once('error', finish);
        child.once('exit', (code) => finish(new Error(`合成 provider 提前退出 ${code}: ${errors}`)));
    });
    const health = await fetch(`${base}/__health`);
    assert.equal((await health.json()).ok, true);
});

after(async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await exited; } finally { clearTimeout(force); }
});

function post(url, body) {
    return fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
}
function generate(stream = false) {
    return post('/v1/chat/completions', { model: 'vc03-fixed-model', stream, messages: [{ role: 'user', content: '合成测试' }] });
}
async function reply() {
    const response = await generate();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].finish_reason, 'stop');
    return body.choices[0].message.content;
}

test('队列跨非流/流式按序消费，保留完整换行协议，耗尽恢复原固定回复', async () => {
    const original = await reply();
    const first = complexReply(15), second = `${complexReply(8)}\n\n最后一行\n`;
    assert.equal((await post('/__replies', [first, second])).status, 200);
    assert.equal(await reply(), first);
    const response = await generate(true);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const data = (await response.text()).trim().split('\n\n').map((line) => {
        assert.ok(line.startsWith('data: '));
        return line.slice(6);
    });
    assert.equal(data.pop(), '[DONE]');
    const chunks = data.map((item) => JSON.parse(item));
    assert.equal(chunks[0].choices[0].delta.role, 'assistant');
    assert.equal(chunks.at(-1).choices[0].finish_reason, 'stop');
    assert.equal(chunks.map((chunk) => chunk.choices[0].delta.content ?? '').join(''), second);
    assert.equal(await reply(), original, '一次性队列不能重放已消费的回复');
});

test('错误队列返回 400，保留尚未消费的合法响应', async () => {
    const pending = complexReply(8);
    assert.equal((await post('/__replies', [pending])).status, 200);
    assert.equal((await post('/__replies', ['invalid mix', 8])).status, 400);
    assert.equal((await fetch(`${base}/__replies`, { method: 'POST', body: '{' })).status, 400);
    assert.equal(await reply(), pending);
});

test('设置新队列替换未消费响应，空队列明确清除', async () => {
    const original = await reply();
    await post('/__replies', ['旧候选']);
    await post('/__replies', ['新候选']);
    assert.equal(await reply(), '新候选');
    await post('/__replies', ['应当被清除']);
    assert.equal((await post('/__replies', [])).status, 200);
    assert.equal(await reply(), original);
});
