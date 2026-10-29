import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as api from '../extension/vc-model-settings/api.js';
import {
    IMPORT_FAILED_COPY, UNSAVED_INSTANCE_COPY,
    inspectCharacterFile, renderInstancePage, createInstancePage, cardsFromContext, bindingsFromContext,
    importNativeCharacterFile,
} from '../extension/vc-model-settings/instance-page.js';

const prefs = {
    replyLength: 'MEDIUM', initiative: 'LOW', humor: 'LIGHT', advicePref: 'ASK_FIRST',
    remindersAllowed: false, memoryShareScope: 'RELATIONSHIP', avoidTopics: [], gender: 'NEUTRAL', avatarRef: 'AVATAR_NEUTRAL_01',
    userAddressAs: null,
};
const card = { characterRef: 'card-1', name: '澄夏', description: '沿湖散步', worldName: '' };
const daily = { relationshipId: '11', personaRef: 'st-character', companionName: '澄夏·日常', active: true, ...prefs };
const trip = { relationshipId: '12', personaRef: 'st-character', companionName: '澄夏·旅行', active: false, ...prefs };
const other = { relationshipId: '13', personaRef: 'gentle-listener', companionName: '旧关系', ...prefs };

function pngChunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    return out;
}
function png(keyword) {
    const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const key = new TextEncoder().encode(keyword);
    const data = new Uint8Array(key.length + 1 + 4);
    data.set(key, 0);
    const chunk = pngChunk('tEXt', data);
    const out = new Uint8Array(sig.length + chunk.length);
    out.set(sig, 0);
    out.set(chunk, sig.length);
    return out;
}

test('区分角色卡模板和陪伴实例，不展示其他 persona 或内部标记', () => {
    const html = renderInstancePage({
        cards: [{ ...card, name: '<澄夏>', worldName: '湖畔日常' }],
        relationships: [daily, trip, other],
        bindings: [{ relationshipId: '11', characterRef: 'card-1', chatIdentity: 'chat-a', mode: 'COMPANION' }],
        selectedCharacterRef: 'card-1',
        selectedRelationshipId: '11',
        draftName: '澄夏·日常',
        savedName: '澄夏·日常',
        creating: false,
        importError: '',
        unsaved: null,
        nameError: '',
    });
    assert.match(html, /角色卡模板/);
    assert.match(html, /陪伴实例/);
    assert.match(html, /澄夏·日常/);
    assert.match(html, /澄夏·旅行/);
    assert.match(html, /湖畔日常/);
    assert.match(html, /沿湖散步/);
    assert.match(html, /&lt;澄夏&gt;/);
    for (const absent of ['<澄夏>', '旧关系', 'gentle-listener', 'st-character', 'credential', '手机已收到']) {
        assert.equal(html.includes(absent), false, absent);
    }
});

test('正在编辑的实例、模板卡和主次按钮可区分', async () => {
    const html = renderInstancePage({
        cards: [{ ...card, worldName: '湖畔日常' }],
        relationships: [daily, trip],
        bindings: [],
        selectedCharacterRef: 'card-1',
        selectedRelationshipId: '11',
        draftName: '澄夏·日常',
        savedName: '澄夏·日常',
        creating: false,
        importError: '',
        unsaved: null,
        nameError: '',
    });
    assert.match(html, /vc-instance-avatar/);
    assert.match(html, /vc-instance-avatar" aria-hidden="true">澄</);
    assert.match(html, /沿湖散步/);
    assert.match(html, /关联世界书 · 湖畔日常/);
    assert.match(html, /data-action="select-instance" data-id="11" aria-current="true"[\s\S]*?正在编辑[\s\S]*?<\/button>/);
    assert.match(html, /正在编辑 · 澄夏·日常/);
    assert.match(html, /data-action="create" class="vc-instance-create"/);
    assert.doesNotMatch(html, /data-action="create"[^>]*vc-instance-primary/);
    assert.match(html, /class="vc-instance-primary">保存更改/);
    const css = await readFile(new URL('../extension/vc-model-settings/instance.css', import.meta.url), 'utf8');
    assert.match(css, /--SmartThemeBlurTintColor/);
    assert.match(css, /--SmartThemeBodyColor/);
    assert.match(css, /#14181F/);
    assert.match(css, /#9AB9FF/);
});

test('首次没有陪伴实例', () => {
    const html = renderInstancePage({
        cards: [card], relationships: [], bindings: [], selectedCharacterRef: 'card-1',
        selectedRelationshipId: '', draftName: '', savedName: '', creating: false,
        importError: '', unsaved: null, nameError: '',
    });
    assert.match(html, /还没有陪伴实例/);
    assert.match(html, /创建实例/);
    assert.equal(html.includes('关联世界书'), false);
});

test('导入失败保持原模板，文件内容不进页面', async () => {
    assert.equal(inspectCharacterFile(png('chara'), '澄夏.png').ok, true);
    assert.equal(inspectCharacterFile(png('Comment'), 'note.png').ok, false);
    assert.equal(inspectCharacterFile(new TextEncoder().encode(JSON.stringify({ name: '澄夏', description: '秘密人设' })), '澄夏.json').ok, true);
    assert.equal(inspectCharacterFile(new TextEncoder().encode('[]'), 'list.json').ok, false);
    const seen = [];
    const page = createInstancePage({
        loadRelationships: async () => [],
        getCards: () => [{ ...card }],
        getBindings: () => [],
        importCard: async (file) => { seen.push(file); throw new Error('host rejected'); },
    });
    await page.open();
    await page.importFile({ name: 'bad.txt', bytes: new TextEncoder().encode('not a card 秘密正文') });
    assert.equal(page.state.importError, IMPORT_FAILED_COPY);
    assert.deepEqual(page.state.cards.map((item) => item.name), ['澄夏']);
    assert.equal(renderInstancePage(page.state).includes('秘密正文'), false);
    assert.equal(seen.length, 0);
    await page.importFile({ name: '澄夏.json', bytes: new TextEncoder().encode(JSON.stringify({ name: '新卡', description: '不可出现的人设原文' })) });
    assert.equal(page.state.importError, IMPORT_FAILED_COPY);
    assert.deepEqual(page.state.cards.map((item) => item.name), ['澄夏']);
    assert.equal(renderInstancePage(page.state).includes('不可出现的人设原文'), false);
});

test('角色卡导入成功后写回 vc_character_ref，已有引用不覆盖', async () => {
    const characters = [{ avatar: 'old.png', name: '澄夏', data: { extensions: { vc_character_ref: 'card-1' } } }];
    const writes = [];
    let seen;
    const page = createInstancePage({
        loadRelationships: async () => [],
        getCards: () => [{ ...card }],
        importCard: (spec) => importNativeCharacterFile({
            ...spec,
            getContext: () => ({
                characters,
                writeExtensionField: async (id, key, value) => {
                    writes.push({ id, key, value });
                    characters[id].data = { ...characters[id].data, extensions: { ...characters[id].data?.extensions, [key]: value } };
                },
            }),
            loadNative: async () => ({
                processDroppedFiles: async (files) => {
                    seen = files[0];
                    characters.push({ avatar: 'new.png', name: '合成卡', description: '沿湖', data: { extensions: {} } });
                },
            }),
            newRef: () => 'ref-new',
        }),
    });
    await page.open();
    await page.importFile({ name: '合成.json', bytes: new TextEncoder().encode(JSON.stringify({ name: '合成卡', description: '沿湖' })) });
    assert.equal(page.state.importError, '');
    assert.deepEqual(page.state.cards.map((item) => item.name), ['澄夏', '合成卡']);
    assert.equal(page.state.cards[1].characterRef, 'ref-new');
    assert.equal(seen.type, 'application/json');
    assert.equal(seen.name, '合成.json');
    assert.deepEqual(writes, [{ id: 1, key: 'vc_character_ref', value: 'ref-new' }]);

    const kept = [];
    const existing = [{ avatar: 'kept.png', name: '已有', data: { extensions: { vc_character_ref: 'ref-kept' }, description: '不改' } }];
    const again = await importNativeCharacterFile({
        name: '已有.json',
        format: 'json',
        bytes: new TextEncoder().encode(JSON.stringify({ name: '已有' })),
        getContext: () => ({ characters: existing, writeExtensionField: async () => { kept.push('write'); } }),
        loadNative: async () => ({
            processDroppedFiles: async () => {
                existing.push({ avatar: 'added.png', name: '已有', data: { extensions: { vc_character_ref: 'ref-kept' } } });
            },
        }),
        newRef: () => 'should-not-run',
    });
    assert.equal(again.characterRef, 'ref-kept');
    assert.deepEqual(kept, []);
});

test('原生导入未加入角色时不改模板', async () => {
    const page = createInstancePage({
        loadRelationships: async () => [],
        getCards: () => [{ ...card }],
        importCard: (spec) => importNativeCharacterFile({
            ...spec,
            getContext: () => ({ characters: [], writeExtensionField: async () => { throw new Error('should not write'); } }),
            loadNative: async () => ({ processDroppedFiles: async () => { throw new Error('秘密人设原文'); } }),
        }),
    });
    await page.open();
    await page.importFile({ name: '合成.json', bytes: new TextEncoder().encode(JSON.stringify({ name: '新卡', description: '秘密人设原文' })) });
    assert.equal(page.state.importError, IMPORT_FAILED_COPY);
    assert.deepEqual(page.state.cards.map((item) => item.name), ['澄夏']);
    assert.equal(renderInstancePage(page.state).includes('秘密人设原文'), false);
});

test('未保存时不能切换，放弃后才切换，Escape 语义由取消保持草稿', async () => {
    const page = createInstancePage({
        loadRelationships: async () => [daily, trip],
        getCards: () => [card],
        getBindings: () => [
            { relationshipId: '11', characterRef: 'card-1', chatIdentity: 'chat-a', mode: 'COMPANION' },
            { relationshipId: '12', characterRef: 'card-1', chatIdentity: 'chat-b', mode: 'COMPANION' },
        ],
    });
    await page.open();
    page.setName('澄夏·日常改');
    assert.equal(page.selectInstance('12'), false);
    assert.equal(page.state.selectedRelationshipId, '11');
    assert.equal(page.state.draftName, '澄夏·日常改');
    assert.match(renderInstancePage(page.state), new RegExp(UNSAVED_INSTANCE_COPY));
    page.cancelUnsaved();
    assert.equal(page.state.unsaved, null);
    assert.equal(page.state.draftName, '澄夏·日常改');
    assert.equal(page.selectInstance('12'), false);
    page.confirmDiscard();
    assert.equal(page.state.selectedRelationshipId, '12');
    assert.equal(page.state.draftName, '澄夏·旅行');
    assert.equal(page.state.unsaved, null);
});

test('创建实例只 POST 当前绑定，保存失败保留草稿且不写 localStorage', async () => {
    const calls = [];
    const storage = { setItem() { throw new Error('localStorage'); }, getItem() { return null; } };
    const realFetch = globalThis.fetch;
    const realDocument = globalThis.document;
    const realStorage = globalThis.localStorage;
    globalThis.document = { cookie: 'vc_csrf=go-token' };
    globalThis.localStorage = storage;
    api.setStHeadersProvider(() => ({ 'X-CSRF-Token': 'st-token' }));
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url, method: init.method || 'GET', body: init.body });
        if (String(url).endsWith('/auth/session')) return json({ accountId: '9007199254740993', sessionId: '42' });
        if (String(url).endsWith('/relationships') && (init.method || 'GET') === 'GET') return json([daily]);
        if (String(url).endsWith('/st/bindings')) {
            return json({ relationshipId: '12', conversationId: '22', chatIdentity: 'chat-new', characterRef: 'card-1', mode: 'COMPANION' });
        }
        if (String(url).includes('/relationships/11')) return new Response(JSON.stringify({ code: 'INVALID_REQUEST' }), { status: 400 });
        return new Response('{}', { status: 500 });
    };
    try {
        await api.captureSessionContext();
        const page = createInstancePage({
            getCards: () => [{ ...card }],
            getBindings: () => [{ relationshipId: '11', characterRef: 'card-1', chatIdentity: 'chat-a', mode: 'COMPANION' }],
            newId: () => 'chat-new',
        });
        await page.open();
        page.startCreate();
        page.setName('澄夏·旅行');
        await page.save();
        const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/st/bindings'));
        assert.ok(post);
        assert.deepEqual(JSON.parse(post.body), {
            chatIdentity: 'chat-new', characterRef: 'card-1', mode: 'COMPANION', displayName: '澄夏·旅行',
        });
        page.setName('澄夏·日常改');
        await page.save();
        assert.equal(page.state.draftName, '澄夏·日常改');
        assert.match(page.state.nameError, /尚未保存/);
        assert.equal(renderInstancePage(page.state).includes('INVALID_REQUEST'), false);
    } finally {
        globalThis.fetch = realFetch;
        globalThis.document = realDocument;
        globalThis.localStorage = realStorage;
    }
});

test('过长名称不发出保存', async () => {
    let writes = 0;
    const page = createInstancePage({
        loadRelationships: async () => [daily],
        getCards: () => [card],
        getBindings: () => [],
        saveName: async () => { writes += 1; },
        createBinding: async () => { writes += 1; },
    });
    await page.open();
    page.setName('名'.repeat(33));
    await page.save();
    assert.equal(writes, 0);
    assert.equal(page.state.draftName, '名'.repeat(33));
    assert.match(page.state.nameError, /32/);
});

test('宿主上下文只取出模板和当前绑定', () => {
    const cards = cardsFromContext({
        characters: [{ name: '澄夏', description: '沿湖', data: { extensions: { vc_character_ref: 'card-1' }, character_book: { name: '湖畔日常' } } }],
    });
    assert.deepEqual(cards, [{ characterRef: 'card-1', name: '澄夏', description: '沿湖', worldName: '湖畔日常' }]);
    const bindings = bindingsFromContext({
        characters: [{ data: { extensions: { vc_character_ref: 'card-1' } } }],
        characterId: 0,
        chatMetadata: { vc_f2: { id: 'chat-a' }, vc_binding: { relationshipId: '11', mode: 'COMPANION', token: 'nope' } },
    });
    assert.deepEqual(bindings, [{ relationshipId: '11', characterRef: 'card-1', chatIdentity: 'chat-a', mode: 'COMPANION' }]);
});

function json(body) {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
