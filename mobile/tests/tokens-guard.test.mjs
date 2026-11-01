// token 守护：页面与组件不写字面颜色、阴影色、字号、圆角、时长（DESIGN.md §3.1、§17.1）。
// 主题文件（src/themes/）与图标 sprite 除外。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const RULES = [
    [/#[0-9a-fA-F]{3,8}\b/, '字面颜色'],
    [/\b(?:rgba?|hsla?)\(\s*\d/, '字面颜色'],
    [/font-size\s*:\s*[\d.]+(?:px|rem|em)/, '字面字号'],
    [/border-radius\s*:\s*[\d.]+(?:px|rem|em|%)/, '字面圆角'],
    [/\b\d+(?:\.\d+)?m?s\b(?=[^;{}]*;)/, '字面时长'],
];

export function scan(text) {
    const style = text.replace(/<template>[\s\S]*?<\/template>/g, '');
    const hits = [];
    style.split('\n').forEach((line, i) => {
        for (const [re, label] of RULES) if (re.test(line.replace(/\/\/.*$|\/\*.*?\*\//g, ''))) hits.push(`${i + 1}: ${label}: ${line.trim()}`);
    });
    return hits;
}

function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return ['themes', 'static'].includes(e.name) ? [] : files(p);
        return /\.(vue|css|scss|js|mjs)$/.test(e.name) ? [p] : [];
    });
}

test('守护能识别字面值（防永远通过）', () => {
    assert.equal(scan('.a { color: #fff; }').length, 1);
    assert.equal(scan('.a { background: rgba(0,0,0,.2); }').length, 1);
    assert.equal(scan('.a { transition: opacity 200ms; }').length, 1);
    assert.equal(scan('.a { border-radius: 12px; }').length, 1);
    assert.equal(scan('.a { color: var(--vc-ink); transition: opacity var(--vc-dur-quick); }').length, 0);
});

test('src 内页面与组件只用 token', () => {
    const bad = files(SRC).flatMap((f) => scan(fs.readFileSync(f, 'utf8')).map((h) => `${path.relative(SRC, f)}:${h}`));
    assert.deepEqual(bad, []);
});
