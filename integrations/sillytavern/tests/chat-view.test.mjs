import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { F2ConflictError, F2_CONFLICT_COPY, showF2Draft } from '../extension/vc-model-settings/f2-client.js';
import {
    PRESS_SLOP,
    NEAR_BOTTOM_PX,
    applyReplyStyle,
    armStreamFade,
    clockText,
    commitHostDelete,
    gapLabel,
    parseSendDate,
    planMessageMarks,
    inspectorOverlayRoot,
    isNearBottom,
    keepsTail,
    markSpeakers,
    mountChatView,
    isDirectChat,
    syncDirectChat,
    pressExceeded,
    readReplyStyle,
    recalledItems,
    refreshIndexes,
    renderReplyBubbles,
    safeAvatarUrl,
    shouldShowNewReply,
    writeReplyStyle,
} from '../extension/vc-model-settings/chat-view.js';
import { CHAT_PICK_COPY } from '../extension/vc-model-settings/chat-shell.js';
import { clearBubbleTransformers, registerBubbleTransformer } from '../extension/vc-model-settings/reply-pipeline.js';
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
            assert.equal(line.startsWith('body.vc-ui') || line.startsWith('html:not([data-vc-layout="desktop"]) body.vc-ui'), true, line);
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

test('整列只高出一截时，停在顶端不再算贴着底部', () => {
    const metrics = { scrollHeight: 820, scrollTop: 0, clientHeight: 750 };
    assert.equal(keepsTail(metrics), false);
    assert.equal(keepsTail({ scrollHeight: 820, scrollTop: 70, clientHeight: 750 }), true);
    assert.equal(keepsTail({ scrollHeight: 820, scrollTop: 40, clientHeight: 750 }), true);
    assert.equal(keepsTail(metrics, { pin: true }), true);
    assert.equal(keepsTail({ scrollHeight: 2000, scrollTop: 0, clientHeight: 750 }), false);
});

test('溢出只有 70px 时滚到顶端保持不动，后续长高才亮新回复', () => {
    const document = installMiniDom();
    const queued = [];
    const ros = [];
    const observed = [];
    const prevRaf = globalThis.requestAnimationFrame;
    const prevRO = globalThis.ResizeObserver;
    const prevMO = globalThis.MutationObserver;
    const prevNow = globalThis.performance.now.bind(globalThis.performance);
    globalThis.requestAnimationFrame = (fn) => {
        queued.push(fn);
        return queued.length;
    };
    globalThis.ResizeObserver = class {
        constructor(fn) { this.fn = fn; ros.push(this); }
        observe(node) { this.node = node; }
        disconnect() {}
    };
    globalThis.MutationObserver = class {
        constructor(fn) { this.fn = fn; observed.push(this); }
        observe(node, options) { this.node = node; this.options = options; }
        disconnect() {}
    };
    const flush = () => { while (queued.length) queued.shift()(); };
    try {
        const { chat } = stage(document, { ui: true });
        let top = 0;
        let height = 820;
        let client = 0;
        Object.defineProperty(chat, 'scrollHeight', { configurable: true, get: () => height });
        Object.defineProperty(chat, 'clientHeight', { configurable: true, get: () => client });
        Object.defineProperty(chat, 'scrollTop', {
            configurable: true,
            get: () => top,
            set(value) { if (client >= 48) top = Number(value); },
        });
        chat.append(mes(document, { text: '开场' }));
        mountChatView({
            getContext() {
                return { powerUserSettings: {}, characters: [{ name: '甲' }], characterId: 0, groupId: '' };
            },
        });
        flush();
        client = 750;
        ros.find((item) => item.node === chat)?.fn();
        flush();
        globalThis.performance.now = () => prevNow() + 5000;
        top = 0;
        observed.find((item) => item.options?.characterData)?.fn();
        flush();
        assert.equal(top, 0);
        height = 900;
        observed.find((item) => item.options?.characterData)?.fn();
        flush();
        assert.equal(top, 0);
        assert.equal(document.querySelector('#vc-new-reply')?.classList.contains('is-on'), true);
        height = 820;
        top = 0;
        chat.dispatch('scroll');
        flush();
        assert.equal(top, 0);
        height = 900;
        observed.find((item) => item.options?.characterData)?.fn();
        flush();
        assert.equal(top, 0);
        assert.equal(document.querySelector('#vc-new-reply')?.classList.contains('is-on'), true);
        top = height;
        chat.dispatch('scroll');
        flush();
    } finally {
        globalThis.performance.now = prevNow;
        if (prevRaf) globalThis.requestAnimationFrame = prevRaf;
        else delete globalThis.requestAnimationFrame;
        if (prevRO) globalThis.ResizeObserver = prevRO;
        else delete globalThis.ResizeObserver;
        if (prevMO) globalThis.MutationObserver = prevMO;
        else delete globalThis.MutationObserver;
    }
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

test('多句回复只改显示，原文仍留在同一条消息里', () => {
    const document = installMiniDom();
    const node = mes(document, { text: '今天好累。想早点睡。' });
    renderReplyBubbles(node, '今天好累。想早点睡。', { reducedMotion: true });
    const segs = [...node.querySelectorAll('.vc-seg')];
    assert.equal(segs.length, 2);
    assert.equal(segs[0].textContent, '今天好累');
    assert.equal(segs[1].textContent, '想早点睡');
    assert.equal(node.querySelector('.mes_text').textContent, '今天好累。想早点睡。');
    assert.equal(node.className.includes('vc-segmented'), true);
});

test('长回复折叠只影响展示，展开和收起可逆，单个长句同样适用', () => {
    const document=installMiniDom();
    for(const text of ['这是一段合成普通对话。'.repeat(40),'长'.repeat(400)]) {
        const node=mes(document,{text});renderReplyBubbles(node,text,{reducedMotion:true});
        const toggle=node.querySelector('.vc-reply-expand');assert.ok(toggle);
        assert.equal(toggle.getAttribute('aria-expanded'),'false');
        assert.ok(node.querySelector('.vc-segs').textContent.length<250);
        toggle.click();assert.equal(toggle.getAttribute('aria-expanded'),'true');
        assert.ok(node.querySelector('.vc-segs').textContent.length>360);
        toggle.click();assert.equal(toggle.getAttribute('aria-expanded'),'false');
        assert.equal(node.querySelector('.mes_text').textContent,text);
        renderReplyBubbles(node,text,{reducedMotion:true});assert.equal(node.querySelectorAll('.vc-reply-expand').length,1);
    }
});

test('表情段渲染成表情气泡，而不是对象文本', () => {
    clearBubbleTransformers();
    registerBubbleTransformer(() => ['在呢', { type: 'sticker', tag: '开心', kind: 'kaomoji', text: '(≧▽≦)' }]);
    try {
        const document = installMiniDom();
        const node = mes(document, { text: '在呢<sticker tag="开心"/>' });
        renderReplyBubbles(node, '在呢<sticker tag="开心"/>', { reducedMotion: true });
        assert.equal(node.querySelector('[data-vc-sticker]')?.textContent, '(≧▽≦)');
        assert.equal(node.textContent.includes('[object Object]'), false);
    } finally {
        clearBubbleTransformers();
    }
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

const VIEW_SRC = new URL('../extension/vc-model-settings/chat-view.js', import.meta.url);

test('聊天视图不再用 jQuery 的 fromSlashCommand 删消息', () => {
    const src = fs.readFileSync(VIEW_SRC, 'utf8');
    assert.equal(src.includes('fromSlashCommand'), false);
    assert.equal(src.includes('jQuery'), false);
    assert.match(src, /commitHostDelete\(/);
    assert.match(src, /safeAvatarUrl\(/);
    assert.match(src, /inspectorOverlayRoot\(/);
    assert.match(src, /vc-shell-navigate|requestShellDestination\(/);
});

test('头像地址只放行 http(s)、站内路径和位图 data', () => {
    assert.equal(safeAvatarUrl(''), '');
    assert.equal(safeAvatarUrl('  //evil.example/a.png'), '');
    assert.equal(safeAvatarUrl('javascript:alert(1)'), '');
    assert.equal(safeAvatarUrl('data:image/svg+xml;base64,PHN2Zy8+'), '');
    assert.equal(safeAvatarUrl('data:text/html,hi'), '');
    assert.equal(safeAvatarUrl('/thumbnail?type=avatar&file=a.png'), '/thumbnail?type=avatar&file=a.png');
    assert.equal(safeAvatarUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png');
    assert.equal(safeAvatarUrl('HTTP://cdn.example/a.png'), 'HTTP://cdn.example/a.png');
    assert.equal(safeAvatarUrl('http://cdn.example/a.png'), 'http://cdn.example/a.png');
    assert.equal(safeAvatarUrl('data:image/png;base64,aaaa'), 'data:image/png;base64,aaaa');
    assert.equal(safeAvatarUrl('data:image/jpeg;base64,aaaa'), 'data:image/jpeg;base64,aaaa');
    assert.equal(safeAvatarUrl('data:image/webp;base64,aaaa'), 'data:image/webp;base64,aaaa');
    assert.equal(safeAvatarUrl('data:image/gif;base64,aaaa'), 'data:image/gif;base64,aaaa');
    assert.equal(safeAvatarUrl('face.png'), '/thumbnail?type=avatar&file=face.png');
});

test('删消息走宿主 deleteMessage，没有该函数就明确失败', async () => {
    const mes = { getAttribute(name) { return name === 'mesid' ? '4' : null; } };
    const calls = [];
    const jq = () => { throw new Error('jquery'); };
    globalThis.jQuery = jq;
    globalThis.$ = jq;
    try {
        const planned = commitHostDelete(mes, {
            deleteMessage(...args) {
                calls.push(args);
                return Promise.resolve('gone');
            },
        });
        assert.equal(planned.ok, true);
        assert.equal(await planned.run(), 'gone');
        assert.deepEqual(calls, [[4, undefined, false, true]]);
        assert.equal(commitHostDelete(mes, {}).ok, false);
        assert.equal(commitHostDelete(mes, {}).reason, 'missing-delete');
        assert.equal(commitHostDelete({ getAttribute() { return '//nope'; } }, { deleteMessage() {} }).ok, false);
        assert.equal(commitHostDelete({ getAttribute() { return '0'; } }, {
            deleteMessage(id) { return id; },
        }).run(), 0);
    } finally {
        delete globalThis.jQuery;
        delete globalThis.$;
    }
});

test('记忆检视确认框挂到当前 sheet 宿主', () => {
    const document = installMiniDom();
    assert.equal(inspectorOverlayRoot(document), null);
    const rail = document.createElement('aside');
    rail.id = 'vc-memory-rail';
    document.body.append(rail);
    assert.equal(inspectorOverlayRoot(document), rail);
    const host = document.createElement('div');
    host.id = 'vc-memory-sheet-host';
    document.body.append(host);
    assert.equal(inspectorOverlayRoot(document), host);
});

test('流式只刷新最后一条，变更合并到一帧', () => {
    assert.deepEqual(refreshIndexes(0, true), []);
    assert.deepEqual(refreshIndexes(4, false), [0, 1, 2, 3]);
    assert.deepEqual(refreshIndexes(4, true), [3]);
    const document = installMiniDom();
    const queued = [];
    const observed = [];
    const prevRaf = globalThis.requestAnimationFrame;
    const prevMO = globalThis.MutationObserver;
    globalThis.requestAnimationFrame = (fn) => {
        queued.push(fn);
        return queued.length;
    };
    globalThis.MutationObserver = class {
        constructor(fn) { this.fn = fn; observed.push(this); }
        observe(node, options) { this.node = node; this.options = options; }
        disconnect() {}
    };
    try {
        const { chat } = stage(document, { ui: true });
        let top = 0;
        let writes = 0;
        Object.defineProperty(chat, 'scrollHeight', { configurable: true, get: () => 400 });
        Object.defineProperty(chat, 'clientHeight', { configurable: true, get: () => 100 });
        Object.defineProperty(chat, 'scrollTop', {
            configurable: true,
            get: () => top,
            set(value) { top = Number(value); writes += 1; },
        });
        chat.append(mes(document, { name: '甲', text: '开场' }), mes(document, { user: true, name: '我', text: '问' }));
        mountChatView({
            getContext() {
                return { powerUserSettings: {}, characters: [{ name: '甲' }], characterId: 0 };
            },
        });
        const chatObs = observed.filter((obs) => obs.options?.characterData);
        assert.equal(chatObs.length, 1);
        while (queued.length) queued.shift()();
        const rows = chat.children.filter((node) => node.className.split(/\s+/).includes('mes'));
        rows[0]._classes = rows[0]._classes.filter((name) => name !== 'vc-speaker');
        rows[0].className = rows[0]._classes.join(' ');
        document.body.setAttribute('data-generating', 'true');
        writes = 0;
        top = 0;
        chatObs[0].fn();
        chatObs[0].fn();
        chatObs[0].fn();
        assert.equal(writes, 0);
        assert.equal(queued.length, 1);
        queued.shift()();
        assert.equal(writes, 1);
        assert.equal(rows[0].className.split(/\s+/).includes('vc-speaker'), false);
        document.body.setAttribute('data-generating', 'false');
        queued.length = 0;
        chatObs[0].fn();
        while (queued.length) queued.shift()();
        assert.equal(rows[0].className.split(/\s+/).includes('vc-speaker'), true);
    } finally {
        if (prevRaf) globalThis.requestAnimationFrame = prevRaf;
        else delete globalThis.requestAnimationFrame;
        if (prevMO) globalThis.MutationObserver = prevMO;
        else delete globalThis.MutationObserver;
    }
});

test('海报高度留给消息，滚动读取合并到一帧', () => {
    const document = installMiniDom();
    const queued = [];
    const ros = [];
    const prevRaf = globalThis.requestAnimationFrame;
    const prevRO = globalThis.ResizeObserver;
    globalThis.requestAnimationFrame = (fn) => {
        queued.push(fn);
        return queued.length;
    };
    globalThis.ResizeObserver = class {
        constructor(fn) { this.fn = fn; ros.push(this); }
        observe(node) { this.node = node; }
        disconnect() { this.dead = true; }
    };
    try {
        const { chat } = stage(document, { ui: true });
        chat.append(mes(document, { name: '甲', text: '合成开场。' }));
        mountChatView({
            getContext() {
                return { powerUserSettings: {}, characters: [{ name: '甲', avatar: 'https://cdn.example/a.png' }], characterId: 0 };
            },
        });
        const poster = document.querySelector('#vc-chat-poster');
        let height = 360;
        let reads = 0;
        Object.defineProperty(poster, 'offsetHeight', {
            configurable: true,
            get() { reads += 1; return height; },
        });
        while (queued.length) queued.shift()();
        assert.equal(document.body.style['--vc-poster-pad'], '360px');
        assert.equal(document.querySelector('#vc-poster-avatar').getAttribute('src'), 'https://cdn.example/a.png');
        const watched = ros.find((item) => item.node === poster);
        assert.ok(watched);
        height = 420;
        reads = 0;
        queued.length = 0;
        watched.fn();
        while (queued.length) queued.shift()();
        assert.equal(document.body.style['--vc-poster-pad'], '420px');
        reads = 0;
        queued.length = 0;
        chat.dispatch('scroll');
        chat.dispatch('scroll');
        chat.dispatch('scroll');
        assert.equal(reads, 0);
        assert.equal(queued.length, 1);
        queued.shift()();
        assert.equal(reads, 1);
    } finally {
        if (prevRaf) globalThis.requestAnimationFrame = prevRaf;
        else delete globalThis.requestAnimationFrame;
        if (prevRO) globalThis.ResizeObserver = prevRO;
        else delete globalThis.ResizeObserver;
    }
});

test('新外观打开角色和模型只发目的地事件', () => {
    const document = installMiniDom();
    const { chat } = stage(document, { ui: true });
    const empty = document.createElement('p');
    empty.id = 'vc-chat-empty';
    empty.textContent = CHAT_PICK_COPY;
    chat.append(empty);
    const status = document.createElement('div');
    status.id = 'vc-chat-status';
    const model = document.createElement('span');
    model.className = 'vc-chat-model';
    model.textContent = '模型待配置';
    document.body.append(status, model);
    let navClicks = 0;
    for (const name of ['characters', 'models']) {
        const decoy = document.createElement('button');
        decoy.setAttribute('data-nav', name);
        decoy.addEventListener('click', () => { navClicks += 1; });
        document.body.append(decoy);
    }
    const navs = [];
    globalThis.addEventListener('vc-shell-navigate', (event) => navs.push(event.detail));
    mountChatView({
        getContext() {
            return { powerUserSettings: {}, characters: [], characterId: null };
        },
    });
    const poster = document.querySelector('#vc-chat-poster');
    poster.querySelectorAll('button').find((button) => button.getAttribute('data-vc-poster') === 'character').click();
    const pick = document.querySelectorAll('button').find((button) => button.textContent === '选择角色');
    pick.click();
    const config = document.querySelectorAll('button').find((button) => button.textContent === '配置');
    config.click();
    assert.equal(navClicks, 0);
    assert.deepEqual(navs.map((detail) => detail.destination), ['characters', 'characters', 'models']);
    const box = document.querySelector('#send_textarea');
    assert.equal(box.getAttribute('placeholder'), '发消息');
});

test('关闭新外观时不改输入占位', () => {
    const document = installMiniDom();
    const { box } = stage(document);
    box.setAttribute('placeholder', '宿主占位');
    mountChatView({ getContext: () => ({ powerUserSettings: {} }) });
    assert.equal(box.getAttribute('placeholder'), '宿主占位');
});

test('聊天样式把滚动交给 #chat，气泡用同等优先级压过外壳', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    const chatBlock = css.match(/body\.vc-ui #chat \{[^}]+\}/)[0];
    assert.equal(chatBlock.includes('pointer-events: none'), false);
    assert.match(chatBlock, /pointer-events:\s*auto\s*!important/);
    assert.match(chatBlock, /padding-top:[^;]*var\(--vc-poster-pad\)[^;]*!important/);
    assert.match(css, /#vc-chat-poster \{[^}]*pointer-events:\s*none/);
    assert.match(css, /#vc-chat-poster button,\s*body\.vc-ui #vc-chat-poster a \{ pointer-events:\s*auto/);
    assert.match(css, /width:\s*fit-content\s*!important/);
    assert.match(css, /max-width:\s*80%\s*!important/);
    assert.match(css, /color-mix\(in srgb, rgb\(var\(--vc-tint\)\) 10%, var\(--vc-bubble-char\)\)/);
    assert.equal(css.includes('blur(24px)'), false);
    assert.match(css, /blur\(22px\) saturate\(180%\)/);
    assert.match(css, /body\.vc-ui #vc-chat-empty \{[^}]*color:\s*var\(--vc-ink-2\)/);
    assert.match(css, /z-index:\s*var\(--vc-z-scrim\)/);
    assert.match(css, /z-index:\s*var\(--vc-z-sheet\)/);
    assert.match(css, /animation-duration:\s*var\(--vc-dur-stream\)/);
    assert.equal(css.includes('0.5s'), false);
});

test('打开或切换会话在可见后贴底，宿主恢复旧位置会被拉回，上翻后保持', () => {
    const document = installMiniDom();
    const queued = [];
    const ros = [];
    const observed = [];
    const handlers = {};
    const prevRaf = globalThis.requestAnimationFrame;
    const prevRO = globalThis.ResizeObserver;
    const prevMO = globalThis.MutationObserver;
    globalThis.requestAnimationFrame = (fn) => {
        queued.push(fn);
        return queued.length;
    };
    globalThis.ResizeObserver = class {
        constructor(fn) { this.fn = fn; ros.push(this); }
        observe(node) { this.node = node; }
        disconnect() {}
    };
    globalThis.MutationObserver = class {
        constructor(fn) { this.fn = fn; observed.push(this); }
        observe(node, options) { this.node = node; this.options = options; }
        disconnect() {}
    };
    const flush = () => { while (queued.length) queued.shift()(); };
    try {
        const { chat } = stage(document, { ui: true });
        let top = 320;
        let height = 1800;
        let client = 0;
        Object.defineProperty(chat, 'scrollHeight', { configurable: true, get: () => height });
        Object.defineProperty(chat, 'clientHeight', { configurable: true, get: () => client });
        Object.defineProperty(chat, 'scrollTop', {
            configurable: true,
            get: () => top,
            set(value) {
                if (client < 48) return;
                top = Number(value);
            },
        });
        chat.append(mes(document, { text: '旧' }), mes(document, { user: true, text: '问' }));
        mountChatView({
            getContext() {
                return {
                    powerUserSettings: {},
                    characters: [{ name: '甲' }],
                    characterId: 0,
                    chatId: 'a',
                    eventTypes: { CHAT_CHANGED: 'CHAT_CHANGED' },
                    eventSource: { on(name, fn) { (handlers[name] ||= []).push(fn); } },
                };
            },
        });
        flush();
        assert.equal(top, 320, '会话还没布局时不能改掉旧 scrollTop');
        client = 640;
        const box = ros.find((item) => item.node === chat);
        assert.ok(box, '聊天列尺寸变化后要补一次贴底');
        box.fn();
        flush();
        assert.equal(top, height, '打开会话并完成布局后应停在最新一条');
        top = 400;
        chat.dispatch('scroll');
        flush();
        assert.equal(top, height, '宿主在渲染后写回旧 scrollTop 时仍应贴底');
        top = 80;
        chat.dispatch('wheel');
        chat.dispatch('scroll');
        flush();
        assert.equal(top, 80);
        height = 2600;
        const chatObs = observed.find((item) => item.options?.characterData);
        assert.ok(chatObs);
        chatObs.fn();
        flush();
        assert.equal(top, 80, '用户上翻后，后续内容增长保持当前位置');
        for (const fn of handlers.CHAT_CHANGED || []) fn();
        flush();
        assert.equal(top, height, '切换会话后重新贴底');
    } finally {
        if (prevRaf) globalThis.requestAnimationFrame = prevRaf;
        else delete globalThis.requestAnimationFrame;
        if (prevRO) globalThis.ResizeObserver = prevRO;
        else delete globalThis.ResizeObserver;
        if (prevMO) globalThis.MutationObserver = prevMO;
        else delete globalThis.MutationObserver;
    }
});

test('记忆正常提示不占玻璃条，持续不可用只留一行小号说明', async () => {
    const { MEMORY_QUIET_COPY } = await import('../extension/vc-model-settings/memory-injection.js');
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    const noteCss = css.match(/body\.vc-ui #vc-memory-note \{[^}]+\}/)?.[0] || '';
    assert.match(noteCss, /color:\s*var\(--vc-ink-3\)/);
    assert.match(noteCss, /font-size:\s*var\(--vc-fs-caption\)/);
    assert.equal(/position:\s*absolute/.test(noteCss), false);
    assert.equal(noteCss.includes('vc-glass'), false);
    assert.equal(noteCss.includes('--vc-glass'), false);

    const skipDoc = installMiniDom();
    stage(skipDoc, { ui: true });
    const skipToasts = skipDoc.createElement('div');
    skipToasts.id = 'toast-container';
    const skip = skipDoc.createElement('div');
    skip.className = 'toast toast-warning';
    skip.textContent = '长期记忆来源已变化或暂不可用，本轮已跳过。';
    skipToasts.append(skip);
    skipDoc.body.append(skipToasts);
    mountChatView({ getContext: () => ({ powerUserSettings: {}, characters: [], characterId: null }) });
    assert.equal(skipToasts.querySelector('.toast'), null);
    assert.equal(skipDoc.querySelector('#vc-memory-note')?.textContent || '', '');
    assert.equal(skipDoc.querySelector('#vc-memory-note')?.className.includes('vc-glass'), false);

    const downDoc = installMiniDom();
    stage(downDoc, { ui: true });
    const downToasts = downDoc.createElement('div');
    downToasts.id = 'toast-container';
    const down = downDoc.createElement('div');
    down.className = 'toast toast-warning';
    down.textContent = '部分长期记忆暂不可用；聊天仍可保存。';
    downToasts.append(down);
    downDoc.body.append(downToasts);
    mountChatView({ getContext: () => ({ powerUserSettings: {}, characters: [], characterId: null }) });
    assert.equal(downToasts.querySelector('.toast'), null);
    const note = downDoc.querySelector('#vc-memory-note');
    assert.equal(note?.textContent, MEMORY_QUIET_COPY);
    assert.equal(note.className.includes('vc-glass'), false);
    downDoc.body.dispatch('vc-memory-notice', { detail: { text: '' } });
    assert.equal(downDoc.querySelector('#vc-memory-note').textContent, '');
});

test('最后一条角色头像不被宿主的下内边距拉成胶囊', async () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.match(css, /#chat > \.mes \.mesAvatarWrapper \{[^}]*padding:\s*0\s*!important/);
    assert.match(css, /#chat > \.mes\.vc-speaker \.mesAvatarWrapper \{[^}]*height:\s*24px\s*!important/);
    assert.match(css, /#chat > \.mes \.avatar \{[^}]*flex:\s*none\s*!important/);
});

test('深色消息头像和海报头像不用变亮混合', async () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    const shell = fs.readFileSync(new URL('../extension/vc-model-settings/shell.css', import.meta.url), 'utf8');
    assert.match(css, /\.vc-poster-avatar \{[^}]*mix-blend-mode:\s*normal/);
    assert.match(shell, /#chat > \.mes \.avatar img \{[^}]*mix-blend-mode:\s*normal/);
    assert.match(shell, /\[data-who-avatar\] img \{[^}]*mix-blend-mode:\s*normal/);
    assert.match(shell, /img\.vc-convo-avatar[\s\S]{0,220}mix-blend-mode:\s*var\(--vc-avatar-blend/);
});

test('一对一不显示发送者名字，群聊仍标记发言人', () => {
    assert.equal(isDirectChat({ groupId: '' }), true);
    assert.equal(isDirectChat({}), true);
    assert.equal(isDirectChat({ groupId: 'g1' }), false);
    const doc = installMiniDom();
    stage(doc, { ui: true });
    syncDirectChat(doc, { groupId: '' });
    assert.equal(doc.body.classList.contains('vc-direct'), true);
    syncDirectChat(doc, { groupId: 'room' });
    assert.equal(doc.body.classList.contains('vc-direct'), false);
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    const speakerAt = css.search(/\.vc-speaker \.name_text \{[^}]*display:\s*inline\s*!important/);
    const directAt = css.search(/body\.vc-ui\.vc-direct #chat > \.mes \.name_text \{[^}]*display:\s*none\s*!important/);
    assert.ok(speakerAt >= 0 && directAt > speakerAt);
    assert.match(css, /body\.vc-ui\.vc-direct #chat > \.mes \.ch_name \{[^}]*display:\s*none\s*!important/);
});

const DESKTOP_CHAT_CSS = new URL('../extension/vc-model-settings/desktop/chat.css', import.meta.url);
const CHARACTER_PANEL_JS = new URL('../extension/vc-model-settings/desktop/character-panel.js', import.meta.url);
const desktopRule = (css, selector) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, selector);
    return css.slice(at, css.indexOf('}', at));
};

test('UX-22 R5：桌面消息头像 36、工具行靠左贴正文、阅读列 720 居中', () => {
    const css = fs.readFileSync(DESKTOP_CHAT_CSS, 'utf8');
    const P = 'html[data-vc-layout="desktop"] body.vc-ui';
    assert.match(desktopRule(css, `${P} #chat > .mes`), /grid-template-columns:\s*36px[^;]*;[^}]*calc\(var\(--vc-read\) \+ 48px\)/);
    assert.match(desktopRule(css, `${P} #chat > .mes.vc-speaker .avatar,\n${P} #chat > .mes.vc-speaker .avatar img`), /width:\s*36px !important;\s*height:\s*36px !important/);
    assert.match(desktopRule(css, `${P} #chat > .mes .vc-mes-tools`), /grid-column:\s*2;\s*justify-content:\s*flex-start/);
    assert.match(desktopRule(css, `${P} .vc-mes-gap`), /display:\s*none/);
    assert.match(desktopRule(css, `${P} #chat > .mes:not(.vc-speaker):not([is_user="true"]):not([is_system="true"]) > .mes_block`), /grid-column:\s*2/);
});

test('UX-22 R5：桌面输入区占位左对齐，语音与发送并列且生成中只留停止', () => {
    const css = fs.readFileSync(DESKTOP_CHAT_CSS, 'utf8');
    const P = 'html[data-vc-layout="desktop"] body.vc-ui';
    assert.match(desktopRule(css, `${P} #send_textarea::placeholder`), /text-align:\s*left/);
    assert.match(desktopRule(css, `${P} #send_form.vc-voice-input-available #send_but`), /display:\s*inline-flex !important/);
    assert.match(desktopRule(css, `${P}[data-generating="true"] #send_form.vc-voice-input-available #send_but`), /display:\s*none !important/);
    assert.match(css, /\.vc-shell-chat \.vc-who \{ background: none !important/);
});

test('UX-22 R6：角色面板头像光晕、56 圆形快捷动作、高度随内容、窄桌面不覆盖对话', () => {
    const css = fs.readFileSync(DESKTOP_CHAT_CSS, 'utf8');
    const P = 'html[data-vc-layout="desktop"] body.vc-ui';
    const glow = desktopRule(css, `${P} .vc-desk-character-avatar`);
    assert.match(glow, /width:\s*96px;\s*height:\s*96px/);
    assert.match(glow, /box-shadow: var\(--vc-shadow-avatar-glow\)/);
    const theme = fs.readFileSync(new URL('../extension/vc-model-settings/desktop/themes/aurora.css', import.meta.url), 'utf8');
    assert.match(theme, /--vc-shadow-avatar-glow:[^;]*color-mix\(in srgb, rgb\(var\(--vc-tint\)\)/);
    assert.equal(/rgb\(var\(--vc-tint\) \//.test(css), false, '逗号形式的 --vc-tint 不能写成斜杠 alpha');
    assert.match(desktopRule(css, `${P} .vc-desk-character-actions .vc-circle`), /width:\s*56px;[^}]*height:\s*56px/);
    assert.match(desktopRule(css, `${P} .vc-desk-character-actions:empty`), /display:\s*none/);
    assert.match(css, /\.vc-desk-character \{ align-self: start; max-height: 100%; \}/);
    const narrow = css.slice(css.indexOf('/* UX-22 R5/R6：<1180'), css.indexOf('@media(min-width:1600px)'));
    // UX-23 P1-6：≥1028 与对话并排（relative）；更窄时面板是浮层（absolute），对话不再被隐藏。
    assert.match(narrow, /position: relative/);
    assert.match(narrow, /@media\(min-width:744px\) and \(max-width:1027px\)[\s\S]*position: absolute; top: 72px/);
    assert.equal(/\.vc-shell-chat \{ display: none; \}/.test(narrow), false);
    const panel = fs.readFileSync(CHARACTER_PANEL_JS, 'utf8');
    assert.equal((panel.match(/\), 24\);|\}, 24\);/g) || []).length, 3);
    assert.match(panel, /memorySection\.hidden = !rows\.length/);
});

test('UX-23 桌面无偏好时按气泡，手机与已存偏好不变', () => {
    const document = installMiniDom();
    const store = memoryStore();
    assert.equal(readReplyStyle(store), 'spread');
    document.documentElement.setAttribute('data-vc-layout', 'desktop');
    assert.equal(readReplyStyle(store), 'bubble');
    assert.equal(readReplyStyle(memoryStore({ 'vc-reply-style': 'spread' })), 'spread');
    assert.equal(readReplyStyle(memoryStore({ 'vc-reply-style': 'bubble' })), 'bubble');
    assert.equal(readReplyStyle({ getItem() { throw new Error('closed'); } }), 'bubble');
    document.documentElement.setAttribute('data-vc-layout', 'mobile');
    assert.equal(readReplyStyle(store), 'spread');
});

test('UX-23 send_date 解析：毫秒数、ISO、宿主旧格式；解析不了不猜', () => {
    const iso = '2026-11-02T08:02:00';
    assert.equal(parseSendDate(1700000000000), 1700000000000);
    assert.equal(parseSendDate(iso), new Date(2026, 10, 2, 8, 2).getTime());
    assert.equal(parseSendDate('一句话'), null);
    assert.equal(parseSendDate('一句话', () => ({ valueOf: () => 42 })), 42);
    assert.equal(parseSendDate('一句话', () => { throw new Error('bad'); }), null);
    assert.equal(parseSendDate(''), null);
    assert.equal(parseSendDate(undefined), null);
});

test('UX-23 日期 / 间隔胶囊文案：今天、昨天、周几、月日、跨年', () => {
    const now = new Date(2026, 10, 2, 12, 0).getTime();
    const at = (y, mo, d, h = 8, mi = 5) => new Date(y, mo, d, h, mi).getTime();
    assert.equal(clockText(at(2026, 10, 2, 8, 5)), '08:05');
    assert.equal(gapLabel(at(2026, 10, 2), now), '今天 08:05');
    assert.equal(gapLabel(at(2026, 10, 1, 22, 14), now), '昨天 22:14');
    assert.equal(gapLabel(at(2026, 9, 31), now), '周六 08:05');
    assert.equal(gapLabel(at(2026, 9, 27), now), '周二 08:05');
    assert.equal(gapLabel(at(2026, 9, 26), now), '10月26日 08:05');
    assert.equal(gapLabel(at(2025, 11, 31), now), '2025年12月31日 08:05');
});

test('UX-23 成组：同发送者且间隔小于 5 分钟；日期 / ≥20 分钟出胶囊并断组；组尾带时间与「已发送」', () => {
    const base = new Date(2026, 10, 2, 8, 0).getTime();
    const min = 60000;
    const char = (m, extra = {}) => ({ user: false, system: false, name: '小满', ts: base + m * min, ...extra });
    const user = (m, extra = {}) => ({ user: true, system: false, name: '我', ts: base + m * min, ...extra });
    const rows = [char(0), char(1), char(4), char(9), user(10), user(12), char(40), { user: false, system: true, name: '', ts: null }, char(41, { rich: true }), char(42)];
    const marks = planMessageMarks(rows, { now: base + 60 * min });
    assert.deepEqual(marks.map((item) => item.pos), ['start', 'mid', 'end', 'solo', 'start', 'end', 'solo', '', '', 'solo']);
    assert.deepEqual(marks.map((item) => item.gap), ['今天 08:00', '', '', '', '', '', '今天 08:40', '', '', '']);
    assert.deepEqual(marks.map((item) => item.tail), [false, false, true, true, false, true, true, false, false, true]);
    assert.equal(marks[2].foot, '08:04');
    assert.equal(marks[5].foot, '08:12 · 已发送');
    assert.equal(marks[0].time, '08:00');
    assert.equal(marks[7].time, '');
    assert.equal(marks[8].time, '');
    assert.equal(marks.filter((item) => item.foot.includes('已发送')).length, 1);
});

test('UX-23 跨天断组、空消息与无时间的消息不带标记、也不连累邻居', () => {
    const late = new Date(2026, 10, 1, 23, 58).getTime();
    const early = new Date(2026, 10, 2, 0, 1).getTime();
    const rows = [
        { user: false, name: '小满', ts: late },
        { user: false, name: '小满', ts: early },
        { user: false, name: '小满', ts: null },
        { user: false, name: '小满', ts: early, empty: true },
        { user: true, name: '我', ts: null },
    ];
    const marks = planMessageMarks(rows, { now: early + 1000 });
    assert.equal(marks[0].gap, '昨天 23:58');
    assert.equal(marks[1].gap, '今天 00:01');
    assert.deepEqual(marks.map((item) => item.pos), ['solo', 'solo', 'solo', '', 'solo']);
    assert.equal(marks[2].foot, '');
    assert.equal(marks[4].foot, '已发送');
    assert.equal(planMessageMarks([]).length, 0);
});

test('UX-23 桌面气泡 CSS：只挂桌面 + 气泡类，用 attr() 绘制，不写字面颜色，手机文件不动', () => {
    const css = fs.readFileSync(DESKTOP_CHAT_CSS, 'utf8');
    const block = css.slice(css.indexOf('/* UX-23：即时通讯气泡'));
    assert.ok(block.length > 2000);
    for (const selector of block.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((rule) => rule.split('{')[0].trim()).filter(Boolean)) {
        for (const part of selector.split(/,\s*(?=html\[)/)) assert.ok(part.startsWith('html[data-vc-layout="desktop"] body.vc-ui'), part);
    }
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/i);
    assert.match(block, /content:\s*attr\(data-vc-gap\)/);
    assert.match(block, /content:\s*attr\(data-vc-foot\)/);
    assert.match(block, /\[data-vc-time\]:hover::after \{ opacity: 1; \}/);
    assert.match(block, /grid-template-columns: 32px fit-content\(var\(--vc-bub-max\)\)/);
    const theme = fs.readFileSync(new URL('../extension/vc-model-settings/desktop/themes/aurora.css', import.meta.url), 'utf8');
    assert.match(theme, /--vc-bub-r: 18px;/);
    assert.match(theme, /--vc-bub-join: 6px;/);
    assert.match(block, /\.mes\.vc-thinking:not\(\.vc-rich\) \{ display: none;/);
    assert.match(block, /#vc-chat-gen\[data-vc-typing\]/);
    assert.match(block, /content: "取消"/);
    assert.match(block, /content: "保存"/);
    const mobile = fs.readFileSync(CSS_PATH, 'utf8');
    assert.equal(/data-vc-(gap|foot|time|pos|tail)/.test(mobile), false);
});

test('UX-23 桌面气泡：data-vc-* 写在 .mes 上，不插节点；回到手机布局即清除', async () => {
    const document = installMiniDom();
    document.documentElement.setAttribute('data-vc-layout', 'desktop');
    document.body.classList.add('vc-ui', 'vc-reply-bubble');
    const { chat } = stage(document, { ui: true });
    const base = new Date(2026, 10, 2, 8, 0).getTime();
    const log = [];
    for (const [index, [user, minute]] of [[false, 0], [false, 1], [true, 10]].entries()) {
        const node = mes(document, { user, name: user ? '我' : '小满', text: `第${index}句` });
        node.setAttribute('mesid', String(index));
        chat.append(node);
        log.push({ mes: `第${index}句`, is_user: user, send_date: new Date(base + minute * 60000).toISOString() });
    }
    const ctx = { chat: log, chatMetadata: {}, characters: [], eventSource: null };
    mountChatView({ getContext: () => ctx, document });
    const rows = [...chat.children];
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((node) => node.getAttribute('data-vc-pos')), ['start', 'end', 'solo']);
    assert.equal(rows[0].getAttribute('data-vc-gap'), gapLabel(base, Date.now()));
    assert.equal(rows[1].getAttribute('data-vc-foot'), '08:01');
    assert.equal(rows[2].getAttribute('data-vc-foot'), '08:10 · 已发送');
    assert.equal(rows[0].hasAttribute('data-vc-tail'), false);
    assert.equal(rows[1].hasAttribute('data-vc-tail'), true);
    assert.equal(rows[0].querySelector('.mes_text').children.length, 0);
});

test('UX-23 桌面气泡生成中：#vc-chat-gen 是「正在输入」气泡（UX-25：450ms 后才显示），手机仍是「思考中」', async () => {
    for (const layout of ['desktop', 'mobile']) {
        const document = installMiniDom();
        document.documentElement.setAttribute('data-vc-layout', layout);
        document.body.classList.add('vc-ui', 'vc-reply-bubble');
        stage(document, { ui: true });
        document.body.setAttribute('data-generating', 'true');
        mountChatView({ getContext: () => ({ chat: [], chatMetadata: {}, characters: [] }), document });
        const line = document.querySelector('#vc-chat-gen');
        if (layout === 'desktop') {
            // UX-25：生成开始 450ms 内不显示，避免一闪而过。
            assert.equal(line.hasAttribute('hidden'), true, 'desktop 防闪');
            await new Promise((resolve) => setTimeout(resolve, 520));
        }
        assert.equal(line.hasAttribute('hidden'), false, layout);
        assert.equal(line.hasAttribute('data-vc-typing'), layout === 'desktop', layout);
        assert.equal(line.textContent, layout === 'desktop' ? '正在输入' : '思考中', layout);
        assert.equal(Boolean(line.querySelector('.vc-gen-bubble')), layout === 'desktop', layout);
    }
});

test('停止后立即续写，先等半截回复保存完成再进入宿主生成', async () => {
    const document = installMiniDom();
    document.documentElement.setAttribute('data-vc-layout', 'desktop');
    const { chat } = stage(document, { ui: true });
    chat.append(mes(document, { text: '尚未写完' }));
    const message = { mes: '尚未写完', is_user: false };
    let finishSave;
    const saved = new Promise(resolve => { finishSave = resolve; });
    const metadata = { vc_f2: { id: 'continue-source', revision: 1 } };
    const context = { chat: [message], chatMetadata: metadata, characters: [], powerUserSettings: {},
        async saveChat() { await saved; metadata.vc_f2.revision = 2; } };
    const calls = [];
    const native = document.createElement('a');
    native.id = 'option_continue';
    native.addEventListener('click', () => calls.push(metadata.vc_f2.revision));
    document.body.append(native);
    mountChatView({ getContext: () => context, document });
    document.querySelector('#mes_stop').click();
    const resume = document.querySelector('#vc-chat-gen')?.querySelector('button');
    assert.equal(resume?.textContent, '继续');
    try {
        resume.click();
        assert.deepEqual(calls, [], '保存未确认前不能带着旧修订号开始续写');
        finishSave();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls, [2]);
    } finally { finishSave(); }
});
