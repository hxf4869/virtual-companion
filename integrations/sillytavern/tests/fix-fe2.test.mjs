// FIX-FE 第二轮：外壳导航、列表保持、剧情滚动、头像白名单、分段释放与详情布局。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { avatarUrl } from '../extension/vc-model-settings/conversations.js';
import { renderCharactersTab } from '../extension/vc-model-settings/instance-page.js';
import { bindOpenMemory, requestOpenMemory } from '../extension/vc-model-settings/memory-page.js';
import { mountShell } from '../extension/vc-model-settings/shell.js';
import { mountStoryTab } from '../extension/vc-model-settings/story-page.js';
import { installMiniDom } from './mini-dom.mjs';

const shellCssUrl = new URL('../extension/vc-model-settings/shell.css', import.meta.url);
const shellJsUrl = new URL('../extension/vc-model-settings/shell.js', import.meta.url);
const instanceCssUrl = new URL('../extension/vc-model-settings/instance.css', import.meta.url);
const memoryCssUrl = new URL('../extension/vc-model-settings/memory.css', import.meta.url);
const memoryJsUrl = new URL('../extension/vc-model-settings/memory-page.js', import.meta.url);
const inboxJsUrl = new URL('../extension/vc-model-settings/inbox-page.js', import.meta.url);
const indexUrl = new URL('../extension/vc-model-settings/index.js', import.meta.url);
const storyJsUrl = new URL('../extension/vc-model-settings/story-page.js', import.meta.url);
const pageUrl = new URL('../extension/vc-model-settings/page.js', import.meta.url);

function shellHost() {
    const doc = installMiniDom();
    globalThis.innerWidth = 900;
    const ctx = {
        characterId: 0,
        chatId: 'file',
        chatMetadata: { vc_binding: { relationshipId: '9' } },
        characters: [{ name: '林' }],
        chat: [],
        name1: '主人',
        eventSource: { on() {} },
        eventTypes: { CHAT_CHANGED: 'chat' },
    };
    const root = mountShell({
        document: doc,
        storage: { getItem() { return null; }, setItem() {} },
        getContext: () => ctx,
        loadRelationships: async () => [],
        loadInbox: async () => [],
    });
    return { doc, root };
}

function click(root, node) {
    root.dispatch('click', { target: node });
}

test('头像只接受 http(s)、站内单斜杠和位图 data', () => {
    assert.equal(avatarUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png');
    assert.equal(avatarUrl('http://cdn.example/a.png'), 'http://cdn.example/a.png');
    assert.equal(avatarUrl('/thumbnail?type=avatar&file=a.png'), '/thumbnail?type=avatar&file=a.png');
    assert.equal(avatarUrl('data:image/png;base64,aaaa'), 'data:image/png;base64,aaaa');
    assert.equal(avatarUrl('data:image/jpeg;base64,aaaa'), 'data:image/jpeg;base64,aaaa');
    assert.equal(avatarUrl('data:image/webp;base64,aaaa'), 'data:image/webp;base64,aaaa');
    assert.equal(avatarUrl('data:image/gif;base64,aaaa'), 'data:image/gif;base64,aaaa');
    assert.equal(avatarUrl('//evil.example/a.png').startsWith('//'), false);
    assert.equal(avatarUrl('data:image/svg+xml,<svg></svg>').startsWith('data:'), false);
    assert.equal(avatarUrl('data:text/html,hi').startsWith('data:'), false);
    assert.match(avatarUrl('face.png'), /^\/thumbnail\?/);

    const html = renderCharactersTab({
        cards: [{ characterRef: 'card-1', name: '澄夏', description: '', worldName: '', avatar: '//evil.example/a.png' }],
        relationships: [],
        bindings: [],
        selectedCharacterRef: 'card-1',
        selectedRelationshipId: '',
        creating: false,
        draftName: '',
        savedName: '',
        importError: '',
        loadError: '',
        nameError: '',
        unsaved: null,
    }, { screen: 'detail', detailRef: 'card-1' });
    assert.doesNotMatch(html, /src="\/\//);
    assert.match(html, /src="\/characters\//);

    const safe = renderCharactersTab({
        cards: [{ characterRef: 'card-1', name: '澄夏', description: '', worldName: '', avatar: 'https://cdn.example/a.png' }],
        relationships: [],
        bindings: [],
        selectedCharacterRef: 'card-1',
        selectedRelationshipId: '',
        creating: false,
        draftName: '',
        savedName: '',
        importError: '',
        loadError: '',
        nameError: '',
        unsaved: null,
    }, { screen: 'detail', detailRef: 'card-1' });
    assert.match(safe, /src="https:\/\/cdn\.example\/a\.png"/);

    const bitmap = renderCharactersTab({
        cards: [{ characterRef: 'card-1', name: '澄夏', description: '', worldName: '', avatar: 'data:image/webp;base64,qq' }],
        relationships: [],
        bindings: [],
        selectedCharacterRef: 'card-1',
        selectedRelationshipId: '',
        creating: false,
        draftName: '',
        savedName: '',
        importError: '',
        loadError: '',
        nameError: '',
        unsaved: null,
    }, { screen: 'detail', detailRef: 'card-1' });
    assert.match(bitmap, /src="data:image\/webp;base64,qq"/);
});

test('角色卡描述是左对齐分组，默认四行并带展开', () => {
    const detail = renderCharactersTab({
        cards: [{ characterRef: 'card-1', name: '澄夏', description: '沿湖散步的人设很长', worldName: '湖畔日常', avatar: '' }],
        relationships: [],
        bindings: [],
        selectedCharacterRef: 'card-1',
        selectedRelationshipId: '',
        creating: false,
        draftName: '',
        savedName: '',
        importError: '',
        loadError: '',
        nameError: '',
        unsaved: null,
    }, { screen: 'detail', detailRef: 'card-1' });
    assert.match(detail, /class="vc-poster"[\s\S]*<\/div><section class="vc-group vc-card-description"/);
    assert.match(detail, /vc-card-description-text">沿湖散步的人设很长/);
    assert.match(detail, /data-action="toggle-description"/);
    assert.match(detail, /aria-expanded="false"/);
    assert.match(detail, />展开</);
    assert.equal(detail.includes('vc-poster') && /vc-poster"[^>]*>[\s\S]*vc-instance-secondary/.test(detail), false);

    const open = renderCharactersTab({
        cards: [{ characterRef: 'card-1', name: '澄夏', description: '沿湖散步的人设很长', worldName: '', avatar: '' }],
        relationships: [],
        bindings: [],
        selectedCharacterRef: 'card-1',
        selectedRelationshipId: '',
        creating: false,
        draftName: '',
        savedName: '',
        importError: '',
        loadError: '',
        nameError: '',
        unsaved: null,
    }, { screen: 'detail', detailRef: 'card-1', descriptionOpen: true });
    assert.match(open, /vc-card-description is-open/);
    assert.match(open, /aria-expanded="true"/);
    assert.match(open, />收起</);
});

test('新外观事件只切换目的地，不调用旧对话框', async () => {
    const opened = [];
    const { root } = shellHost();
    assert.ok(root);
    const shell = await import('../extension/vc-model-settings/shell.js');
    root.openCharacters = () => opened.push('characters');
    globalThis.dispatchEvent(new CustomEvent('vc-shell-navigate', { detail: { destination: 'story', opener: null } }));
    assert.equal(root.dataset.destination, 'story');
    globalThis.dispatchEvent(new CustomEvent('vc-open-characters', { detail: { opener: null } }));
    assert.equal(root.dataset.destination, 'characters');
    globalThis.dispatchEvent(new CustomEvent('vc-open-memory', { detail: { opener: null } }));
    assert.equal(root.dataset.destination, 'memory');
    globalThis.dispatchEvent(new CustomEvent('vc-view-inbox', { detail: { opener: null } }));
    assert.equal(root.dataset.destination, 'inbox');
    assert.equal(opened.length, 0);
    assert.equal(typeof shell.whoTintBackground, 'function');
    if (typeof shell.whoTintBackground !== 'function') return;
    assert.match(shell.whoTintBackground('12, 34, 56'), /color-mix\(in srgb, rgb\(12, 34, 56\) 6%/);
    assert.equal(shell.whoTintBackground('//evil'), '');
    assert.equal(shell.whoTintBackground(''), '');
});

test('中等宽度手动打开的会话列表在缩放后保留，换目的地或会话后收起', async () => {
    const { root } = shellHost();
    await root.openConversation({ relationshipId: '9', characterIndex: 0, file: 'file', name: '林' });
    assert.equal(root.dataset.list, 'hidden');
    const toggle = root.querySelector('[data-list-toggle]');
    click(root, toggle);
    assert.equal(root.dataset.list, 'open');
    globalThis.innerWidth = 1000;
    globalThis.dispatchEvent(new Event('resize'));
    assert.equal(root.dataset.list, 'open');
    globalThis.innerWidth = 900;
    globalThis.dispatchEvent(new Event('resize'));
    assert.equal(root.dataset.list, 'open');

    const memory = root.querySelectorAll('[data-nav]').find((node) => node.getAttribute('data-nav') === 'memory');
    const chat = root.querySelectorAll('[data-nav]').find((node) => node.getAttribute('data-nav') === 'chat');
    click(root, memory);
    click(root, chat);
    assert.equal(root.dataset.list, 'hidden');

    click(root, toggle);
    assert.equal(root.dataset.list, 'open');
    await root.openConversation({ relationshipId: '10', characterIndex: 0, file: 'file', name: '周' });
    assert.equal(root.dataset.list, 'hidden');
});

test('设置账户行名字与副标题分成两行', () => {
    globalThis.innerWidth = 1000;
    const { root } = shellHost();
    const settings = root.querySelector('[data-settings]');
    click(root, settings);
    const copy = root.querySelector('.vc-settings-copy');
    assert.ok(copy);
    assert.equal(copy.querySelector('.vc-settings-name')?.textContent, '主人');
    assert.equal(copy.querySelector('.vc-settings-meta')?.textContent, '密码与身份验证器');
});

test('新外观下记忆入口事件不打开旧对话框', () => {
    installMiniDom();
    document.body.classList.add('vc-ui');
    const opened = [];
    bindOpenMemory((opener) => opened.push(opener));
    requestOpenMemory({ id: 'nav' });
    assert.equal(opened.length, 0);
});

test('旧外观记忆入口事件仍打开对话框', () => {
    installMiniDom();
    document.body.classList.remove('vc-ui');
    const opened = [];
    bindOpenMemory((opener) => opened.push(opener));
    const button = { id: 'memory' };
    requestOpenMemory(button);
    assert.equal(opened.length, 1);
    assert.equal(opened[0], button);
});

test('剧情重绘保留滚动和焦点，滚动只绑一次，销毁清掉长按', async () => {
    installMiniDom();
    document.body.classList.add('vc-ui');
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    const container = document.createElement('div');
    document.body.append(container);
    try {
        const handle = mountStoryTab(container, { getConversation: () => ({ conversationId: '', mode: 'COMPANION' }) });
        await handle.refresh();
        const scroll = container.querySelector('.vc-scroll');
        scroll.scrollTop = 140;
        const button = container.querySelector('button');
        const action = button.getAttribute('data-action');
        button.focus();
        await handle.refresh();
        const nextScroll = container.querySelector('.vc-scroll');
        assert.equal(nextScroll.scrollTop, 140);
        const again = container.querySelectorAll('button').find((node) => node.getAttribute('data-action') === action);
        assert.equal(document.activeElement, again);
        const story = container.querySelector('.vc-story-tab');
        assert.equal(story.listeners.scroll?.length || 0, 1);
        assert.equal(nextScroll.listeners?.scroll?.length || 0, 0);

        const jobs = new Map();
        let seq = 0;
        const origSet = globalThis.setTimeout;
        const origClear = globalThis.clearTimeout;
        globalThis.setTimeout = (fn) => {
            const id = ++seq;
            jobs.set(id, fn);
            return id;
        };
        globalThis.clearTimeout = (id) => { jobs.delete(id); };
        try {
            story.listeners.pointerdown[0]({
                target: { closest: (sel) => (String(sel).includes('vc-npc') ? { dataset: {} } : null), dataset: {} },
                button: 0,
            });
            const id = [...jobs.keys()].at(-1);
            assert.ok(id);
            handle.destroy();
            assert.equal(jobs.has(id), false);
        } finally {
            globalThis.setTimeout = origSet;
            globalThis.clearTimeout = origClear;
        }
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test('回档确认带回打开者，节点替换后聚焦舞台标题', async () => {
    const story = await import('../extension/vc-model-settings/story-page.js');
    assert.equal(typeof story.focusIfDetached, 'function');
    if (typeof story.focusIfDetached !== 'function') return;
    const doc = installMiniDom();
    const title = doc.createElement('h1');
    title.className = 'vc-nav-title';
    doc.body.append(title);
    const live = doc.createElement('button');
    doc.body.append(live);
    live.focus();
    assert.equal(story.focusIfDetached(live, title), false);
    assert.equal(doc.activeElement, live);
    const gone = doc.createElement('button');
    assert.equal(story.focusIfDetached(gone, title), true);
    assert.equal(doc.activeElement, title);
    const src = await readFile(storyJsUrl, 'utf8');
    const chunk = src.slice(src.indexOf('async function maybeRewind'), src.indexOf('async function enterStage'));
    assert.match(chunk, /opener/);
    assert.match(chunk, /focusIfDetached/);
    assert.match(src.slice(src.indexOf('function destroy')), /clearTimeout\(holdTimer\)/);
});

test('记忆和陪伴重绘前释放上一段分段控件', async () => {
    const memory = await import('../extension/vc-model-settings/memory-page.js');
    const inbox = await import('../extension/vc-model-settings/inbox-page.js');
    assert.equal(typeof memory.releaseSegment, 'function');
    assert.equal(typeof inbox.releaseSegment, 'function');
    if (typeof memory.releaseSegment !== 'function' || typeof inbox.releaseSegment !== 'function') return;
    let calls = 0;
    memory.releaseSegment({ dispose() { calls += 1; } });
    inbox.releaseSegment({ dispose() { calls += 1; } });
    memory.releaseSegment(null);
    inbox.releaseSegment({});
    assert.equal(calls, 2);
    const memorySrc = await readFile(memoryJsUrl, 'utf8');
    const inboxSrc = await readFile(inboxJsUrl, 'utf8');
    const memoryPaint = memorySrc.slice(memorySrc.indexOf('function paint(state)'), memorySrc.indexOf('container.addEventListener'));
    const inboxPaint = inboxSrc.slice(inboxSrc.indexOf('function paint(state)'), inboxSrc.indexOf('function syncConflict'));
    assert.ok(memoryPaint.indexOf('releaseSegment') !== -1 && memoryPaint.indexOf('releaseSegment') < memoryPaint.indexOf('bindSegment'));
    assert.ok(inboxPaint.indexOf('releaseSegment') !== -1 && inboxPaint.indexOf('releaseSegment') < inboxPaint.indexOf('bindSegment'));
});

test('生成预算 clone 失败时原样返回，init 只登记一次', async () => {
    const page = await import('../extension/vc-model-settings/page.js');
    assert.equal(typeof page.observeGenerateBudget, 'function');
    assert.equal(typeof page.claimExtensionInit, 'function');
    assert.equal(typeof page.guardSameTurn, 'function');
    assert.equal(typeof page.legacyDialogAllowed, 'function');
    if (typeof page.observeGenerateBudget !== 'function') return;
    const response = {
        ok: false,
        headers: { get: () => 'application/json' },
        clone() { throw new Error('locked'); },
    };
    const signals = [];
    assert.equal(page.observeGenerateBudget(response, (signal) => signals.push(signal)), response);
    assert.equal(signals.length, 0);
    const ok = { ok: true, headers: { get: () => 'application/json' }, clone() { throw new Error('no'); } };
    assert.equal(page.observeGenerateBudget(ok, () => signals.push('x')), ok);
    assert.equal(page.claimExtensionInit(), true);
    assert.equal(page.claimExtensionInit(), false);
    let runs = 0;
    const guarded = page.guardSameTurn(() => { runs += 1; });
    guarded();
    guarded();
    assert.equal(runs, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    guarded();
    assert.equal(runs, 2);
    const doc = installMiniDom();
    assert.equal(page.legacyDialogAllowed(doc), true);
    doc.body.classList.add('vc-ui');
    assert.equal(page.legacyDialogAllowed(doc), false);
    const index = await readFile(indexUrl, 'utf8');
    assert.match(index, /if \(!claimExtensionInit\(\)\) return;/);
    assert.match(index, /observeGenerateBudget\(response/);
    assert.match(index, /guardSameTurn/);
    assert.match(index, /legacyDialogAllowed\(\)/);
});

test('外壳样式去掉气泡宽度冲突，并给详情和账户行留出位置', async () => {
    const css = await readFile(shellCssUrl, 'utf8');
    const shell = await readFile(shellJsUrl, 'utf8');
    const instanceCss = await readFile(instanceCssUrl, 'utf8');
    const memoryCss = await readFile(memoryCssUrl, 'utf8');
    assert.doesNotMatch(css, /\.mes_block,/);
    assert.doesNotMatch(css, /\.mes_block \{[^}]*!important/);
    assert.match(shell, /whoTintBackground/);
    assert.match(css, /--vc-detail-pad:\s*calc\(84px \+ env\(safe-area-inset-bottom, 0px\)\)/);
    assert.match(css, /is-detail\) \.vc-scroll \{\s*padding-bottom: var\(--vc-detail-pad\)/);
    assert.match(css, /\.vc-settings-copy \{[^}]*flex-direction:\s*column/);
    assert.match(instanceCss, /-webkit-line-clamp:\s*4/);
    assert.match(instanceCss, /text-align:\s*left/);
    assert.match(memoryCss, /\.vc-shell-page:has\(\.vc-memory-tab\.is-detail\) > \.vc-navbar \{\s*display:\s*none;/);
    assert.match(await readFile(memoryJsUrl, 'utf8'), /classList\.toggle\('is-detail'/);
    assert.match(await readFile(inboxJsUrl, 'utf8'), /classList\.toggle\('is-detail'/);
});
