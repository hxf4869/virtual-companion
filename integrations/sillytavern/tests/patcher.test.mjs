// 确定性补丁器：合成 fixture 验证正确替换与坏输入失败（不读 upstream/）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applySpecToText, applySpecToFile } from '../scripts/lib/patcher.mjs';
import { sha256 } from '../scripts/lib/util.mjs';

const CDN_A = 'https://cdn.example/npm/a/dist/a.min.js';
const CDN_B = 'https://cdn.example/npm/b/dist/b.min.js';
const bundle = `x("${CDN_A}");y("${CDN_B}");z("${CDN_A}");keep("https://cdn.example/npm/other.js");`;
const base = {
    id: 't', reason: 'r', upstream: { commit: 'c', version: 'v' }, removal_condition: 'rc', target: 'dist/index.js',
    expected_input_sha256: sha256(Buffer.from(bundle)),
    replacements: [
        { from: CDN_A, to: '/vendor/a/a.js', count: 2 },
        { from: CDN_B, to: '/vendor/b/b.js', count: 1 },
    ],
};

test('正确替换：命中次数精确、其余字串不动、输出 sha 可复现', () => {
    const r1 = applySpecToText(bundle, base);
    assert.equal(r1.output, `x("/vendor/a/a.js");y("/vendor/b/b.js");z("/vendor/a/a.js");keep("https://cdn.example/npm/other.js");`);
    assert.deepEqual(r1.report.map((x) => x.count), [2, 1]);
    const r2 = applySpecToText(bundle, { ...base, expected_output_sha256: r1.outputSha256 });
    assert.equal(r2.outputSha256, r1.outputSha256);
});

test('输入 sha 不匹配（上游产物变化）→ 拒绝', () => {
    assert.throws(() => applySpecToText(bundle + ' ', base), /输入 SHA256 不匹配/);
});

test('命中次数与规格不符 → 拒绝（多一处或少一处都失败）', () => {
    assert.throws(() => applySpecToText(bundle, { ...base, replacements: [{ from: CDN_A, to: '/v', count: 1 }] }), /命中 2 次，规格要求 1 次/);
    assert.throws(() => applySpecToText(bundle, { ...base, replacements: [{ from: CDN_A, to: '/v', count: 3 }] }), /命中 2 次，规格要求 3 次/);
    assert.throws(() => applySpecToText(bundle, { ...base, replacements: [{ from: 'https://cdn.example/npm/none.js', to: '/v', count: 1 }] }), /命中 0 次/);
});

test('声明的输出 sha 不匹配 → 拒绝', () => {
    assert.throws(() => applySpecToText(bundle, { ...base, expected_output_sha256: 'a'.repeat(64) }), /输出 SHA256 不匹配/);
});

test('规格无效 → 拒绝', () => {
    assert.throws(() => applySpecToText(bundle, { ...base, replacements: [] }), /规格无效/);
    assert.throws(() => applySpecToText(bundle, { ...base, reason: '' }), /缺少字段 reason/);
});

test('文件级应用：输出 0600，内容与文本级一致', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-patch-'));
    try {
        const inp = path.join(dir, 'in.js'); const out = path.join(dir, 'out.js');
        fs.writeFileSync(inp, bundle);
        const r = applySpecToFile(inp, out, base);
        assert.equal(fs.readFileSync(out, 'utf8'), r.output);
        assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
