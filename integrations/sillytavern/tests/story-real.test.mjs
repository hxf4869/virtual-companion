// W14-T5：真实叙事场景的出站检查、回复判定与显式注册。不联系真实模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';

import { SCENES, resolveSceneFilter } from '../scripts/managed-lib.mjs';
import {
    decodeAgentFile, parseAgentLines, publicModelConfig, storyCanonicalView,
    forbiddenForActor, inspectChatUpstream, judgeReply, sealStoryReport, startStoryCapture,
} from '../scripts/lib/story-real-capture.mjs';

const MODEL_ID = 'cline-pass/deepseek-v4.1-flash-1017';
const LIN_FACT = '19:55把维修柜钥匙借给周澈，并有借用记录。';
const ZHOU_FACT = '自己把怀表藏在维修柜，钥匙还在自己手里。';
const WORLD = 'VCW14_REAL_WORLD_BOOK_HARMLESS';
const PLAYER = 'PLAYER_LINE_SENTINEL_91';
const VIEW_MARK = 'VIEW_SENTINEL_92';
const REPLY = 'REPLY_SENTINEL_94';
const KEY = 'sk-test-sentinel';

function viewOf(actorId, events = []) {
    return {
        conversationId: '7', runId: '11', branchId: '13', actorId, worldVersion: 2,
        publicLore: { setting: VIEW_MARK, locations: ['lobby'], knownEvent: '20:20老板发现怀表不见了。' },
        knowledge: actorId === 'lin' ? [{ id: 'lin-loan', fact: LIN_FACT, marker: 'PRIVATE_LIN_LOAN_31' }] : [],
        events,
        participants: [
            { actorId: 'lin', name: '林岚', publicPersona: '旅馆老板' },
            { actorId: 'zhou', name: '周澈', publicPersona: '住客' },
        ],
    };
}

function listen(handler) {
    const server = http.createServer(handler);
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            base: `http://127.0.0.1:${server.address().port}/v1`,
        }));
    });
}

test('私有配置只公开形状，GB18030 解码不把密钥写进公开结果', () => {
    const text = [
        'API 地址：https://example.test/v1',
        `API Key：${KEY}`,
        '协议：Chat Completions',
        `模型id：${MODEL_ID}`,
        '思考深度默认用 max',
    ].join('\n');
    const parsed = parseAgentLines(text);
    assert.equal(parsed.baseUrl, 'https://example.test/v1');
    assert.equal(parsed.modelId, MODEL_ID);
    assert.equal(parsed.protocol, 'Chat Completions');
    const pub = publicModelConfig(parsed);
    assert.deepEqual(pub, { basePresent: true, keyPresent: true, modelMatched: true, chatCompletions: true, reasoningMax: true });
    assert.equal(JSON.stringify(pub).includes(KEY), false);
    const encoded = Buffer.from('c4a3d0cd6964a3ba636c696e652d706173732f646565707365656b2d76342e312d666c6173682d31303137', 'hex');
    assert.equal(decodeAgentFile(encoded), `模型id：${MODEL_ID}`);
});

test('出站检查只接受当前视图、本轮玩家话语和本轮工具记录', () => {
    const viewText = storyCanonicalView(viewOf('lin', [{
        eventId: '4', actorId: 'player', worldVersion: 1, body: { kind: 'statement', text: '上一轮对白' },
    }]));
    const forbidden = forbiddenForActor('lin', [{ label: 'WORLD', text: WORLD }]);
    const ok = inspectChatUpstream({
        model: MODEL_ID,
        reasoning_effort: 'max',
        messages: [
            { role: 'system', content: viewText },
            { role: 'user', content: PLAYER },
        ],
    }, { viewText, playerLine: PLAYER, toolRecords: [], forbidden, modelId: MODEL_ID });
    assert.equal(ok.onlyCurrentSlots, true);
    assert.equal(ok.systemMatchesView, true);
    assert.equal(ok.userIsCurrentPlayerLine, true);
    assert.equal(ok.toolRecordsMatch, true);
    assert.deepEqual(ok.forbiddenHits, []);
    assert.equal(ok.reasoningEffort, 'max');
    assert.equal(ok.reasoningEffortMax, true);
    assert.equal(JSON.stringify(ok).includes(PLAYER), false);
    assert.equal(JSON.stringify(ok).includes(LIN_FACT), false);
    assert.equal(JSON.stringify(ok).includes('上一轮对白'), false);

    const leaked = inspectChatUpstream({
        model: MODEL_ID,
        messages: [
            { role: 'system', content: viewText },
            { role: 'user', content: PLAYER },
            { role: 'assistant', content: ZHOU_FACT },
        ],
    }, { viewText, playerLine: PLAYER, toolRecords: [], forbidden, modelId: MODEL_ID });
    assert.equal(leaked.onlyCurrentSlots, false);
    assert.deepEqual(leaked.forbiddenHits, ['ZHOU_FACT']);
    assert.equal(leaked.reasoningEffort, null);
    assert.equal(leaked.reasoningEffortMax, false);
    assert.equal(JSON.stringify(leaked).includes(ZHOU_FACT), false);

    const high = inspectChatUpstream({
        model: MODEL_ID,
        reasoning_effort: 'high',
        messages: [
            { role: 'system', content: viewText },
            { role: 'user', content: PLAYER },
        ],
    }, { viewText, playerLine: PLAYER, toolRecords: [], forbidden, modelId: MODEL_ID });
    assert.equal(high.reasoningEffort, 'high');
    assert.equal(high.reasoningEffortMax, false);
    assert.equal(JSON.stringify(high).includes(PLAYER), false);

    const world = inspectChatUpstream({
        model: MODEL_ID,
        messages: [
            { role: 'system', content: `${viewText}\n${WORLD}` },
            { role: 'user', content: PLAYER },
        ],
    }, { viewText, playerLine: PLAYER, toolRecords: [], forbidden, modelId: MODEL_ID });
    assert.equal(world.systemMatchesView, false);
    assert.deepEqual(world.forbiddenHits, ['WORLD']);

    const tools = inspectChatUpstream({
        model: MODEL_ID,
        messages: [
            { role: 'system', content: viewText },
            { role: 'user', content: PLAYER },
            { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'note_clue', arguments: '{"secret":"不应保存"}' } }] },
            { role: 'tool', tool_call_id: 'c1', content: '已记下公开线索。' },
        ],
    }, {
        viewText, playerLine: PLAYER, forbidden, modelId: MODEL_ID,
        toolRecords: [{ role: 'assistant', names: ['note_clue'] }, { role: 'tool' }],
    });
    assert.equal(tools.onlyCurrentSlots, true);
    assert.equal(tools.toolRecordsMatch, true);
    assert.equal(JSON.stringify(tools).includes('不应保存'), false);
    assert.equal(JSON.stringify(tools).includes('已记下公开线索'), false);
});

test('角色判定与泄露检查不回写回复正文', () => {
    const held = judgeReply('lin', '今晚我一直在厨房。');
    assert.equal(held.inCharacter, true);
    assert.deepEqual(held.leakedLabels, []);
    assert.equal(held.reason.length > 0, true);
    assert.equal(held.reason.includes('今晚我一直在厨房'), false);

    const other = judgeReply('lin', '我是周澈，怀表的事与我无关。');
    assert.equal(other.inCharacter, false);
    assert.match(other.reason, /其他角色/);

    const leak = judgeReply('lin', `我记得${ZHOU_FACT}`);
    assert.deepEqual(leak.leakedLabels, ['ZHOU_FACT']);
    assert.equal(JSON.stringify(leak).includes(ZHOU_FACT), false);

    const empty = judgeReply('zhou', '   ');
    assert.equal(empty.inCharacter, false);
    assert.match(empty.reason, /为空/);
});

test('捕获代理只留下结构、判定和用量', async () => {
    const viewText = storyCanonicalView(viewOf('lin'));
    const forbidden = forbiddenForActor('lin', [{ label: 'WORLD', text: WORLD }]);
    const upstream = await listen((req, res) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
            if (req.url.endsWith('/stream')) {
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                res.end(`data: {"choices":[{"delta":{"content":"${REPLY}"}}]}\n\ndata: {"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18,"cost":0.00021}}\n\ndata: [DONE]\n`);
                return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                data: {
                    choices: [{ message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, cost: 0.0003 },
                },
            }));
            assert.equal(raw.includes(KEY), false);
        });
    });
    const capture = await startStoryCapture(upstream.base, { maxCalls: 2 });
    try {
        capture.arm({ viewText, playerLine: PLAYER, toolRecords: [], forbidden, modelId: MODEL_ID });
        const ok = await fetch(`${capture.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                model: MODEL_ID,
                reasoning_effort: 'max',
                messages: [
                    { role: 'system', content: viewText },
                    { role: 'user', content: PLAYER },
                ],
            }),
        });
        assert.equal(ok.status, 200);
        capture.arm({ viewText, playerLine: PLAYER, toolRecords: [], forbidden, modelId: MODEL_ID });
        const streamed = await fetch(`${capture.baseUrl}/stream`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'system', content: viewText }, { role: 'user', content: PLAYER }] }),
        });
        assert.equal(streamed.status, 200);
        await streamed.text();
        const blocked = await fetch(`${capture.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: PLAYER }] }),
        });
        assert.equal(blocked.status, 429);
        const snapshot = capture.snapshot();
        assert.equal(snapshot.length, 2);
        assert.equal(snapshot[0].usage.promptTokens, 20);
        assert.equal(snapshot[0].usage.completionTokens, 5);
        assert.equal(snapshot[0].usage.totalTokens, 25);
        assert.equal(snapshot[0].usage.cost, 0.0003);
        assert.equal(snapshot[0].onlyCurrentSlots, true);
        assert.equal(snapshot[0].reasoningEffort, 'max');
        assert.equal(snapshot[0].reasoningEffortMax, true);
        assert.equal(snapshot[1].reasoningEffort, null);
        assert.equal(snapshot[1].reasoningEffortMax, false);
        assert.equal(snapshot[0].character.inCharacter, true);
        assert.equal(snapshot[1].stream, true);
        assert.equal(snapshot[1].usage.cost, 0.00021);
        assert.equal(snapshot[1].usage.totalTokens, 18);
        const packed = JSON.stringify(snapshot);
        for (const secret of [KEY, PLAYER, VIEW_MARK, REPLY, LIN_FACT, ZHOU_FACT]) {
            assert.equal(packed.includes(secret), false, secret);
        }
    } finally {
        await capture.stop();
        await new Promise((resolve) => upstream.server.close(resolve));
    }
});

test('验收产物拒绝对话正文和密钥', () => {
    const clean = sealStoryReport({ rounds: [{ actor: 'lin', usage: { cost: 0.1 } }] }, [KEY, PLAYER]);
    assert.equal(clean.ok, true);
    const dirty = sealStoryReport({ rounds: [{ reason: PLAYER }] }, [KEY, PLAYER]);
    assert.equal(dirty.ok, false);
    assert.equal(JSON.stringify(dirty).includes(PLAYER), false);
});

test('story-real 只在显式 filter 注册，不进入默认场景', () => {
    const src = fs.readFileSync(new URL('../scripts/accept-managed.mjs', import.meta.url), 'utf8');
    const at = src.indexOf("id: 'story-real'");
    assert.notEqual(at, -1, 'accept-managed 应追加 story-real');
    const block = src.slice(at, at + 420);
    assert.match(block, /default:\s*false/);
    assert.match(block, /'catalog'/);
    assert.match(block, /'stack'/);
    assert.match(block, /'browser'/);
    assert.match(src, /sceneStoryReal/);
    assert.match(src, /'story-real':\s*sceneStoryReal/);
    assert.equal(SCENES.some((scene) => scene.id === 'story-real'), false);
    assert.equal(resolveSceneFilter().includes('story-real'), false);
});

test('story-real 写入测试单价、钉住 max，并核对每轮预留结算', () => {
    const src = fs.readFileSync(new URL('../scripts/story-real-accept.mjs', import.meta.url), 'utf8');
    assert.match(src, /reasoningLevels:\s*\['max'\]/);
    assert.match(src, /generationParams:\s*\{\s*reasoningEffort:\s*'max'\s*\}/);
    assert.match(src, /测试环境价格/);
    assert.match(src, /不是 Owner 价格/);
    assert.match(src, /model_unit_price/);
    assert.match(src, /0\.0003,\s*0\.0012/);
    assert.match(src, /reasoningEffortMax/);
    assert.match(src, /FOREGROUND_CHAT/);
    assert.match(src, /SETTLED/);
    assert.match(src, /actual_input_tokens IS NULL/);
    assert.match(src, /actual_output_tokens IS NULL/);
    assert.doesNotMatch(src, /st_custom_maps_max_to_high/);
});
