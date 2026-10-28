// W12-D：玩家剧情页只渲染玩家 ActorView。假 fetch，不启浏览器、不调用模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as api from '../extension/vc-model-settings/api.js';
import { ADMIN_BRIDGE_ROUTES } from '../server-plugin/virtual-companion/lib/admin-bridge.js';
import { createStoryPage, renderStoryPage, STORY_CONFLICT } from '../extension/vc-model-settings/story-page.js';

const MARKERS = ['PRIVATE_LIN_LOAN_31', 'PRIVATE_ZHOU_WATCH_44', 'PRIVATE_SU_WITNESS_57', 'GM_ONLY_WATCH_TRUTH_92'];
const STORY_ID = '9007199254740993';
const realFetch = globalThis.fetch;
const realDocument = globalThis.document;
const realStorage = globalThis.localStorage;
let calls;
let route;
let storage;

const runBody = {
    conversationId: STORY_ID,
    runId: '11',
    branchId: '13',
    caseId: 'rainy-inn-v1',
    worldVersion: 0,
    stage: 'investigation',
    participants: [
        { actorId: 'player', name: '调查者', role: 'player', scene: 'lobby' },
        { actorId: 'lin', name: '林岚', role: 'npc', scene: 'lobby' },
        { actorId: 'zhou', name: '周澈', role: 'npc', scene: 'lobby' },
        { actorId: 'su', name: '苏禾', role: 'npc', scene: 'lobby' },
    ],
};

function poisonedView(extra = {}) {
    return {
        conversationId: STORY_ID,
        runId: '11',
        branchId: '13',
        actorId: 'player',
        worldVersion: 0,
        publicLore: {
            setting: '雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。',
            locations: ['lobby', 'kitchen', 'workshop', 'workshop_cabinet'],
            knownEvent: '20:20老板发现怀表不见了。',
            gm_truth: 'GM_ONLY_WATCH_TRUTH_92',
        },
        knowledge: [
            { id: 'empty-case', fact: '大堂展柜是空的', marker: 'VISIBLE_EMPTY_CASE' },
            { id: 'leak', fact: 'PRIVATE_LIN_LOAN_31', marker: 'PRIVATE_LIN_LOAN_31' },
        ],
        events: [
            { eventId: '1', actorId: 'player', worldVersion: 0, body: { note: '玩家已看见空展柜' } },
            { eventId: '2', actorId: 'zhou', worldVersion: 0, body: { note: 'PRIVATE_ZHOU_WATCH_44', secret: 'PRIVATE_SU_WITNESS_57' } },
        ],
        participants: [
            { actorId: 'lin', name: '林岚', publicPersona: '响应中的林岚公开人设' },
            { actorId: 'zhou', name: '周澈', publicPersona: '响应中的周澈公开人设' },
            { actorId: 'su', name: '苏禾', publicPersona: '响应中的苏禾公开人设' },
        ],
        gm: 'GM_ONLY_WATCH_TRUTH_92',
        ...extra,
    };
}

test.beforeEach(() => {
    calls = [];
    storage = new Map();
    route = (url) => {
        if (url.endsWith('/auth/session')) return { body: { accountId: STORY_ID, sessionId: '42' } };
        if (url.endsWith('/st/bindings')) return { body: { conversationId: '7', relationshipId: '8', chatIdentity: 'c', characterRef: 'r', mode: 'STORY' } };
        if (url.endsWith('/story/runs')) return { body: runBody };
        if (url.includes('/actors/player/view')) return { body: poisonedView() };
        return { status: 500, body: { code: 'UNEXPECTED', message: url } };
    };
    globalThis.document = { cookie: 'vc_csrf=go-token', body: { innerHTML: '' } };
    globalThis.localStorage = {
        get length() { return storage.size; },
        key: (index) => [...storage.keys()][index] ?? null,
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(String(key), String(value)),
        removeItem: (key) => storage.delete(key),
        clear: () => storage.clear(),
    };
    api.setStHeadersProvider(() => ({ 'X-CSRF-Token': 'st-token' }));
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body, credentials: init.credentials });
        const result = await route(url, init);
        return new Response(JSON.stringify(result.body), { status: result.status || 200, headers: result.headers });
    };
});

test.after(() => {
    globalThis.fetch = realFetch;
    globalThis.document = realDocument;
    globalThis.localStorage = realStorage;
});

function storyConversation() {
    return { conversationId: STORY_ID, mode: 'STORY' };
}

async function started(getConversation = storyConversation) {
    const page = createStoryPage({ getConversation });
    await page.open();
    await page.start();
    return page;
}

function assertNoSecrets(label, text) {
    for (const marker of MARKERS) assert.equal(text.includes(marker), false, `${label} 含 ${marker}`);
}

test('开局后只渲染玩家可见线索、公共背景与三名 NPC', async () => {
    const page = await started();
    const html = renderStoryPage(page.state);
    document.body.innerHTML = html;
    for (const text of ['大堂展柜是空的', '玩家已看见空展柜', '雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。', '20:20老板发现怀表不见了。', '林岚', '周澈', '苏禾', '大堂', '厨房', '维修间']) {
        assert.ok(html.includes(text), text);
    }
    assert.match(html, /data-state="playing"/);
    assert.doesNotMatch(html, /workshop_cabinet|执行行动|确认回档|结局/);
    assertNoSecrets('渲染', html);
    assertNoSecrets('DOM', document.body.innerHTML);
    assertNoSecrets('页面 JSON', JSON.stringify(page.state));
    assertNoSecrets('localStorage', JSON.stringify([...storage.entries()]));
    assert.equal(storage.size, 0);
    const urls = calls.map((call) => call.url);
    assert.equal(urls.some((url) => /\/actors\/(lin|zhou|su|gm)\//.test(url)), false);
    const view = calls.find((call) => call.url.includes('/actors/player/view'));
    const viewUrl = new URL(view.url, 'https://example.invalid');
    assert.equal(viewUrl.pathname, `${api.BRIDGE_PREFIX}/api/v1/story/runs/11/actors/player/view`);
    assert.equal(viewUrl.searchParams.get('branchId'), '13');
    assert.equal(viewUrl.searchParams.get('worldVersion'), '0');
    page.close();
});

test('已有剧情对话时开局请求携带会话快照；没有时先建 STORY 绑定', async () => {
    const page = await started();
    const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/story/runs'));
    assert.equal(post.url, `${api.BRIDGE_PREFIX}/api/v1/story/runs`);
    assert.deepEqual(JSON.parse(post.body), { conversationId: STORY_ID, caseId: 'rainy-inn-v1' });
    assert.equal(post.credentials, 'same-origin');
    assert.equal(post.headers['X-CSRF-Token'], 'st-token');
    assert.equal(post.headers['X-VC-CSRF-Token'], 'go-token');
    assert.equal(post.headers['X-VC-Expected-Account-ID'], STORY_ID);
    assert.equal(post.headers['X-VC-Expected-Session-ID'], '42');
    assert.equal(calls.some((call) => call.url.includes('/st/bindings')), false);
    page.close();

    calls = [];
    const fresh = await started(() => ({ conversationId: STORY_ID, mode: 'COMPANION' }));
    const binding = calls.find((call) => call.url.endsWith('/st/bindings'));
    const body = JSON.parse(binding.body);
    assert.equal(binding.method, 'POST');
    assert.equal(body.mode, 'STORY');
    assert.equal(body.displayName, '雨夜旅馆');
    assert.equal(body.relationshipId, undefined);
    assert.match(body.chatIdentity, /^[0-9a-f-]{36}$/);
    assert.match(body.characterRef, /^[0-9a-f-]{36}$/);
    assert.notEqual(body.chatIdentity, body.characterRef);
    assert.deepEqual(JSON.parse(calls.find((call) => call.method === 'POST' && call.url.endsWith('/story/runs')).body), { conversationId: '7', caseId: 'rainy-inn-v1' });
    fresh.close();
});

test('409 显示固定冲突文案，不回显响应，也不进入已开局', async () => {
    const base = route;
    route = (url, init) => (init?.method === 'POST' && url.endsWith('/story/runs')
        ? { status: 409, body: { code: 'REVISION_CONFLICT', message: 'story world conflict PRIVATE_LIN_LOAN_31 GM_ONLY_WATCH_TRUTH_92' } }
        : base(url, init));
    const page = await started();
    const html = renderStoryPage(page.state);
    document.body.innerHTML = html;
    assert.equal(STORY_CONFLICT, '这一局与当前对话冲突，开局未完成。');
    assert.match(html, /这一局与当前对话冲突，开局未完成。/);
    assert.match(html, /data-state="unstarted"/);
    assert.equal(page.state.run, null);
    assert.doesNotMatch(html, /林岚|大堂展柜是空的/);
    assertNoSecrets('冲突渲染', html);
    assertNoSecrets('冲突 DOM', document.body.innerHTML);
    assertNoSecrets('冲突 JSON', JSON.stringify(page.state));
    page.close();
});

test('NPC 公开人设来自 ActorView，页面源码不含定义原文', async () => {
    const page = await started();
    const html = renderStoryPage(page.state);
    const fixture = JSON.parse(await readFile(new URL('../../../docs/source/v2-r3/fixtures/rainy_inn_case.json', import.meta.url), 'utf8'));
    const defined = fixture.actors.map((actor) => actor.public_persona).filter(Boolean);
    assert.equal(defined.length, 3);
    const source = await readFile(new URL('../extension/vc-model-settings/story-page.js', import.meta.url), 'utf8');
    for (const persona of ['响应中的林岚公开人设', '响应中的周澈公开人设', '响应中的苏禾公开人设']) {
        assert.ok(html.includes(persona), persona);
        assert.equal(source.includes(persona), false);
    }
    for (const persona of defined) {
        assert.equal(html.includes(persona), false, persona);
        assert.equal(source.includes(persona), false, persona);
    }
    assertNoSecrets('人设渲染', html);
    page.close();
});

test('动态文本转义，不能把线索或名字写成 HTML', async () => {
    const base = route;
    route = (url) => {
        if (url.endsWith('/story/runs')) {
            return { body: { ...runBody, participants: runBody.participants.map((p) => (p.actorId === 'lin' ? { ...p, name: '"><img src=x onerror=alert(1)>' } : p)) } };
        }
        if (url.includes('/actors/player/view')) {
            return { body: poisonedView({
                publicLore: { setting: '<script>alert(1)</script>', locations: ['lobby'], knownEvent: '20:20老板发现怀表不见了。' },
                knowledge: [{ id: 'x', fact: "大堂<img src=x onerror=alert(1)>", marker: 'VISIBLE' }],
                participants: [
                    { actorId: 'lin', name: '"><img src=x onerror=alert(1)>', publicPersona: '<img src=persona onerror=alert(1)>' },
                    { actorId: 'zhou', name: '周澈', publicPersona: '响应中的周澈公开人设' },
                    { actorId: 'su', name: '苏禾', publicPersona: '响应中的苏禾公开人设' },
                ],
            }) };
        }
        return base(url);
    };
    const page = await started();
    const html = renderStoryPage(page.state);
    assert.match(html, /大堂/);
    assert.match(html, /&lt;script/);
    assert.match(html, /&lt;img/);
    assert.doesNotMatch(html, /<script|<img/i);
    page.close();
});

test('入口、手机单列与桥接范围', async () => {
    const css = await readFile(new URL('../extension/vc-model-settings/story.css', import.meta.url), 'utf8');
    assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(css, /@media \(max-width:\s*760px\)/);
    assert.match(css, /grid-template-columns:\s*1fr/);
    const entry = await readFile(new URL('../extension/vc-model-settings/index.js', import.meta.url), 'utf8');
    assert.match(entry, /mountStoryPage/);
    assert.match(entry, /vc_story_menu_button/);
    const allows = (method, path) => ADMIN_BRIDGE_ROUTES.some((route) => route.method === method && route.path.test(path));
    assert.equal(allows('POST', '/api/v1/story/runs'), true);
    assert.equal(allows('GET', '/api/v1/story/runs/11/actors/player/view'), true);
    assert.equal(allows('POST', '/api/v1/story/runs/11/actions'), false);
    assert.equal(allows('POST', '/api/v1/story/runs/11/rewind'), false);
    assert.equal(allows('GET', '/api/v1/story/runs/../admin/providers'), false);
});
