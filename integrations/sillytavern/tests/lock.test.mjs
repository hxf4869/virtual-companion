// 锁文件与补丁规格一致性（离线，不需要 upstream/ 或 dev/）。
// 受管（managed）核心补丁规格只做结构校验：输入/输出 SHA 与真实 upstream 文件的比对在
// assemble-managed / start-managed 预检运行（需要 upstream/ 克隆）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../scripts/lib/patcher.mjs';
import { CORE_PATCH_SPECS } from '../scripts/lib/paths.mjs';

const INTEG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = JSON.parse(fs.readFileSync(path.join(INTEG, 'upstream.lock.json'), 'utf8'));
const vendor = JSON.parse(fs.readFileSync(path.join(INTEG, 'vendor.lock.json'), 'utf8'));
const spec = JSON.parse(fs.readFileSync(path.join(INTEG, 'patches', 'helper-selfhost-runtime-assets.json'), 'utf8'));
const coreSpecs = CORE_PATCH_SPECS.map((file) => ({
    id: path.basename(file, '.json'), file,
    json: JSON.parse(fs.readFileSync(file, 'utf8')),
}));
const HEX64 = /^[0-9a-f]{64}$/;
const SHA512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

test('upstream.lock：四组件均为 commit 锁定且产物 SHA256 合法', () => {
    assert.equal(upstream.policy.pin_by, 'commit');
    assert.equal(upstream.components.length, 4);
    for (const c of upstream.components) {
        assert.match(c.commit, /^[0-9a-f]{40}$/, c.id);
        assert.ok(c.license, `${c.id} 缺 license`);
        assert.ok(Object.keys(c.artifact_sha256).length >= 1, `${c.id} 缺产物 SHA`);
        for (const [f, h] of Object.entries(c.artifact_sha256)) assert.match(h, HEX64, `${c.id}/${f}`);
    }
});

test('vendor.lock：每个包有版本/许可/registry sha512/逐文件 sha256，目标路径不含 CDN', () => {
    assert.ok(vendor.packages.length >= 6);
    const targets = new Set();
    for (const p of vendor.packages) {
        assert.match(p.version, /^\d+\.\d+\.\d+$/, p.name);
        assert.ok(p.license, `${p.name} 缺 license`);
        assert.match(p.tarball, /^https:\/\/registry\.npmjs\.org\//, p.name);
        assert.ok(p.tarball.includes(`-${p.version}.tgz`), `${p.name} tarball 版本不一致`);
        assert.match(p.tarball_integrity, SHA512, p.name);
        assert.ok(p.files.length >= 1);
        for (const f of p.files) {
            assert.match(f.sha256, HEX64, f.to);
            assert.ok(!/jsdelivr|unpkg|cdnjs/.test(f.to), f.to);
            assert.ok(!targets.has(f.to), `重复目标 ${f.to}`);
            targets.add(f.to);
        }
    }
    for (const s of vendor.local_sources || []) { assert.match(s.sha256, HEX64); assert.ok(s.license); targets.add(s.to); }
    // FontAwesome 字体不能按 MIT 登记
    const fa = vendor.packages.find((p) => p.name === '@fortawesome/fontawesome-free');
    for (const f of fa.files.filter((f) => f.to.includes('/webfonts/'))) assert.equal(f.license, 'OFL-1.1', f.to);
    assert.ok(/OFL-1\.1/.test(fa.license) && /CC-BY-4\.0/.test(fa.license));
    // vue / vue-router 与 Helper 自身锁一致
    assert.equal(vendor.packages.find((p) => p.name === 'vue').version, '3.5.44');
    assert.equal(vendor.packages.find((p) => p.name === 'vue-router').version, '5.4.0');
});

test('Helper补丁：锁定输入、12处自托管资源与实际异步变量回调守卫均有明确目标', () => {
    assert.deepEqual(validateSpec(spec), []);
    const helper = upstream.components.find((c) => c.id === 'tavern-helper');
    assert.equal(spec.expected_input_sha256, helper.artifact_sha256['dist/index.js']);
    assert.match(spec.expected_output_sha256, HEX64);
    assert.notEqual(spec.expected_output_sha256, spec.expected_input_sha256);
    assert.equal(spec.upstream.commit, helper.commit);
    const vendorTargets = new Set([...vendor.packages.flatMap((p) => p.files.map((f) => f.to)), ...(vendor.local_sources || []).map((s) => s.to)]);
    const prefix = vendor.served_prefix + '/';
    let total = 0;
    let updaterGuards = 0;
    for (const r of spec.replacements) {
        if (r.where === 'W05 async variable updater') {
            assert.match(r.from, /^function WI\(/);
            assert.match(r.to, /vcG\.capture/); assert.match(r.to, /vcG\.assert/);
            assert.equal(r.count, 1); updaterGuards++;
            continue;
        }
        assert.match(r.from, /^https:\/\/testingcf\.jsdelivr\.net\//, r.from);
        assert.ok(r.to.startsWith(prefix), `${r.to} 不在 ${prefix}`);
        assert.ok(!/^https?:/.test(r.to), '替换目标不能是绝对 URL');
        const rel = r.to.slice(prefix.length);
        assert.ok(vendorTargets.has(rel), `vendor.lock 缺少 ${rel}`);
        total += r.count;
    }
    assert.equal(total, 12, '选定运行链共 12 处引用（1+1+1+1+1+3+2+2）');
    assert.equal(updaterGuards, 1, '实际updater只接一次来源守卫');
    assert.ok(spec.reason && spec.removal_condition && spec.upstream.version);
});

test('补丁规格：坏输入必须被拒绝（缺字段 / count 非法 / from==to / sha 非 hex）', () => {
    const bad1 = { ...spec, replacements: [{ from: 'a', to: 'a', count: 1 }] };
    assert.ok(validateSpec(bad1).some((e) => e.includes('相同')));
    const bad2 = { ...spec, replacements: [{ from: 'a', to: 'b', count: 0 }] };
    assert.ok(validateSpec(bad2).some((e) => e.includes('count')));
    const bad3 = { ...spec, expected_input_sha256: 'zz' };
    assert.ok(validateSpec(bad3).some((e) => e.includes('expected_input_sha256')));
    const { reason, ...bad4 } = spec;
    assert.ok(validateSpec(bad4).some((e) => e.includes('reason')));
});

test('受管全部核心补丁：锁定ST commit、结构有效、服务端和前端目标互不重叠', () => {
    const st = upstream.components.find((c) => c.id === 'sillytavern');
    const targets = new Set();
    for (const s of coreSpecs) {
        assert.deepEqual(validateSpec(s.json), [], `${s.id} 规格无效`);
        assert.equal(s.json.upstream.component, 'sillytavern');
        assert.equal(s.json.upstream.commit, st.commit, `${s.id} 必须对准锁定 commit`);
        assert.match(s.json.expected_input_sha256, HEX64, s.id);
        assert.match(s.json.expected_output_sha256, HEX64, s.id);
        assert.notEqual(s.json.expected_output_sha256, s.json.expected_input_sha256, s.id);
        assert.match(s.json.target, /^(src|public)\/.*\.js$/, `${s.id} 只作用于 ST 运行副本源码`);
        assert.ok(!targets.has(s.json.target), `补丁目标重叠 ${s.json.target}`);
        targets.add(s.json.target);
        assert.ok(s.json.replacements.length >= 1);
        assert.ok(s.json.reason && s.json.removal_condition && s.json.applies_to);
    }
    assert.equal(targets.size, CORE_PATCH_SPECS.length);
    assert.ok(targets.has('src/endpoints/backends/chat-completions.js'));
    assert.ok(targets.has('src/util.js'));
});
