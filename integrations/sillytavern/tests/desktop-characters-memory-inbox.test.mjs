import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = async (name) => readFile(new URL(`../extension/vc-model-settings/desktop/${name}.css`, import.meta.url), 'utf8');
const rules = (source) => [...source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(media|keyframes)[^{]*\{/g, '}').matchAll(/(^|\})\s*([^{}@][^{}]*)\{/g)].map((m) => m[2].trim());

const topLevel = (selector) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < selector.length; i++) {
        if ('([' .includes(selector[i])) depth++;
        else if (')]'.includes(selector[i])) depth--;
        else if (selector[i] === ',' && depth === 0) { parts.push(selector.slice(start, i)); start = i + 1; }
    }
    parts.push(selector.slice(start));
    return parts;
};

test('UX-22 R7/R8 桌面样式的每条选择器都限定在桌面布局内', async () => {
    for (const name of ['characters', 'memory', 'inbox']) {
        for (const selector of rules(await css(name))) {
            for (const part of topLevel(selector)) assert.match(part.trim(), /^html\[data-vc-layout="desktop"\]|^(from|to)$|^\d+%$/, `${name}.css: ${part.trim().slice(0, 80)}`);
        }
    }
});

test('UX-22 R7 无头像角色用首字 + 渐变底，实例分组带标题', async () => {
    const source = await css('characters');
    assert.match(source, /:not\(:has\(img\)\)[^}]*text-transform:\s*uppercase/);
    assert.match(source, /linear-gradient\(145deg/);
    assert.match(source, /\.vc-roles \+ \.vc-group::before\s*\{[^}]*content:\s*attr\(aria-label\)/);
});

test('UX-22 R8 陪伴右栏单独滚动并底部渐隐，记忆筛选使用设置分类行样式', async () => {
    const inbox = await css('inbox');
    assert.match(inbox, /@media\(min-width:1180px\)[\s\S]*\.vc-inbox-workspace > div \{[^}]*overflow-y:auto[^}]*mask-image:linear-gradient/);
    const memory = await css('memory');
    assert.match(memory, /\.vc-desktop-memory > \.vc-column \{ max-width:972px; \}/);
    assert.match(memory, /\.vc-segment > \[aria-pressed="true"\] \{[^}]*var\(--vc-select-fill\)/);
    assert.match(memory, /\.vc-segment \{[^}]*background:transparent/);
});
