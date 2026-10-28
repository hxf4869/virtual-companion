import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as api from '../extension/vc-model-settings/api.js';
import { createMemoryPage, renderMemoryPage, FORGET_NOTICE } from '../extension/vc-model-settings/memory-page.js';

const item = (extra = {}) => ({ memoryId: '101', version: 2, summary: '喜欢傍晚沿湖散步', type: 'PREFERENCE', mode: 'DAILY', relationshipId: '11', lifecycle: 'ACTIVE', sourceStatus: 'VALID', recallEligible: true, time: { eventDate: '2026-10-27', eventTime: null, eventTimezone: null, recordedAt: '2026-10-28T06:20:00Z' }, history: [], cleanup: { state: 'NONE' }, ...extra });
const realFetch = globalThis.fetch;
const realDocument = globalThis.document;
let calls, route;
test.beforeEach(() => {
    calls = [];
    route = (url) => url.endsWith('/auth/session') ? { body: { accountId: '9007199254740993', sessionId: '42' } }
        : url.endsWith('/relationships') ? { body: [{ relationshipId: '11', companionName: '澄夏' }, { relationshipId: '12', companionName: '澄夏' }] }
        : url.includes('/relationships/') ? { body: [item()] }
        : url.endsWith('/evidence') ? { body: [{ chatDisplayName: '湖边散步', messageId: 'm1', revision: 3, status: 'VALID', sourceTimestamp: '2026-10-27T10:00:00Z', sourceTimezone: 'Asia/Shanghai', excerpt: '喜欢散步' }] }
        : { body: item() };
    globalThis.document = { cookie: 'vc_csrf=go-token' };
    api.setStHeadersProvider(() => ({ 'X-CSRF-Token': 'st-token' }));
    globalThis.fetch = async (url, init) => {
        calls.push({ url, ...init });
        const result = await route(url, init);
        return new Response(JSON.stringify(result.body), { status: result.status || 200, headers: result.headers });
    };
});
test.after(() => { globalThis.fetch = realFetch; globalThis.document = realDocument; });
async function opened(options = {}) {
    const page = createMemoryPage(options);
    await page.open('11');
    return page;
}

test('列表查询、游标响应头与同源桥；实例列表复用 relationships', async () => {
    route = () => ({ body: [item()], headers: { 'X-Next-Cursor': 'next/+=' } });
    const result = await api.fetchMemories('11/a', { q: '湖 & 风', status: 'ACTIVE', eventDateFrom: '2026-10-01', eventDateTo: '2026-10-28', cursor: 'cursor/+=' , limit: 20 });
    const url = new URL(calls[0].url, 'https://example.invalid');
    assert.equal(url.pathname, `${api.BRIDGE_PREFIX}/api/v1/relationships/11%2Fa/memories`);
    assert.deepEqual(Object.fromEntries(url.searchParams), { q: '湖 & 风', status: 'ACTIVE', eventDateFrom: '2026-10-01', eventDateTo: '2026-10-28', cursor: 'cursor/+=', limit: '20' });
    assert.equal(result.nextCursor, 'next/+='); assert.equal(result.items[0].memoryId, '101');
    assert.equal(calls[0].credentials, 'same-origin');
    await api.fetchRelationships(); assert.equal(calls.at(-1).url, `${api.BRIDGE_PREFIX}/api/v1/relationships`);
});

test('纠正/遗忘使用现有请求边界：summary、expectedVersion、双 CSRF、会话快照', async () => {
    await api.captureSessionContext();
    await api.correctMemory('101', { summary: '改为早上散步', expectedVersion: 2 });
    assert.equal(calls.at(-1).method, 'PATCH');
    assert.deepEqual(JSON.parse(calls.at(-1).body), { summary: '改为早上散步', expectedVersion: 2 });
    await api.forgetMemory('101');
    for (const call of calls.slice(1)) {
        assert.equal(call.headers['X-CSRF-Token'], 'st-token');
        assert.equal(call.headers['X-VC-CSRF-Token'], 'go-token');
        assert.equal(call.headers['X-VC-Expected-Account-ID'], '9007199254740993');
        assert.equal(call.headers['X-VC-Expected-Session-ID'], '42');
    }
    assert.equal(calls.at(-1).method, 'DELETE');
});

test('409 保留输入；显式刷新后才能基于最新版本重新保存', async () => {
    const page = await opened(); await page.select('101'); page.edit(); page.setDraft('我的纠正草稿');
    const base = route;
    route = (url, init) => init.method === 'PATCH' ? { status: 409, body: { code: 'MEMORY_VERSION_CONFLICT', details: { current: item({ version: 3 }) } } } : base(url, init);
    await page.save();
    assert.equal(page.state.draft, '我的纠正草稿'); assert.equal(page.state.conflict, true);
    assert.match(renderMemoryPage(page.state), /输入已保留/);
    const writes = calls.filter(c => c.method === 'PATCH').length; await page.save();
    assert.equal(calls.filter(c => c.method === 'PATCH').length, writes);
    route = (url, init) => url.endsWith('/memories/101') ? { body: item({ version: 3 }) } : base(url, init);
    await page.refreshDetail(); assert.equal(page.state.draft, '我的纠正草稿'); assert.equal(page.state.detail.version, 3); assert.equal(page.state.conflict, false);
    page.close();
});

test('纠正成功选择新记录，旧记录标为被替代', async () => {
    const page = await opened(); await page.select('101'); page.edit(); page.setDraft('早上散步');
    const base = route;
    route = (url, init) => init.method === 'PATCH' ? { body: item({ memoryId: '102', version: 3, summary: '早上散步', supersedesId: '101' }) } : url.includes('/relationships/11/memories') ? { body: [item({ lifecycle: 'SUPERSEDED' }), item({ memoryId: '102', version: 3 })] } : base(url, init);
    await page.save();
    assert.equal(page.state.detail.memoryId, '102'); assert.equal(page.state.editing, false);
    assert.equal(page.state.items.find(x => x.memoryId === '101').lifecycle, 'SUPERSEDED');
    page.close();
});

test('DELETE 202 立即不可召回，轮询到 PARTIAL 如实报告并停止', async () => {
    const queue = []; const page = await opened({ schedule: (fn) => { queue.push(fn); return queue.length; }, cancel: () => {} });
    await page.select('101'); const base = route;
    route = (url, init) => init.method === 'DELETE' ? { status: 202, body: { cleanup: { state: 'PENDING' } } }
        : url.endsWith('/memories/101') ? { body: item({ lifecycle: 'FORGOTTEN', recallEligible: false, cleanup: { state: 'PARTIAL', detail: '画像仍待清理' } }) } : base(url, init);
    await page.forget();
    assert.equal(page.state.detail.recallEligible, false); assert.equal(page.state.detail.lifecycle, 'FORGETTING');
    assert.match(renderMemoryPage(page.state), /清理中/); assert.equal(queue.length, 1);
    await queue.shift()();
    const html = renderMemoryPage(page.state);
    assert.match(html, /部分完成/); assert.match(html, /画像仍待清理/); assert.doesNotMatch(html, /已彻底删除/); assert.equal(queue.length, 0);
    page.close();
});

test('已在清理中的详情继续轮询；关闭后迟到响应不更新页面', async () => {
    const queue = []; const page = await opened({ schedule: fn => { queue.push(fn); return 1; }, cancel: () => {} });
    const base = route; route = (url, init) => url.endsWith('/memories/101') ? { body: item({ lifecycle: 'FORGETTING', cleanup: { state: 'PENDING' } }) } : base(url, init);
    await page.select('101'); assert.equal(queue.length, 1);
    page.close(); const count = calls.length; await queue[0](); assert.equal(calls.length, count);
});

test('各生命周期、核验状态、空结果和加载失败，内容转义', async () => {
    const page = await opened(); await page.select('101');
    for (const [lifecycle, label] of [['ACTIVE', '生效中'], ['SUPERSEDED', '已被替代'], ['FORGETTING', '清理中'], ['FORGOTTEN', '已遗忘']]) {
        page.state.detail = item({ lifecycle }); assert.match(renderMemoryPage(page.state), new RegExp(label));
    }
    for (const [sourceStatus, label] of [['PENDING_VERIFICATION', '来源待核验'], ['INVALID', '来源已失效']]) {
        page.state.detail = item({ sourceStatus, summary: '<img onerror=alert(1)>' });
        const html = renderMemoryPage(page.state); assert.match(html, new RegExp(label)); assert.doesNotMatch(html, /<img/);
    }
    page.state.items = []; assert.match(renderMemoryPage(page.state), /没有找到记忆/);
    route = () => { throw new Error('offline'); }; await page.loadList(); assert.match(renderMemoryPage(page.state), /加载失败/);
    page.close();
});

test('详情呈现来源、发生时间、记录时间、范围、修订历史和准确删除文案', async () => {
    const page = await opened(); await page.select('101');
    page.state.detail.history = [{ memoryId: '100', version: 1, summary: '以前的内容', lifecycle: 'SUPERSEDED', time: { recordedAt: '2026-10-27T01:00:00Z' } }];
    const html = renderMemoryPage(page.state);
    for (const text of ['发生日期', '记录时间', '湖边散步', '修订 1', '以前的内容', '仅此角色实例', '日常']) assert.ok(html.includes(text), text);
    assert.equal(FORGET_NOTICE, '聊天原文仍保留，可能继续用于当前对话。');
    assert.ok(html.includes(FORGET_NOTICE)); assert.doesNotMatch(html, /彻底忘记|永远不再看到/);
    page.close();
});

test('桌面分栏与手机列表/详情切换结构；菜单为独立入口', async () => {
    const page = await opened(); assert.match(renderMemoryPage(page.state), /data-view="list"/);
    await page.select('101'); assert.match(renderMemoryPage(page.state), /data-view="detail"/);
    assert.match(renderMemoryPage(page.state), /data-action="back"/); page.back(); assert.match(renderMemoryPage(page.state), /data-view="list"/);
    const css = await readFile(new URL('../extension/vc-model-settings/style.css', import.meta.url), 'utf8');
    assert.match(css, /grid-template-columns: minmax\(280px, 0\.9fr\) minmax\(0, 1\.1fr\)/);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /\[data-view="detail"\] \.vc-memory-list-pane\s*\{\s*display: none/);
    assert.match(css, /\[data-view="list"\] \.vc-memory-detail\s*\{\s*display: none/);
    const entry = await readFile(new URL('../extension/vc-model-settings/index.js', import.meta.url), 'utf8');
    assert.match(entry, /mountMemoryPage/); assert.match(entry, /vc_memory_menu_button/);
    page.close();
});

test('翻页追加、筛选重置游标、实例切换隔离；空游标不再请求', async () => {
    const page = await opened(); const base = route;
    route = (url, init) => url.includes('/relationships/11/memories') ? (url.includes('cursor=') ? { body: [item({ memoryId: '102' })] } : { body: [item()], headers: { 'X-Next-Cursor': 'page2' } }) : base(url, init);
    await page.loadList(); await page.more(); assert.equal(page.state.items.length, 2); assert.ok(calls.at(-1).url.includes('cursor=page2'));
    const count = calls.length; await page.more(); assert.equal(calls.length, count);
    await page.filter({ q: '散步' }); assert.ok(!calls.at(-1).url.includes('cursor='));
    await page.changeRelationship('12'); assert.equal(page.state.detail, null); assert.ok(calls.at(-1).url.includes('/relationships/12/memories'));
    page.close();
});

test('写入 403 进入再认证，成功后重试原操作', async () => {
    const page = await opened(); await page.select('101'); page.edit(); page.setDraft('早上散步');
    const base = route; let verified = false;
    route = (url, init) => url.endsWith('/auth/reauth') ? (verified = true, { body: { ok: true } })
        : init.method === 'PATCH' && !verified ? { status: 403, body: { code: 'REAUTH_REQUIRED' } } : base(url, init);
    await page.save(); assert.equal(page.state.reauthAction, 'save'); assert.equal(page.state.draft, '早上散步');
    await page.authenticate('test-password'); assert.equal(page.state.reauthAction, null); assert.equal(calls.filter(c => c.method === 'PATCH').length, 2);
    page.close();
});

test('详情失败可重试，来源失败不遮蔽内容；手机编辑时不能退入锁住的列表', async () => {
    const page = await opened(); const base = route;
    route = (url, init) => url.endsWith('/memories/101') ? { status: 503, body: {} } : base(url, init);
    await page.select('101'); assert.match(renderMemoryPage(page.state), /重试详情/);
    route = (url, init) => url.endsWith('/evidence') ? { status: 503, body: {} } : base(url, init);
    await page.refreshDetail(); assert.equal(page.state.detail.memoryId, '101'); assert.match(renderMemoryPage(page.state), /来源加载失败/);
    page.edit(); page.back(); assert.equal(page.state.view, 'detail');
    page.cancelEdit(); page.back(); assert.equal(page.state.view, 'list'); page.close();
});

test('切换实例后忽略旧列表与旧详情的迟到响应', async () => {
    const page = await opened(); const base = route; let resolveOld;
    route = (url, init) => url.endsWith('/memories/101') ? new Promise(resolve => { resolveOld = resolve; }) : base(url, init);
    const pending = page.select('101'); await page.changeRelationship('12');
    resolveOld({ body: item() }); await pending;
    assert.equal(page.state.detail, null); assert.equal(page.state.relationshipId, '12');
    let resolveList;
    route = (url, init) => url.includes('/relationships/12/memories') ? new Promise(resolve => { resolveList = resolve; }) : base(url, init);
    const oldList = page.loadList(); await page.changeRelationship('11');
    resolveList({ body: [item({ memoryId: 'wrong-instance' })] }); await oldList;
    assert.equal(page.state.items[0].memoryId, '101'); page.close();
});

test('清理轮询失败保留未完成状态；刷新可到 DONE 并停止', async () => {
    const queue = []; const page = await opened({ schedule: fn => { queue.push(fn); return 1; }, cancel: () => {} });
    const base = route;
    route = (url, init) => url.endsWith('/memories/101') ? { body: item({ lifecycle: 'FORGETTING', recallEligible: false, cleanup: { state: 'PENDING' } }) } : base(url, init);
    await page.select('101');
    route = () => ({ status: 503, body: {} }); await queue.shift()();
    assert.equal(page.state.detail.cleanup.state, 'PENDING'); assert.match(renderMemoryPage(page.state), /清理状态更新失败/);
    route = (url, init) => url.endsWith('/memories/101') ? { body: item({ lifecycle: 'FORGOTTEN', recallEligible: false, cleanup: { state: 'DONE' } }) } : base(url, init);
    await page.refreshDetail(); assert.equal(queue.length, 0); assert.match(renderMemoryPage(page.state), /本次记忆清理已完成/); page.close();
});

test('后台刷新不覆盖尚未提交的搜索/日期输入，应用前不发查询', async () => {
    const page = await opened(); const count = calls.length;
    page.setFilterDraft('q', '未提交的关键词'); page.setFilterDraft('eventDateFrom', '2026-10-01');
    assert.equal(calls.length, count); assert.equal(page.state.filters.q, undefined);
    await page.select('101');
    const html = renderMemoryPage(page.state); assert.match(html, /value="未提交的关键词"/); assert.match(html, /value="2026-10-01"/);
    page.close();
});
