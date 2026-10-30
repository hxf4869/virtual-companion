import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { installMiniDom } from './mini-dom.mjs';
import { renderReplyBubbles } from '../extension/vc-model-settings/chat-view.js';
import { clearBubbleTransformers, registerBubbleTransformer } from '../extension/vc-model-settings/reply-pipeline.js';
import {
    FREQUENCIES,
    isSendableTag,
    GATE_KEY,
    applyStickerDom,
    assetsFromManifest,
    installStickers,
    listTags,
    loadManifest,
    mountStickerSettingsEntry,
    planSticker,
    registerBubbleTransformerIfPresent,
    renderStickerPage,
    revertSentSticker,
    setStickerCatalog,
    stickerSrc,
    tagFromFilename,
    transformSegments,
} from '../extension/vc-model-settings/stickers.js';

const happy = { id: 'k1', tag: '开心', kind: 'kaomoji', text: '(≧▽≦)' };
const shy = { id: 'img', tag: '害羞', kind: 'image', src: '/user/images/vc-stickers/害羞.png' };

function gateCtx(metadata, turnId, text, extra = {}) {
    return {
        segments: [text],
        userText: '在吗',
        metadata,
        turnId,
        random: () => 0,
        enabled: true,
        frequency: 'high',
        assets: [happy, shy],
        live: true,
        ...extra,
    };
}

test('解析并剥离 sticker 标签，每轮最多一张且放在文字之后', () => {
    const metadata = {};
    const plan = planSticker(gateCtx(metadata, 't1', '在呢<sticker tag="开心"/> 呀<sticker tag="害羞"/>'));
    assert.equal(plan.reason, 'sent');
    assert.equal(plan.sticker.tag, '开心');
    assert.equal(plan.sticker.kind, 'kaomoji');
    assert.deepEqual(plan.segments, ['在呢 呀', plan.sticker]);
    assert.equal(JSON.stringify(plan.segments).includes('<sticker'), false);
    const again = planSticker(gateCtx(metadata, 't1', '在呢<sticker tag="开心"/>'));
    assert.equal(again.reason, 'sent');
    assert.equal(metadata[GATE_KEY].assistantCount, 1);
});

test('近 4 条助手回复内最多 1 张，冷却内只剥离不发', () => {
    const metadata = {};
    const first = planSticker(gateCtx(metadata, 't1', '好<sticker tag="开心"/>'));
    assert.equal(first.reason, 'sent');
    for (const turnId of ['t2', 't3', 't4']) {
        const blocked = planSticker(gateCtx(metadata, turnId, '再<sticker tag="开心"/>'));
        assert.equal(blocked.reason, 'cooldown');
        assert.equal(blocked.sticker, null);
        assert.deepEqual(blocked.segments, ['再']);
    }
    const later = planSticker(gateCtx(metadata, 't5', '又<sticker tag="害羞"/>'));
    assert.equal(later.reason, 'sent');
    assert.equal(later.sticker.kind, 'image');
    assert.equal(later.sticker.src, shy.src);
});

test('概率门、严肃求助、被打断、关闭和未知标签都不发，标签仍剥离', () => {
    const normal = FREQUENCIES.find((item) => item.id === 'normal');
    const probability = planSticker(gateCtx({}, 'p', '好<sticker tag="开心"/>', {
        frequency: 'normal',
        random: () => normal.probability,
    }));
    assert.equal(probability.reason, 'probability');
    assert.equal(probability.sticker, null);
    assert.deepEqual(probability.segments, ['好']);

    const high = planSticker(gateCtx({}, 'h', '好<sticker tag="开心"/>', {
        frequency: 'high',
        random: () => 0.999,
    }));
    assert.equal(high.reason, 'sent');

    for (const userText of ['我该怎么办', '爷爷去世了']) {
        const blocked = planSticker(gateCtx({}, userText, '抱抱<sticker tag="开心"/>', { userText }));
        assert.equal(blocked.reason, 'serious');
        assert.equal(blocked.sticker, null);
    }
    const casual = planSticker(gateCtx({}, 'ok', '哈哈<sticker tag="开心"/>', { userText: '笑死我了' }));
    assert.equal(casual.reason, 'sent');

    const interrupted = planSticker(gateCtx({}, 'stop', '好<sticker tag="开心"/>', { interrupted: true }));
    assert.equal(interrupted.reason, 'interrupted');
    assert.equal(interrupted.sticker, null);

    const off = planSticker(gateCtx({}, 'off', '好<sticker tag="开心"/>', { enabled: false }));
    assert.equal(off.reason, 'off');
    assert.equal(off.sticker, null);

    const unknown = planSticker(gateCtx({}, 'miss', '好<sticker tag="不存在"/>'));
    assert.equal(unknown.reason, 'unknown-tag');
    assert.deepEqual(unknown.segments, ['好']);
});

test('被打断丢弃已决定的表情，并退回冷却', () => {
    const metadata = {};
    const message = { mes: '好<sticker tag="开心"/>', extra: {} };
    const plan = planSticker(gateCtx(metadata, 'live', message.mes));
    message.mes = plan.segments.filter((item) => typeof item === 'string').join('');
    message.extra.vc_sticker = plan.sticker;
    assert.equal(revertSentSticker(metadata, message), true);
    assert.equal(message.extra.vc_sticker, null);
    assert.equal(metadata[GATE_KEY].lastStickerAt, 0);
    const next = planSticker(gateCtx(metadata, 'next', '再<sticker tag="开心"/>'));
    assert.equal(next.reason, 'sent');
});

test('历史消息只剥离不计数，同一标签多素材随机选一张', () => {
    const history = planSticker(gateCtx({}, 'old', '旧<sticker tag="开心"/>', { live: false }));
    assert.equal(history.reason, 'history');
    assert.equal(history.sticker, null);
    assert.equal(history.counted, false);

    const rolls = [];
    const assets = [
        { id: 'a', tag: '开心', kind: 'kaomoji', text: 'A' },
        { id: 'b', tag: '开心', kind: 'image', src: '/b.png' },
    ];
    for (const value of [0, 0.49, 0.5, 0.99]) {
        const plan = planSticker(gateCtx({}, `r${value}`, '<sticker tag="开心"/>', {
            assets,
            random: () => value,
        }));
        rolls.push(plan.sticker.id);
    }
    assert.deepEqual(rolls, ['a', 'a', 'b', 'b']);
});

test('文件名和 manifest 只收 2–4 字标签，未标注不进入可用表', () => {
    assert.equal(tagFromFilename('开心.png'), '开心');
    assert.equal(tagFromFilename('subdir/抱抱-2.webp'), '抱抱');
    assert.equal(tagFromFilename('photo.png'), '');
    assert.equal(tagFromFilename('啊.png'), '');
    assert.equal(tagFromFilename('开心快乐呀.png'), '');

    const manifest = loadManifest({
        name: 'demo',
        license: 'CC0-1.0',
        attribution: '示例作者',
        stickers: { 开心: ['a.png'], 开心快乐呀: ['no.png'], x: ['no.png'] },
        kaomoji: { 害羞: ['(*/ω＼*)'], 未: ['x'] },
    });
    const assets = assetsFromManifest(manifest, 'file:///pack/');
    assert.deepEqual(assets.map((item) => item.tag), ['开心', '害羞']);
    assert.equal(assets[0].src, 'file:///pack/a.png');
    assert.equal(assets[0].license, 'CC0-1.0');
    assert.equal(assets[0].attribution, '示例作者');
    assert.equal(assets[1].text, '(*/ω＼*)');
    assert.throws(() => loadManifest({ name: 'x', stickers: {}, kaomoji: {} }), /license/);

    setStickerCatalog({
        enabled: true,
        assets: [...assets, { id: 'u', tag: '', kind: 'image', src: '/x.png' }],
    });
    assert.deepEqual(listTags(), ['开心', '害羞']);
    setStickerCatalog({ enabled: false, assets });
    assert.deepEqual(listTags(), []);
    setStickerCatalog(null);
    assert.equal(stickerSrc('user/images/vc-stickers/开心.png'), '/user/images/vc-stickers/开心.png');
});

test('空示例 manifest 带许可与署名字段且没有素材', async () => {
    const raw = JSON.parse(await readFile(new URL('../extension/vc-model-settings/stickers/example-manifest.json', import.meta.url), 'utf8'));
    const manifest = loadManifest(raw);
    assert.equal(manifest.license, '');
    assert.equal(manifest.attribution, '');
    assert.deepEqual(assetsFromManifest(manifest, 'file:///stickers/'), []);
});

test('内置表情包：许可与署名齐全，标签可发送，图片文件都存在', async () => {
    const { existsSync } = await import('node:fs');
    const base = new URL('../extension/vc-model-settings/stickers/', import.meta.url);
    const manifest = loadManifest(JSON.parse(await readFile(new URL('builtin-manifest.json', base), 'utf8')));
    assert.match(manifest.license, /MIT/);
    assert.match(manifest.attribution, /Microsoft/);
    assert.ok(existsSync(new URL('fluent/LICENSE', base)));
    const assets = assetsFromManifest(manifest, base.href);
    const images = assets.filter((item) => item.kind === 'image');
    assert.ok(images.length >= 20);
    assert.ok(assets.some((item) => item.kind === 'kaomoji'));
    for (const item of images) assert.ok(existsSync(new URL(item.src)), item.src);
    for (const item of assets) assert.ok(isSendableTag(item.tag), item.tag);
});

test('transformer 把标签变成表情段；流水线缺失则不注册', async () => {
    const metadata = {};
    const segments = transformSegments(['先接住你<sticker tag="开心"/>'], {
        userText: '在吗',
        metadata,
        turnId: 'pipe',
        live: true,
        enabled: true,
        frequency: 'high',
        assets: [happy],
        random: () => 0,
    });
    assert.equal(segments.at(-1).type, 'sticker');
    assert.equal(segments[0], '先接住你');

    const skipped = await registerBubbleTransformerIfPresent({
        importPipeline: async () => {
            const error = new Error('missing');
            error.code = 'ERR_MODULE_NOT_FOUND';
            throw error;
        },
    });
    assert.equal(skipped, false);
    let registered;
    const armed = await registerBubbleTransformerIfPresent({
        importPipeline: async () => ({
            registerBubbleTransformer(fn) { registered = fn; },
        }),
    });
    assert.equal(armed, true);
    assert.equal(typeof registered, 'function');
    const viaPipeline = registered(['<sticker tag="开心"/>'], {
        userText: '在吗',
        metadata: {},
        turnId: 'reg',
        live: true,
        enabled: true,
        frequency: 'high',
        assets: [happy],
        random: () => 0,
    });
    assert.equal(viaPipeline.at(-1).type, 'sticker');
});

test('流水线已注册时，新回复仍剥离标签并画出表情气泡', async () => {
    const doc = installMiniDom();
    setStickerCatalog({ enabled: true, frequency: 'high', assets: [happy] });
    const handlers = {};
    const metadata = {};
    const message = { mes: '在呢<sticker tag="开心"/>', is_user: false, swipe_id: 0, extra: {} };
    const row = doc.createElement('div');
    row.className = 'mes';
    row.setAttribute('mesid', '1');
    const block = doc.createElement('div');
    block.className = 'mes_block';
    const body = doc.createElement('div');
    body.className = 'mes_text';
    body.textContent = message.mes;
    block.append(body);
    row.append(block);
    doc.body.append(row);
    const context = {
        eventSource: { on(name, fn) { (handlers[name] ||= []).push(fn); } },
        eventTypes: {
            GENERATION_STARTED: 'gen-start',
            GENERATION_STOPPED: 'gen-stop',
            CHARACTER_MESSAGE_RENDERED: 'gen-rendered',
            CHAT_CHANGED: 'gen-changed',
        },
        chat: [null, message],
        chatMetadata: metadata,
        chatId: 'hl',
        extensionSettings: {},
        saveSettingsDebounced() {},
    };
    try {
        await installStickers({
            document: doc,
            getContext: () => context,
            getRequestHeaders: () => ({}),
            saveChat() {},
        });
        for (const fn of handlers['gen-start'] || []) fn('normal');
        for (const fn of handlers['gen-rendered'] || []) fn(1, 'normal');
        assert.equal(message.mes.includes('<sticker'), false);
        assert.equal(row.querySelector('[data-vc-sticker]')?.textContent, '(≧▽≦)');
        assert.equal(Number(metadata.vc_sticker_gate?.assistantCount) >= 1, true);
    } finally {
        setStickerCatalog(null);
    }
});

test('表情气泡跟在文字后面，冷却内第二次不出现', () => {
    const doc = installMiniDom();
    const metadata = {};
    function mes(text) {
        const row = doc.createElement('div');
        row.className = 'mes';
        const block = doc.createElement('div');
        block.className = 'mes_block';
        const body = doc.createElement('div');
        body.className = 'mes_text';
        body.textContent = text;
        block.append(body);
        row.append(block);
        doc.body.append(row);
        return { row, message: { mes: text, is_user: false, extra: {} } };
    }
    const first = mes('在呢<sticker tag="开心"/>');
    const sent = applyStickerDom(first.row, first.message, gateCtx(metadata, 'd1', first.message.mes, { assets: [happy] }));
    assert.equal(sent.reason, 'sent');
    assert.equal(first.message.mes.includes('<sticker'), false);
    assert.equal(first.row.querySelector('.mes_text').textContent.includes('<sticker'), false);
    assert.equal(first.row.querySelector('[data-vc-sticker]').textContent, '(≧▽≦)');
    assert.ok(first.row.querySelector('.mes_text').parent === first.row.querySelector('[data-vc-sticker]').parent);

    const second = mes('再来<sticker tag="开心"/>');
    const blocked = applyStickerDom(second.row, second.message, gateCtx(metadata, 'd2', second.message.mes, { assets: [happy] }));
    assert.equal(blocked.reason, 'cooldown');
    assert.equal(second.row.querySelector('[data-vc-sticker]'), null);
    assert.equal(second.message.mes.includes('<sticker'), false);
    assert.equal(doc.querySelectorAll('[data-vc-sticker]').length, 1);
});

test('流水线按已剥离文本再次排版后，表情气泡还在', () => {
    setStickerCatalog({ enabled: true, frequency: 'high', assets: [happy] });
    clearBubbleTransformers();
    registerBubbleTransformer((segments, ctx) => transformSegments(segments, ctx));
    try {
        const doc = installMiniDom();
        const metadata = {};
        const row = doc.createElement('div');
        row.className = 'mes';
        const block = doc.createElement('div');
        block.className = 'mes_block';
        const body = doc.createElement('div');
        body.className = 'mes_text';
        const message = { mes: '在呢<sticker tag="开心"/>', is_user: false, extra: {} };
        body.textContent = message.mes;
        block.append(body);
        row.append(block);
        doc.body.append(row);
        renderReplyBubbles(row, message.mes, { reducedMotion: true });
        assert.equal(row.querySelectorAll('[data-vc-sticker]').length, 1);
        applyStickerDom(row, message, gateCtx(metadata, 'live-1', message.mes, { assets: [happy] }));
        assert.equal(message.mes.includes('<sticker'), false);
        assert.equal(metadata[GATE_KEY].lastStickerAt, 1);
        renderReplyBubbles(row, message.mes, { reducedMotion: true });
        assert.equal(row.querySelectorAll('[data-vc-sticker]').length, 1);
        assert.equal(row.querySelector('[data-vc-sticker]').textContent, '(≧▽≦)');
    } finally {
        clearBubbleTransformers();
        setStickerCatalog(null);
    }
});

test('表情包设置页可以开关、改频率、上传、改标签和删除', async () => {
    const doc = installMiniDom();
    const seen = [];
    const page = renderStickerPage(doc, {
        settings: { enabled: true, frequency: 'normal' },
        rows: [{ id: 'u1', tag: '开心', name: '开心.png', src: '/user/images/vc-stickers/开心.png', builtin: false }],
        onEnabled: (value) => seen.push(['enabled', value]),
        onFrequency: (value) => seen.push(['frequency', value]),
        onTag: (id, tag) => seen.push(['tag', id, tag]),
        onDelete: (id) => seen.push(['delete', id]),
        onUpload: (file) => seen.push(['upload', file.name]),
        onBack: () => seen.push(['back']),
        confirm: async () => true,
    });
    doc.body.append(page);
    assert.equal(page.querySelector('[data-vc-sticker-title]').textContent, '表情包');
    assert.equal(page.querySelector('[data-vc-sticker-enabled]').getAttribute('aria-checked'), 'true');
    page.querySelector('[data-vc-sticker-enabled]').click();
    assert.deepEqual(seen[0], ['enabled', false]);
    const often = [...page.querySelectorAll('button')].find((button) => button.textContent === '多');
    often.click();
    assert.deepEqual(seen[1], ['frequency', 'high']);
    const input = page.querySelector('[data-vc-sticker-tag]');
    input.value = '抱抱';
    input.dispatch('change');
    assert.deepEqual(seen[2], ['tag', 'u1', '抱抱']);
    page.querySelector('[data-vc-sticker-delete]').click();
    await Promise.resolve();
    assert.deepEqual(seen[3], ['delete', 'u1']);
    const file = page.querySelector('[data-vc-sticker-file]');
    file.files = [{ name: '委屈.png' }];
    file.dispatch('change');
    assert.deepEqual(seen[4], ['upload', '委屈.png']);
    page.querySelector('[data-vc-sticker-back]').click();
    assert.deepEqual(seen[5], ['back']);

    const empty = renderStickerPage(doc, { settings: { enabled: true, frequency: 'normal' }, rows: [] });
    assert.equal(empty.querySelector('[data-vc-sticker-empty]').textContent.includes('还没有表情包'), true);
    assert.equal(empty.querySelector('[data-vc-sticker-upload]').textContent, '上传');

    const form = doc.createElement('div');
    form.className = 'vc-settings-form';
    const group = doc.createElement('div');
    group.className = 'vc-group';
    const models = doc.createElement('button');
    models.setAttribute('data-action', 'models');
    group.append(models);
    form.append(group);
    doc.body.append(form);
    let opened = false;
    mountStickerSettingsEntry(doc, { open: () => { opened = true; } });
    const entry = form.querySelector('[data-vc-sticker-entry]');
    assert.equal(entry.textContent.includes('表情包'), true);
    entry.click();
    assert.equal(opened, true);
});

test('表情样式不写死色值和字号', async () => {
    const css = await readFile(new URL('../extension/vc-model-settings/stickers.css', import.meta.url), 'utf8');
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(body), false);
    assert.equal(/\d+px/.test(body), false);
    assert.equal(/\d+ms/.test(body), false);
});

const FLUENT_NOTE = 'Microsoft Fluent Emoji, Copyright (c) Microsoft Corporation, MIT License, https://github.com/microsoft/fluentui-emoji';

test('表情包行内是缩略图、可读标签和删除，许可署名按包在列表底部只出现一次', () => {
    const doc = installMiniDom();
    const page = renderStickerPage(doc, {
        settings: { enabled: true, frequency: 'normal' },
        rows: [
            { id: 'b1', tag: '开心', src: '/a.png', builtin: true, attribution: FLUENT_NOTE },
            { id: 'b2', tag: '害羞', src: '/b.png', builtin: true, attribution: FLUENT_NOTE },
            { id: 'c1', tag: '晚安', src: '/c.png', builtin: true, attribution: '自定义包，MIT' },
            { id: 'u1', tag: '抱抱', name: '抱抱.png', src: '/u.png', builtin: false, attribution: '' },
        ],
    });
    const list = page.querySelector('[data-vc-sticker-list]');
    const upload = list.querySelector('[data-vc-sticker-upload]');
    const rows = list.querySelectorAll('[data-vc-sticker-id]');
    assert.equal(upload.textContent, '上传');
    assert.equal(list.children.indexOf(upload) < list.children.indexOf(rows[0]), true);
    assert.deepEqual(rows.map((row) => row.querySelector('[data-vc-sticker-tag]').value), ['开心', '害羞', '晚安', '抱抱']);
    for (const row of rows) {
        assert.ok(row.querySelector('.vc-sticker-thumb'));
        assert.equal(row.querySelector('.vc-meta'), null);
        assert.equal(row.textContent.includes('Microsoft'), false);
        assert.equal(row.textContent.includes('MIT'), false);
    }
    assert.equal(rows[0].querySelector('[data-vc-sticker-tag]').hasAttribute('readonly'), true);
    assert.equal(rows[3].querySelector('[data-vc-sticker-tag]').hasAttribute('readonly'), false);
    assert.equal(rows[0].querySelector('[data-vc-sticker-delete]'), null);
    assert.ok(rows[3].querySelector('[data-vc-sticker-delete]'));
    const notes = page.querySelectorAll('[data-vc-sticker-attribution]');
    assert.equal(notes.length, 2);
    assert.equal(notes[0].classList.contains('vc-footnote'), true);
    assert.match(notes[0].textContent, /Microsoft/);
    assert.match(notes[0].textContent, /MIT/);
    assert.equal(notes[1].textContent, '自定义包，MIT');
    assert.equal(page.innerHTML.split(FLUENT_NOTE).length - 1, 1);
    assert.equal(list.children.indexOf(rows.at(-1)) < page.children.indexOf(notes[0]), true);
});

test('表情标签输入在行内伸展，不会被压成空胶囊', async () => {
    const css = await readFile(new URL('../extension/vc-model-settings/stickers.css', import.meta.url), 'utf8');
    const block = css.match(/body\.vc-ui \.vc-sticker-tag \{([\s\S]*?)\n\}/);
    assert.ok(block, '缺少 .vc-sticker-tag 规则');
    const body = block[1];
    assert.match(body, /flex:\s*1\s+1\s+auto/);
    assert.match(body, /min-height:\s*var\(--vc-touch\)/);
    assert.equal(/\bmin-width:\s*0\b/.test(body), false);
    assert.equal(/width:\s*calc\(var\(--vc-space-xxl\)\s*\*\s*3\)/.test(body), false);
    assert.match(css, /\.vc-sticker-page \.vc-footnote \{[\s\S]*?overflow-wrap:\s*anywhere/);
});
