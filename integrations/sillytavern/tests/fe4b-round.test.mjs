// FIX-FE4B：角色卡实例计数稳定，模型页浅色提示可读且不误报上下文窗口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bindingsFromContext, createInstancePage, renderCharactersTab } from '../extension/vc-model-settings/instance-page.js';

function card(characterRef, name) {
    return { characterRef, name, description: '', worldName: '', avatar: '' };
}

function instance(relationshipId, companionName, characterRef = '') {
    return { relationshipId, personaRef: 'st-character', companionName, characterRef };
}

function counts(html) {
    return [...html.matchAll(/<b>([^<]*)<\/b><span>(\d+) 个实例<\/span>/g)].map((match) => [match[1], Number(match[2])]);
}

test('空角色引用不会把未归属实例算进缺少引用的卡', () => {
    const html = renderCharactersTab({
        cards: [card('', 'Seraphina'), card('card-v', 'vc-rerank-acceptance')],
        relationships: [instance('11', '甲'), instance('12', '乙')],
        bindings: [],
        selectedCharacterRef: '',
        selectedRelationshipId: '',
        creating: false,
        draftName: '',
        savedName: '',
        importError: '',
        loadError: '',
        nameError: '',
    });
    assert.deepEqual(counts(html), [['Seraphina', 0], ['vc-rerank-acceptance', 0]]);
    assert.match(html, /aria-label="陪伴实例"/);
    assert.match(html, /甲/);
    assert.match(html, /乙/);
});

test('补上角色引用后，其余未归属实例不会挪到另一张空引用卡', () => {
    const html = renderCharactersTab({
        cards: [card('card-s', 'Seraphina'), card('', 'vc-rerank-acceptance')],
        relationships: [instance('11', '甲', 'card-s'), instance('12', '乙')],
        bindings: [{ relationshipId: '11', characterRef: 'card-s', chatIdentity: 'chat-s', mode: 'COMPANION' }],
        selectedCharacterRef: 'card-s',
        selectedRelationshipId: '11',
        creating: false,
        draftName: '甲',
        savedName: '甲',
        importError: '',
        loadError: '',
        nameError: '',
    });
    assert.deepEqual(counts(html), [['Seraphina', 1], ['vc-rerank-acceptance', 0]]);
    assert.match(html, /aria-label="陪伴实例"/);
    assert.match(html, /乙/);
    assert.equal(html.includes('>甲<'), false);
});

test('同名实例不会按名字算进角色卡', () => {
    const html = renderCharactersTab({
        cards: [card('card-s', 'Seraphina'), card('card-v', 'vc-rerank-acceptance')],
        relationships: [instance('11', 'Seraphina'), instance('12', 'Seraphina')],
        bindings: [],
        selectedCharacterRef: 'card-s',
        selectedRelationshipId: '',
        creating: false,
        draftName: '',
        savedName: '',
        importError: '',
        loadError: '',
        nameError: '',
    });
    assert.deepEqual(counts(html), [['Seraphina', 0], ['vc-rerank-acceptance', 0]]);
    assert.match(html, /aria-label="陪伴实例"/);
});

test('当前绑定优先使用已保存的角色引用，不跟着选中角色改口', () => {
    const bindings = bindingsFromContext({
        characters: [
            { name: 'Seraphina', data: { extensions: { vc_character_ref: 'ref-s' } } },
            { name: 'vc-rerank-acceptance', data: { extensions: { vc_character_ref: 'ref-v' } } },
        ],
        characterId: 0,
        chatMetadata: {
            vc_f2: { id: 'chat-v' },
            vc_binding: { relationshipId: '21', characterRef: 'ref-v', mode: 'COMPANION' },
        },
    });
    assert.deepEqual(bindings, [{
        relationshipId: '21', characterRef: 'ref-v', chatIdentity: 'chat-v', mode: 'COMPANION',
    }]);
});

test('后发起的角色加载不会被先发起的结果覆盖', async () => {
    let releaseFirst;
    const first = new Promise((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const page = createInstancePage({
        loadRelationships: () => {
            calls += 1;
            if (calls === 1) return first;
            return Promise.resolve([instance('21', '晚到', 'card-v')]);
        },
        getCards: () => [card('card-v', 'vc-rerank-acceptance')],
        getBindings: () => [{ relationshipId: '21', characterRef: 'card-v', chatIdentity: 'c', mode: 'COMPANION' }],
    });
    const early = page.open();
    const late = page.open();
    await late;
    releaseFirst([instance('11', '早到'), instance('12', '早到二')]);
    await early;
    assert.deepEqual(counts(renderCharactersTab(page.state)), [['vc-rerank-acceptance', 1]]);
});

test('上下文窗口是否缺失只看正在编辑的模型', async () => {
    const { contextWindowMissing } = await import('../extension/vc-model-settings/model-logic.js');
    assert.equal(contextWindowMissing({ contextWindowTokens: 1000000 }), false);
    assert.equal(contextWindowMissing({ contextWindowTokens: '1000000' }), false);
    assert.equal(contextWindowMissing({ contextWindowTokens: 0 }), false);
    assert.equal(contextWindowMissing({ contextWindowTokens: '' }), true);
    assert.equal(contextWindowMissing({ contextWindowTokens: '  ' }), true);
    assert.equal(contextWindowMissing({ contextWindowTokens: null }), true);
    assert.equal(contextWindowMissing({}), true);
});

test('模型编辑页用正在编辑模型的上下文窗口决定未填写提示', async () => {
    const page = await readFile(new URL('../extension/vc-model-settings/page.js', import.meta.url), 'utf8');
    const formStart = page.indexOf('function renderModelForm');
    const form = page.slice(formStart, page.indexOf('function renderToolCallVerification', formStart));
    assert.match(form, /contextWindowMissing\(m\)/);
    const feedbackStart = page.indexOf('function refreshFeedback');
    const feedback = page.slice(feedbackStart, page.indexOf('// ---------- 事件 ----------', feedbackStart));
    assert.match(feedback, /contextWindowMissing\(model\)/);
});

test('浅色模型页共用说明与次级标题使用可读 token', async () => {
    const css = await readFile(new URL('../extension/vc-model-settings/settings-pages.css', import.meta.url), 'utf8');
    assert.match(css, /#vc-model-settings-root \.vcms-callout-info > div\s*\{[^}]*color:\s*var\(--vc-ink\)/);
    assert.match(css, /#vc-model-settings-root \.vcms-advanced summary\s*\{[^}]*color:\s*var\(--vc-ink-2\)/);
    assert.match(css, /#vc-model-settings-root \.vcms-subsection-title\s*\{[^}]*color:\s*var\(--vc-ink-2\)/);
    assert.match(css, /#vc-model-settings-root \.vcms-section-label\s*\{[^}]*color:\s*var\(--vc-ink-2\)/);
    assert.match(css, /#vcms-m-ctx:not\(:placeholder-shown\)\) \[data-note="ctx"\]/);
});
