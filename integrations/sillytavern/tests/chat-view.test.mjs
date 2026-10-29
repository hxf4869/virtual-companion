import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { F2ConflictError, F2_CONFLICT_COPY, showF2Draft } from '../extension/vc-model-settings/f2-client.js';
import {
    PRESS_SLOP,
    NEAR_BOTTOM_PX,
    applyReplyStyle,
    armStreamFade,
    isNearBottom,
    shouldShowNewReply,
    markSpeakers,
    mountChatView,
    pressExceeded,
    readReplyStyle,
    recalledItems,
    writeReplyStyle,
} from '../extension/vc-model-settings/chat-view.js';
import { installMiniDom } from './mini-dom.mjs';

const CSS_PATH = new URL('../extension/vc-model-settings/chat-view.css', import.meta.url);

function memoryStore(initial = {}) {
    const data = { ...initial };
    return {
        getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
        setItem(key, value) { data[key] = String(value); },
    };
}

function mes(document, { user = false, system = false, name = '角色', text = '一句', swipes = '' } = {}) {
    const node = document.createElement('div');
    node.className = 'mes';
    node.setAttribute('is_user', user ? 'true' : 'false');
    node.setAttribute('is_system', system ? 'true' : 'false');
    node.setAttribute('ch_name', name);
    const body = document.createElement('div');
    body.className = 'mes_text';
    body.textContent = text;
    node.append(body);
    if (swipes) {
        const counter = document.createElement('div');
        counter.className = 'swipes-counter';
        counter.textContent = swipes;
        node.append(counter);
    }
    return node;
}

function stage(document, { ui = false } = {}) {
    if (ui) document.body.classList.add('vc-ui');
    const sheld = document.createElement('div');
    sheld.id = 'sheld';
    const chat = document.createElement('div');
    chat.id = 'chat';
    sheld.append(chat);
    const form = document.createElement('form');
    form.id = 'send_form';
    const box = document.createElement('textarea');
    box.id = 'send_textarea';
    const plus = document.createElement('div');
    plus.id = 'options_button';
    const send = document.createElement('div');
    send.id = 'send_but';
    const stop = document.createElement('div');
    stop.id = 'mes_stop';
    const options = document.createElement('div');
    options.id = 'options';
    const wand = document.createElement('div');
    wand.id = 'extensionsMenuButton';
    form.append(plus, box, send, stop);
    document.body.append(sheld, form, options, wand);
    return { sheld, chat, form, box, options, wand };
}

test('聊天样式只写在 body.vc-ui 下，且不限制角色卡 iframe', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.equal(/iframe|\.TH-render/.test(css), false);
    const comments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    let keyframe = false;
    let keyframeDepth = 0;
    for (const raw of comments.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (!keyframe && line.startsWith('@keyframes')) {
            keyframe = true;
            keyframeDepth = depth;
        }
        if (!keyframe && line.includes('{') && !line.startsWith('@') && !line.startsWith('from') && !line.startsWith('to') && !/^\d+%/.test(line)) {
            assert.equal(line.startsWith('body.vc-ui'), true, line);
        }
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        depth += opens - closes;
        if (keyframe && depth <= keyframeDepth) keyframe = false;
    }
});

test('回复样式读写本机偏好，气泡类只加在 body 上', () => {
    const document = installMiniDom();
    const store = memoryStore();
    assert.equal(readReplyStyle(store), 'spread');
    assert.equal(writeReplyStyle('bubble', store), 'bubble');
    assert.equal(store.getItem('vc-reply-style'), 'bubble');
    assert.equal(document.body.classList.contains('vc-reply-bubble'), true);
    writeReplyStyle('spread', store);
    assert.equal(document.body.classList.contains('vc-reply-bubble'), false);
    applyReplyStyle(document, 'bubble');
    assert.equal(document.body.classList.contains('vc-reply-bubble'), true);
});

test('跟随滚动以 80px 为界，长按超过 8px 取消', () => {
    assert.equal(NEAR_BOTTOM_PX, 80);
    assert.equal(PRESS_SLOP, 8);
    assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 }), true);
    assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 820, clientHeight: 100 }), true);
    assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 100 }), false);
    assert.equal(isNearBottom({ scrollHeight: 0 }), true);
    assert.equal(pressExceeded(0, 8), false);
    assert.equal(pressExceeded(0, 9), true);
    assert.equal(pressExceeded(6, 6), true);
    assert.equal(shouldShowNewReply({ nearBottom: true, grew: true, pending: true }), false);
    assert.equal(shouldShowNewReply({ nearBottom: false, grew: false, pending: false }), false);
    assert.equal(shouldShowNewReply({ nearBottom: false, grew: true }), true);
    assert.equal(shouldShowNewReply({ nearBottom: false, pending: true }), true);
});

test('发言人变化才露出名字，本次召回按摘要是否出现过滤', () => {
    assert.deepEqual(markSpeakers([
        { name: '甲' },
        { name: '甲' },
        { user: true, name: '我' },
        { name: '甲' },
        { system: true, name: '系统' },
        { name: '乙' },
    ]), [true, false, false, true, false, true]);
    const items = [{ summary: '雨夜' }, { summary: '未出现' }, { summary: '' }];
    assert.deepEqual(recalledItems(items, '前文 雨夜 后文').map((item) => item.summary), ['雨夜']);
    assert.deepEqual(recalledItems(items, '   '), []);
});

test('流式渐清只改内存开关，不派发 input', () => {
    const document = installMiniDom();
    const box = document.createElement('input');
    box.id = 'stream_fade_in';
    box.checked = false;
    let inputs = 0;
    box.addEventListener('input', () => { inputs += 1; });
    document.body.append(box);
    const power = { stream_fade_in: false };
    const first = armStreamFade(power, document);
    assert.equal(first.wrote, true);
    assert.equal(first.persisted, false);
    assert.equal(power.stream_fade_in, true);
    assert.equal(box.checked, true);
    assert.equal(inputs, 0);
    assert.equal(armStreamFade(power, document).already, true);
    assert.equal(armStreamFade(null, document).wrote, false);
});

test('关闭新外观时不挂海报、不改宿主节点', () => {
    const document = installMiniDom();
    const { chat, wand, options } = stage(document);
    const result = mountChatView({ getContext: () => ({ powerUserSettings: {} }) });
    assert.equal(result.enabled, false);
    assert.equal(document.querySelector('#vc-chat-poster'), null);
    assert.equal(document.querySelector('#vc-chat-view-css'), null);
    assert.equal(chat.children.length, 0);
    assert.equal(wand.parent, document.body);
    assert.equal(options.className.includes('vc-menu'), false);
});

test('开启新外观时海报不在 #chat 内，工具行保留宿主滑动计数', () => {
    const document = installMiniDom();
    const power = { stream_fade_in: false };
    const { sheld, chat, form, options, wand } = stage(document, { ui: true });
    chat.append(
        mes(document, { name: '甲', swipes: '1\u200b/\u200b2' }),
        mes(document, { name: '甲', text: '接着' }),
        mes(document, { user: true, name: '我', text: '问' }),
    );
    const result = mountChatView({
        getContext() {
            return { powerUserSettings: power, characters: [], chatMetadata: { vc_binding: { displayName: '实例' } } };
        },
    });
    assert.equal(result.enabled, true);
    const poster = document.querySelector('#vc-chat-poster');
    assert.ok(poster);
    assert.equal(poster.parent, sheld);
    assert.equal(chat.children.includes(poster), false);
    assert.equal(document.querySelector('#vc-chat-view-css').getAttribute('rel'), 'stylesheet');
    assert.equal(document.body.getAttribute('data-vc-chat-view'), 'on');
    assert.equal(power.stream_fade_in, true);
    assert.equal(form.className.includes('vc-send-idle'), true);
    assert.equal(options.className.includes('vc-menu'), true);
    assert.equal(wand.parent, options);
    const rows = chat.children.filter((node) => node.className.split(/\s+/).includes('mes'));
    assert.equal(rows[0].className.includes('vc-speaker'), true);
    assert.equal(rows[0].className.includes('vc-tools-pin'), false);
    assert.equal(rows[1].className.includes('vc-speaker'), false);
    assert.equal(rows[1].className.includes('vc-tools-pin'), true);
    assert.ok(rows[1].querySelector('[data-vc-act="regen"]'));
    assert.equal(rows[0].querySelector('.vc-num').textContent, '1/2');
    assert.equal(rows[2].querySelector('[data-vc-act="regen"]'), null);
    assert.ok(rows[2].querySelector('[data-vc-act="copy"]'));
    assert.equal(document.querySelector('#vc-poster-avatar') != null, true);
    assert.equal(mountChatView().enabled, true);
    assert.equal(document.querySelectorAll('#vc-chat-poster').length, 1);
});

test('冲突面板在新外观下收成上下两段，关闭时保持原按钮行', () => {
    const payload = JSON.stringify({ mes: 'DRAFT_MARKER_91', token: 'should-not-render' });
    const off = installMiniDom();
    showF2Draft(payload, new F2ConflictError('VC_STALE_SOURCE'));
    assert.equal(off.body.textContent.includes('我的草稿'), false);
    assert.equal(off.querySelector('#vc-f2-conflict').className.includes('vc-sheet'), false);
    assert.match(off.querySelector('#vc-f2-conflict').innerHTML, new RegExp(F2_CONFLICT_COPY));

    const document = installMiniDom();
    document.body.classList.add('vc-ui');
    showF2Draft(payload, new F2ConflictError('VC_STALE_SOURCE'));
    const panel = document.querySelector('#vc-f2-conflict');
    assert.equal(panel.className.includes('vc-sheet'), true);
    assert.match(panel.textContent, /我的草稿/);
    assert.match(panel.textContent, /最新版本/);
    assert.ok(panel.querySelector('[data-action="view-latest"]'));
    assert.ok(panel.querySelector('[data-action="keep-draft"]'));
    assert.ok(panel.querySelector('[data-action="copy-input"]'));
    assert.equal(panel.querySelector('textarea'), null);
    assert.equal(panel.innerHTML.includes('DRAFT_MARKER_91'), false);
    assert.equal(panel.innerHTML.includes('should-not-render'), false);
    const draft = panel.querySelector('[data-vc-draft]');
    const latest = panel.querySelector('[data-vc-latest]');
    assert.ok(draft.querySelector('[data-action="keep-draft"]'));
    assert.ok(latest.querySelector('[data-action="view-latest"]'));
});
