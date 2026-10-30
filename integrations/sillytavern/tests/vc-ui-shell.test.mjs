import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { installMiniDom } from './mini-dom.mjs';
import {
    chatSnapshotFromContext,
    chatSnapshotsFromRecent,
    conversationRows,
    renderConversationRow,
    renderConversationRows,
} from '../extension/vc-model-settings/conversations.js';
import {
    CHAT_EMPTY_COPY,
    DESTINATIONS,
    REPLY_STYLE_KEY,
    TAVERN_ENTRIES,
    chromeForWidth,
    createDestinationHost,
    mountShell,
    openChatAction,
    openHostDrawer,
    openSurfaceAction,
    readReplyStyle,
    readSidebarCollapsed,
    registerShellTabs,
    settingOpener,
    sidebarCssWidth,
    writeReplyStyle,
} from '../extension/vc-model-settings/shell.js';

const indexUrl = new URL('../extension/vc-model-settings/index.js', import.meta.url);
const cssUrl = new URL('../extension/vc-model-settings/shell.css', import.meta.url);

test('导航目的地与断点', () => {
    assert.deepEqual(DESTINATIONS.map((item) => item.nav), ['chat', 'characters', 'memory', 'inbox', 'story']);
    assert.deepEqual(DESTINATIONS.map((item) => item.label), ['聊天', '角色', '记忆', '陪伴', '剧情']);
    assert.equal(DESTINATIONS.some((item) => item.nav === 'models' || item.nav === 'account'), false);
    assert.equal(chromeForWidth(743).nav, 'tabbar');
    assert.equal(chromeForWidth(743).sidebar, 0);
    assert.deepEqual(chromeForWidth(744), { nav: 'sidebar', sidebar: 240, collapsible: true, wide: false, list: 0 });
    assert.equal(chromeForWidth(1179).collapsible, true);
    assert.equal(chromeForWidth(1179).wide, false);
    assert.deepEqual(chromeForWidth(1180), { nav: 'sidebar', sidebar: 240, collapsible: false, wide: true, list: 320 });
    assert.equal(chromeForWidth(Number.NaN).nav, 'tabbar');
    assert.equal(sidebarCssWidth(360, false), 0);
    assert.equal(sidebarCssWidth(800, false), 240);
    assert.equal(sidebarCssWidth(800, true), 72);
    assert.equal(sidebarCssWidth(1179, true), 72);
    assert.equal(sidebarCssWidth(1180, true), 240);
    assert.equal(readSidebarCollapsed({ getItem() { return null; } }), true);
    assert.equal(readSidebarCollapsed({ getItem() { return 'collapsed'; } }), true);
    assert.equal(readSidebarCollapsed({ getItem() { return 'open'; } }), false);
    assert.equal(readSidebarCollapsed({ getItem() { throw new Error('closed'); } }), true);
    assert.equal(CHAT_EMPTY_COPY.includes('会话'), true);
});

test('会话行缺字段不编造', () => {
    const bare = renderConversationRow({ relationshipId: '9', instanceName: '晨间' });
    assert.match(bare, /data-relationship-id="9"/);
    assert.match(bare, /晨间/);
    assert.match(bare, /vc-convo-preview">暂无消息/);
    assert.equal(bare.includes('vc-convo-time'), false);
    assert.equal(bare.includes('vc-convo-unread'), false);
    assert.equal(bare.includes('刚刚'), false);
    assert.equal(bare.includes('未知'), false);

    const full = renderConversationRow({
        relationshipId: '9',
        name: '林',
        instanceName: '晨间',
        time: '18:05',
        preview: '你好',
        unread: true,
    });
    assert.match(full, /vc-convo-name">林/);
    assert.match(full, /vc-convo-inst">晨间/);
    assert.match(full, /vc-convo-time[^>]*>18:05/);
    assert.match(full, /vc-convo-preview">你好/);
    assert.match(full, /vc-convo-unread/);

    const rows = conversationRows([
        { relationshipId: '1', personaRef: 'st-character', companionName: '晨间' },
        { relationshipId: '2', personaRef: 'other', companionName: '不该出现' },
        { relationshipId: '3', personaRef: 'st-character' },
    ], {
        chats: [],
        inboxRows: [{
            intent: 'BODY',
            stDelivered: false,
            linkStatus: 'present',
            relationshipId: '1',
            conversationId: '5',
            body: 'SECRET-BODY',
        }],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].instanceName, '晨间');
    assert.equal(rows[0].preview, undefined);
    assert.equal(rows[0].time, undefined);
    assert.equal(rows[0].name, undefined);
    assert.equal(rows[0].unread, true);
    assert.equal(rows[1].instanceName, '未命名实例');
    assert.equal(rows[1].unread, undefined);
    const html = renderConversationRows(rows);
    assert.equal(html.includes('SECRET-BODY'), false);
    assert.equal(html.includes('不该出现'), false);
    assert.match(html, /vc-convo-preview">暂无消息/);

    const snap = chatSnapshotFromContext({
        chatMetadata: { vc_binding: { relationshipId: '3' } },
        characterId: 0,
        characters: [{ name: '林', avatar: 'a.png' }],
        chatId: 'file',
        chat: [{ is_system: true, mes: '系统提示' }],
    });
    assert.equal(snap.preview, undefined);
    assert.equal(snap.time, undefined);
    assert.equal(snap.characterName, '林');
    assert.equal(snap.avatar, 'a.png');
    assert.equal(snap.file, 'file');
    assert.equal(chatSnapshotFromContext({ chat: [{ mes: '没有绑定' }] }), null);
});

test('设置项映射到宿主入口', () => {
    assert.equal(settingOpener('account'), 'account');
    assert.equal(settingOpener('data'), 'account');
    assert.equal(settingOpener('models'), 'models');
    assert.equal(settingOpener('notifications'), 'inbox');
    assert.deepEqual(TAVERN_ENTRIES.map((item) => item.id), [
        'ai-config-button',
        'advanced-formatting-button',
        'WI-SP-button',
        'extensions-settings-button',
        'persona-management-button',
        'backgrounds-button',
        'user-settings-button',
        'sys-settings-button',
        'rightNavHolder',
    ]);
    for (const entry of TAVERN_ENTRIES) assert.equal(settingOpener(entry.id), entry.id);
    assert.equal(settingOpener('models-page'), '');

    const doc = installMiniDom();
    const drawer = doc.createElement('div');
    drawer.id = 'ai-config-button';
    const toggle = doc.createElement('div');
    toggle.classList.add('drawer-toggle');
    let clicks = 0;
    toggle.addEventListener('click', () => { clicks += 1; });
    drawer.append(toggle);
    doc.body.append(drawer);
    assert.equal(openHostDrawer('ai-config-button', doc), true);
    assert.equal(clicks, 1);
    assert.equal(openHostDrawer('missing-drawer', doc), false);
});

test('外观偏好读写兜底', () => {
    assert.equal(readReplyStyle({ getItem() { throw new Error('closed'); } }), 'spread');
    const mem = new Map();
    const storage = {
        getItem(key) { return mem.has(key) ? mem.get(key) : null; },
        setItem(key, value) { mem.set(key, value); },
    };
    assert.equal(writeReplyStyle('nope', storage), 'spread');
    assert.equal(mem.get(REPLY_STYLE_KEY), 'spread');
    assert.equal(writeReplyStyle('bubble', storage), 'bubble');
    assert.equal(readReplyStyle(storage), 'bubble');
    assert.equal(writeReplyStyle('spread', {
        getItem() { return 'bubble'; },
        setItem() { throw new Error('full'); },
    }), 'spread');
});

test('新外观默认挂载，仅 off 时不挂载外壳', () => {
    const doc = installMiniDom();
    const before = doc.body.children.length;
    assert.equal(mountShell({ document: doc, storage: { getItem() { return 'off'; }, setItem() {} } }), null);
    assert.equal(doc.body.children.length, before);
    assert.equal(doc.querySelector('#vc-shell'), null);
    assert.equal(doc.querySelector('#vc-shell-css'), null);
    const opened = mountShell({ document: doc, storage: { getItem() { return null; }, setItem() {} } });
    assert.equal(opened?.id, 'vc-shell');
    const second = installMiniDom();
    const thrown = mountShell({ document: second, storage: { getItem() { throw new Error('closed'); } } });
    assert.equal(thrown?.id, 'vc-shell');
});

test('index 只在标志打开时挂载外壳', async () => {
    const src = await readFile(indexUrl, 'utf8');
    assert.match(src, /function mountVcUi\(\) \{\n    if \(!readVcUiFlag\(\)\) return;\n    enableVcUi\(\);/);
    assert.equal([...src.matchAll(/enableVcUi\(\)/g)].length, 1);
    assert.match(src, /if \(readVcUiFlag\(\)\) \{\n\s+const navigation = \{\n\s+openInstance\(\) \{\},\n\s+\};\n\s+registerShellTabs\(\{/);
    assert.ok(src.indexOf('mountShell({') > src.indexOf('registerShellTabs({'));
    // mountVcUi 以列表加载 vc-ui.css、drawers.css 等；仍须在外壳挂载之前。
    const ui = src.indexOf("'./vc-ui.css'");
    const call = src.indexOf('mountShell({');
    assert.ok(ui !== -1 && call > ui);
});

test('shell.css 只在 body.vc-ui 下生效', async () => {
    const css = stripComments(await readFile(cssUrl, 'utf8'));
    assert.equal(/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/.test(css), false);
    assert.equal(css.includes('rgb('), false);
    assert.equal(css.includes('hsl('), false);
    assert.equal(css.includes('grid-template-columns: 72px minmax(0, 1fr)'), true);
    assert.match(css, /\[data-chat="closed"\] \.vc-shell-chat > \.vc-navbar \{\s*display: none;/);
    assert.equal(css.includes('minmax(180px, 320px)'), false);
    assert.match(css, /#vc-shell\[data-chrome="sidebar"\] \.vc-navbar \[data-settings\] \{\s*display: none;/);
    assert.match(css, /\[data-page="inbox"\] \.vc-inbox-tab > \.vc-screen > \.vc-navbar:not\(\.is-solid\) \{\s*position: absolute;/);
    assert.match(css, /\[data-page="story"\] \.vc-story-tab:not\(\[data-view="stage"\]\) \.vc-scroll \{\s*padding-top: env\(safe-area-inset-top\);/);
    assert.match(css, /\[data-page="story"\] \.vc-story-tab:not\(\[data-view="stage"\]\) \.vc-navbar \{\s*display: none;/);
    assert.match(css, /\[data-page="memory"\] \.vc-memory-tab:not\(\.is-detail\) \.vc-column,\s*body\.vc-ui \.vc-shell-page\[data-page="inbox"\] \.vc-inbox-tab:not\(\.is-detail\) \.vc-column \{\s*padding-top: 0;/);
    const errors = [];
    walkCss(css, (selector) => {
        for (const part of selector.split(',')) {
            const piece = part.trim();
            if (piece && !piece.includes('body.vc-ui')) errors.push(piece);
        }
    });
    assert.deepEqual(errors, []);
});

test('键盘焦点环只给可交互控件，标题不显示焦点框', async () => {
    const ui = await readFile(new URL('../extension/vc-model-settings/vc-ui.css', import.meta.url), 'utf8');
    assert.equal(/body\.vc-ui :focus-visible \{/.test(ui), false);
    assert.match(ui, /body\.vc-ui :is\([^)]*button[^)]*\):focus-visible/);
    assert.match(ui, /body\.vc-ui :is\(h1, h2, h3\)\[tabindex="-1"\]:focus/);
    assert.match(ui, /outline:\s*none/);
});

test('同名实例去重、用角色卡头像，并用序号区分', () => {
    const duplicated = conversationRows([
        { relationshipId: '9', personaRef: 'st-character', companionName: '晨间' },
        { relationshipId: '9', personaRef: 'st-character', companionName: '晨间' },
    ]);
    assert.equal(duplicated.length, 1);

    const rows = conversationRows([
        { relationshipId: 'rel-2', personaRef: 'st-character', companionName: '外壳', createdAt: '2026-10-28T01:00:00Z' },
        { relationshipId: 'rel-3', personaRef: 'st-character', companionName: '外壳', createdAt: '2026-10-29T09:30:00Z' },
    ], {
        characters: [{ name: '外壳', avatar: 'shell.png' }],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].avatar, 'shell.png');
    assert.equal(rows[1].avatar, 'shell.png');
    const html = renderConversationRows(rows);
    assert.match(html, /shell\.png/);
    assert.equal(html.includes('>rel-2<'), false);
    assert.equal(html.includes('>rel-3<'), false);
    const inst = [...html.matchAll(/vc-convo-inst">([^<]+)</g)].map((item) => item[1]);
    assert.deepEqual(inst, ['外壳', '外壳 · 2']);
    assert.equal(html.includes('2026'), false);
    const tied = conversationRows([
        { relationshipId: 'a', personaRef: 'st-character', companionName: '外壳', createdAt: '2026-10-30T00:55:01Z' },
        { relationshipId: 'b', personaRef: 'st-character', companionName: '外壳', createdAt: '2026-10-30T00:55:01Z' },
    ], {
        characters: [{ name: '外壳', avatar: 'shell.png' }],
        chats: [{ relationshipId: 'b', characterName: '外壳', preview: '你好', time: '2026-10-30T00:54:00Z' }],
    });
    const tiedHtml = renderConversationRows(tied);
    const tiedInst = [...tiedHtml.matchAll(/vc-convo-inst">([^<]+)</g)].map((item) => item[1]);
    assert.deepEqual(tiedInst, ['外壳', '外壳 · 2']);
    assert.equal(tiedHtml.includes('还没有消息'), false);
    assert.equal(tiedHtml.includes('2026'), false);
    assert.equal(new Set([...tiedHtml.matchAll(/aria-label="([^"]+)"/g)].map((item) => item[1])).size, 2);
    const named = renderConversationRow({ relationshipId: 'rel-9', name: '林', instanceName: '晨间' });
    assert.match(named, /vc-convo-name">林/);
    assert.match(named, /vc-convo-inst">晨间/);
    assert.equal(named.includes('>rel-9<'), false);
});

test('同一个聊天文件只出现一行，紧挨着创建且没有文件的同名分身不占第二行', () => {
    const relationships = [
        { relationshipId: '2', personaRef: 'st-character', companionName: 'vc-rerank-acceptance', createdAt: '2026-10-29T15:18:48.944Z' },
        { relationshipId: '3', personaRef: 'st-character', companionName: 'vc-rerank-acceptance', createdAt: '2026-10-29T15:18:49.421Z' },
    ];
    const characters = [{
        name: 'vc-rerank-acceptance',
        avatar: 'vc-rerank-acceptance.png',
        data: { extensions: { vc_character_ref: 'ref-v' } },
    }];
    const chats = [{
        relationshipId: '3',
        file: 'vc-rerank-acceptance - 2026-10-29@15h17m31s371ms',
        characterName: 'vc-rerank-acceptance',
        characterRef: 'ref-v',
        avatar: 'vc-rerank-acceptance.png',
        preview: '同一句',
        time: '2026-10-30T02:00:00Z',
    }];
    const open = conversationRows(relationships, { chats, characters });
    assert.equal(open.length, 2);
    const rows = conversationRows(relationships, { chats, characters, chatsComplete: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].relationshipId, '3');
    assert.equal(rows[0].file, chats[0].file);
    assert.equal(rows[0].preview, '同一句');
    assert.equal(rows[0].disambiguator, undefined);
    const html = renderConversationRows(rows);
    assert.equal(html.includes('· 2'), false);
    assert.equal((html.match(/class="vc-cell vc-convo"/g) || []).length, 1);
});

test('两个真实聊天文件各自一行，同名实例仍能区分', () => {
    const rows = conversationRows([
        { relationshipId: '2', personaRef: 'st-character', companionName: '外壳', createdAt: '2026-10-29T15:18:48.000Z' },
        { relationshipId: '3', personaRef: 'st-character', companionName: '外壳', createdAt: '2026-10-29T15:18:49.000Z' },
    ], {
        chatsComplete: true,
        characters: [{ name: '外壳', avatar: 'a.png', data: { extensions: { vc_character_ref: 'ref' } } }],
        chats: [
            { relationshipId: '2', file: 'chat-a', characterRef: 'ref', preview: '甲', time: '2026-10-30T01:00:00Z' },
            { relationshipId: '3', file: 'chat-b', characterRef: 'ref', preview: '乙', time: '2026-10-30T02:00:00Z' },
        ],
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.file), ['chat-a', 'chat-b']);
    const html = renderConversationRows(rows);
    const inst = [...html.matchAll(/vc-convo-inst">([^<]+)</g)].map((item) => item[1]);
    assert.deepEqual(inst, ['外壳', '外壳 · 2']);
    assert.equal(new Set([...html.matchAll(/aria-label="([^"]+)"/g)].map((item) => item[1])).size, 2);
    assert.match(html, /vc-convo-preview">甲/);
    assert.match(html, /vc-convo-preview">乙/);
});

test('几秒内连着创建、开场白相同的两份聊天只留后一条', () => {
    const relationships = [
        { relationshipId: '5', personaRef: 'st-character', companionName: '走查 13d72836', createdAt: '2026-10-30T11:16:58.360Z' },
        { relationshipId: '6', personaRef: 'st-character', companionName: '走查 13d72836', createdAt: '2026-10-30T11:16:58.547Z' },
    ];
    const characters = [{
        name: '走查 13d72836',
        avatar: 'walk.png',
        data: { extensions: { vc_character_ref: 'ref-w' } },
    }];
    const chats = [
        { relationshipId: '5', file: '走查 13d72836 - 2026-10-30@19h16m58s360ms', characterRef: 'ref-w', preview: '合成开场。', time: '2026-10-30T11:16:58.100Z' },
        { relationshipId: '6', file: 'vc-ui-walkthrough-fecc3e5f', characterRef: 'ref-w', preview: '合成开场。', time: '2026-10-30T11:16:58.200Z' },
    ];
    const rows = conversationRows(relationships, { chats, characters, chatsComplete: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].relationshipId, '6');
    assert.equal(rows[0].file, 'vc-ui-walkthrough-fecc3e5f');
    assert.equal(rows[0].preview, '合成开场。');
    assert.equal(renderConversationRows(rows).includes('· 2'), false);
    const later = conversationRows([
        relationships[0],
        { relationshipId: '9', personaRef: 'st-character', companionName: '走查 13d72836', createdAt: '2026-10-30T12:00:00.000Z' },
    ], {
        chatsComplete: true,
        characters,
        chats: [
            chats[0],
            { relationshipId: '9', file: 'another', characterRef: 'ref-w', preview: '合成开场。', time: '2026-10-30T12:00:01.000Z' },
        ],
    });
    assert.equal(later.length, 2);
    assert.deepEqual(later.map((row) => row.relationshipId), ['5', '9']);
});

test('过一会儿另建的实例没有聊天文件时仍然单独成行', () => {
    const rows = conversationRows([
        { relationshipId: '2', personaRef: 'st-character', companionName: '外壳', createdAt: '2026-10-29T15:18:48.000Z' },
        { relationshipId: '9', personaRef: 'st-character', companionName: '外壳', createdAt: '2026-10-29T16:00:00.000Z' },
    ], {
        chatsComplete: true,
        characters: [{ name: '外壳', avatar: 'a.png', data: { extensions: { vc_character_ref: 'ref' } } }],
        chats: [{ relationshipId: '2', file: 'chat-a', characterRef: 'ref', preview: '甲', time: '2026-10-30T01:00:00Z' }],
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.relationshipId), ['2', '9']);
    const html = renderConversationRows(rows);
    assert.equal(new Set([...html.matchAll(/aria-label="([^"]+)"/g)].map((item) => item[1])).size, 2);
});

test('两个实例指向同一聊天文件时合并成一行', () => {
    const rows = conversationRows([
        { relationshipId: '2', personaRef: 'st-character', companionName: '外壳', createdAt: '2026-10-01T00:00:00Z' },
        { relationshipId: '3', personaRef: 'st-character', companionName: '晚一些', createdAt: '2026-11-01T00:00:00Z' },
    ], {
        chats: [
            { relationshipId: '2', file: 'same-chat', characterRef: 'ref', preview: '同一句' },
            { relationshipId: '3', file: 'same-chat', characterRef: 'ref', preview: '同一句' },
        ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].file, 'same-chat');
    assert.equal(rows[0].preview, '同一句');
    assert.equal(renderConversationRows(rows).includes('· 2'), false);
});

test('最近聊天快照只保留有绑定的文件，空占位不当成预览', () => {
    const snaps = chatSnapshotsFromRecent([
        {
            file_id: 'kept',
            file_name: 'kept.jsonl',
            mes: '[The chat is empty]',
            last_mes: '2026-10-30T00:00:00Z',
            avatar: 'a.png',
            chat_metadata: { vc_binding: { relationshipId: 3, characterRef: 'ref-v' } },
        },
        { file_id: 'loose', mes: '不该出现', chat_metadata: {} },
        { file_name: 'named.jsonl', mes: '你好\n第二行', avatar: 'b.png', chat_metadata: { vc_binding: { relationshipId: '8' } } },
    ]);
    assert.equal(snaps.length, 2);
    assert.equal(snaps[0].relationshipId, '3');
    assert.equal(snaps[0].file, 'kept');
    assert.equal(snaps[0].preview, undefined);
    assert.equal(snaps[0].characterRef, 'ref-v');
    assert.equal(snaps[0].avatar, 'a.png');
    assert.equal(snaps[1].file, 'named');
    assert.equal(snaps[1].preview, '你好');
});

test('外壳用完整聊天目录合并会话，避免只靠当前快照', async () => {
    const src = await readFile(new URL('../extension/vc-model-settings/shell.js', import.meta.url), 'utf8');
    assert.match(src, /loadRecentChatSnapshots\(/);
    assert.match(src, /chatsComplete/);
});

test('走查场景默认不进套件', async () => {
    const managed = await readFile(new URL('../scripts/vc-ui-walkthrough.mjs', import.meta.url), 'utf8');
    assert.match(managed, /id: 'vc-ui-walkthrough'[\s\S]{0,240}default: false/);
    assert.match(managed, /run: sceneVcUiWalkthrough/);
    const scene = await readFile(new URL('../scripts/vc-ui-walkthrough.mjs', import.meta.url), 'utf8');
    assert.match(scene, /pinVcUi\(context, 'on'\)/);
    assert.match(scene, /'\.\.\/dev-managed'\)/);
    assert.match(scene, /path\.join\(MANAGED, 'artifacts', `walkthrough-/);
    assert.match(scene, /index\.html/);
});

test('页签首次挂载、再次刷新，离开不销毁', async () => {
    const doc = installMiniDom();
    const container = doc.createElement('div');
    const title = doc.createElement('h1');
    title.className = 'vc-large-title';
    title.textContent = '记忆';
    container.append(title);
    let mounts = 0;
    let refreshes = 0;
    let destroys = 0;
    let loads = 0;
    const host = createDestinationHost({
        enabled: true,
        async load(nav) {
            loads += 1;
            assert.equal(nav, 'memory');
            return {
                mountMemoryTab(el, args) {
                    mounts += 1;
                    assert.equal(args.getRelationshipId(), '9');
                    const owned = doc.createElement('h1');
                    owned.className = 'vc-large-title';
                    owned.setAttribute('data-vc-owned-title', '');
                    el.append(owned);
                    return {
                        refresh() { refreshes += 1; },
                        destroy() { destroys += 1; },
                    };
                },
            };
        },
    });
    assert.equal(await host.enter('memory', container, { getRelationshipId: () => '9' }), 'mount');
    assert.equal(await host.enter('memory', container, { getRelationshipId: () => '9' }), 'refresh');
    assert.equal(host.leave('memory'), 'kept');
    assert.equal(mounts, 1);
    assert.equal(refreshes, 1);
    assert.equal(destroys, 0);
    assert.equal(loads, 1);
    assert.equal(title.hidden, true);

    let fallbacks = 0;
    const missing = createDestinationHost({
        enabled: true,
        async load() { throw new Error('missing'); },
        onFallback() { fallbacks += 1; },
    });
    assert.equal(await missing.enter('inbox', container, {}), 'fallback');
    assert.equal(fallbacks, 1);

    let offLoads = 0;
    const off = createDestinationHost({
        enabled: false,
        async load() { offLoads += 1; return {}; },
    });
    assert.equal(await off.enter('story', container, {}), 'off');
    assert.equal(offLoads, 0);
});

test('抽屉、模型和对话菜单在模块缺失时退回', async () => {
    let drawer = '';
    assert.equal(await openSurfaceAction('drawer', {
        load: async () => ({ openDrawerPage(id) { drawer = id; } }),
        drawerId: 'ai-config-button',
        fallback() { throw new Error('不应退回'); },
    }), 'module');
    assert.equal(drawer, 'ai-config-button');

    let fallbacks = 0;
    assert.equal(await openSurfaceAction('models', {
        load: async () => { throw new Error('missing'); },
        fallback() { fallbacks += 1; },
    }), 'fallback');
    assert.equal(fallbacks, 1);
    let modelLoads = 0;
    assert.equal(await openSurfaceAction('account', {
        enabled: false,
        load: async () => { modelLoads += 1; return {}; },
    }), 'off');
    assert.equal(modelLoads, 0);

    let anchor = null;
    assert.equal(await openChatAction('more', {
        load: async () => ({ openChatMoreMenu(el) { anchor = el; } }),
        anchor: { id: 'more' },
    }), 'module');
    assert.equal(anchor.id, 'more');
    assert.equal(await openChatAction('memory', {
        load: async () => null,
        fallback() { fallbacks += 1; },
    }), 'fallback');

    const src = await readFile(new URL('../extension/vc-model-settings/shell.js', import.meta.url), 'utf8');
    for (const spec of ['./characters-tab.js', './memory-page.js', './inbox-page.js', './story-tab.js', './chat-view.js', './surface.js']) {
        assert.equal(src.includes(`import('${spec}')`), false, spec);
    }
    for (const name of ['registerShellTabs', 'mountCharactersTab', 'mountMemoryTab', 'mountInboxTab', 'mountStoryTab', 'mountChatView', 'openMemoryInspector', 'openChatMoreMenu', 'openDrawerPage', 'openModelSettings', 'openAccountData', '--vc-sidebar', 'data-vc-owned-title', 'openConversation']) {
        assert.equal(src.includes(name), true, name);
    }
    const index = await readFile(indexUrl, 'utf8');
    assert.match(index, /characters: \(container\) => mountCharactersTab\(container, \{/);
    assert.match(index, /getBindings: characterBindings/);
    assert.match(index, /loadRelationships: fetchRelationships/);
    assert.match(index, /importCard: \(spec\) => importNativeCharacterFile/);
    assert.match(index, /onOpenInstance: \(instance\) => navigation\.openInstance\(instance\)/);
    assert.match(index, /story: \(container\) => mountStoryTab\(container, \{/);
    assert.match(index, /getConversation:/);
    assert.match(index, /onConfigure:/);
    assert.match(index, /onRun:/);
    assert.match(index, /project: \(job\) => storyProjection\.project\(job\)/);
    assert.match(index, /memory: \(container\) => mountMemoryTab\(container, \{/);
    assert.match(index, /inbox: \(container\) => mountInboxTab\(container, \{/);
    assert.match(index, /onOpenConversation: \(payload\) => navigation\.openInstance/);
    assert.match(index, /navigation\.openInstance = \(instance, opener\) => shell\?\.openConversation\?\.\(instance, opener\)/);
    assert.match(index, /surface:\s*async\s*\(\)\s*=>\s*\(\{/);
    assert.match(index, /openDrawerPage\(entry \? entry\.panel : id\)/);
    assert.match(index, /openModelSettings,/);
    assert.match(index, /openAccountData,/);
});

test('注册表挂载优先于缺失模块', async () => {
    const doc = installMiniDom();
    const container = doc.createElement('div');
    let mounted = 0;
    let loads = 0;
    registerShellTabs({
        characters(el) {
            mounted += 1;
            el.append(doc.createElement('div'));
            return { refresh() {}, destroy() {} };
        },
    });
    try {
        const host = createDestinationHost({
            enabled: true,
            registry: true,
            async load() {
                loads += 1;
                return null;
            },
        });
        assert.equal(await host.enter('characters', container, {}), 'mount');
        assert.equal(mounted, 1);
        assert.equal(loads, 0);
        assert.equal(await host.enter('story', container, {}), 'fallback');
        assert.equal(loads, 1);
    } finally {
        registerShellTabs({});
    }
});

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function matchingBrace(css, open) {
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    throw new Error('unbalanced brace');
}

function walkCss(css, fn) {
    let i = 0;
    while (i < css.length) {
        while (i < css.length && /\s/.test(css[i])) i += 1;
        if (i >= css.length) break;
        const brace = css.indexOf('{', i);
        if (brace < 0) break;
        const prelude = css.slice(i, brace).trim();
        const end = matchingBrace(css, brace);
        const body = css.slice(brace + 1, end);
        if (prelude.startsWith('@')) {
            const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
            if (name === 'keyframes' || name === '-webkit-keyframes') {
                const frame = prelude.split(/\s+/)[1] || '';
                if (!/^vc-[\w-]+$/.test(frame)) throw new Error(`keyframes ${prelude}`);
            } else if (name === 'media' || name === 'supports') {
                walkCss(body, fn);
            } else {
                throw new Error(`at-rule ${prelude}`);
            }
        } else if (prelude) {
            fn(prelude);
        }
        i = end + 1;
    }
}
