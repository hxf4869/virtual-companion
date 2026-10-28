// W13-2：剧情回合最终出站重写、outbound-check 与 Responses 续接身份。
// 只走插件公开入口（generate bridge）。Go 用测试桩，不联系真实上游。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createGenerateBridge } from '../server-plugin/virtual-companion/lib/generate-bridge.js';
import { ToolContinuationStore } from '../server-plugin/virtual-companion/lib/responses-adapter.js';
import { memoryBlock } from '../extension/vc-model-settings/memory-injection.js';

const ZHOU_PRIVATE = '自己把怀表藏在维修柜，钥匙还在自己手里。';
const ZHOU_GOAL = '避免承认擅自拿走怀表；证据充分时可归还钥匙。';
const GM = '周澈因维修报酬争议擅自暂藏怀表。';
const GM_MARKER = 'GM_ONLY_WATCH_TRUTH_92';
const WORLD = 'EJS_WORLDINFO_柜门夹层_9c2e';
const CARD = 'CARD_MACRO_角色卡全知旁白_4aa1';
const PLAYER = '怀表是什么时候不见的？';
const SECRETS = [ZHOU_PRIVATE, ZHOU_GOAL, GM, GM_MARKER];
const MARKER = 'vc-go://model-purposes/FOREGROUND_CHAT?provider=p1&profile=vc-profile-a&pr=3&br=9&scope=story-chat';
const CHAT_URL = 'http://fixture.test/v1/chat/completions';
const ANTHROPIC_URL = 'http://fixture.test/v1/messages';
const MEMORY_CHAT = '10000000-0000-4000-8000-0000000000aa';

const PROTOCOLS = ['OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES'];

function story(over = {}) {
    return {
        runId: '11', branchId: '13', actorId: 'lin', worldVersion: 0,
        chatIdentity: '10000000-0000-4000-8000-000000000042',
        ownerAccountId: '1', // 诱饵：核对必须用会话账号，不能用浏览器自报值
        ...over,
    };
}

function mockRes() {
    return {
        statusCode: 200, headers: {}, chunks: [], ended: false, _sent: false,
        setHeader(k, v) { this.headers[k] = v; },
        flushHeaders() {},
        write(c) { this._sent = true; this.chunks.push(Buffer.from(String(c))); return true; },
        end(c) { if (c !== undefined) this.write(c); this._sent = true; this.ended = true; },
        body() { return Buffer.concat(this.chunks).toString('utf8'); },
        get headersSent() { return this._sent; },
        get writableEnded() { return this.ended; },
    };
}

function mockReq(body) {
    const socket = new EventEmitter();
    socket.removeAllListeners = () => socket;
    return {
        body, socket, user: { profile: { handle: 'owner' } },
        headers: {
            cookie: 'vc_session=s1; st_session=nope; vc_csrf=c1',
            origin: 'http://st.test',
            'x-vc-expected-account-id': '42',
            'x-vc-expected-session-id': '9',
        },
    };
}

function setup(t, protocol) {
    const state = {
        protocol, store: new ToolContinuationStore(), views: [], checks: [], recalls: [], upstream: [],
        checkMode: 'auto', viewActor: null,
        nextOutput: () => [{ type: 'message', content: [{ type: 'output_text', text: '好' }] }],
    };
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        const target = String(url);
        if (target.endsWith('/api/v1/auth/session')) return Response.json({ accountId: '42', sessionId: '9' });
        if (target.includes('/service/model-purposes/')) {
            const sent = JSON.parse(init.body);
            assert.equal(sent.ownerAccountId, '42');
            assert.equal(init.headers.Authorization, 'Bearer synthetic-service-token');
            assert.equal(init.headers.Origin, undefined);
            return Response.json({
                purpose: 'FOREGROUND_CHAT', bindingRevision: 9,
                provider: {
                    providerId: 'p1', displayName: 'P', protocol: state.protocol, revision: 3,
                    credential: 'sk-upstream', endpointUrl: 'http://fixture.test/v1',
                },
                model: {
                    profileKey: 'vc-profile-a', modelId: 'fixture-model', contextWindowTokens: 8192,
                    maxOutputTokens: 512, capabilities: {}, generationParams: {},
                },
            });
        }
        if (target.endsWith('/memory/recall')) {
            state.recalls.push(JSON.parse(init.body));
            return Response.json({ status: 'ok', block: '合成经历', memoryIds: ['1'], summaryIds: [], sources: [] });
        }
        if (target.includes('/actors/') && target.includes('/view')) {
            const parsed = new URL(target);
            const actor = parsed.pathname.split('/').at(-2);
            state.views.push({ url: target, headers: init.headers, actor });
            return Response.json({
                conversationId: '7', runId: '11', branchId: parsed.searchParams.get('branchId'),
                actorId: state.viewActor ?? actor, worldVersion: Number(parsed.searchParams.get('worldVersion')),
                publicLore: { setting: `CANONICAL_VIEW_${state.viewActor ?? actor}`, locations: ['lobby'], knownEvent: '公开事件' },
                knowledge: [{ id: 'k1', fact: '公开可知的柜台位置。', marker: 'PUBLIC_COUNTER' }],
                events: (state.eventsByActor?.[state.viewActor ?? actor]) || [],
                participants: [
                    { actorId: 'lin', name: '林岚', publicPersona: '前台', goal: 'SHOULD_NOT_LEAK_GOAL_FIELD' },
                    { actorId: 'zhou', name: '周澈', publicPersona: '住客' },
                ],
                goal: 'SHOULD_NOT_LEAK_GOAL_FIELD',
            });
        }
        if (target.includes('/outbound-check')) {
            const body = JSON.parse(init.body);
            state.checks.push({ url: target, headers: init.headers, body });
            if (state.checkMode === 'http') return new Response('secret-echo-must-not-leak', { status: 500 });
            if (state.checkMode === 'fail') return Response.json({ passed: false, message: ZHOU_PRIVATE });
            const corpus = JSON.stringify(body);
            if (SECRETS.some((secret) => corpus.includes(secret)) || body.hasPreviousResponseId || body.hasConversation) {
                return Response.json({ code: 'ACCESS_DENIED', message: 'story outbound rejected' }, { status: 403 });
            }
            return Response.json({ passed: true });
        }
        throw new Error(`unexpected Go fetch ${target}`);
    });
    state.bridge = createGenerateBridge({
        config: { goBaseUrl: 'http://fixture-go', serviceToken: 'synthetic-service-token', timeoutMs: 5000 },
        continuationStore: state.store,
        fetchImpl: async (url, init) => {
            state.upstream.push({ url, body: JSON.parse(init.body) });
            return Response.json({
                id: 'resp-fixture', model: 'fixture-model', output: state.nextOutput(),
                usage: { input_tokens: 1, output_tokens: 1 },
            });
        },
    });
    return state;
}

function generateBody(protocol, over = {}) {
    const body = {
        messages: [{ role: 'user', content: PLAYER }],
        model: 'fixture-model', temperature: 0.2, max_tokens: 128, stream: false,
        vc_story: story(),
        ...over,
    };
    if (protocol === 'ANTHROPIC_MESSAGES') {
        body.chat_completion_source = 'claude';
        body.reverse_proxy = MARKER;
    } else {
        body.chat_completion_source = 'custom';
        body.custom_url = MARKER;
    }
    return body;
}

function chatFinal({ system = `${WORLD}\n${CARD}`, user = PLAYER, tools, extra } = {}) {
    return {
        model: 'fixture-model', temperature: 0.2, max_tokens: 128,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        ...(tools ? { tools } : {}),
        ...extra,
    };
}

function anthropicFinal({ system = `${WORLD}\n${CARD}`, user = PLAYER, tools, messages } = {}) {
    return {
        model: 'fixture-model', temperature: 0.2, max_tokens: 128,
        system: [{ type: 'text', text: system }],
        messages: messages ?? [{ role: 'user', content: [{ type: 'text', text: user }] }],
        ...(tools ? { tools } : {}),
    };
}

function expectedUrl(protocol) {
    if (protocol === 'ANTHROPIC_MESSAGES') return ANTHROPIC_URL;
    if (protocol === 'OPENAI_RESPONSES') return 'http://fixture.test/v1/responses';
    return CHAT_URL;
}

async function runTurn(state, protocol, body, finalBody) {
    const req = mockReq(body);
    const res = mockRes();
    const handled = await state.bridge.interceptGenerate(req, res);
    if (protocol === 'OPENAI_RESPONSES') return { handled, guard: null, res, finalBody: null };
    const guardRes = mockRes();
    const guard = await state.bridge.finalOutboundGuard(req, guardRes, finalBody, expectedUrl(protocol));
    if (!guard) state.upstream.push({ url: expectedUrl(protocol), body: JSON.parse(JSON.stringify(finalBody)) });
    return { handled, guard, res: guard ? guardRes : res, finalBody };
}

function assertNoSecret(text) {
    for (const secret of [...SECRETS, 'SHOULD_NOT_LEAK_GOAL_FIELD', 'secret-echo-must-not-leak']) {
        assert.equal(text.includes(secret), false, `response leaked ${secret}`);
    }
}

function assertCheckHeaders(state, protocol) {
    const check = state.checks.at(-1);
    assert.ok(check, 'outbound-check was not called');
    assert.equal(check.headers.Authorization, 'Bearer synthetic-service-token');
    assert.equal(check.headers.Origin, undefined);
    assert.equal(check.headers.Cookie, undefined);
    assert.equal(check.body.ownerAccountId, '42');
    assert.equal(check.body.protocol, protocol);
    assert.equal(check.body.chatIdentity, '10000000-0000-4000-8000-000000000042');
    assert.equal(check.body.worldVersion, 0);
    assert.ok(Array.isArray(check.body.messages) && Array.isArray(check.body.system));
    assert.ok(Array.isArray(check.body.instructions) && Array.isArray(check.body.toolDefinitions) && Array.isArray(check.body.toolResults));
    const view = state.views.at(-1);
    assert.ok(view.url.includes('/actors/lin/'));
    assert.equal(view.headers.Authorization, undefined);
    assert.equal(view.headers.authorization, undefined);
    assert.match(view.headers.Cookie, /vc_session=s1/);
    assert.doesNotMatch(view.headers.Cookie, /st_session/);
    assert.equal(view.headers.origin, 'http://st.test');
    assert.equal(state.recalls.length, 0);
}

for (const protocol of PROTOCOLS) {
    test(`${protocol}：转换后正文含他人私密、goal 或 GM 原文时不联系上游`, async (t) => {
        const state = setup(t, protocol);
        for (const secret of SECRETS) {
            state.upstream.length = 0;
            state.checks.length = 0;
            state.views.length = 0;
            // Chat/Anthropic 的原文只出现在原生转换后的 body（system / system block）。
            // Responses 的原文进入转换后的 input item。
            const body = generateBody(protocol, protocol === 'OPENAI_RESPONSES' ? {
                messages: [
                    { role: 'system', content: secret },
                    { role: 'user', content: PLAYER },
                ],
            } : {});
            const finalBody = protocol === 'ANTHROPIC_MESSAGES'
                ? anthropicFinal({ system: secret })
                : protocol === 'OPENAI_CHAT_COMPLETIONS' ? chatFinal({ system: secret }) : null;
            const result = await runTurn(state, protocol, body, finalBody);
            if (protocol === 'OPENAI_RESPONSES') assert.equal(result.handled, true);
            else {
                assert.equal(result.handled, false, 'Chat/Anthropic 在最终防线拒绝，而不是提前吞掉原生链');
                assert.equal(result.guard, true);
                assert.equal(JSON.stringify(finalBody).includes(secret), false, '拒绝后最终 body 不得保留原文');
            }
            assert.equal(state.upstream.length, 0);
            assert.ok(JSON.stringify(state.checks.at(-1)?.body ?? '').includes(secret), '核对请求必须看见转换后文本桶里的原文');
            assertCheckHeaders(state, protocol);
            assertNoSecret(result.res.body());
            assert.equal(JSON.parse(result.res.body()).error.code, 'VC_STORY_OUTBOUND_REJECTED');
        }
    });

    test(`${protocol}：世界书与 EJS 注入在重写后不出站，规范视角与玩家话语保留`, async (t) => {
        const state = setup(t, protocol);
        const tools = protocol === 'ANTHROPIC_MESSAGES'
            ? [{ name: 'ask', description: '询问', input_schema: { type: 'object', properties: {} }, x_note: WORLD }]
            : [{ type: 'function', function: { name: 'ask', description: '询问', parameters: { type: 'object', properties: {} }, x_note: WORLD } }];
        const body = generateBody(protocol, {
            messages: [
                { role: 'system', content: `${WORLD}\n${CARD}` },
                { role: 'user', content: '请扮演周澈' },
            ],
            tools,
        });
        const finalBody = protocol === 'ANTHROPIC_MESSAGES'
            ? anthropicFinal({ system: `${WORLD}\n${CARD}`, user: '请扮演周澈', tools })
            : protocol === 'OPENAI_CHAT_COMPLETIONS'
                ? chatFinal({ system: `${WORLD}\n${CARD}`, user: '请扮演周澈', tools })
                : null;
        const result = await runTurn(state, protocol, body, finalBody);
        assert.equal(state.upstream.length, 1);
        const sent = JSON.stringify(state.upstream[0].body);
        assert.equal(sent.includes(WORLD), false);
        assert.equal(sent.includes(CARD), false);
        assert.equal(sent.includes('SHOULD_NOT_LEAK_GOAL_FIELD'), false);
        assert.match(sent, /CANONICAL_VIEW_lin/);
        assert.match(sent, /请扮演周澈/);
        assert.match(sent, /"ask"/);
        if (protocol === 'OPENAI_RESPONSES') {
            const input = state.upstream[0].body.input;
            assert.equal(input[0].type, 'message');
            assert.equal(input[0].role, 'system');
            assert.match(input[0].content, /CANONICAL_VIEW_lin/);
            assert.equal(state.upstream[0].body.previous_response_id, undefined);
            assert.equal(state.upstream[0].body.conversation, undefined);
        } else if (protocol === 'ANTHROPIC_MESSAGES') {
            assert.equal(result.guard, false);
            const system = JSON.stringify(finalBody.system);
            assert.match(system, /CANONICAL_VIEW_lin/);
        } else {
            assert.equal(result.guard, false);
            assert.equal(finalBody.messages[0].role, 'system');
            assert.match(finalBody.messages[0].content, /CANONICAL_VIEW_lin/);
        }
        const checked = JSON.stringify(state.checks.at(-1).body);
        assert.match(checked, new RegExp(WORLD));
        assert.equal(state.checks.at(-1).body.hasPreviousResponseId, false);
        assert.equal(state.checks.at(-1).body.hasConversation, false);
        assertCheckHeaders(state, protocol);
    });

    test(`${protocol}：工具后续轮次的工具结果含原文时同样拒绝`, async (t) => {
        const state = setup(t, protocol);
        const call = { id: 'call_lin', type: 'function', function: { name: 'ask', arguments: '{}' } };
        const messages = [
            { role: 'system', content: '公开天气' },
            { role: 'user', content: PLAYER },
            { role: 'assistant', content: '', tool_calls: [call] },
            { role: 'tool', tool_call_id: 'call_lin', content: ZHOU_PRIVATE },
        ];
        const body = generateBody(protocol, protocol === 'OPENAI_RESPONSES' ? { messages } : {
            messages: [
                { role: 'user', content: PLAYER },
                { role: 'assistant', content: '', tool_calls: [call] },
                { role: 'tool', tool_call_id: 'call_lin', content: '没有新情况' },
            ],
        });
        let finalBody = null;
        if (protocol === 'OPENAI_CHAT_COMPLETIONS') {
            finalBody = { model: 'fixture-model', temperature: 0.2, max_tokens: 128, messages };
        } else if (protocol === 'ANTHROPIC_MESSAGES') {
            finalBody = anthropicFinal({
                system: '公开天气',
                messages: [
                    { role: 'user', content: [{ type: 'text', text: PLAYER }] },
                    { role: 'assistant', content: [{ type: 'text', text: '旁白' }, { type: 'tool_use', id: 'call_lin', name: 'ask', input: {} }] },
                    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_lin', content: ZHOU_PRIVATE }] },
                ],
            });
        }
        const result = await runTurn(state, protocol, body, finalBody);
        assert.equal(state.upstream.length, 0);
        assert.match(JSON.stringify(state.checks.at(-1).body.toolResults), new RegExp(ZHOU_PRIVATE));
        assertNoSecret(result.res.body());
        assert.equal(JSON.parse(result.res.body()).error.code, 'VC_STORY_OUTBOUND_REJECTED');
    });
}

test('ANTHROPIC_MESSAGES：重写只保留本轮工具记录，历史工具结果不进入上游', async (t) => {
    const state = setup(t, 'ANTHROPIC_MESSAGES');
    const history = [
        { role: 'user', content: [{ type: 'text', text: '上一轮公开问句' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_old', name: 'note_clue', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_old', content: 'OLD_TOOL_NOTE_PUBLIC' }] },
        { role: 'assistant', content: [{ type: 'text', text: '上一轮后续文本' }] },
    ];
    const fresh = anthropicFinal({
        messages: [...history, { role: 'user', content: [{ type: 'text', text: PLAYER }] }],
    });
    await runTurn(state, 'ANTHROPIC_MESSAGES', generateBody('ANTHROPIC_MESSAGES'), fresh);
    assert.equal(state.upstream.length, 1);
    const freshSent = JSON.stringify(state.upstream[0].body.messages);
    assert.equal(freshSent.includes('toolu_old'), false);
    assert.equal(freshSent.includes('OLD_TOOL_NOTE_PUBLIC'), false);
    assert.equal(freshSent.includes('上一轮公开问句'), false);
    assert.equal(freshSent.includes('上一轮后续文本'), false);
    assert.equal(freshSent.includes('tool_use'), false);
    assert.match(freshSent, new RegExp(PLAYER));

    state.upstream.length = 0;
    const follow = anthropicFinal({
        messages: [
            ...history,
            { role: 'user', content: [{ type: 'text', text: PLAYER }] },
            { role: 'assistant', content: [{ type: 'text', text: '旁白' }, { type: 'tool_use', id: 'toolu_new', name: 'note_clue', input: {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_new', content: 'NEW_TOOL_NOTE_PUBLIC' }] },
        ],
    });
    await runTurn(state, 'ANTHROPIC_MESSAGES', generateBody('ANTHROPIC_MESSAGES'), follow);
    assert.equal(state.upstream.length, 1);
    const followSent = JSON.stringify(state.upstream[0].body.messages);
    assert.equal(followSent.includes('toolu_old'), false);
    assert.equal(followSent.includes('OLD_TOOL_NOTE_PUBLIC'), false);
    assert.equal(followSent.includes('旁白'), false);
    assert.match(followSent, /toolu_new/);
    assert.match(followSent, /NEW_TOOL_NOTE_PUBLIC/);
    assert.match(followSent, new RegExp(PLAYER));
});

test('Responses：注入的 reasoning input item 含他人 goal 时不联系上游', async (t) => {
    const state = setup(t, 'OPENAI_RESPONSES');
    state.nextOutput = () => [{
        type: 'reasoning', id: 'rs_lin',
        summary: [{ type: 'summary_text', text: ZHOU_GOAL }],
        encrypted_content: 'enc-lin-private',
    }, { type: 'function_call', call_id: 'call_lin', name: 'ask', arguments: '{}' }];
    const first = await runTurn(state, 'OPENAI_RESPONSES', generateBody('OPENAI_RESPONSES'), null);
    assert.equal(first.res.statusCode, 200);
    assert.equal(state.upstream.length, 1);
    assert.equal(state.store.entries.size, 1);
    state.nextOutput = () => [{ type: 'message', content: [{ type: 'output_text', text: '续' }] }];
    const secondBody = generateBody('OPENAI_RESPONSES', {
        messages: [
            { role: 'user', content: PLAYER },
            { role: 'assistant', content: '', tool_calls: [{ id: 'call_lin', type: 'function', function: { name: 'ask', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'call_lin', content: '没有新情况' },
        ],
    });
    const second = await runTurn(state, 'OPENAI_RESPONSES', secondBody, null);
    assert.equal(state.upstream.length, 1, '含 goal 的 reasoning item 不得进入第二次上游请求');
    assert.match(JSON.stringify(state.checks.at(-1).body), new RegExp(ZHOU_GOAL));
    assert.equal(JSON.parse(second.res.body()).error.code, 'VC_STORY_OUTBOUND_REJECTED');
    assertNoSecret(second.res.body());
});

test('Responses：同一剧情身份注入 reasoning；actor、branch、worldVersion 任一不同则丢弃', async (t) => {
    const call = { id: 'call_lin', type: 'function', function: { name: 'ask', arguments: '{}' } };
    async function round(state, storyOver) {
        state.nextOutput = () => [{ type: 'message', content: [{ type: 'output_text', text: '续' }] }];
        return runTurn(state, 'OPENAI_RESPONSES', generateBody('OPENAI_RESPONSES', {
            vc_story: story(storyOver),
            messages: [
                { role: 'user', content: PLAYER },
                { role: 'assistant', content: '', tool_calls: [call] },
                { role: 'tool', tool_call_id: 'call_lin', content: '没有新情况' },
            ],
        }), null);
    }
    await t.test('同一身份注入', async (t) => {
        const matched = setup(t, 'OPENAI_RESPONSES');
        matched.nextOutput = () => [{
            type: 'reasoning', id: 'rs_lin', summary: [{ type: 'summary_text', text: '继续询问' }], encrypted_content: 'enc-lin-private',
        }, { type: 'function_call', call_id: 'call_lin', name: 'ask', arguments: '{}' }];
        await runTurn(matched, 'OPENAI_RESPONSES', generateBody('OPENAI_RESPONSES'), null);
        await round(matched, {});
        const input = matched.upstream.at(-1).body.input;
        const reasoningAt = input.findIndex((item) => item.type === 'reasoning');
        const callAt = input.findIndex((item) => item.type === 'function_call');
        assert.ok(reasoningAt >= 0 && reasoningAt < callAt);
        assert.equal(input[reasoningAt].encrypted_content, 'enc-lin-private');
    });
    for (const change of [{ actorId: 'zhou' }, { branchId: '14' }, { worldVersion: 1 }]) {
        await t.test(JSON.stringify(change), async (t) => {
            const state = setup(t, 'OPENAI_RESPONSES');
            state.nextOutput = () => [{
                type: 'reasoning', id: 'rs_lin', summary: [{ type: 'summary_text', text: '继续询问' }], encrypted_content: 'enc-lin-private',
            }, { type: 'function_call', call_id: 'call_lin', name: 'ask', arguments: '{}' }];
            await runTurn(state, 'OPENAI_RESPONSES', generateBody('OPENAI_RESPONSES'), null);
            await round(state, change);
            assert.equal(state.upstream.length, 2);
            assert.equal(JSON.stringify(state.upstream[1]).includes('enc-lin-private'), false);
            assert.equal(state.upstream[1].body.input.some((item) => item.type === 'reasoning'), false);
        });
    }
});

test('Responses：无效剧情身份不消耗已保存的 reasoning', async (t) => {
    const state = setup(t, 'OPENAI_RESPONSES');
    state.nextOutput = () => [{
        type: 'reasoning', id: 'rs_lin', summary: [{ type: 'summary_text', text: '继续询问' }], encrypted_content: 'enc-lin-private',
    }, { type: 'function_call', call_id: 'call_lin', name: 'ask', arguments: '{}' }];
    await runTurn(state, 'OPENAI_RESPONSES', generateBody('OPENAI_RESPONSES'), null);
    assert.equal(state.store.entries.size, 1);
    const broken = generateBody('OPENAI_RESPONSES', {
        vc_story: undefined, vc_session_mode: 'STORY',
        messages: [
            { role: 'user', content: PLAYER },
            { role: 'assistant', content: '', tool_calls: [{ id: 'call_lin', type: 'function', function: { name: 'ask', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'call_lin', content: '没有新情况' },
        ],
    });
    delete broken.vc_story;
    const rejected = await runTurn(state, 'OPENAI_RESPONSES', broken, null);
    assert.equal(JSON.parse(rejected.res.body()).error.code, 'VC_STORY_IDENTITY_REQUIRED');
    assert.equal(state.store.entries.size, 1);
    assert.equal(state.upstream.length, 1);
    state.nextOutput = () => [{ type: 'message', content: [{ type: 'output_text', text: '续' }] }];
    await runTurn(state, 'OPENAI_RESPONSES', generateBody('OPENAI_RESPONSES', {
        messages: [
            { role: 'user', content: PLAYER },
            { role: 'assistant', content: '', tool_calls: [{ id: 'call_lin', type: 'function', function: { name: 'ask', arguments: '{}' } }] },
            { role: 'tool', tool_call_id: 'call_lin', content: '没有新情况' },
        ],
    }), null);
    assert.equal(state.upstream.at(-1).body.input.some((item) => item.encrypted_content === 'enc-lin-private'), true);
});

test('无 vc_story 的 STORY 请求拒绝，且不读取视角、不核对、不联系上游', async (t) => {
    for (const protocol of PROTOCOLS) {
        await t.test(protocol, async (t) => {
            const state = setup(t, protocol);
            const body = generateBody(protocol, { vc_story: undefined, vc_session_mode: 'STORY' });
            delete body.vc_story;
            const finalBody = protocol === 'ANTHROPIC_MESSAGES'
                ? anthropicFinal({ system: WORLD })
                : protocol === 'OPENAI_CHAT_COMPLETIONS' ? chatFinal({ system: WORLD }) : null;
            const result = await runTurn(state, protocol, body, finalBody);
            assert.equal(JSON.parse(result.res.body()).error.code, 'VC_STORY_IDENTITY_REQUIRED');
            assert.equal(state.views.length, 0);
            assert.equal(state.checks.length, 0);
            assert.equal(state.upstream.length, 0);
            assert.equal(state.recalls.length, 0);
        });
    }
    await t.test('worldVersion 必须是整数', async (t) => {
        const state = setup(t, 'OPENAI_CHAT_COMPLETIONS');
        const typed = generateBody('OPENAI_CHAT_COMPLETIONS', { vc_story: story({ worldVersion: '0' }) });
        const result = await runTurn(state, 'OPENAI_CHAT_COMPLETIONS', typed, chatFinal());
        assert.equal(JSON.parse(result.res.body()).error.code, 'VC_STORY_IDENTITY_REQUIRED');
        assert.equal(state.views.length, 0);
    });
    await t.test('一次只允许一个 actor', async (t) => {
        const many = setup(t, 'OPENAI_RESPONSES');
        const plural = generateBody('OPENAI_RESPONSES', { vc_story: { ...story(), actorIds: ['lin', 'zhou'] } });
        const pluralResult = await runTurn(many, 'OPENAI_RESPONSES', plural, null);
        assert.equal(JSON.parse(pluralResult.res.body()).error.code, 'VC_STORY_IDENTITY_REQUIRED');
        assert.equal(many.upstream.length, 0);
    });
});

test('COMPANION 请求仍只重核记忆槽，不重写剧情、不调用 outbound-check', async (t) => {
    for (const protocol of ['OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES']) {
        await t.test(protocol, async (t) => {
        const state = setup(t, protocol);
        const body = generateBody(protocol, {
            vc_story: undefined,
            vc_memory: { chatIdentity: MEMORY_CHAT, revision: 3, enabled: true, budgetTokens: 1024, block: '合成经历' },
            messages: [{ role: 'user', content: `${memoryBlock('合成经历')}\n${WORLD}` }],
        });
        delete body.vc_story;
        const finalBody = protocol === 'OPENAI_CHAT_COMPLETIONS' ? {
            model: 'fixture-model', temperature: 0.2, max_tokens: 128,
            messages: [{ role: 'system', content: `${memoryBlock('合成经历')}\n${CARD}` }, { role: 'user', content: '你好' }],
        } : null;
        await runTurn(state, protocol, body, finalBody);
        assert.equal(state.recalls.length, 1);
        assert.equal(state.views.length, 0);
        assert.equal(state.checks.length, 0);
        assert.equal(state.upstream.length, 1);
        const sent = JSON.stringify(state.upstream[0].body);
        assert.match(sent, /合成经历/);
        assert.match(sent, protocol === 'OPENAI_CHAT_COMPLETIONS' ? new RegExp(CARD) : new RegExp(WORLD));
        assert.equal(sent.includes('CANONICAL_VIEW_'), false);
        });
    }
});

test('Chat：previous_response_id 与 conversation 仍要报告给核对并拒绝', async (t) => {
    const state = setup(t, 'OPENAI_CHAT_COMPLETIONS');
    const finalBody = chatFinal({
        extra: { previous_response_id: 'resp_abc', conversation: 'conv_abc' },
    });
    const result = await runTurn(state, 'OPENAI_CHAT_COMPLETIONS', generateBody('OPENAI_CHAT_COMPLETIONS'), finalBody);
    assert.equal(result.guard, true);
    assert.equal(state.upstream.length, 0);
    assert.equal(state.checks.at(-1).body.hasPreviousResponseId, true);
    assert.equal(state.checks.at(-1).body.hasConversation, true);
    assert.equal(JSON.parse(result.res.body()).error.code, 'VC_STORY_OUTBOUND_REJECTED');
});

test('核对非 200 或 passed 不为 true 时拒绝，且不回显核对正文', async (t) => {
    for (const mode of ['http', 'fail']) {
        await t.test(mode, async (t) => {
            const state = setup(t, 'OPENAI_RESPONSES');
            state.checkMode = mode;
            const result = await runTurn(state, 'OPENAI_RESPONSES', generateBody('OPENAI_RESPONSES'), null);
            assert.equal(state.upstream.length, 0);
            assert.equal(JSON.parse(result.res.body()).error.code, 'VC_STORY_OUTBOUND_REJECTED');
            assertNoSecret(result.res.body());
        });
    }
});

test('ActorView 的 actor 与 vc_story 不一致时拒绝，且不调用 outbound-check', async (t) => {
    const state = setup(t, 'OPENAI_CHAT_COMPLETIONS');
    state.viewActor = 'zhou';
    const finalBody = chatFinal();
    const result = await runTurn(state, 'OPENAI_CHAT_COMPLETIONS', generateBody('OPENAI_CHAT_COMPLETIONS'), finalBody);
    assert.equal(result.guard, true);
    assert.equal(state.checks.length, 0);
    assert.equal(state.upstream.length, 0);
    assert.equal(JSON.parse(result.res.body()).error.code, 'VC_STORY_VIEW_MISMATCH');
    assert.equal(JSON.stringify(finalBody).includes(WORLD), false);
});

test('林岚可见的对白在林岚视图和重写后的上游，不在周澈视图，旧聊天历史不出站', async (t) => {
    const state = setup(t, 'OPENAI_CHAT_COMPLETIONS');
    const line = '林岚，钥匙是你借出的吗？';
    const oldHistory = '上一轮不该出站的旧聊天历史VCW14';
    state.eventsByActor = {
        lin: [{ eventId: '9', actorId: 'player', worldVersion: 1, body: { kind: 'statement', text: line } }],
        zhou: [],
    };
    const linFinal = chatFinal({
        extra: {
            messages: [
                { role: 'system', content: `${WORLD}\n${CARD}` },
                { role: 'user', content: oldHistory },
                { role: 'user', content: '现在只问这一句' },
            ],
        },
    });
    await runTurn(state, 'OPENAI_CHAT_COMPLETIONS', generateBody('OPENAI_CHAT_COMPLETIONS', {
        vc_story: story({ actorId: 'lin', worldVersion: 1 }),
        messages: [
            { role: 'user', content: oldHistory },
            { role: 'user', content: '现在只问这一句' },
        ],
    }), linFinal);
    const linSent = JSON.stringify(state.upstream.at(-1).body);
    assert.match(linSent, new RegExp(line));
    assert.equal(linSent.includes(oldHistory), false);
    assert.match(state.views.at(-1).url, /\/actors\/lin\//);
    state.upstream.length = 0;
    const zhouFinal = chatFinal({
        extra: {
            messages: [
                { role: 'system', content: `${WORLD}\n${CARD}` },
                { role: 'user', content: oldHistory },
                { role: 'user', content: '现在只问这一句' },
            ],
        },
    });
    await runTurn(state, 'OPENAI_CHAT_COMPLETIONS', generateBody('OPENAI_CHAT_COMPLETIONS', {
        vc_story: story({ actorId: 'zhou', worldVersion: 1 }),
        messages: [
            { role: 'user', content: oldHistory },
            { role: 'user', content: '现在只问这一句' },
        ],
    }), zhouFinal);
    const zhouSent = JSON.stringify(state.upstream.at(-1).body);
    assert.equal(zhouSent.includes(line), false);
    assert.equal(zhouSent.includes(oldHistory), false);
    assert.match(state.views.at(-1).url, /\/actors\/zhou\//);
});
