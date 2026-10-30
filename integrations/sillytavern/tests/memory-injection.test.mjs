import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryInjection, memoryBlock, MEMORY_PROMPT } from '../extension/vc-model-settings/memory-injection.js';
import { memoryRequest, replaceMemorySlots, refreshMemorySlot } from '../server-plugin/virtual-companion/lib/memory-guard.js';
const id = '20000000-0000-4000-8000-000000000001';
const input = { chatIdentity: id, revision: 4, enabled: true, budgetTokens: 1024 };
function host() {
    let context = { chatMetadata: { vc_f2: { id, revision: 4 }, vc_binding: { relationshipId: '7' } },
        extensionSettings: {}, prompts: {}, setExtensionPrompt(key, ...value) { this.prompts[key] = value; } };
    const status = [];
    return { get: () => context, set: (value) => { context = value; }, status,
        controller(recall) { return createMemoryInjection({ getContext: () => context, recall, ensureBinding: async () => {},
            onStatus: (s) => status.push(s) }); } };
}
test('W07 原生专用USER历史资料槽、可关闭和预算；请求元数据仅一次使用', async () => {
    const h = host(), requests = [];
    const c = h.controller(async (value) => { requests.push(value); return { status: value.enabled ? 'ok' : 'disabled', block: value.enabled ? '10月30日婚礼' : '' }; });
    await c.intercept([], 8192, () => assert.fail('不应中止'), 'normal');
    assert.deepEqual(requests, [input]);
    assert.deepEqual(h.get().prompts[MEMORY_PROMPT], [memoryBlock('10月30日婚礼'), 1, 1, false, 1]);
    const body = {}; c.attach(body);
    assert.deepEqual(body.vc_memory, { ...input, block: '10月30日婚礼' });
    const extra = {}; c.attach(extra); assert.equal(extra.vc_memory, undefined);
    h.get().extensionSettings.vc_memory = { enabled: false, budgetTokens: 128 };
    await c.intercept([], 8192, () => assert.fail(), 'normal');
    assert.equal(h.get().prompts[MEMORY_PROMPT][0], '');
    assert.equal(requests[1].enabled, false); assert.equal(requests[1].budgetTokens, 128);
});
test('W07 切换/同聊天revision变化拒绝迟到召回，故障先清空旧资料', async () => {
    for (const switchChat of [false, true]) {
        const h = host(); let release, aborted = false;
        const c = h.controller(() => new Promise((resolve) => { release = resolve; }));
        const pending = c.intercept([], 8192, () => { aborted = true; }, 'normal');
        await new Promise((resolve) => setImmediate(resolve));
        if (switchChat) h.set({ ...h.get(), chatMetadata: { vc_f2: { id: 'another', revision: 1 } } });
        else h.get().chatMetadata.vc_f2.revision++;
        release({ status: 'ok', block: '旧聊天私人经历' }); await pending;
        assert.equal(aborted, true); assert.equal(h.get().prompts[MEMORY_PROMPT][0], '');
        const data = {}; c.attach(data); assert.equal(data.vc_memory, undefined);
    }
    const h = host(); h.get().prompts[MEMORY_PROMPT] = ['旧资料'];
    const c = h.controller(async () => { throw new Error('offline'); });
    await c.intercept([], 8192, () => assert.fail(), 'normal');
    assert.equal(h.get().prompts[MEMORY_PROMPT][0], ''); assert.match(h.status.at(-1), /跳过/);
});
test('W07 quiet、impersonate与无实例群聊不借用普通陪伴资料；末次状态只更新对应快照', async () => {
    const h = host(); const c = h.controller(async () => assert.fail('无普通召回'));
    for (const type of ['quiet', 'impersonate']) await c.intercept([], 1, () => assert.fail(), type);
    h.get().groupId = 'group'; await c.intercept([], 1, () => assert.fail(), 'normal');
    c.finalStatus({ chatIdentity: 'other', revision: 4, status: 'skipped' }); assert.equal(h.status.length, 0);
    c.finalStatus({ chatIdentity: id, revision: 4, status: 'skipped' }); assert.match(h.status.at(-1), /已跳过/);
});
test('W07 三协议实际内容槽替换不动卡、世界书、工具和图片；重复槽去重', () => {
    for (const protocol of ['chat', 'anthropic', 'responses']) {
        const old = memoryBlock('已被删除的旧来源');
        const body = protocol === 'chat' ? { messages: [{ role: 'system', content: '角色卡与世界书' }, { role: 'user', content: `近期对话\n${old}\n当前问题` }, { role: 'user', content: old }] }
            : protocol === 'anthropic' ? { system: [{ type: 'text', text: '角色卡与世界书' }], messages: [{ role: 'user', content: [{ type: 'text', text: `近期对话\n${old}\n当前问题` }, { type: 'image', source: { data: 'synthetic' } }] }] }
                : { instructions: '角色卡与世界书', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `近期对话\n${old}\n当前问题` }] }, { type: 'function_call_output', call_id: 'x', output: '真实工具结果' }] };
        assert.ok(replaceMemorySlots(body, '已核验的上海新居') >= 1);
        const text = JSON.stringify(body);
        assert.equal(text.includes('已被删除'), false); assert.equal(text.includes('上海新居'), true);
        assert.equal(text.includes('角色卡与世界书'), true); assert.equal(text.includes('当前问题'), true);
        replaceMemorySlots(body); assert.equal(JSON.stringify(body).includes('上海新居'), false);
    }
    assert.throws(() => replaceMemorySlots({ messages: [{ role: 'user', content: '<vc-long-term-memory>截断' }] }), (e) => e.code === 'VC_MEMORY_SLOT_CHANGED');
});
test('W07 最终出站核对使用原会话/CSRF/期望身份；来源不可用删除旧块，无元数据不调用Go', async () => {
    const calls = [];
    const req = { body: { vc_memory: { ...input, block: '旧内容' } }, headers: { cookie: 'vc_session=s1; st_session=st; vc_csrf=c1', origin: 'http://st.test', 'x-vc-expected-account-id': '7', 'x-vc-expected-session-id': '9' } };
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; } };
    const run = async (result) => {
        const finalBody = { messages: [{ role: 'user', content: `查询\n${memoryBlock('旧内容')}` }] };
        await refreshMemorySlot({ config: { goBaseUrl: 'http://go.test', timeoutMs: 1000 }, request: req, response, finalBody,
            fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => result }; } });
        return finalBody;
    };
    assert.match(JSON.stringify(await run({ status: 'ok', block: '新内容', memoryIds: ['7'], summaryIds: [], sources: [] })), /新内容/);
    const { init } = calls[0]; assert.equal(init.headers.Cookie, 'vc_session=s1; vc_csrf=c1');
    assert.equal(init.headers['X-CSRF-Token'], 'c1'); assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers['x-vc-expected-account-id'], '7'); assert.deepEqual(JSON.parse(init.body), input);
    assert.equal(JSON.stringify(await run({ status: 'skipped', block: '' })).includes('旧内容'), false);
    assert.equal(response.headers['X-VC-Memory-Status'], 'skipped');
    req.body = {};
    const body = { messages: [{ role: 'user', content: memoryBlock('旧内容') }, { role: 'user', content: '新问题' }] };
    await refreshMemorySlot({ request: req, response, finalBody: body, config: {}, fetchImpl: async () => assert.fail() });
    assert.deepEqual(body.messages, [{ role: 'user', content: '新问题' }]);
});
test('本轮召回成功但没有记忆时，不把空槽记成来源变化', async () => {
    const h = host();
    let block = '旧事实';
    const c = h.controller(async () => ({ status: 'ok', block }));
    await c.intercept([], 8192, () => assert.fail('不应中止'), 'normal');
    c.finalStatus({ chatIdentity: id, revision: 4, status: 'skipped' });
    assert.match(h.status.at(-1), /来源已变化/);
    block = '';
    await c.intercept([], 8192, () => assert.fail('不应中止'), 'normal');
    c.finalStatus({ chatIdentity: id, revision: 4, status: 'skipped' });
    assert.equal(h.status.at(-1), '');
    assert.equal(h.status.filter((item) => String(item).includes('来源已变化')).length, 1);
    c.finalStatus({ chatIdentity: id, revision: 4, status: 'ok' });
    assert.equal(h.status.at(-1), '');
});
test('W07 请求身份改变中止生成；伪造recall输入拒绝', async () => {
    assert.throws(() => memoryRequest({ ...input, revision: -1, block: '' }), (e) => e.code === 'VC_MEMORY_REQUEST_INVALID');
    await assert.rejects(refreshMemorySlot({ config: { goBaseUrl: 'http://go', timeoutMs: 1000 },
        request: { body: { vc_memory: { ...input, block: '' } }, headers: {} }, response: { setHeader() {} }, finalBody: {},
        fetchImpl: async () => ({ status: 409, ok: false }) }), (e) => e.code === 'VC_MEMORY_CONTEXT_CHANGED');
});
