import test from 'node:test';
import assert from 'node:assert/strict';
import { F2ConflictError, F2_CONFLICT_COPY, extractUnsavedUserInput, readF2Draft, showF2Draft } from '../extension/vc-model-settings/f2-client.js';
import { installMiniDom } from './mini-dom.mjs';

const payload = JSON.stringify({ mes: 'DRAFT_MARKER_91', token: 'should-not-render' });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function sendBox(document, value = '') {
    const box = document.createElement('textarea');
    box.setAttribute('id', 'send_textarea');
    box.value = value;
    document.body.append(box);
    return box;
}

function watchStorage() {
    const writes = [];
    const record = (name) => (...args) => { writes.push([name, args.map((item) => String(item)).join('|')]); };
    for (const name of ['localStorage', 'sessionStorage']) {
        const current = globalThis[name];
        const setItem = record(name);
        if (current) {
            try {
                Object.defineProperty(current, 'setItem', { configurable: true, writable: true, value: setItem });
                continue;
            } catch { /* fall through */ }
        }
        try {
            Object.defineProperty(globalThis, name, {
                configurable: true,
                writable: true,
                value: { setItem, getItem() { return null; }, removeItem() {}, clear() {}, key() { return null; }, length: 0 },
            });
        } catch { /* locked */ }
    }
    return writes;
}

function attributeHas(node, needle, seen = new Set()) {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (node.attributes) {
        for (const value of Object.values(node.attributes)) {
            if (String(value).includes(needle)) return true;
        }
    }
    for (const child of node.children || []) {
        if (attributeHas(child, needle, seen)) return true;
    }
    return false;
}

function stubClipboard(writeText) {
    const clipboard = { writeText };
    const nav = globalThis.navigator;
    if (nav && typeof nav === 'object') {
        Object.defineProperty(nav, 'clipboard', { configurable: true, value: clipboard });
        return;
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } });
}

function watchConsole() {
    const lines = [];
    const originals = {};
    for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
        originals[level] = console[level];
        console[level] = (...args) => { lines.push(args.map((item) => String(item)).join(' ')); };
    }
    return { lines, restore() { Object.assign(console, originals); } };
}

test('冲突面板使用规范文案，保留草稿且不展示 JSON、不提供强制覆盖', async () => {
    const document = installMiniDom();
    const writes = watchStorage();
    const logs = watchConsole();
    const opener = document.createElement('button');
    opener.textContent = '发送';
    document.body.append(opener);
    opener.focus();
    const box = sendBox(document, '正在输入');
    let reloads = 0;
    globalThis.location = { reload() { reloads += 1; } };
    try {
        showF2Draft(payload, new F2ConflictError('VC_STALE_SOURCE'));
        const panelHtml = document.querySelector('#vc-f2-conflict').innerHTML;
        assert.match(panelHtml, new RegExp(F2_CONFLICT_COPY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(document.body.textContent, /查看最新/);
        assert.match(document.body.textContent, /保留草稿/);
        assert.match(panelHtml, /data-action="copy-input"/);
        for (const absent of ['强制覆盖', '复制草稿', '重新加载最新版本', '继续查看本页', 'DRAFT_MARKER_91', 'should-not-render', 'textarea', 'VC_STALE_SOURCE']) {
            assert.equal(panelHtml.includes(absent), false, absent);
        }
        assert.equal(attributeHas(document.documentElement, 'DRAFT_MARKER_91'), false);
        assert.equal(attributeHas(document.documentElement, 'should-not-render'), false);
        assert.equal(readF2Draft(), payload);
        assert.equal(reloads, 0);
        assert.equal(document.querySelector('#vc-f2-recall').getAttribute('hidden'), '');
        document.querySelector('[data-action="keep-draft"]').click();
        assert.equal(document.querySelector('#vc-f2-conflict').open, false);
        assert.equal(box.value, '正在输入\nDRAFT_MARKER_91');
        assert.equal(document.activeElement, box);
        assert.equal(readF2Draft(), payload);
        assert.equal(reloads, 0);
        assert.equal(document.querySelector('#vc-f2-recall').hidden, false);
        assert.equal(document.querySelector('#vc-f2-conflict').innerHTML.includes('DRAFT_MARKER_91'), false);
        assert.equal(writes.length, 0);
        assert.equal(logs.lines.some((line) => line.includes('DRAFT_MARKER_91') || line.includes('should-not-render')), false);
    } finally {
        logs.restore();
    }
});

test('查看最新调用 reloadCurrentChat，草稿回到输入框且不整页刷新', async () => {
    const document = installMiniDom();
    const writes = watchStorage();
    const box = sendBox(document, '正在输入');
    let reloads = 0;
    let calls = 0;
    globalThis.location = { reload() { reloads += 1; } };
    const realFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => { fetches += 1; throw new Error('must not send'); };
    const latest = [{ is_user: false, mes: '最新里的另一句' }];
    const ctx = {
        chat: [{ is_user: false, mes: '本地旧句' }],
        async reloadCurrentChat() {
            calls += 1;
            ctx.chat = latest;
        },
    };
    globalThis.SillyTavern = { getContext: () => ctx };
    try {
        showF2Draft(payload, new F2ConflictError('VC_REVISION_CONFLICT'));
        document.querySelector('[data-action="view-latest"]').click();
        await flush();
        assert.equal(reloads, 0);
        assert.equal(calls, 1);
        assert.equal(fetches, 0);
        assert.equal(box.value, '正在输入\nDRAFT_MARKER_91');
        assert.equal(document.activeElement, box);
        assert.equal(document.querySelector('#vc-f2-conflict').open, false);
        assert.equal(readF2Draft(), payload);
        assert.equal(document.body.innerHTML.includes('DRAFT_MARKER_91'), false);
        assert.equal(document.body.innerHTML.includes('should-not-render'), false);
        assert.equal(writes.length, 0);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('reloadCurrentChat 不可用或失败时面板保持打开并可复制，不刷新页面', async () => {
    const document = installMiniDom();
    const writes = watchStorage();
    const box = sendBox(document, '正在输入');
    let reloads = 0;
    globalThis.location = { reload() { reloads += 1; } };
    let copied = '';
    stubClipboard(async (text) => { copied = text; });
    delete globalThis.SillyTavern;
    showF2Draft(payload, new F2ConflictError('VC_REVISION_CONFLICT'));
    document.querySelector('[data-action="view-latest"]').click();
    await flush();
    assert.equal(reloads, 0);
    assert.equal(document.querySelector('#vc-f2-conflict').open, true);
    assert.equal(box.value, '正在输入');
    document.querySelector('#vc-f2-conflict').querySelector('[data-action="copy-input"]').click();
    await flush();
    assert.equal(copied, 'DRAFT_MARKER_91');
    assert.equal(copied.includes('should-not-render'), false);
    assert.equal(writes.length, 0);

    let calls = 0;
    globalThis.SillyTavern = { getContext: () => ({ chat: [], async reloadCurrentChat() { calls += 1; throw new Error('load failed'); } }) };
    document.querySelector('[data-action="view-latest"]').click();
    await flush();
    assert.equal(calls, 1);
    assert.equal(reloads, 0);
    assert.equal(document.querySelector('#vc-f2-conflict').open, true);
    assert.equal(box.value, '正在输入');
    assert.equal(writes.length, 0);
});

test('查看最新只带回本地有而最新版本没有的消息，按顺序拼接且不覆盖原输入', async () => {
    const document = installMiniDom();
    const writes = watchStorage();
    const box = sendBox(document, '正在输入');
    let reloads = 0;
    globalThis.location = { reload() { reloads += 1; } };
    const snapshot = {
        chat: [
            { chat_metadata: { vc_f2: { id: 'chat-1', revision: 4 } }, user_name: 'unused', character_name: 'unused' },
            { is_user: true, mes: '已经在最新里' },
            { is_user: false, mes: '角色回复' },
            { is_user: true, mes: '未保存一' },
            { is_user: false, mes: '改过的角色句' },
            { is_user: true, mes: '未保存二' },
        ],
    };
    const latest = [
        { is_user: true, mes: '已经在最新里' },
        { is_user: false, mes: '角色回复' },
        { is_user: false, mes: '旧角色句' },
    ];
    assert.equal(extractUnsavedUserInput(JSON.stringify(snapshot), latest), '未保存一\n改过的角色句\n未保存二');
    const ctx = { chat: snapshot.chat.slice(1), async reloadCurrentChat() { ctx.chat = latest; } };
    globalThis.SillyTavern = { getContext: () => ctx };
    showF2Draft(JSON.stringify(snapshot), new F2ConflictError('VC_REVISION_CONFLICT'));
    document.querySelector('[data-action="view-latest"]').click();
    await flush();
    assert.equal(reloads, 0);
    assert.equal(box.value, '正在输入\n未保存一\n改过的角色句\n未保存二');
    assert.equal(box.value.includes('已经在最新里'), false);
    assert.equal(box.value.includes('角色回复'), false);
    assert.equal(box.value.includes('chat-1'), false);
    assert.equal(writes.length, 0);
});

test('保留草稿关闭面板后仍能从复制入口拿回全部未保存用户消息', async () => {
    const document = installMiniDom();
    const writes = watchStorage();
    const box = sendBox(document, '正在输入');
    let reloads = 0;
    let copied = '';
    globalThis.location = { reload() { reloads += 1; } };
    stubClipboard(async (text) => { copied = text; });
    const snapshot = {
        chat: [
            { chat_metadata: { vc_f2: { id: 'chat-1', revision: 4 } } },
            { is_user: false, mes: '角色回复' },
            { is_user: true, mes: '未保存一' },
            { is_user: true, mes: '未保存二' },
        ],
    };
    showF2Draft(JSON.stringify(snapshot), new F2ConflictError('VC_STALE_SOURCE'));
    document.querySelector('[data-action="keep-draft"]').click();
    await flush();
    assert.equal(reloads, 0);
    assert.equal(document.querySelector('#vc-f2-conflict').open, false);
    assert.equal(box.value, '正在输入\n未保存一\n未保存二');
    assert.equal(box.value.includes('角色回复'), false);
    document.querySelector('#vc-f2-recall').click();
    await flush();
    assert.equal(copied, '未保存一\n未保存二');
    assert.equal(copied.includes('chat-1'), false);
    assert.equal(writes.length, 0);
});

test('Escape 关闭冲突面板并回到打开它的元素，输入仍可拿回', () => {
    const document = installMiniDom();
    const writes = watchStorage();
    const opener = document.createElement('button');
    opener.textContent = '输入';
    document.body.append(opener);
    opener.focus();
    const box = sendBox(document, '正在输入');
    showF2Draft(payload, new F2ConflictError());
    const panel = document.querySelector('#vc-f2-conflict');
    assert.equal(panel.open, true);
    panel.dispatch('cancel');
    assert.equal(panel.open, false);
    assert.equal(document.activeElement, opener);
    assert.equal(box.value, '正在输入\nDRAFT_MARKER_91');
    assert.equal(readF2Draft(), payload);
    assert.equal(document.querySelector('#vc-f2-recall').hidden, false);
    assert.equal(writes.length, 0);
});
