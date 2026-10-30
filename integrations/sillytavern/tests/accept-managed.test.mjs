// V2-W03 受管验收编排的纯逻辑测试：断言库（精确 ID / 错误信封 / SSE 聚合）、
// 合成材料形状、场景表与 --filter 依赖闭包、dry-run 自检路径。
// 不启动 docker / Go / ST / fixture 子进程（fixture 以随机端口内联起用于 dry-run 路径复验）。
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README；ADR-0009 §3）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    synthApiKey, synthServiceToken, synthRestKey, synthSessionToken, synthCsrfToken,
    decimalStringsEqual, assertExactAccountId, assertApiError,
    parseSSEText, collectChatStream, responsesEventTypes,
    SCENES, resolveSceneFilter,
} from '../scripts/managed-lib.mjs';
import { DEFAULT_EXPECT_KEY } from '../scripts/managed-protocol-provider.mjs';

// ---------------------------------------------------------------------------
// 合成材料（全部随机、可重复调用、形状满足 Go 侧校验）
// ---------------------------------------------------------------------------

test('合成材料：服务令牌 >=32 字节、REST key 为 32B padded base64、key/token 互不相同', () => {
    const token = synthServiceToken();
    assert.ok(token.length >= 32, `service token 长度 ${token.length}`);
    assert.notEqual(synthServiceToken(), token);

    const restKey = synthRestKey();
    const raw = Buffer.from(restKey, 'base64');
    assert.equal(raw.length, 32);
    assert.ok(/[=]$/.test(restKey) || restKey.length === 44, '标准 padded base64');

    const key = synthApiKey();
    assert.ok(key.startsWith('vc03m-') && key.length > 16);
    assert.notEqual(synthApiKey(), key);
});

test('synthSessionToken 复刻 Go NewSessionToken：raw 为 base64url(32B)、hash 为 sha256 hex', () => {
    const { raw, hash } = synthSessionToken();
    assert.equal(Buffer.from(raw, 'base64url').length, 32);
    assert.match(hash, /^[0-9a-f]{64}$/);
    // 与 Go TokenHash 相同的 sha256 hex（独立计算路径，验证一致性）
    assert.equal(hash, crypto.createHash('sha256').update(raw).digest('hex'));
});

// ---------------------------------------------------------------------------
// 精确 ID 断言（safe-integer 之上）
// ---------------------------------------------------------------------------

test('decimalStringsEqual：9007199254740993 与 float 邻值必须可区分', () => {
    assert.equal(decimalStringsEqual('9007199254740993', '9007199254740993'), true);
    assert.equal(decimalStringsEqual(' 9007199254740993 ', '9007199254740993'), true);
    assert.equal(decimalStringsEqual('9007199254740993', '9007199254740992'), false);
    assert.equal(decimalStringsEqual('9007199254740993', ' 9007199254740993.0'), false);
    assert.equal(decimalStringsEqual('', '1'), false);
    assert.equal(decimalStringsEqual('abc', 'abc'), false);
    assert.equal(decimalStringsEqual('042', '42'), true, '前导零视为同一数值');
});

test('assertExactAccountId：number 输入直接拒绝（数字路径即丢精度来源）', () => {
    assert.equal(assertExactAccountId('9007199254740993', '9007199254740993'), true);
    assert.throws(() => assertExactAccountId(9007199254740993, '9007199254740993'), /精确比对失败/);
    assert.throws(() => assertExactAccountId('9007199254740992', '9007199254740993'), /精确比对失败/);
});

test('assertApiError：code/message 缺失即失败', () => {
    assert.equal(assertApiError(409, { code: 'REVISION_CONFLICT', message: 'x' }, 'REVISION_CONFLICT'), true);
    assert.throws(() => assertApiError(409, { code: 'OTHER', message: 'x' }, 'REVISION_CONFLICT'));
    assert.throws(() => assertApiError(409, { code: 'REVISION_CONFLICT' }, 'REVISION_CONFLICT'), /message/);
});

// ---------------------------------------------------------------------------
// SSE 聚合
// ---------------------------------------------------------------------------

test('parseSSEText + collectChatStream：content/tool_calls 分片聚合与 [DONE]', () => {
    const sse = [
        'event: chunk',
        'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"你"}}]}',
        '',
        'data: {"choices":[{"index":0,"delta":{"content":"好"}}]}',
        '',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"f","arguments":"{\\"a\\""}}]}}]}',
        '',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}]}}]}',
        '',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
        '',
        'data: [DONE]',
        '',
    ].join('\n');
    const collected = collectChatStream(parseSSEText(sse));
    assert.equal(collected.content, '你好');
    assert.deepEqual(collected.toolCalls, [{ id: 'call-1', name: 'f', arguments: '{"a":1}' }]);
    assert.equal(collected.finish, 'tool_calls');
    assert.deepEqual(collected.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
    assert.equal(collected.sawDone, true);
});

test('responsesEventTypes：缺 event 行时按 data.type', () => {
    assert.deepEqual(responsesEventTypes(parseSSEText('data: {"type":"response.created"}\n\nevent: x\ndata: {"type":"response.completed"}\n\n')), ['response.created', 'response.completed']);
});

// ---------------------------------------------------------------------------
// 场景表与 --filter 依赖闭包
// ---------------------------------------------------------------------------

test('场景表：id 唯一、每个场景有实现入口名与 needs', () => {
    const ids = SCENES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const s of SCENES) {
        assert.ok(Array.isArray(s.needs) && s.needs.length > 0, `${s.id} needs`);
        assert.equal(typeof s.title, 'string');
        assert.equal(typeof s.default, 'boolean');
    }
    assert.equal(SCENES.find((s) => s.id === 'ui03-browser').default, false, '浏览器场景默认不选');
});

test('resolveSceneFilter：默认集不含 ui03-browser；e2e 依赖自动补 catalog-admin；未知场景报错', () => {
    const def = resolveSceneFilter();
    assert.ok(def.includes('catalog-admin'));
    assert.ok(!def.includes('ui03-browser'));

    const expanded = resolveSceneFilter('e2e-anthropic');
    assert.ok(expanded.includes('catalog-admin') && expanded.includes('e2e-anthropic'));

    assert.deepEqual(resolveSceneFilter('catalog-admin'), ['catalog-admin']);

    assert.throws(() => resolveSceneFilter('no-such-scene'), /未知场景/);
    // 按 SCENES 声明序输出：依赖（catalog-admin）必须先于依赖方执行
    assert.deepEqual(resolveSceneFilter('ui03-browser'), ['catalog-admin', 'ui03-browser']);
});

// ---------------------------------------------------------------------------
// accept-managed 的场景实现覆盖完整性（SCENE_IMPLS 键 = SCENES id）
// ---------------------------------------------------------------------------

test('accept-managed.mjs 声明了全部场景实现（源文本契约检查）', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { ACCEPT_SCENES } = await import('../scripts/managed-scenes.mjs');
    const src = fs.readFileSync(new URL('../scripts/accept-managed.mjs', import.meta.url), 'utf8');
    for (const s of SCENES) {
        const scene = ACCEPT_SCENES.find((item) => item.id === s.id);
        assert.equal(typeof scene?.run, 'function', `场景列表缺少实现：${s.id}`);
    }
    // 关键生命周期与红线存在性（源文本层面，防意外删除）
    assert.ok(src.includes('vc-w03-managed-pg') || src.includes('PG_CONTAINER'), 'PG 容器名');
    assert.ok(src.includes('com.vc.w03=managed') || src.includes('PG_LABEL'), 'PG label');
    assert.ok(src.includes('VC_MIGRATE_DB_DSN'), 'migrate DSN 环境变量');
    assert.ok(src.includes('go1.26.10'), 'Go 工具链');
    assert.ok(src.includes('VC_ST_PLUGIN_SERVICE_TOKEN'), '服务令牌环境变量');
    assert.ok(src.includes('VC_PROVIDER_ALLOW_LOOPBACK_HTTP'), 'loopback 放行');
    assert.ok(!src.includes(DEFAULT_EXPECT_KEY), 'accept-managed 不应内联 fixture 默认 key（运行时合成）');
});

test('story-outbound 只在显式 filter 注册，不进入默认场景表', async () => {
    const fs = await import('node:fs');
    const { ACCEPT_SCENES } = await import('../scripts/managed-scenes.mjs');
    const src = fs.readFileSync(new URL('../scripts/story-outbound-accept.mjs', import.meta.url), 'utf8');
    const at = src.indexOf("id: 'story-outbound'");
    assert.notEqual(at, -1, 'story-outbound 场景模块应注册该场景');
    const block = src.slice(at, at + 360);
    assert.match(block, /default:\s*false/);
    assert.match(block, /'catalog'/);
    assert.match(block, /'stack'/);
    assert.match(block, /'browser'/);
    assert.match(src, /run:\s*sceneStoryOutbound/);
    assert.equal(ACCEPT_SCENES.find((scene) => scene.id === 'story-outbound')?.default, false);
    assert.equal(SCENES.some((scene) => scene.id === 'story-outbound'), false, '共享场景表不收录该场景');
    assert.equal(resolveSceneFilter().includes('story-outbound'), false);
    const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    assert.match(readme, /--filter story-outbound/);
    assert.match(readme, /\.vc-wt\.env/);
    const scene = src.slice(src.indexOf('async function sceneStoryOutbound'), src.indexOf('export const storyOutboundScene'));
    const armed = scene.slice(scene.indexOf('if (proxyArmed && spec.proxy)'));
    assert.notEqual(armed.indexOf('if (proxyArmed && spec.proxy)'), -1, 'Claude 首发须处理代理确认');
    assert.match(armed.slice(0, 700), /waitFor\(\{ timeout: 15000 \}\)/, '代理弹窗在点击发送后出现，必须等待而不是立刻视为没有');
    assert.doesNotMatch(armed.slice(0, 500), /confirmProxy\(spec\.proxy\)/);
});

// ---------------------------------------------------------------------------
// dry-run 自检路径（复用 accept-managed 的 runDryRun 不引入 CLI 副作用：
// 这里等价复验其三件套：fixture 单起 + 精确 ID + SSE 闭包）
// ---------------------------------------------------------------------------

test('dry-run 等价自检：fixture 随机端口单起 + 断言库自测', async () => {
    const { createProtocolFixtureServer } = await import('../scripts/managed-protocol-provider.mjs');
    const fixture = await createProtocolFixtureServer({ port: 0, expectKey: DEFAULT_EXPECT_KEY });
    try {
        const health = await (await fetch(`${fixture.url}/__health`)).json();
        assert.equal(health.ok, true);
        assert.equal(typeof health.port, 'number');
        const r = await fetch(`${fixture.url}/v1/responses`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${DEFAULT_EXPECT_KEY}` },
            body: JSON.stringify({ model: 'vc03m-chat', stream: false }),
        });
        assert.equal(r.status, 200);
        assert.equal((await r.json()).object, 'response');
        assert.ok((await fixture.api.count()) >= 1, '生成请求应被捕获（/__health 不计入）');
        assert.equal(assertExactAccountId('9007199254740993', '9007199254740993'), true);
        assert.throws(() => assertExactAccountId('9007199254740992', '9007199254740993'));
    } finally {
        await fixture.api.close();
    }
});
