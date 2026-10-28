// W12-C：蓝窗书店公开设定必须是 ST 1.19.0 可直接导入的原生世界书。
// 导入端点只要求存在 entries；世界书引擎与 W00/W04 落盘结果使用 uid 映射，
// 字段是 key / keysecondary / order / position（数字）/ constant，不是角色卡的 keys 数组。
// 内容只保留源 public_lore 的公开常驻与关键词条目，不混入雨夜客栈的 case、私密或 GM 文本。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LORE_PATH = path.join(HERE, '../fixtures/public_lore.json');
const SOURCE_PATH = path.join(HERE, '../../../docs/source/v2-r3/fixtures/public_lore.json');
const CASE_PATH = path.join(HERE, '../../../docs/source/v2-r3/fixtures/rainy_inn_case.json');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function collectStrings(value, out = []) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
    else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
            out.push(key);
            collectStrings(item, out);
        }
    }
    return out;
}

function collectValues(value, out = []) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) for (const item of value) collectValues(item, out);
    else if (value && typeof value === 'object') for (const item of Object.values(value)) collectValues(item, out);
    return out;
}

test('公开世界书是 ST 1.19.0 原生可导入结构，且只含公开常驻与关键词条目', () => {
    const lore = readJson(LORE_PATH);
    const source = readJson(SOURCE_PATH);

    assert.equal(typeof lore, 'object');
    assert.ok(lore && !Array.isArray(lore));
    assert.equal(Object.hasOwn(lore, 'entries'), true, '导入端点要求存在 entries');
    assert.equal(Array.isArray(lore.entries), false, '原生世界书的 entries 是 uid 映射，不是 character_book 数组');
    assert.equal(lore.entries && typeof lore.entries, 'object');

    const pairs = Object.entries(lore.entries);
    assert.equal(pairs.length, source.entries.length, '只保留源公开条目，不增删');
    assert.equal(source.entries.filter((entry) => entry.constant).length, 1);
    assert.equal(source.entries.filter((entry) => !entry.constant && entry.keys.length > 0).length, 1);

    for (const [id, entry] of pairs) {
        assert.equal(String(entry.uid), id);
        assert.equal(Number.isInteger(entry.uid), true);
        assert.ok(Array.isArray(entry.key) && entry.key.every((key) => typeof key === 'string'));
        assert.ok(Array.isArray(entry.keysecondary));
        assert.equal(typeof entry.content, 'string');
        assert.ok(entry.content.length > 0);
        assert.equal(typeof entry.comment, 'string');
        assert.equal(typeof entry.constant, 'boolean');
        assert.equal(typeof entry.selective, 'boolean');
        assert.equal(typeof entry.order, 'number');
        assert.equal(typeof entry.position, 'number');
        assert.equal(entry.position, 0, 'before_char 对应 ST position 0');
        assert.equal(entry.disable, false);
        assert.equal(entry.selectiveLogic, 0);
        assert.equal(entry.depth, 4);
        assert.equal(entry.probability, 100);
        assert.equal(entry.useProbability, true);
        assert.equal(entry.role, 0);
        assert.equal(entry.keys, undefined, '原生条目使用 key，不保留角色卡 keys');
        assert.equal(entry.secondary_keys, undefined);
        assert.equal(entry.insertion_order, undefined);
    }

    const native = Object.values(lore.entries);
    for (const sourceEntry of source.entries) {
        const found = native.find((entry) => entry.comment === sourceEntry.comment);
        assert.ok(found, `缺少条目 ${sourceEntry.comment}`);
        assert.equal(found.uid, sourceEntry.id);
        assert.deepEqual(found.key, sourceEntry.keys);
        assert.deepEqual(found.keysecondary, sourceEntry.secondary_keys);
        assert.equal(found.content, sourceEntry.content);
        assert.equal(found.constant, sourceEntry.constant);
        assert.equal(found.selective, sourceEntry.selective);
        assert.equal(found.order, sourceEntry.insertion_order);
        assert.equal(found.enabled, undefined);
    }

    assert.equal(native.filter((entry) => entry.constant && entry.key.length === 0).length, 1, '一条常驻条目');
    assert.equal(native.filter((entry) => !entry.constant && entry.key.includes('蓝窗书店') && entry.key.includes('书店')).length, 1, '一条关键词条目');
    assert.equal(lore.originalData.name, source.name);
    assert.equal(lore.originalData.description, source.description);
    assert.equal(lore.originalData.scan_depth, source.scan_depth);
    assert.equal(lore.originalData.token_budget, source.token_budget);
    assert.equal(lore.originalData.recursive_scanning, source.recursive_scanning);
    assert.deepEqual(lore.originalData.entries, source.entries);
});

test('任何字段都不含 GM_ONLY_ 或 PRIVATE_ 标记', () => {
    const raw = fs.readFileSync(LORE_PATH, 'utf8');
    const lore = JSON.parse(raw);
    assert.equal(raw.includes('GM_ONLY_'), false);
    assert.equal(raw.includes('PRIVATE_'), false);
    for (const text of collectStrings(lore)) {
        assert.equal(text.includes('GM_ONLY_'), false, text);
        assert.equal(text.includes('PRIVATE_'), false, text);
    }
});

test('与雨夜客栈整案无交集：不含 case_id、NPC 私密或 GM 文本', () => {
    const loreText = fs.readFileSync(LORE_PATH, 'utf8');
    const rainy = readJson(CASE_PATH);
    const forbidden = [
        rainy.case_id,
        ...collectValues(rainy.gm_truth),
        ...collectValues(rainy.initial_private_knowledge),
    ];
    for (const text of forbidden) {
        assert.notEqual(text, '');
        assert.equal(loreText.includes(text), false, `雨夜客栈文本泄漏: ${text}`);
    }
});
