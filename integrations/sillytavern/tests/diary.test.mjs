import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../extension/vc-model-settings/api.js';
import {
    DIARY_FONT_KEY,
    createDiaryPage,
    diaryDayTitle,
    ensureHandwriting,
    monthDays,
    monthLabel,
    readDiaryFont,
    renderDiary,
    shiftMonth,
    writeDiaryFont,
} from '../extension/vc-model-settings/diary-page.js';

const realFetch = globalThis.fetch;
const realDocument = globalThis.document;
let calls;
const entry = (day, extra = {}) => ({ entryId: `e${day}`, relationshipId: '11', day, body: `这一天（${day}）的日记`, vibe: '开心', moments: ['看展计划', '晚霞'], createdAt: `${day}T22:00:00+08:00`, ...extra });
test.beforeEach(() => {
    calls = [];
    globalThis.document = { cookie: 'vc_csrf=go-token' };
    api.setStHeadersProvider(() => ({}));
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        const month = new URL(url, 'http://x').searchParams.get('month');
        const items = month === '2026-11' ? [entry('2026-11-01'), entry('2026-11-02')] : month === '2026-10' ? [entry('2026-10-30')] : [];
        return new Response(JSON.stringify({ month, items }), { status: 200 });
    };
});
test.after(() => { globalThis.fetch = realFetch; globalThis.document = realDocument; });

test('月份与日期的纯函数', () => {
    assert.equal(monthDays('2026-02').length, 28);
    assert.equal(monthDays('2026-11').at(-1), '2026-11-30');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(monthLabel('2026-11'), '11月');
    assert.equal(diaryDayTitle('2026-11-02'), '11月2日 周一');
});

test('字体偏好存本机，存储不可用时回落正文', () => {
    const data = new Map();
    const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
    assert.equal(readDiaryFont(storage), 'body');
    assert.equal(writeDiaryFont('hand', storage), 'hand');
    assert.equal(data.get(DIARY_FONT_KEY), 'hand');
    assert.equal(readDiaryFont(storage), 'hand');
    assert.equal(writeDiaryFont('其他', storage), 'body');
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(readDiaryFont(broken), 'body');
    assert.equal(writeDiaryFont('hand', broken), 'hand');
});

test('手写样式表只在需要时插入一次，且指向本地自托管字体', () => {
    const appended = [];
    const doc = {
        head: { append: (node) => appended.push(node) },
        createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
        querySelector: () => (appended.length ? appended[0] : null),
    };
    ensureHandwriting(doc);
    ensureHandwriting(doc);
    assert.equal(appended.length, 1);
    assert.match(appended[0].href, /\/fonts\/lxgw-wenkai\/lxgwwenkai-regular\.css$/);
    assert.doesNotMatch(appended[0].href, /^https?:\/\/(?!localhost)/);
});

test('渲染：有日记的天带圆点，纸张含日期、心情、正文与瞬间标签，Aa 与字体类', () => {
    const state = { month: '2026-11', selectedDay: '2026-11-02', entries: { '2026-11-01': entry('2026-11-01'), '2026-11-02': entry('2026-11-02') }, loading: false, error: '' };
    const html = renderDiary(state, { font: 'hand' });
    assert.equal(html.match(/data-has="true"/g).length, 2);
    assert.match(html, /data-day="2026-11-02" aria-pressed="true"/);
    assert.match(html, /<h2>11月2日 周一<\/h2>/);
    assert.match(html, /vc-diary-vibe">开心</);
    assert.match(html, /vc-diary-paper is-hand/);
    assert.match(html, /<h3>今天的瞬间<\/h3>/);
    assert.match(html, />Aa</);
    assert.doesNotMatch(renderDiary(state, { font: 'body' }), /is-hand/);
});

test('没有日记时给简洁空态；读取失败给重试', () => {
    const empty = renderDiary({ month: '2026-12', selectedDay: '2026-12-01', entries: {}, loading: false, error: '' });
    assert.match(empty, /还没有日记/);
    assert.doesNotMatch(empty, /vc-diary-paper/);
    assert.match(renderDiary({ month: '2026-12', selectedDay: '2026-12-01', entries: {}, loading: false, error: '没有完成，请重试。' }), /role="alert"/);
});

test('控制器：当月有今天的日记就选今天；切月选该月最后一篇；无日记的月份保留空态', async () => {
    const page = createDiaryPage({ now: () => new Date(2026, 10, 2, 10) });
    await page.load('11');
    assert.equal(page.state.selectedDay, '2026-11-02');
    assert.ok(calls[0].includes('/relationships/11/diary?month=2026-11'));
    await page.shift(-1);
    assert.equal(page.state.month, '2026-10');
    assert.equal(page.state.selectedDay, '2026-10-30');
    await page.shift(-1);
    assert.equal(page.state.month, '2026-09');
    assert.deepEqual(page.state.entries, {});
    assert.equal(page.state.selectedDay, '2026-09-01');
});

test('控制器：读取失败只留一句错误，不抛出', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 500 });
    const page = createDiaryPage({ now: () => new Date(2026, 10, 2) });
    await page.load('11');
    assert.equal(page.state.error, '没有完成，请重试。');
    assert.equal(page.state.loading, false);
});
