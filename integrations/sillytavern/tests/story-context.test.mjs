// W13-4：剧情回合在 SETTINGS_READY 写入单个 actor 的 vc_story。假 eventSource，不启浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as api from '../extension/vc-model-settings/api.js';
import { createMemoryInjection, MEMORY_PROMPT, memoryBlock } from '../extension/vc-model-settings/memory-injection.js';
import { createStoryPage, renderStoryPage } from '../extension/vc-model-settings/story-page.js';
import { createStoryContext } from '../extension/vc-model-settings/story-context.js';

const READY = 'chat_completion_settings_ready';
const RUN_ID = '9007199254740993';
const BRANCH_ID = '9007199254740997';
const CONVERSATION_ID = '9007199254740999';
const CHAT = '20000000-0000-4000-8000-000000000001';
const MARKER = 'PRIVATE_ZHOU_WATCH_44';

function bus() {
    const listeners = [];
    const order = [];
    return {
        order,
        eventSource: {
            on(name, fn) {
                if (name !== READY) return;
                listeners.push(async (body) => {
                    order.push(fn.name);
                    await fn(body);
                });
            },
            async emit(name, body) {
                if (name !== READY) return;
                for (const fn of listeners) await fn(body);
            },
        },
    };
}

function host(mode) {
    const prompts = {};
    const context = {
        chatMetadata: {
            vc_f2: { id: CHAT, revision: 4 },
            vc_binding: { mode, conversationId: CONVERSATION_ID, relationshipId: '7' },
        },
        extensionSettings: {},
        prompts,
        setExtensionPrompt(key, ...value) { prompts[key] = value; },
    };
    return context;
}

function armedTurn(worldVersion = 3) {
    return { runId: RUN_ID, branchId: BRANCH_ID, worldVersion, conversationId: CONVERSATION_ID };
}

function wire(context, { recall, ensureBinding } = {}) {
    const events = bus();
    const story = createStoryContext({ getContext: () => context });
    let recalls = 0;
    let bindings = 0;
    const memory = createMemoryInjection({
        getContext: () => context,
        recall: recall || (async () => { recalls += 1; return { status: 'ok', block: '10月30日婚礼' }; }),
        ensureBinding: ensureBinding || (async () => { bindings += 1; }),
        onStatus() {},
    });
    const install = () => {
        events.eventSource.on(READY, memory.attach);
        story.install(events.eventSource, READY);
    };
    return { events, story, memory, install, recalls: () => recalls, bindings: () => bindings };
}

test('STORY 会话 SETTINGS_READY 后 body 含正确 vc_story，且写在 EJS 改写之后', async () => {
    const context = host('STORY');
    const { events, story, install } = wire(context);
    events.eventSource.on(READY, function ejsRewrite(body) {
        body.messages[0].content = `EJS:${body.messages[0].content} ${MARKER}`;
    });
    install();
    story.setRun(armedTurn());
    story.selectActor('lin');
    const body = { messages: [{ role: 'user', content: '林岚，展柜是空的' }], temperature: 0.7 };
    await events.eventSource.emit(READY, body);
    assert.ok(events.order.indexOf('ejsRewrite') < events.order.indexOf('attachStoryIdentity'));
    assert.equal(body.messages[0].content.includes(MARKER), true);
    assert.equal(body.messages[0].content.startsWith('EJS:'), true);
    assert.deepEqual(body.vc_story, {
        runId: RUN_ID,
        branchId: BRANCH_ID,
        actorId: 'lin',
        worldVersion: 3,
        chatIdentity: CHAT,
    });
    assert.equal(typeof body.vc_story.runId, 'string');
    assert.equal(typeof body.vc_story.branchId, 'string');
    assert.equal(typeof body.vc_story.worldVersion, 'number');
    assert.equal(body.temperature, 0.7);
});

test('切换 actor 后下一次发送身份改变，一次发送只有一个 actor', async () => {
    const context = host('STORY');
    const { events, story, install } = wire(context);
    install();
    story.setRun(armedTurn());
    story.selectActor('lin');
    story.selectActor('zhou');
    const first = { messages: [{ role: 'user', content: '先问周澈' }] };
    await events.eventSource.emit(READY, first);
    assert.equal(first.vc_story.actorId, 'zhou');
    assert.equal(JSON.stringify(first.vc_story).includes('lin'), false);
    assert.equal(JSON.stringify(first.vc_story).includes('su'), false);
    assert.equal(Array.isArray(first.vc_story.actorId), false);
    story.selectActor('su');
    const second = { messages: [{ role: 'user', content: '再问苏禾' }] };
    await events.eventSource.emit(READY, second);
    assert.equal(second.vc_story.actorId, 'su');
    assert.equal(first.vc_story.actorId, 'zhou');
    assert.deepEqual(Object.keys(second.vc_story).sort(), ['actorId', 'branchId', 'chatIdentity', 'runId', 'worldVersion']);
});

test('STORY 不注入陪伴记忆块', async () => {
    const context = host('STORY');
    context.prompts[MEMORY_PROMPT] = [memoryBlock('旧陪伴'), 1, 1, false, 1];
    let recalls = 0;
    const { events, story, memory, install } = wire(context, {
        recall: async () => { recalls += 1; return { status: 'ok', block: '不应出现的陪伴记忆' }; },
        ensureBinding: async () => { recalls += 1; },
    });
    install();
    story.setRun(armedTurn());
    story.selectActor('lin');
    await memory.intercept([], 8192, () => { throw new Error('不应中止'); }, 'normal');
    assert.equal(recalls, 0);
    assert.equal(context.prompts[MEMORY_PROMPT][0], '');
    const body = { messages: [{ role: 'user', content: '只问林岚' }] };
    await events.eventSource.emit(READY, body);
    assert.equal(body.vc_memory, undefined);
    assert.equal(JSON.stringify(body).includes('vc-long-term-memory'), false);
    assert.equal(JSON.stringify(body).includes('不应出现的陪伴记忆'), false);
    assert.equal(JSON.stringify(body).includes('旧陪伴'), false);
    assert.equal(body.vc_story.actorId, 'lin');
});

test('COMPANION 不含 vc_story，记忆注入保持原样', async () => {
    const context = host('COMPANION');
    const { events, story, memory, install } = wire(context);
    install();
    story.setRun(armedTurn());
    story.selectActor('lin');
    await memory.intercept([], 8192, () => { throw new Error('不应中止'); }, 'normal');
    const body = { messages: [{ role: 'user', content: '今天的安排' }] };
    await events.eventSource.emit(READY, body);
    assert.equal(body.vc_story, undefined);
    assert.equal(JSON.stringify(body).includes('vc_story'), false);
    assert.deepEqual(context.prompts[MEMORY_PROMPT], [memoryBlock('10月30日婚礼'), 1, 1, false, 1]);
    assert.deepEqual(body.vc_memory, {
        chatIdentity: CHAT, revision: 4, enabled: true, budgetTokens: 1024, block: '10月30日婚礼',
    });
});

test('缺少当前局、身份不完整或未选 actor 时不伪造 vc_story', async () => {
    const context = host('STORY');
    const { events, story, install } = wire(context);
    install();
    const bare = { messages: [{ role: 'user', content: '还没有这一局' }] };
    await events.eventSource.emit(READY, bare);
    assert.equal(Object.hasOwn(bare, 'vc_story'), false);

    story.setRun({ runId: 11, branchId: BRANCH_ID, worldVersion: 3, conversationId: CONVERSATION_ID });
    story.selectActor('lin');
    const numeric = { messages: [{ role: 'user', content: '数字 id' }] };
    await events.eventSource.emit(READY, numeric);
    assert.equal(numeric.vc_story, undefined);

    story.setRun({ ...armedTurn(), worldVersion: '3' });
    story.selectActor('lin');
    const textual = { messages: [{ role: 'user', content: '版本是字符串' }] };
    await events.eventSource.emit(READY, textual);
    assert.equal(textual.vc_story, undefined);

    story.setRun(armedTurn());
    const unselected = { messages: [{ role: 'user', content: '还没选角色' }] };
    await events.eventSource.emit(READY, unselected);
    assert.equal(unselected.vc_story, undefined);
    assert.equal(JSON.stringify(unselected).includes(RUN_ID), false);
    assert.equal(JSON.stringify(unselected).includes(CHAT), false);
});

test('剧情页选择的 actor 进入下一次发送，worldVersion 取视图版本', async () => {
    const realFetch = globalThis.fetch;
    const realDocument = globalThis.document;
    globalThis.document = { cookie: 'vc_csrf=go-token' };
    api.setStHeadersProvider(() => ({ 'X-CSRF-Token': 'st-token' }));
    globalThis.fetch = async (url, init = {}) => {
        const path = String(url);
        const payload = path.endsWith('/auth/session') ? { accountId: CONVERSATION_ID, sessionId: '42' }
            : path.endsWith('/story/runs') && init.method === 'POST' ? {
                conversationId: CONVERSATION_ID,
                runId: RUN_ID,
                branchId: BRANCH_ID,
                caseId: 'rainy-inn-v1',
                worldVersion: 1,
                stage: 'investigation',
                participants: [
                    { actorId: 'player', name: '调查者', role: 'player', scene: 'lobby' },
                    { actorId: 'lin', name: '林岚', role: 'npc', scene: 'lobby' },
                    { actorId: 'zhou', name: '周澈', role: 'npc', scene: 'lobby' },
                    { actorId: 'su', name: '苏禾', role: 'npc', scene: 'lobby' },
                ],
            } : path.includes('/actors/player/view') ? {
                conversationId: CONVERSATION_ID,
                runId: RUN_ID,
                branchId: BRANCH_ID,
                actorId: 'player',
                worldVersion: 4,
                publicLore: { setting: '雨夜', locations: ['lobby'], knownEvent: '怀表不见了' },
                knowledge: [],
                events: [],
                participants: [
                    { actorId: 'lin', name: '林岚', publicPersona: '公开的林岚' },
                    { actorId: 'zhou', name: '周澈', publicPersona: '公开的周澈' },
                    { actorId: 'su', name: '苏禾', publicPersona: '公开的苏禾' },
                ],
            } : { code: 'UNEXPECTED' };
        const status = payload.code === 'UNEXPECTED' ? 500 : 200;
        return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    };
    try {
        const context = host('STORY');
        const { events, story, install } = wire(context);
        install();
        const page = createStoryPage({
            getConversation: () => ({ conversationId: CONVERSATION_ID, mode: 'STORY' }),
            onRun: (turn) => story.setRun(turn),
            onActor: (actorId) => story.selectActor(actorId),
        });
        await page.open();
        await page.start();
        const before = { messages: [{ role: 'user', content: '还没点角色' }] };
        await events.eventSource.emit(READY, before);
        assert.equal(before.vc_story, undefined);
        page.selectActor('lin');
        page.selectActor('zhou');
        const body = { messages: [{ role: 'user', content: '周澈在哪' }] };
        await events.eventSource.emit(READY, body);
        assert.deepEqual(body.vc_story, {
            runId: RUN_ID,
            branchId: BRANCH_ID,
            actorId: 'zhou',
            worldVersion: 4,
            chatIdentity: CHAT,
        });
        const html = renderStoryPage(page.state);
        assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
        assert.match(html, /data-actor="zhou" aria-pressed="true"/);
        assert.equal(html.includes(MARKER), false);
        page.close();
    } finally {
        globalThis.fetch = realFetch;
        globalThis.document = realDocument;
    }
});

test('advance 更新当前分支和世界版本，不清除已选 actor', async () => {
    const context = host('STORY');
    const { events, story, install } = wire(context);
    install();
    story.setRun(armedTurn());
    story.selectActor('zhou');
    story.advance({ runId: RUN_ID, branchId: '9007199254740998', worldVersion: 6, conversationId: CONVERSATION_ID });
    const body = { messages: [{ role: 'user', content: '还是周澈' }] };
    await events.eventSource.emit(READY, body);
    assert.deepEqual(body.vc_story, {
        runId: RUN_ID,
        branchId: '9007199254740998',
        actorId: 'zhou',
        worldVersion: 6,
        chatIdentity: CHAT,
    });
});

test('扩展 loading_order 晚于 EJS，SETTINGS_READY 只追加注册', async () => {
    const manifest = JSON.parse(await readFile(new URL('../extension/vc-model-settings/manifest.json', import.meta.url), 'utf8'));
    const index = await readFile(new URL('../extension/vc-model-settings/index.js', import.meta.url), 'utf8');
    assert.equal(manifest.loading_order, 100);
    assert.match(index, /createStoryContext/);
    assert.match(index, /CHAT_COMPLETION_SETTINGS_READY/);
    assert.doesNotMatch(index, /makeFirst/);
});
