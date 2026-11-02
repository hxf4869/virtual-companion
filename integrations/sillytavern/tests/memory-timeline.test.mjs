import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MEMORY_SECTIONS,
    SECTION_STATUS,
    clockOf,
    dayGroupLabel,
    dayKeyOf,
    excerptOf,
    groupTimeline,
    parseSourceRef,
    pickSource,
    renderDesktopMemory,
} from '../extension/vc-model-settings/memory-page.js';

const now = new Date(2026, 10, 2, 16, 0);
const at = (offset, hour, minute = 0) => new Date(2026, 10, 2 + offset, hour, minute).toISOString();
const memory = (id, extra = {}) => ({
    memoryId: String(id), relationshipId: '11', mode: 'DAILY', summary: `记忆${id}`, lifecycle: 'ACTIVE', sourceStatus: 'VALID',
    type: 'FACT', version: 1, recallEligible: true, time: { eventDate: '2026-10-28' }, createdAt: at(0, 15, 42), pinnedAt: null, ...extra,
});
const state = (items, extra = {}) => ({
    open: true, relationships: [{ relationshipId: '11', personaRef: 'st-character', companionName: '小满' }], relationshipId: '11', filters: {}, filterDraft: {},
    items, nextCursor: null, loading: false, busy: false, editing: false, draft: '', detail: null, listError: '', ...extra,
});

test('日期分组标签：今天 / 昨天 / M月D日，跨年带年份，未知日期单列', () => {
    assert.equal(dayGroupLabel('2026-11-02', now), '今天');
    assert.equal(dayGroupLabel('2026-11-01', now), '昨天');
    assert.equal(dayGroupLabel('2026-10-28', now), '10月28日');
    assert.equal(dayGroupLabel('2025-12-31', now), '2025年12月31日');
    assert.equal(dayGroupLabel('', now), '日期未知');
    assert.equal(dayKeyOf('2026-10-28'), '2026-10-28');
    assert.equal(dayKeyOf(at(0, 0, 36)), '2026-11-02');
    assert.equal(clockOf(at(0, 9, 5)), '09:05');
    assert.equal(clockOf('2026-10-28'), '');
});

test('时间线按本地日期分组并保持接口顺序', () => {
    const groups = groupTimeline([
        memory(1, { createdAt: at(0, 15, 42) }), memory(2, { createdAt: at(0, 12, 18) }),
        memory(3, { createdAt: at(-1, 22, 14) }), memory(4, { createdAt: at(-5, 20, 11) }),
    ], now);
    assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.memoryId)]), [['今天', ['1', '2']], ['昨天', ['3']], ['10月28日', ['4']]]);
});

test('来源一句：优先已核验且有摘录的证据，解析聊天标识与消息序号', () => {
    assert.deepEqual(parseSourceRef('st:chat-7:23:cand:2:1'), { chatIdentity: 'chat-7', messageId: '23', mesId: 23 });
    assert.equal(parseSourceRef('st:chat-7:abc:cand:2:1').mesId, null);
    assert.equal(parseSourceRef('st:chat-7:abc:cand:2:1').messageId, 'abc');
    assert.equal(parseSourceRef('other'), null);
    const picked = pickSource([
        { status: 'PENDING_VERIFICATION', excerpt: '待核验的', sourceRef: 'st:c:1:x:1:1', sourceTimestamp: at(0, 9) },
        { status: 'VALID', excerpt: '刚才开会的时候突然想起你', sourceRef: 'st:chat-7:23:x:1:1', sourceTimestamp: at(0, 15, 42), messageId: '23' },
    ], now);
    assert.deepEqual(picked, { line: '来自 今天 15:42：「刚才开会的时候突然想起你」', chatIdentity: 'chat-7', messageId: '23', mesId: 23 });
    assert.equal(pickSource([{ status: 'VALID', excerpt: '  ' }], now), null);
    assert.equal(pickSource([], now), null);
    assert.equal(excerptOf('甲'.repeat(40), 36), `${'甲'.repeat(36)}…`);
});

test('桌面渲染：左栏分区与计数、钉住卡、悬停操作、来源槽、新对话不记', () => {
    const items = [memory(1, { pinnedAt: at(0, 15, 43) }), memory(2, { createdAt: at(-1, 19, 3) }), memory(3, { lifecycle: 'FORGOTTEN', createdAt: at(-1, 8) })];
    const html = renderDesktopMemory(state(items, { nextCursor: '9' }), {
        section: 'timeline', now, sources: new Map([['1', { line: '来自 今天 15:42：「刚才」' }]]), incognito: true,
    });
    assert.deepEqual(MEMORY_SECTIONS.map(([key]) => key), ['timeline', 'pinned', 'pending', 'invalid']);
    for (const label of ['时间线', '已钉住', '待核验', '已失效', '日记', '收藏', '新对话不记']) assert.ok(html.includes(label), label);
    assert.match(html, /data-section="timeline" aria-pressed="true"[^>]*>[\s\S]*?<span class="vc-mem-count">3\+<\/span>/);
    assert.match(html, /data-section="diary" aria-pressed="false"/);
    assert.match(html, /<h2>今天<\/h2>/);
    assert.match(html, /<h2>昨天<\/h2>/);
    assert.equal(html.match(/class="vc-mem-pin"/g).length, 1);
    assert.match(html, /data-pinned="true"/);
    assert.match(html, /aria-label="取消钉住"/);
    assert.match(html, /aria-label="钉住"/);
    assert.match(html, /data-vc-incognito aria-label="新对话不记" aria-checked="true"/);
    assert.match(html, /<button type="button" class="vc-mem-source" data-action="open-source" data-mid="1" >来自 今天 15:42：「刚才」/);
    assert.match(html, /data-mid="2" hidden/);
    // 已遗忘的卡片不再提供「忘记」与「编辑」
    const forgotten = html.slice(html.indexOf('记忆3'));
    assert.doesNotMatch(forgotten, /data-action="forget-inline" data-mid="3"/);
    assert.doesNotMatch(forgotten, /data-action="edit-inline" data-mid="3"/);
});

test('已钉住分区只列钉住的记忆；时间线内联编辑带取消 / 保存', () => {
    const items = [memory(1, { pinnedAt: at(0, 15) }), memory(2)];
    const pinned = renderDesktopMemory(state(items), { section: 'pinned', now });
    assert.match(pinned, /记忆1/);
    assert.doesNotMatch(pinned, /记忆2/);
    const editing = renderDesktopMemory(state(items, { editing: true, draft: '改一下' }), { section: 'timeline', now, inlineId: '2' });
    assert.match(editing, /<textarea id="vc-memory-draft" name="summary"[^>]*>改一下<\/textarea>/);
    assert.match(editing, /data-action="cancel-inline"[^>]*>取消<[\s\S]*data-action="save-inline"[^>]*>保存</);
    assert.match(editing, /记忆1/);
});

test('空态与错误只给图标与一句话；有筛选条件才出现「清除筛选」', () => {
    const empty = renderDesktopMemory(state([]), { section: 'timeline', now });
    assert.match(empty, /没有找到记忆/);
    assert.doesNotMatch(empty, /清除筛选/);
    assert.match(renderDesktopMemory(state([], { filters: { q: '猫' } }), { section: 'timeline', now }), /清除筛选/);
    assert.match(renderDesktopMemory(state([], { listError: '加载失败' }), { section: 'timeline', now }), /role="alert">加载失败/);
});

test('分区与服务端状态筛选的对应', () => {
    assert.deepEqual(SECTION_STATUS, { timeline: '', pinned: 'ACTIVE', pending: 'PENDING_VERIFICATION', invalid: 'INVALID' });
});
