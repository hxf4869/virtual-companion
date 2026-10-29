// W12-D：玩家剧情页只渲染玩家 ActorView。假 fetch，不启浏览器、不调用模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as api from '../extension/vc-model-settings/api.js';
import { ADMIN_BRIDGE_ROUTES } from '../server-plugin/virtual-companion/lib/admin-bridge.js';
import { createStoryPage, renderStoryPage, STORY_CONFLICT } from '../extension/vc-model-settings/story-page.js';
import { STORY_UI_ROUTES } from '../server-plugin/virtual-companion/lib/story-ui-routes.js';

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
    assert.equal(allows('POST', '/api/v1/story/runs/11/actions'), true);
    assert.equal(allows('POST', '/api/v1/story/runs/11/rewind'), true);
    assert.equal(allows('POST', '/api/v1/story/runs/11/projections/101/confirm'), true);
    assert.equal(allows('POST', '/api/v1/story/runs/11/participants/lin'), true);
    assert.equal(allows('POST', '/api/v1/story/runs/11/epilogue'), true);
    assert.equal(allows('GET', '/api/v1/story/runs/11/actors/lin/view'), false);
    assert.equal(allows('GET', '/api/v1/story/runs/11/actors/gm/view'), false);
    assert.equal(allows('DELETE', '/api/v1/relationships/8'), false);
    assert.equal(allows('GET', '/api/v1/story/runs/../admin/providers'), false);
    assert.match(entry, /createStoryProjection/);
    assert.match(entry, /onAdvance/);
});

test('无钥匙检查维修柜只显示条件不足，世界版本不变，也不补写', async () => {
    let projected = 0;
    const base = route;
    route = (url, init) => {
        if (init?.method === 'POST' && url.endsWith('/actions')) {
            return { body: { accepted: false, replayed: false, reason: 'precondition_failed', worldVersion: 0, branchId: '13', stage: 'investigation', ended: false, message: '拿到了在维修柜找回怀表' } };
        }
        return base(url, init);
    };
    const page = createStoryPage({ getConversation: storyConversation, project: async () => { projected += 1; return { confirmed: true }; } });
    await page.open();
    await page.start();
    await page.act('a6');
    const html = renderStoryPage(page.state);
    document.body.innerHTML = html;
    assert.match(html, /条件还不足，世界没有变化。/);
    assert.equal(page.state.turn.worldVersion, 0);
    assert.equal(projected, 0);
    assert.doesNotMatch(html, /找回怀表|拿到|在维修柜找回怀表/);
    assert.doesNotMatch(html, /workshop_cabinet|执行行动|确认回档|结局/);
    assertNoSecrets('拒绝', html);
    assertNoSecrets('拒绝 JSON', JSON.stringify(page.state));
    page.close();
});

test('回档先写明阶段和对后续行动、分支记忆的影响，确认后才提交', async () => {
    const base = route;
    route = (url, init) => {
        if (url.endsWith('/story/runs') && init?.method === 'POST') {
            return { body: { ...runBody, worldVersion: 2 } };
        }
        if (url.includes('/actors/player/view')) {
            const parsed = new URL(url, 'https://example.invalid');
            const worldVersion = Number(parsed.searchParams.get('worldVersion'));
            return { body: poisonedView({
                branchId: parsed.searchParams.get('branchId'),
                worldVersion,
                events: [{ eventId: '4', worldVersion: 1, body: { note: '已问过林岚', phase: 'investigation' } }],
            }) };
        }
        if (init?.method === 'POST' && url.endsWith('/rewind')) {
            return { body: { branchId: '21', worldVersion: 1, stage: 'investigation' } };
        }
        return base(url, init);
    };
    const page = createStoryPage({
        getConversation: storyConversation,
        getChatIdentity: () => '',
    });
    await page.open();
    await page.start();
    await page.askRewind(1);
    let html = renderStoryPage(page.state);
    assert.match(html, /回到世界版本 1，阶段为调查中。此版本之后的行动不会留在当前分支，需要重新提交才会再次发生。该阶段之后形成的分支记忆会失效，不会并入当前进度。/);
    assert.match(html, /公开线索和角色私密知情范围会重新计算。备份不会因此全部删除。/);
    assert.match(html, /同一局的其他设备需要加载最新状态，不会自动合并。/);
    assert.match(html, /确认回档/);
    assert.match(html, /vc-story-rewind-dialog/);
    assert.equal(calls.some((call) => call.url.endsWith('/rewind')), false);
    page.cancelRewind();
    assert.equal(page.state.rewindAsk, null);
    assert.doesNotMatch(renderStoryPage(page.state), /确认回档/);
    await page.askRewind(1);
    await page.confirmRewind();
    assert.match(renderStoryPage(page.state), /当前聊天还不能回档/);
    assert.equal(calls.some((call) => call.url.endsWith('/rewind')), false);
    page.close();
    const ready = createStoryPage({
        getConversation: storyConversation,
        getChatIdentity: () => '10000000-0000-4000-8000-000000000042',
    });
    await ready.open();
    await ready.start();
    calls = calls.filter((call) => !call.url.endsWith('/rewind'));
    await ready.askRewind(1);
    await ready.confirmRewind();
    const rewind = calls.find((call) => call.url.endsWith('/rewind'));
    assert.equal(rewind.method, 'POST');
    assert.deepEqual(JSON.parse(rewind.body), { toWorldVersion: 1, chatIdentity: '10000000-0000-4000-8000-000000000042' });
    assert.equal(ready.state.turn.branchId, '21');
    assert.equal(ready.state.turn.worldVersion, 1);
    ready.close();
});

test('结局可保存或放弃；保存后提示到记忆页确认，页面不确认记忆', async () => {
    const base = route;
    route = (url, init) => {
        if (init?.method === 'POST' && url.endsWith('/actions')) {
            return { body: { accepted: true, replayed: false, worldVersion: 7, worldEventId: '70', branchId: '13', stage: 'resolved', ended: true } };
        }
        if (url.includes('/actors/player/view') && url.includes('worldVersion=7')) {
            return { body: poisonedView({ worldVersion: 7 }) };
        }
        if (url.endsWith('/relationships')) return { body: [{ relationshipId: 8, personaRef: 'gentle-listener', companionName: '阿兰' }] };
        if (init?.method === 'POST' && url.includes('/participants/lin')) return { body: { runId: '11', actorId: 'lin', relationshipId: '8' } };
        if (init?.method === 'POST' && url.endsWith('/epilogue')) return { body: JSON.parse(init.body).decision === 'save'
            ? { decision: 'save', relationshipId: '8', memoryId: '90', memoryStatus: 'PENDING_CONFIRMATION', summary: JSON.parse(init.body).summary }
            : { decision: 'discard' } };
        return base(url, init);
    };
    const page = createStoryPage({ getConversation: storyConversation, project: async () => ({ confirmed: true }) });
    await page.open();
    await page.start();
    await page.act('a7');
    let html = renderStoryPage(page.state);
    assert.match(html, /data-state="ended"/);
    assert.match(html, /结局/);
    await page.discardEpilogue();
    html = renderStoryPage(page.state);
    assert.match(html, /已放弃共同游玩摘要，不会写入日常记忆。/);
    const discard = calls.find((call) => call.url.endsWith('/epilogue'));
    assert.deepEqual(JSON.parse(discard.body), { decision: 'discard' });
    page.close();

    const saving = createStoryPage({ getConversation: storyConversation, project: async () => ({ confirmed: true }) });
    await saving.open();
    await saving.start();
    await saving.act('a7');
    await saving.saveEpilogue('一起查过怀表');
    assert.match(renderStoryPage(saving.state), /请先让一位陪伴入局/);
    assert.equal(calls.filter((call) => call.url.endsWith('/epilogue')).length, 1);
    await saving.showCompanions();
    html = renderStoryPage(saving.state);
    assert.match(html, /阿兰/);
    assert.doesNotMatch(html, /<img/i);
    await saving.mapCompanion('lin', '8');
    const mapped = calls.find((call) => call.url.includes('/participants/lin'));
    assert.deepEqual(JSON.parse(mapped.body), { relationshipId: '8' });
    await saving.mapCompanion('player', '8');
    assert.equal(calls.filter((call) => call.url.includes('/participants/')).length, 1);
    await saving.saveEpilogue('一起查过怀表');
    const save = calls.filter((call) => call.url.endsWith('/epilogue')).at(-1);
    assert.deepEqual(JSON.parse(save.body), { decision: 'save', relationshipId: '8', summary: '一起查过怀表' });
    assert.match(renderStoryPage(saving.state), /已保存共同游玩摘要，请到记忆页确认后才会写入日常记忆。/);
    assert.equal(calls.some((call) => call.url.includes('/memories/')), false);
    saving.close();
});

test('世界已生效但投影未确认时显示待同步，动态文本被转义', async () => {
    const base = route;
    route = (url, init) => {
        if (init?.method === 'POST' && url.endsWith('/actions')) {
            return { body: { accepted: true, replayed: false, worldVersion: 1, worldEventId: '31', branchId: '13', stage: 'investigation', ended: false } };
        }
        if (url.includes('worldVersion=1')) {
            return { body: poisonedView({
                worldVersion: 1,
                events: [{ eventId: '31', worldVersion: 1, body: { clueName: '<script>钥匙借用记录</script>', text: '<img src=x onerror=alert(1)>' } }],
            }) };
        }
        return base(url, init);
    };
    const page = createStoryPage({ getConversation: storyConversation, project: async () => ({ confirmed: false }) });
    await page.open();
    await page.start();
    await page.act('a1');
    const html = renderStoryPage(page.state);
    assert.match(html, /行动已生效，聊天记录待同步/);
    assert.match(html, /发现证据：/);
    assert.match(html, /&lt;script/);
    assert.match(html, /&lt;img/);
    assert.doesNotMatch(html, /<script|<img/i);
    assert.equal(page.state.syncPending, true);
    assertNoSecrets('投影', html);
    assert.equal(storage.size, 0);
    page.close();
});

test('重放不采用旧分支，换了剧情对话会重新开局', async () => {
    let runs = 0;
    const base = route;
    route = (url, init) => {
        if (init?.method === 'POST' && url.endsWith('/story/runs')) {
            runs += 1;
            return { body: { ...runBody, branchId: runs === 1 ? '13' : '13', worldVersion: runs === 1 ? 0 : 2 } };
        }
        if (init?.method === 'POST' && url.endsWith('/actions')) {
            return { body: { accepted: true, replayed: true, worldVersion: 1, worldEventId: '4', branchId: '99', stage: 'investigation', ended: false } };
        }
        if (url.includes('worldVersion=2')) return { body: poisonedView({ worldVersion: 2 }) };
        return base(url, init);
    };
    let projected = 0;
    let conversation = storyConversation();
    const page = createStoryPage({
        getConversation: () => conversation,
        project: async () => { projected += 1; return { confirmed: true }; },
    });
    await page.open();
    await page.start();
    await page.act('a1');
    assert.equal(page.state.turn.branchId, '13');
    assert.equal(page.state.turn.worldVersion, 2);
    assert.equal(page.state.notice, '');
    assert.equal(projected, 0);
    conversation = { conversationId: '77', mode: 'STORY' };
    route = (url, init) => {
        if (init?.method === 'POST' && url.endsWith('/story/runs')) return { body: { ...runBody, conversationId: '77', runId: '12', branchId: '14', worldVersion: 0 } };
        if (url.includes('/actors/player/view')) return { body: poisonedView({ runId: '12', branchId: '14', conversationId: '77' }) };
        return base(url, init);
    };
    await page.start();
    const restarted = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/story/runs')).at(-1);
    assert.equal(JSON.parse(restarted.body).conversationId, '77');
    assert.equal(page.state.turn.runId, '12');
    page.close();
});

test('行动版本冲突后重查当前进度，不采用冲突响应里的分支，也不回显正文', async () => {
    let runs = 0;
    let projected = 0;
    const base = route;
    route = (url, init) => {
        if (init?.method === 'POST' && url.endsWith('/story/runs')) {
            runs += 1;
            return { body: { ...runBody, worldVersion: runs === 1 ? 0 : 2, branchId: '13' } };
        }
        if (init?.method === 'POST' && url.endsWith('/actions')) {
            return { status: 409, body: { code: 'REVISION_CONFLICT', message: 'story world conflict PRIVATE_LIN_LOAN_31', branchId: '99', worldVersion: 5 } };
        }
        if (url.includes('/actors/player/view')) {
            const worldVersion = Number(new URL(url, 'https://example.invalid').searchParams.get('worldVersion'));
            return { body: poisonedView({ worldVersion, branchId: '13' }) };
        }
        return base(url, init);
    };
    const page = createStoryPage({
        getConversation: storyConversation,
        project: async () => { projected += 1; return { confirmed: true }; },
    });
    await page.open();
    await page.start();
    await page.act('a1');
    const html = renderStoryPage(page.state);
    document.body.innerHTML = html;
    assert.match(html, /data-state="conflict"/);
    assert.match(html, /这步行动与当前进度不一致，没有另开分支。/);
    assert.equal(page.state.turn.branchId, '13');
    assert.equal(page.state.turn.worldVersion, 2);
    assert.equal(projected, 0);
    assert.equal(runs >= 2, true);
    assert.equal(calls.some((call) => call.url.includes('/actors/player/view') && call.url.includes('worldVersion=2')), true);
    assertNoSecrets('冲突重查', html);
    assertNoSecrets('冲突重查 JSON', JSON.stringify(page.state));
    page.close();
});

test('导演或 NPC 未就绪时只显示固定缺配置文案，不写入用途载荷', async () => {
    const base = route;
    route = (url, init) => {
        if (url.endsWith('/model-purposes')) {
            return { body: [
                { purpose: 'STORY_DIRECTOR', status: 'PENDING_CONFIGURATION', note: 'PRIVATE_LIN_LOAN_31 GM_ONLY_WATCH_TRUTH_92' },
                { purpose: 'NPC_DIALOGUE', status: 'DISABLED', secret: 'sk-test-secret' },
            ] };
        }
        return base(url, init);
    };
    const page = await started();
    const html = renderStoryPage(page.state);
    document.body.innerHTML = html;
    assert.match(html, /data-config="missing"/);
    assert.match(html, /剧情导演或 NPC 尚未绑定可用模型。/);
    assert.match(html, /打开模型设置/);
    assert.doesNotMatch(html, /STORY_DIRECTOR|NPC_DIALOGUE|PENDING_CONFIGURATION|sk-test-secret/);
    assertNoSecrets('缺配置', html);
    assertNoSecrets('缺配置 JSON', JSON.stringify(page.state));
    assert.equal(storage.size, 0);
    page.close();
});

test('行动请求未返回时显示正在生成，并停用这一步的按钮', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const base = route;
    route = (url, init) => {
        if (init?.method === 'POST' && url.endsWith('/actions')) return gate;
        return base(url, init);
    };
    const page = createStoryPage({ getConversation: storyConversation, project: async () => ({ confirmed: true }) });
    await page.open();
    await page.start();
    const pending = page.act('a1');
    const html = renderStoryPage(page.state);
    assert.match(html, /data-state="generating"/);
    assert.match(html, /正在生成这一步/);
    assert.match(html, /data-action="act"[^>]*disabled/);
    assert.doesNotMatch(html, /发现证据：|结局|确认回档/);
    release({ body: { accepted: false, replayed: false, reason: 'bad_command', worldVersion: 0, branchId: '13', stage: 'investigation', ended: false } });
    await pending;
    assert.match(renderStoryPage(page.state), /data-state="rejected"/);
    page.close();
});

test('发现证据时用过渡状态标出玩家可见线索名', async () => {
    const base = route;
    route = (url, init) => {
        if (init?.method === 'POST' && url.endsWith('/actions')) {
            return { body: { accepted: true, replayed: false, worldVersion: 1, worldEventId: '31', branchId: '13', stage: 'investigation', ended: false } };
        }
        if (url.includes('worldVersion=1')) {
            return { body: poisonedView({
                worldVersion: 1,
                events: [{ eventId: '31', worldVersion: 1, body: { clueName: '钥匙借用记录', text: '林岚出示了借用记录' } }],
            }) };
        }
        return base(url, init);
    };
    const page = createStoryPage({ getConversation: storyConversation, project: async () => ({ confirmed: false }) });
    await page.open();
    await page.start();
    await page.act('a1');
    const html = renderStoryPage(page.state);
    assert.match(html, /data-state="evidence"/);
    assert.match(html, /data-evidence="show"/);
    assert.match(html, /发现证据：钥匙借用记录/);
    assertNoSecrets('证据过渡', html);
    page.close();
});

test('剧情页路由常量覆盖行动、回档、投影、入局、结局和用途', () => {
    const allows = (method, path) => STORY_UI_ROUTES.some((item) => item.method === method && item.path.test(path));
    assert.equal(allows('POST', '/api/v1/story/runs/11/actions'), true);
    assert.equal(allows('POST', '/api/v1/story/runs/11/rewind'), true);
    assert.equal(allows('POST', '/api/v1/story/runs/11/projections/101/confirm'), true);
    assert.equal(allows('POST', '/api/v1/story/runs/11/participants/lin'), true);
    assert.equal(allows('POST', '/api/v1/story/runs/11/epilogue'), true);
    assert.equal(allows('GET', '/api/v1/admin/model-purposes'), true);
    assert.equal(allows('GET', '/api/v1/story/runs/11/actors/lin/view'), false);
    assert.equal(allows('GET', '/api/v1/story/runs/11/actors/gm/view'), false);
    assert.equal(allows('DELETE', '/api/v1/story/runs/11'), false);
});
