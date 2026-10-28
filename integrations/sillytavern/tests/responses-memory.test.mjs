import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGenerateBridge } from '../server-plugin/virtual-companion/lib/generate-bridge.js';
import { ToolContinuationStore } from '../server-plugin/virtual-companion/lib/responses-adapter.js';
import { refreshMemorySlot } from '../server-plugin/virtual-companion/lib/memory-guard.js';
import { memoryBlock } from '../extension/vc-model-settings/memory-injection.js';

const chat = '10000000-0000-0000-0000-000000000001';
const sourceChat = '10000000-0000-0000-0000-000000000002';
const marker = 'vc-go://model-purposes/FOREGROUND_CHAT?provider=p&profile=m&pr=1&br=1&scope=fixture-chat-1';
const call = { id: 'call_fixture', type: 'function', function: { name: 'lookup', arguments: '{}' } };
const history = '已核验的合成经历';
const recall = () => ({ status: 'ok', block: history, memoryIds: ['7'], summaryIds: ['11'],
    sources: [{ chatIdentity: chat, revision: 3 }, { chatIdentity: sourceChat, revision: 8 }] });
function request({ continuation = false, enabled = true, block = history, revision = 3 } = {}) {
    return { socket: new EventEmitter(), headers: { cookie: 'vc_session=synthetic' }, user: { profile: { handle: 'fixture' } },
        body: { chat_completion_source: 'custom', custom_url: marker, model: 'fixture-model', max_tokens: 512, stream: false,
            vc_memory: { chatIdentity: chat, revision, enabled, budgetTokens: 1024, block },
            messages: [{ role: 'user', content: `${memoryBlock(block)}\n合成问题` },
                ...(continuation ? [{ role: 'assistant', content: '', tool_calls: [call] }, { role: 'tool', tool_call_id: call.id, content: '{}' }] : [])] } };
}
function response() {
    return { statusCode: 200, headers: {}, headersSent: false, body: '',
        setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ''; this.headersSent = true; } };
}
function harness(t) {
    const h = { providerRequests: [], recall: async () => recall() };
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        if (url.endsWith('/auth/session')) return Response.json({ accountId: '1' });
        if (url.includes('/service/model-purposes/')) return Response.json({ bindingRevision: 1,
            provider: { providerId: 'p', protocol: 'OPENAI_RESPONSES', revision: 1, credential: 'synthetic', endpointUrl: 'http://fixture-model/v1' },
            model: { profileKey: 'm', modelId: 'fixture-model', contextWindowTokens: 8192, maxOutputTokens: 512 } });
        if (url.endsWith('/memory/recall')) return Response.json(await h.recall(init));
        // 用量预留按契约成立后才允许发送。其它地址仍禁止。
        if (String(url).includes('/service/model-usage/reservations')) {
            const path = String(url);
            if (path.endsWith('/settle')) {
                return Response.json({
                    reservationId: '1', purpose: 'FOREGROUND_CHAT', status: 'SETTLED',
                    actualUsd: '0.003000', inputTokens: 1, outputTokens: 1, idempotent: false,
                });
            }
            if (path.endsWith('/cancel')) {
                return Response.json({
                    reservationId: '1', purpose: 'FOREGROUND_CHAT', status: 'UNKNOWN',
                    reservedUsd: '1.000000', actualUsd: null, idempotent: false,
                });
            }
            return Response.json({
                reservationId: '1', purpose: 'FOREGROUND_CHAT', status: 'HELD',
                reservedUsd: '1.000000', attemptId: 'fixture-attempt',
            });
        }
        assert.fail('No external request is permitted in this deterministic test');
    });
    h.store = new ToolContinuationStore();
    h.bridge = createGenerateBridge({ config: { goBaseUrl: 'http://fixture-go', serviceToken: 'synthetic', timeoutMs: 1000 },
        continuationStore: h.store, fetchImpl: async (_url, init) => {
            assert.equal(init.signal.aborted, false);
            h.providerRequests.push(JSON.parse(init.body));
            return Response.json({ id: 'response-fixture', output: h.providerRequests.length === 1
                ? [{ type: 'reasoning', id: 'reasoning-fixture', summary: [{ type: 'summary_text', text: 'derived from prior memory' }], encrypted_content: 'opaque-prior-memory' },
                    { type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments }]
                : [{ type: 'message', content: [{ type: 'output_text', text: '合成回复' }] }], usage: { input_tokens: 1, output_tokens: 1 } });
        } });
    return h;
}

test('W07 Responses 续接拒绝已遗忘、关闭或不可核验的旧推理状态', async (t) => {
    for (const change of ['forgotten', 'disabled', 'unavailable', 'source-revision']) {
        await t.test(change, async (t) => {
            const h = harness(t);
            const first = response(); await h.bridge.interceptGenerate(request(), first);
            assert.equal(first.statusCode, 200); assert.equal(h.providerRequests.length, 1); assert.equal(h.store.entries.size, 1);
            h.recall = async () => change === 'disabled' ? { status: 'disabled', block: '', memoryIds: [], summaryIds: [], sources: [] }
                : change === 'unavailable' ? { status: 'skipped', block: '', memoryIds: [], summaryIds: [], sources: [] }
                    : change === 'source-revision' ? { ...recall(), sources: [{ chatIdentity: sourceChat, revision: 9 }] }
                        : { status: 'ok', block: '', memoryIds: [], summaryIds: [], sources: [] };
            const next = response();
            await h.bridge.interceptGenerate(request({ continuation: true, enabled: change !== 'disabled' }), next);
            assert.equal(next.statusCode, 409);
            assert.equal(JSON.parse(next.body).error.code, 'VC_MEMORY_CONTINUATION_CHANGED');
            assert.equal(h.providerRequests.length, 1, 'stale opaque reasoning must never reach another provider request');
            assert.equal(h.store.entries.size, 0, 'rejected reasoning must not remain available for retry');
        });
    }
});

test('W07 Responses 正常工具续接保留推理，目标聊天保存的整聊revision不误杀；关闭记忆仍可用工具', async (t) => {
    for (const enabled of [true, false]) {
        await t.test(`memory enabled=${enabled}`, async (t) => {
            const h = harness(t), block = enabled ? history : '';
            h.recall = async () => enabled ? recall() : { status: 'disabled', block: '', memoryIds: [], summaryIds: [], sources: [] };
            await h.bridge.interceptGenerate(request({ enabled, block }), response());
            h.recall = async () => enabled ? { ...recall(), sources: [{ chatIdentity: chat, revision: 4 }, { chatIdentity: sourceChat, revision: 8 }] }
                : { status: 'disabled', block: '', memoryIds: [], summaryIds: [], sources: [] };
            const next = response(); await h.bridge.interceptGenerate(request({ continuation: true, enabled, block, revision: 4 }), next);
            assert.equal(next.statusCode, 200); assert.equal(h.providerRequests.length, 2);
            const items = h.providerRequests[1].input;
            const reasoning = items.findIndex((item) => item.type === 'reasoning');
            const tool = items.findIndex((item) => item.type === 'function_call');
            assert.equal(items[reasoning].encrypted_content, 'opaque-prior-memory');
            assert.equal(reasoning + 1, tool, 'reasoning must precede its function call after final slot rewriting');
        });
    }
});

test('W07 最终没有专用槽时，续接快照不声称注入新召回内容', async () => {
    const result = await refreshMemorySlot({ config: { goBaseUrl: 'http://fixture', timeoutMs: 1000 }, request: request({ block: '' }),
        response: response(), finalBody: { input: [{ type: 'message', role: 'user', content: '合成问题' }] },
        fetchImpl: async () => Response.json(recall()) });
    assert.equal(result.status, 'ok'); assert.equal(result.block, '');
    assert.deepEqual(result.memoryIds, []); assert.deepEqual(result.summaryIds, []); assert.deepEqual(result.sources, []);
});

test('W07 Responses 在来源重核等待时取消，不吞取消、不发上游并清除待续接状态', async (t) => {
    const h = harness(t);
    await h.bridge.interceptGenerate(request(), response());
    const nextRequest = request({ continuation: true });
    let release;
    const entered = new Promise((resolve) => { release = resolve; });
    h.recall = async ({ signal }) => {
        release();
        await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        assert.fail('cancelled recall must not return a usable snapshot');
    };
    const nextResponse = response();
    const pending = h.bridge.interceptGenerate(nextRequest, nextResponse);
    await entered;
    nextRequest.socket.destroyed = true;
    nextRequest.socket.emit('close');
    await pending;
    assert.equal(h.providerRequests.length, 1, 'cancelled continuation must not start another model call');
    assert.equal(h.store.entries.size, 0);
    assert.equal(JSON.parse(nextResponse.body).error.code, 'VC_UPSTREAM_TIMEOUT');
});
