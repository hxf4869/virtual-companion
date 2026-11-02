import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ATTACH_PX, LAND_OFFSET, anchorDelta, badgeText, centerTop, landingTop, latestLabel, latestVisible,
    mountChatScroll, nextFollow, nextRead, scrollDuration, shouldLand, unreadInfo,
} from '../extension/vc-model-settings/chat-scroll.js';
import { installMiniDom } from './mini-dom.mjs';

test('跟随 / 脱离：只有用户输入改状态', () => {
    assert.equal(nextFollow('follow', { type: 'user-scroll', up: true, gap: 10 }), 'detached');
    assert.equal(nextFollow('detached', { type: 'user-scroll', up: false, gap: 200 }), 'detached');
    assert.equal(nextFollow('detached', { type: 'user-scroll', up: false, gap: ATTACH_PX }), 'follow');
    assert.equal(nextFollow('detached', { type: 'send' }), 'follow');
    assert.equal(nextFollow('detached', { type: 'grow' }), 'detached');
    assert.equal(nextFollow('follow', { type: 'grow' }), 'follow');
});

test('回到最新：离底 > 300 出现，计数 99+', () => {
    assert.equal(latestVisible(300), false);
    assert.equal(latestVisible(301), true);
    assert.equal(badgeText(0), '');
    assert.equal(badgeText(7), '7');
    assert.equal(badgeText(99), '99');
    assert.equal(badgeText(100), '99+');
    assert.equal(latestLabel(0), '回到最新');
    assert.equal(latestLabel(3), '回到最新，3 条新消息');
});

test('长回复落地：首行停在视口顶部下 24px，短回复不落地', () => {
    assert.equal(landingTop({ chatTop: 100, mesTop: 700, scrollTop: 1000, offset: LAND_OFFSET }), 1576);
    assert.equal(landingTop({ chatTop: 100, mesTop: 110, scrollTop: 0 }), 0);
    assert.equal(shouldLand({ following: true, mesHeight: 900, viewHeight: 600 }), true);
    assert.equal(shouldLand({ following: true, mesHeight: 300, viewHeight: 600 }), false);
    assert.equal(shouldLand({ following: false, mesHeight: 900, viewHeight: 600 }), false);
});

test('跳转：居中并夹在可滚范围，时长 250–600ms 随距离', () => {
    assert.equal(centerTop({ chatTop: 0, mesTop: 1000, mesHeight: 100, viewHeight: 500, scrollTop: 0, max: 5000 }), 800);
    assert.equal(centerTop({ chatTop: 0, mesTop: 10, mesHeight: 100, viewHeight: 500, scrollTop: 0, max: 5000 }), 0);
    assert.equal(centerTop({ chatTop: 0, mesTop: 9000, mesHeight: 100, viewHeight: 500, scrollTop: 0, max: 5000 }), 5000);
    assert.equal(scrollDuration(0), 250);
    assert.equal(scrollDuration(400), 350);
    assert.equal(scrollDuration(99999), 600);
});

test('已读只前进；未读从第一条未读角色消息起算', () => {
    assert.equal(nextRead(null, 5), 5);
    assert.equal(nextRead(5, 3), 5);
    assert.equal(nextRead(5, 8), 8);
    assert.equal(nextRead(5, null), 5);
    const rows = [
        { id: 3, user: false, system: false },
        { id: 4, user: true, system: false },
        { id: 5, user: false, system: true },
        { id: 6, user: false, system: false },
        { id: 7, user: false, system: false },
    ];
    assert.deepEqual(unreadInfo(3, rows), { first: 6, count: 2 });
    assert.deepEqual(unreadInfo(7, rows), { first: null, count: 0 });
    assert.deepEqual(unreadInfo(null, rows), { first: null, count: 0 });
});

test('向上加载历史：锚点位移就是 scrollTop 补偿量', () => {
    assert.equal(anchorDelta(40, 1240), 1200);
    assert.equal(anchorDelta(40, 40), 0);
});

test('列表背后的聊天不恢复位置，展开对话列后才按实际尺寸恢复', t => {
    const doc = installMiniDom(); doc.addEventListener = () => {};
    const shell = doc.createElement('div'); shell.id = 'vc-shell'; shell.dataset.chat = 'closed';
    shell.dataset.destination = 'chat'; doc.body.append(shell);
    const chat = doc.createElement('div'); shell.append(chat); chat.parentElement = shell;
    chat.scrollTop = 0; chat.clientHeight = 80; chat.scrollHeight = 5600;
    chat.getBoundingClientRect = () => ({ top: 0, bottom: chat.clientHeight });
    let rowHeight = 560;
    for (let id = 0; id < 10; id++) {
        const row = doc.createElement('div'); row.className = 'mes'; row.setAttribute('mesid', id);
        row.getBoundingClientRect = () => ({ top: id * rowHeight - chat.scrollTop, bottom: (id + 1) * rowHeight - chat.scrollTop, height: rowHeight });
        chat.append(row);
    }
    const frames = [], values = new Map([['vc-read:qa-chat', '9'], ['vc-pos:qa-chat', '3']]);
    const previous = { raf: globalThis.requestAnimationFrame, storage: globalThis.localStorage };
    globalThis.requestAnimationFrame = fn => frames.push(fn);
    globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
    t.mock.method(globalThis, 'setTimeout', () => 0);
    t.after(() => { globalThis.requestAnimationFrame = previous.raf; globalThis.localStorage = previous.storage; });
    const flush = () => { for (let i = 0; frames.length && i < 40; i++) frames.shift()(); };
    let desktop = true;
    const api = mountChatScroll({ chat, doc, hooks: { isDesktop: () => desktop, getChatId: () => 'qa-chat', attach() {}, detach() {}, dateLabel: () => '' } });
    flush();
    assert.equal(chat.scrollTop, 0, '隐藏列的临时窄尺寸不能用于恢复');
    shell.dataset.chat = 'open'; rowHeight = 100; chat.clientHeight = 400; chat.scrollHeight = 1000;
    api.openChat(); flush();
    assert.equal(chat.scrollTop, 276, '第三条消息应停在展开后的视口顶部下 24px');
    assert.equal(values.get('vc-pos:qa-chat'), '3');
    assert.equal(doc.querySelector('#vc-latest').hidden, false);
    desktop = false; api.refresh();
    assert.equal(doc.querySelector('#vc-latest').hidden, true);
    assert.equal(doc.querySelector('#vc-date-chip').hidden, true, '桌面浮动日期不能残留成手机页底部文字');
    desktop = true; api.refresh();
    assert.equal(doc.querySelector('#vc-latest').hidden, false);
    assert.equal(doc.querySelector('#vc-date-chip').hidden, false);
});
