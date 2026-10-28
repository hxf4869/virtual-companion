// 确定性补丁器与受管（managed）运行装配：合成 fixture 验证正确替换与坏输入失败（不读 upstream/）。
// 受管部分覆盖：运行副本构建（顶层排除 + node_modules 符号链接 + 核心补丁 SHA 硬校验）、
// 部署排除 harness、verifyCorePatches/verifyManagedDeployment 漂移检出、幂等重跑逐字节一致、
// Go 桥接环境硬校验（requireManagedGoEnv：baseURL/token/账号映射）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applySpecToText, applySpecToFile } from '../scripts/lib/patcher.mjs';
import { sha256, sha256File } from '../scripts/lib/util.mjs';
import { buildRunCopy, deployManagedAssets, verifyCorePatches, verifyManagedDeployment, assertManagedDevIsolated, requireManagedGoEnv } from '../scripts/lib/managed.mjs';

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

// ---------- 受管（managed）运行装配（合成树；不依赖真实 upstream/） ----------

const STREAM_LINE = '            console.warn(`Streaming request failed with status ${from.status} ${statusText}: ${detail}`);';
const UTIL_SRC = `"use strict";\n${STREAM_LINE}\nmodule.exports = {};\n`;

/** 合成 ST 源树 + 核心补丁规格 + 插件/扩展源，全部落在临时目录。 */
function makeManagedFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-managed-'));
    const stDir = path.join(root, 'SillyTavern');
    fs.mkdirSync(path.join(stDir, 'src', 'endpoints', 'backends'), { recursive: true });
    fs.writeFileSync(path.join(stDir, 'server.js'), 'console.log("st");\n');
    fs.writeFileSync(path.join(stDir, 'src', 'util.js'), UTIL_SRC);
    fs.writeFileSync(path.join(stDir, 'src', 'endpoints', 'backends', 'chat-completions.js'), 'module.exports = {};\n');
    // 依赖树以符号链接复用：合成 node_modules 必须真实存在
    fs.mkdirSync(path.join(stDir, 'node_modules', 'express'), { recursive: true });
    fs.writeFileSync(path.join(stDir, 'node_modules', 'express', 'package.json'), '{"name":"express","version":"5.0.0"}\n');
    // 顶层排除项：复制后不得出现在运行副本
    for (const d of ['data', 'backups', 'colab', '.git']) fs.mkdirSync(path.join(stDir, d));
    fs.writeFileSync(path.join(stDir, 'data', 'x.txt'), 'x');
    // 补丁规格（输入/输出 SHA 由合成内容计算，applySpecToFile 硬校验）
    const patched = UTIL_SRC.split(STREAM_LINE).join('            console.warn(`Streaming request failed with status ${from.status} ${statusText}`); // vc patch');
    const spec = {
        id: 't-util', kind: 'deterministic-string-replacement', reason: 'r', upstream: { component: 'sillytavern', commit: 'c', version: 'v' },
        target: 'src/util.js', applies_to: 'a', removal_condition: 'rc',
        expected_input_sha256: sha256(Buffer.from(UTIL_SRC)),
        expected_output_sha256: sha256(Buffer.from(patched)),
        replacements: [{ from: STREAM_LINE, to: '            console.warn(`Streaming request failed with status ${from.status} ${statusText}`); // vc patch', count: 1 }],
    };
    const specFile = path.join(root, 't-util.json');
    fs.writeFileSync(specFile, JSON.stringify(spec));
    // 插件与扩展源（扩展含必须排除的 harness/）
    const pluginSrc = path.join(root, 'server-plugin');
    fs.mkdirSync(path.join(pluginSrc, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(pluginSrc, 'index.js'), 'export default {};\n');
    fs.writeFileSync(path.join(pluginSrc, 'package.json'), '{"name":"vc-plugin","type":"module"}\n');
    fs.writeFileSync(path.join(pluginSrc, 'lib', 'go-client.js'), 'export const x = 1;\n');
    const extSrc = path.join(root, 'extension');
    fs.mkdirSync(path.join(extSrc, 'harness'), { recursive: true });
    fs.writeFileSync(path.join(extSrc, 'manifest.json'), '{"js":"index.js"}\n');
    fs.writeFileSync(path.join(extSrc, 'index.js'), 'export const init = () => {};\n');
    for (const name of ['f2-client.js', 'instance-binding.js']) fs.writeFileSync(path.join(extSrc, name), 'export {};\n');
    fs.writeFileSync(path.join(extSrc, 'harness', 'server.mjs'), 'export {}; // 开发验收用具，不是生产扩展资产\n');
    return { root, stDir, spec, specFile, patched, pluginSrc, extSrc };
}

test('buildRunCopy：顶层排除项不进副本、node_modules 为符号链接、核心补丁 SHA 硬校验通过', () => {
    const f = makeManagedFixture();
    try {
        const runDir = path.join(f.root, 'st-run');
        const patches = buildRunCopy({ stDir: f.stDir, runDir, specs: [f.specFile] });
        assert.equal(patches.length, 1);
        assert.equal(patches[0].id, 't-util');
        assert.equal(patches[0].output_sha256, sha256(Buffer.from(f.patched)));
        for (const d of ['.git', 'data', 'backups', 'colab']) assert.ok(!fs.existsSync(path.join(runDir, d)), `副本不应包含顶层 ${d}`);
        assert.ok(fs.lstatSync(path.join(runDir, 'node_modules')).isSymbolicLink(), 'node_modules 必须是符号链接');
        assert.equal(fs.realpathSync(path.join(runDir, 'node_modules')), fs.realpathSync(path.join(f.stDir, 'node_modules')));
        assert.equal(fs.readFileSync(path.join(runDir, 'src', 'util.js'), 'utf8'), f.patched, '补丁后的 util.js 落位');
        assert.equal(fs.readFileSync(path.join(f.stDir, 'src', 'util.js'), 'utf8'), UTIL_SRC, 'upstream 原文件必须保持未改');
        const cp = verifyCorePatches({ stDir: f.stDir, runDir, specs: [f.specFile] });
        assert.equal(cp.ok, true);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('buildRunCopy：上游输入漂移或规格 SHA 不匹配必须硬失败（不静默产出）', () => {
    const f = makeManagedFixture();
    try {
        fs.appendFileSync(path.join(f.stDir, 'src', 'util.js'), '// drift\n');
        assert.throws(() => buildRunCopy({ stDir: f.stDir, runDir: path.join(f.root, 'st-run'), specs: [f.specFile] }), /输入 SHA256 不匹配/);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('受管装配幂等：重跑 buildRunCopy 后补丁产物与关键文件逐字节一致', () => {
    const f = makeManagedFixture();
    try {
        const runDir = path.join(f.root, 'st-run');
        buildRunCopy({ stDir: f.stDir, runDir, specs: [f.specFile] });
        const before = {
            util: sha256File(path.join(runDir, 'src', 'util.js')),
            server: sha256File(path.join(runDir, 'server.js')),
            cc: sha256File(path.join(runDir, 'src', 'endpoints', 'backends', 'chat-completions.js')),
        };
        buildRunCopy({ stDir: f.stDir, runDir, specs: [f.specFile] });
        assert.equal(sha256File(path.join(runDir, 'src', 'util.js')), before.util);
        assert.equal(sha256File(path.join(runDir, 'server.js')), before.server);
        assert.equal(sha256File(path.join(runDir, 'src', 'endpoints', 'backends', 'chat-completions.js')), before.cc);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('deployManagedAssets：harness 不被部署；部署漂移/缺失被 verifyManagedDeployment 检出', () => {
    const f = makeManagedFixture();
    try {
        const runDir = path.join(f.root, 'st-run');
        const extDir = path.join(f.root, 'data', 'default-user', 'extensions');
        fs.mkdirSync(extDir, { recursive: true });
        const dep = deployManagedAssets({ pluginSrc: f.pluginSrc, extensionSrc: f.extSrc, runDir, extDir });
        assert.equal(dep.plugin.files, 3);
        assert.equal(dep.extension.files, 4, 'harness 内文件不计入部署');
        assert.ok(!fs.existsSync(path.join(extDir, 'vc-model-settings', 'harness')));
        assert.ok(fs.existsSync(path.join(runDir, 'plugins', 'virtual-companion', 'index.js')));
        let v = verifyManagedDeployment({ pluginSrc: f.pluginSrc, extensionSrc: f.extSrc, runDir, extDir });
        assert.equal(v.ok, true);
        const runtimeClient = path.join(runDir, 'public/scripts/vc-runtime/f2-client.js');
        assert.ok(fs.existsSync(runtimeClient), '所有profile共用原生F2模块');
        fs.writeFileSync(runtimeClient, 'tampered\n');
        v = verifyManagedDeployment({ pluginSrc: f.pluginSrc, extensionSrc: f.extSrc, runDir, extDir });
        assert.ok(v.problems.some((p) => p.includes('native F2')));
        fs.rmSync(path.join(extDir, 'vc-model-settings', 'manifest.json'));
        v = verifyManagedDeployment({ pluginSrc: f.pluginSrc, extensionSrc: f.extSrc, runDir, extDir });
        assert.equal(v.ok, false);
        assert.ok(v.problems.some((p) => p.includes('manifest.json')));
        fs.writeFileSync(path.join(runDir, 'plugins', 'virtual-companion', 'index.js'), 'tampered\n');
        v = verifyManagedDeployment({ pluginSrc: f.pluginSrc, extensionSrc: f.extSrc, runDir, extDir });
        assert.ok(v.problems.some((p) => p.includes('内容漂移')));
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('verifyCorePatches：upstream 输入或运行副本输出被改动都会被检出', () => {
    const f = makeManagedFixture();
    try {
        const runDir = path.join(f.root, 'st-run');
        buildRunCopy({ stDir: f.stDir, runDir, specs: [f.specFile] });
        fs.writeFileSync(path.join(runDir, 'src', 'util.js'), 'tampered\n');
        let v = verifyCorePatches({ stDir: f.stDir, runDir, specs: [f.specFile] });
        assert.equal(v.ok, false);
        assert.ok(v.problems.some((p) => p.includes('输出 SHA 不匹配')));
        buildRunCopy({ stDir: f.stDir, runDir, specs: [f.specFile] });
        fs.appendFileSync(path.join(f.stDir, 'src', 'util.js'), '// drift\n');
        v = verifyCorePatches({ stDir: f.stDir, runDir, specs: [f.specFile] });
        assert.ok(v.problems.some((p) => p.includes('输入 SHA 不匹配')));
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('assertManagedDevIsolated：受管目录指向原生 dev/ 默认路径必须拒绝', () => {
    const nativeDefault = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dev');
    assert.throws(() => assertManagedDevIsolated(nativeDefault), /原生 dev/);
    assert.doesNotThrow(() => assertManagedDevIsolated(path.join(nativeDefault, '..', 'dev-managed')));
});

// ---------- Go 桥接环境硬校验（requireManagedGoEnv） ----------

const goEnvValid = {
    VC_ST_GO_BASE_URL: 'http://127.0.0.1:8095',
    VC_ST_PLUGIN_SERVICE_TOKEN: 't'.repeat(32),
    VC_ST_ACCOUNT_HANDLES: '{"12345678901234567":"owner-main"}',
};

test('requireManagedGoEnv：完整环境（含有效账号映射）通过，返回解析后的 accountHandles 供 start 透传', () => {
    const r = requireManagedGoEnv(goEnvValid);
    assert.equal(r.ok, true);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.accountHandles, { '12345678901234567': 'owner-main' });
});

test('requireManagedGoEnv：空/非法/重复 handle 的账号映射必须被拒绝，且错误不回显映射内容', () => {
    const missing = { ...goEnvValid, VC_ST_ACCOUNT_HANDLES: '' };
    for (const env of [missing, { ...goEnvValid, VC_ST_ACCOUNT_HANDLES: undefined }, { ...goEnvValid, VC_ST_ACCOUNT_HANDLES: '{}' }]) {
        const r = requireManagedGoEnv(env);
        assert.equal(r.ok, false, '空映射必须被拒');
        assert.ok(r.problems.some((p) => p.startsWith('VC_ST_ACCOUNT_HANDLES')));
        assert.equal(r.accountHandles, undefined);
    }
    const invalid = [
        '{bad json',                             // 非法 JSON
        '{"acct":"owner-main"}',                 // 账号不是正整数 ID
        '{"12345678901234567":"../escape"}',     // handle 含路径字符
        '{"1":"dup","2":"dup"}',                 // 两个账号共用同一 handle
        '["12345678901234567"]',                 // 不是对象
    ];
    for (const raw of invalid) {
        const r = requireManagedGoEnv({ ...goEnvValid, VC_ST_ACCOUNT_HANDLES: raw });
        assert.equal(r.ok, false, `非法映射必须被拒（${raw.slice(0, 12)}…）`);
        assert.ok(r.problems.some((p) => p.startsWith('VC_ST_ACCOUNT_HANDLES')));
        assert.equal(r.accountHandles, undefined);
        for (const p of r.problems) {
            assert.ok(!p.includes('owner-main') && !p.includes('dup') && !p.includes('bad json') && !p.includes('escape'), '错误信息不得回显映射内容');
        }
    }
});
