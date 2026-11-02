import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../extension/vc-model-settings/api.js';
import {
    createFavoritesPage,
    glyph,
    monthDay,
    reminderWhen,
    renderFavorites,
} from '../extension/vc-model-settings/favorites-page.js';
import { COPY, REMIND_MAX, messageInstant, messageMenuPlan, quoteSummary, reminderChoices, rfc3339 } from '../extension/vc-model-settings/chat-compose.js';

const realFetch = globalThis.fetch;
const realDocument = globalThis.document;
let calls;
const favorite = (id, extra = {}) => ({ favoriteId: String(id), relationshipId: '11', chatFile: 'chat-a', mesId: id, role: 'character', messageAt: new Date(2026, 9, 20, 20).toISOString(), body: `收藏${id}`, createdAt: new Date(2026, 9, 21).toISOString(), ...extra });
const reminder = (id, at, text) => ({ reminderId: String(id), relationshipId: '11', text, remindAt: at.toISOString(), recurrence: 'NONE', status: 'ACTIVE', createdAt: new Date(2026, 10, 2).toISOString() });
test.beforeEach(() => {
    calls = [];
    globalThis.document = { cookie: 'vc_csrf=go-token' };
    api.setStHeadersProvider(() => ({}));
    globalThis.fetch = async (url, init = {}) => {
        const path = String(url);
        calls.push({ path, method: init.method || 'GET', body: init.body });
        if (path.endsWith('/auth/session')) return new Response(JSON.stringify({ accountId: '1', sessionId: '2' }), { status: 200 });
        if (path.includes('/favorites?')) return new Response(JSON.stringify({ items: [favorite(1), favorite(2)], nextCursor: 'c2' }), { status: 200 });
        if (path.endsWith('/reminders')) return new Response(JSON.stringify([reminder(7, new Date(2026, 10, 2, 21), '看晚霞')]), { status: 200 });
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    };
});
test.after(() => { globalThis.fetch = realFetch; globalThis.document = realDocument; });

test('提醒时间：今晚 / 今天 / 明天 / M月D日', () => {
    const now = new Date(2026, 10, 2, 10, 0);
    assert.equal(reminderWhen(new Date(2026, 10, 2, 21).toISOString(), now), '今晚 21:00');
    assert.equal(reminderWhen(new Date(2026, 10, 2, 14, 5).toISOString(), now), '今天 14:05');
    assert.equal(reminderWhen(new Date(2026, 10, 3, 8).toISOString(), now), '明天 08:00');
    assert.equal(reminderWhen(new Date(2026, 10, 9, 8).toISOString(), now), '11月9日 08:00');
    assert.equal(monthDay(new Date(2026, 9, 20).toISOString()), '10月20日');
});

test('收藏卡片墙：正文、角色名 · 日期、回到对话；右侧即将提醒可取消', () => {
    const now = new Date(2026, 10, 2, 10);
    const state = { segment: 'favorites', favorites: [favorite(1), favorite(2)], nextCursor: '', reminders: [reminder(7, new Date(2026, 10, 2, 21), '看晚霞')], loading: false, error: '' };
    const html = renderFavorites(state, { names: { 11: '小满' }, now });
    assert.match(html, /aria-pressed="true">收藏</);
    assert.match(html, /aria-pressed="false">提醒</);
    assert.equal(html.match(/class="vc-fav-card"/g).length, 2);
    assert.match(html, /小满 · 10月20日/);
    assert.match(html, /data-action="open-favorite" data-favorite-id="1">回到对话/);
    assert.match(html, /aria-label="即将提醒"><h2>即将提醒<\/h2>/);
    assert.match(html, /今晚 21:00[\s\S]*看晚霞/);
    assert.match(html, /data-action="cancel-reminder" data-reminder-id="7"/);
});

test('提醒分段列出全部提醒；没有收藏 / 没有提醒时给一句空态', () => {
    const base = { segment: 'favorites', favorites: [], nextCursor: '', reminders: [], loading: false, error: '' };
    assert.match(renderFavorites(base), /还没有收藏/);
    assert.doesNotMatch(renderFavorites(base), /即将提醒/);
    assert.match(renderFavorites({ ...base, segment: 'reminders' }), /还没有提醒/);
    assert.match(renderFavorites({ ...base, segment: 'reminders', reminders: [reminder(1, new Date(2026, 10, 3, 8), '带围巾')] }, { now: new Date(2026, 10, 2) }), /明天 08:00/);
});

test('控制器：加载收藏与提醒，分页、取消收藏、取消提醒', async () => {
    await api.captureSessionContext();
    const page = createFavoritesPage();
    await page.load('11');
    assert.equal(page.state.favorites.length, 2);
    assert.equal(page.state.nextCursor, 'c2');
    assert.equal(page.state.reminders.length, 1);
    await page.more();
    assert.ok(calls.some((c) => c.path.includes('after=c2')));
    await page.removeFavorite('1');
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/favorites/1')));
    assert.ok(!page.state.favorites.some((item) => item.favoriteId === '1'));
    await page.cancelReminder('7');
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/reminders/7')));
    assert.equal(page.state.reminders.length, 0);
});

test('控制器：读取失败只留一句错误', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 500 });
    const page = createFavoritesPage();
    await page.load('11');
    assert.equal(page.state.error, '没有完成，请重试。');
});

test('右键菜单：已绑定的非系统消息出现「收藏」「稍后提醒」，其余计划不变', () => {
    assert.deepEqual(messageMenuPlan({ character: true, bound: true }), ['quote', 'copy', 'favorite', 'remind', '-', 'edit', '-', 'remove']);
    assert.deepEqual(messageMenuPlan({ character: true, last: true, voice: true, bound: true }),
        ['quote', 'copy', 'read', 'favorite', 'remind', '-', 'edit', 'regenerate', '-', 'remove']);
    assert.deepEqual(messageMenuPlan({ system: true, bound: true }), ['copy', '-', 'edit', '-', 'remove']);
    assert.deepEqual(messageMenuPlan({ character: true }), ['quote', 'copy', '-', 'edit', '-', 'remove']);
    for (const text of ['收藏', '稍后提醒', '已收藏', '好，到时候提醒你', '20 分钟后', '今晚 21:00', '明天早上', '选择时间…']) {
        assert.ok(Object.values(COPY).includes(text), text);
    }
});

test('稍后提醒的时间选项：今晚 21:00 已过则明天 21:00，明天早上 08:00', () => {
    const morning = reminderChoices(new Date(2026, 10, 2, 10, 0));
    assert.deepEqual(morning.map((c) => c.id), ['in20', 'tonight', 'tomorrow']);
    assert.equal(morning[0].at.getTime(), new Date(2026, 10, 2, 10, 20).getTime());
    assert.equal(morning[1].at.getTime(), new Date(2026, 10, 2, 21, 0).getTime());
    assert.equal(morning[2].at.getTime(), new Date(2026, 10, 3, 8, 0).getTime());
    const late = reminderChoices(new Date(2026, 10, 2, 22, 0));
    assert.equal(late[1].at.getTime(), new Date(2026, 10, 3, 21, 0).getTime());
    assert.equal(reminderChoices(new Date(2026, 10, 2, 21, 0))[1].at.getTime(), new Date(2026, 10, 3, 21, 0).getTime());
});

test('提醒时间带本地时区偏移的 RFC3339，消息摘要不超过 30 字', () => {
    const date = new Date(2026, 10, 2, 21, 0, 0);
    const text = rfc3339(date);
    assert.match(text, /^2026-11-02T21:00:00[+-]\d\d:\d\d$/);
    assert.equal(new Date(text).getTime(), date.getTime());
    assert.equal(REMIND_MAX, 30);
    assert.equal([...quoteSummary('甲'.repeat(50), REMIND_MAX)].length, 31);
    assert.equal(messageInstant(''), undefined);
    assert.equal(messageInstant('不是时间'), undefined);
    assert.equal(messageInstant(new Date(2026, 10, 2).getTime()), new Date(2026, 10, 2).toISOString());
});

test('内联图标补齐精灵图里没有的几枚', () => {
    for (const name of ['pin', 'star', 'clock', 'circle-check', 'ban']) assert.match(glyph(name, 18), /<svg class="vc-icon"[^>]*><(path|circle)/);
});
