// FIX-FE 第三轮：走查提速、浅色可读性、背景抽屉、账户遮罩、警示条、剧情舞台、抬起层。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { mountShell } from '../extension/vc-model-settings/shell.js';
import { mountStoryTab } from '../extension/vc-model-settings/story-page.js';
import { installMiniDom } from './mini-dom.mjs';

const walkUrl = new URL('../scripts/vc-ui-walkthrough.mjs', import.meta.url);
const guardUrl = new URL('../scripts/lib/overlay-guard.mjs', import.meta.url);
const settingsCssUrl = new URL('../extension/vc-model-settings/settings-pages.css', import.meta.url);
const drawersCssUrl = new URL('../extension/vc-model-settings/drawers.css', import.meta.url);
const shellCssUrl = new URL('../extension/vc-model-settings/shell.css', import.meta.url);
const chatCssUrl = new URL('../extension/vc-model-settings/chat-view.css', import.meta.url);
const tokenCssUrl = new URL('../extension/vc-model-settings/vc-ui.css', import.meta.url);
const designUrl = new URL('../../../DESIGN.md', import.meta.url);

function shellHost(width) {
    const doc = installMiniDom();
    doc.body.classList.add('vc-ui');
    globalThis.innerWidth = width;
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

function channel(hex, index) {
    const n = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function contrast(fore, back) {
    const lum = (hex) => {
        const [r, g, b] = [0, 1, 2].map((index) => channel(hex, index));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [lum(fore), lum(back)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
}

function themeBlock(css, theme) {
    const re = theme === 'light'
        ? /html\[data-vc-theme="light"\] body\.vc-ui \{([\s\S]*?)\n\}/
        : /html\[data-vc-theme="dark"\] body\.vc-ui \{([\s\S]*?)\n\}/;
    const block = css.match(re);
    assert.ok(block, theme);
    return block[1];
}

function token(css, theme, name) {
    const found = themeBlock(css, theme).match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(found, `${theme} ${name}`);
    return found[1].toLowerCase();
}

test('走查图标就绪看可见字形，超时要计数', async () => {
    const mod = await import('../scripts/vc-ui-walkthrough.mjs');
    assert.equal(mod.iconUsesReady([]), true);
    assert.equal(mod.iconUsesReady([{ visible: false, width: 0 }]), true);
    assert.equal(mod.iconUsesReady([{ visible: true, width: 0 }]), false);
    assert.equal(mod.iconUsesReady([{ visible: true, width: 8 }, { visible: false, width: 0 }]), true);
    assert.deepEqual(mod.noteForIconSettleTimeouts(0), []);
    assert.deepEqual(mod.noteForIconSettleTimeouts(3), ['图标未在时限内就绪 3']);
    const order = [];
    const lock = mod.createMutex();
    const first = lock(async () => {
        order.push('a');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('a2');
    });
    const second = lock(async () => { order.push('b'); });
    await Promise.all([first, second]);
    assert.deepEqual(order, ['a', 'a2', 'b']);
    assert.deepEqual(
        mod.walkthroughGroups([{ width: 390 }, { width: 1440 }]).map((group) => `${group.theme}-${group.viewport.width}`),
        ['light-390', 'light-1440', 'dark-390', 'dark-1440'],
    );
    const walk = await readFile(walkUrl, 'utf8');
    const settleStart = walk.indexOf('async function settle');
    const settle = walk.slice(settleStart, walk.indexOf('\nfunction ', settleStart + 10));
    assert.match(settle, /getBBox\(\)/);
    assert.match(settle, /iconSettleTimeouts/);
    assert.doesNotMatch(settle, /startsWith\('#'\)/);
    assert.doesNotMatch(settle, /waitForFunction\([\s\S]*?\.catch\(\(\) => \{\}\)/);
    assert.match(walk, /Promise\.all\(/);
    assert.match(walk, /storageState/);
    assert.match(walk, /createMutex\(\)/);
    assert.match(walk, /noteForIconSettleTimeouts\(iconSettleTimeouts\)/);
    assert.match(walk, /storyLock\(/);
    assert.doesNotMatch(walk, /await sleep\(250\)/);
    assert.doesNotMatch(walk, /await sleep\(400\)/);
});

test('走查把推入的设置页和非当前页算作残留', async () => {
    const { allowedOverlays, unexpectedOverlays } = await import('../scripts/lib/overlay-guard.mjs');
    assert.deepEqual(allowedOverlays('settings'), ['sheet', 'settings']);
    assert.deepEqual(allowedOverlays('model-home'), ['model', 'settings']);
    assert.deepEqual(allowedOverlays('model-provider'), ['model', 'settings']);
    assert.deepEqual(allowedOverlays('account'), ['dialog', 'settings']);
    assert.deepEqual(allowedOverlays('story-stage'), []);
    assert.deepEqual(allowedOverlays('tavern-prompt'), ['drawer']);
    assert.deepEqual(unexpectedOverlays(['settings', 'page'], []), ['settings', 'page']);
    assert.deepEqual(unexpectedOverlays(['settings'], ['settings']), []);
    const walk = await readFile(walkUrl, 'utf8');
    const recordStart = walk.indexOf('const record = async');
    const record = walk.slice(recordStart, walk.indexOf('shots.push', recordStart));
    assert.match(record, /data-settings'\) === 'page'|dataset\.settings === 'page'/);
    assert.match(record, /data-vc-page/);
    assert.match(record, /stage-hidden/);
    assert.match(record, /removeSheets\(page\)/);
    assert.doesNotMatch(record, /dismissSheet/);
    const guard = await readFile(guardUrl, 'utf8');
    assert.match(guard, /settings/);
});

test('浅色模型按钮和模型行改走外观令牌', async () => {
    const css = await readFile(settingsCssUrl, 'utf8');
    assert.match(css, /body\.vc-ui #vc-model-settings-root \.vcms-btn-ghost[\s\S]*color:\s*var\(--vc-ink\)/);
    assert.match(css, /body\.vc-ui #vc-model-settings-root \.vcms-btn-primary-outline[\s\S]*color:\s*var\(--vc-accent-text\)/);
    assert.match(css, /body\.vc-ui #vc-model-settings-root \.vcms-model-row[\s\S]*background:\s*var\(--vc-group\)/);
    assert.match(css, /body\.vc-ui #vc-model-settings-root \.vcms-model-row[\s\S]*color:\s*var\(--vc-ink\)/);
    assert.match(css, /body\.vc-ui \.vc-data-root \.vc-data-dialog::backdrop[\s\S]*background:\s*transparent/);
});

test('背景抽屉内层和提示词警告条走外观令牌', async () => {
    const css = await readFile(drawersCssUrl, 'utf8');
    assert.match(css, /body\.vc-ui #Backgrounds\.vc-drawer-page :is\(#bg-header-fixed, #bg_tabs, \.ui-widget-content\)[\s\S]*background:\s*var\(--vc-canvas\)/);
    assert.doesNotMatch(css, /#Backgrounds[\s\S]{0,400}\.bg_example[\s\S]{0,80}background/);
    assert.match(css, /#advanced-formatting-cc-notice[\s\S]*color:\s*var\(--vc-warning\)/);
    assert.match(css, /#advanced-formatting-cc-notice[\s\S]*background:\s*var\(--vc-group\)/);
    const tokens = await readFile(tokenCssUrl, 'utf8');
    for (const theme of ['light', 'dark']) {
        const ratio = contrast(token(tokens, theme, '--vc-warning'), token(tokens, theme, '--vc-group'));
        assert.ok(ratio >= 4.5, `${theme} ${ratio}`);
    }
});

test('剧情舞台盖过推入的设置页', async () => {
    const css = await readFile(shellCssUrl, 'utf8');
    assert.match(css, /#vc-shell\[data-cover="story"\] \.vc-shell-page\[data-page="story"\][\s\S]*z-index:\s*var\(--vc-z-page\)/);
    assert.match(css, /#vc-shell\[data-cover="story"\] \.vc-shell-settings[\s\S]*display:\s*none !important/);
});

test('关闭设置后，点外壳内部不会再打开设置', () => {
    const { root } = shellHost(1440);
    click(root, root.querySelector('[data-settings]'));
    assert.equal(root.dataset.settings, 'page');
    click(root, root.querySelector('[data-settings-done]'));
    assert.notEqual(root.dataset.settings, 'page');
    click(root, root.querySelector('.vc-shell-page'));
    assert.notEqual(root.dataset.settings, 'page');
});

test('进入剧情舞台时清掉推入的设置页，且不自动打开模型设置', async () => {
    const previousFetch = globalThis.fetch;
    const previousMatch = globalThis.matchMedia;
    globalThis.matchMedia = (query) => ({
        matches: String(query).includes('reduce'),
        media: String(query),
        addEventListener() {},
        removeEventListener() {},
    });
    globalThis.fetch = async (url) => {
        const path = String(url);
        let body = {};
        if (path.endsWith('/auth/session')) body = { accountId: '11', sessionId: '42' };
        else if (path.endsWith('/model-purposes')) body = [{ purpose: 'STORY_DIRECTOR', status: 'MISSING' }, { purpose: 'NPC_DIALOGUE', status: 'MISSING' }];
        else if (path.endsWith('/st/bindings')) body = { conversationId: '11', relationshipId: '8', chatIdentity: 'c', characterRef: 'r', mode: 'STORY' };
        else if (path.endsWith('/story/runs')) body = { conversationId: '11', runId: '13', branchId: '17', caseId: 'rainy-inn-v1', worldVersion: 0, stage: 'investigation', participants: [{ actorId: 'player', name: '调查者', role: 'player' }] };
        else if (path.includes('/actors/player/view')) body = { participants: [{ actorId: 'lin', name: '林岚', publicPersona: '公开人设' }], publicLore: { setting: '雨夜旅馆' }, knowledge: [], events: [] };
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
    };
    const { doc, root } = shellHost(1440);
    const configured = { n: 0 };
    const container = root.querySelector('[data-page="story"]');
    try {
        mountStoryTab(container, {
            getConversation: () => ({ conversationId: '', mode: 'COMPANION' }),
            onConfigure: () => { configured.n += 1; },
        });
        const story = container.querySelector('.vc-story-tab');
        let start = null;
        for (let i = 0; i < 50 && !start; i += 1) {
            start = story.querySelector('[data-action="start"]');
            if (!start) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.ok(start);
        story.ownerDocument = doc;
        root.dataset.settings = 'page';
        for (const fn of story.listeners.click || []) fn({ target: start, button: 0 });
        for (let i = 0; i < 50 && story.dataset.view !== 'stage'; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(story.dataset.view, 'stage');
        assert.notEqual(root.dataset.settings, 'page');
        assert.equal(configured.n, 0);
        const configure = story.querySelector('[data-action="configure"]');
        assert.ok(configure);
        for (const fn of story.listeners.click || []) fn({ target: configure, button: 0 });
        assert.equal(configured.n, 1);
    } finally {
        globalThis.fetch = previousFetch;
        globalThis.matchMedia = previousMatch;
    }
});

test('桌面进入账户后关掉设置层，手机上的设置 sheet 仍留着', async () => {
    const listeners = [];
    const previousAdd = globalThis.addEventListener;
    const previousRemove = globalThis.removeEventListener;
    const previousWidth = globalThis.innerWidth;
    const previousHeight = globalThis.innerHeight;
    globalThis.addEventListener = (type, fn, ...rest) => {
        listeners.push({ type, fn });
        previousAdd?.call(globalThis, type, fn, ...rest);
    };
    globalThis.removeEventListener = (type, fn, ...rest) => {
        previousRemove?.call(globalThis, type, fn, ...rest);
    };
    globalThis.innerHeight = 844;
    function clickAction(doc, action) {
        const button = [...doc.querySelectorAll('button')].find((el) => el.getAttribute('data-action') === action);
        assert.ok(button, action);
        const original = button.closest.bind(button);
        button.closest = (sel) => (String(sel).includes('data-action') ? button : original(sel));
        let node = button;
        while (node && !(node.listeners?.click?.length)) node = node.parent;
        assert.ok(node, action);
        node.dispatch('click', { target: button, button: 0 });
    }
    function mount(doc, width) {
        globalThis.innerWidth = width;
        return mountShell({
            document: doc,
            storage: { getItem() { return null; }, setItem() {} },
            getContext: () => ({ name1: '主人', eventSource: { on() {} }, eventTypes: {} }),
            loadRelationships: async () => [],
            loadInbox: async () => [],
            seams: {
                surface: async () => ({
                    openAccountData() {
                        const dialog = doc.createElement('dialog');
                        dialog.className = 'vc-data-dialog';
                        dialog.setAttribute('open', '');
                        doc.body.append(dialog);
                    },
                }),
            },
        });
    }
    try {
        const phone = installMiniDom();
        phone.body.classList.add('vc-ui');
        const narrow = mount(phone, 390);
        click(narrow, narrow.querySelector('[data-settings]'));
        assert.ok(phone.querySelector('.vc-sheet'));
        clickAction(phone, 'data');
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.ok(phone.querySelector('.vc-sheet'), '手机上返回设置仍要留着 sheet');
        const dialog = phone.createElement('dialog');
        dialog.className = 'vc-data-dialog';
        dialog.setAttribute('open', '');
        phone.body.append(dialog);
        globalThis.innerWidth = 1440;
        for (const item of listeners) if (item.type === 'resize') item.fn();
        assert.equal(phone.querySelector('.vc-sheet'), null);
        assert.notEqual(narrow.dataset.settings, 'page');

        const desk = installMiniDom();
        desk.body.classList.add('vc-ui');
        const wide = mount(desk, 1440);
        click(wide, wide.querySelector('[data-settings]'));
        assert.equal(wide.dataset.settings, 'page');
        const pane = wide.querySelector('.vc-shell-settings');
        assert.equal(pane.style.getPropertyValue('--vc-nav-p'), '0');
        clickAction(desk, 'data');
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.notEqual(wide.dataset.settings, 'page');
        assert.ok(desk.querySelector('.vc-data-dialog'));
    } finally {
        globalThis.addEventListener = previousAdd;
        globalThis.removeEventListener = previousRemove;
        globalThis.innerWidth = previousWidth;
        globalThis.innerHeight = previousHeight;
    }
});

test('酒馆横幅按钮改成用户语言，投影动作不变', async () => {
    const src = await readFile(new URL('../extension/vc-model-settings/projection.js', import.meta.url), 'utf8');
    assert.match(src, /data-vcfg-action="reproject">恢复为模型页设置</);
    assert.equal(src.includes('${escHtml(model.revisions'), false);
    assert.doesNotMatch(src, />重新投影</);
});

test('长按抬起层只用叠层表里的 lift', async () => {
    const css = await readFile(chatCssUrl, 'utf8');
    const design = await readFile(designUrl, 'utf8');
    assert.match(design, /--vc-z-lift` \| 80 \| 长按抬起的消息/);
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((item) => item[1].includes('.vc-lift') && item[2].includes('z-index'));
    assert.equal(blocks.length, 1);
    assert.match(blocks[0][2], /z-index:\s*var\(--vc-z-lift\)/);
    assert.doesNotMatch(blocks[0][2], /--vc-z-alert/);
});
