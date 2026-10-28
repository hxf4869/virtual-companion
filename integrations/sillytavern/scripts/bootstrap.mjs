#!/usr/bin/env node
// V2-W03-S1 bootstrap：把锁定上游栈固化为可重现的开发入口。
// 步骤（任一失败即硬失败退出，不产出半成品）：
//   1) 校验 upstream/ 四仓库 HEAD == upstream.lock.json 的 commit 且工作树干净；
//   2) 校验 lock 声明的原始产物 SHA256；
//   3) ST 生产依赖树对照锁定 package-lock.json 校验，不一致时 npm ci（联网；不运行 npm install、不改上游锁）；
//   4) 下载 vendor.lock.json 固定的 npm 官方 tarball（联网；--offline 用已缓存），
//      校验 registry sha512 完整性与逐文件 SHA256；
//   5) 在本切片专用 dataRoot（0700）下复制 Helper/EJS 并对 Helper dist 应用确定性补丁；
//      放置自托管 vendor 资源与 MVU bundle；
//   6) 生成最小 config.yaml（0600）；写 derived-manifest.json（派生产物记录，原始 lock 值不动）。
// 用法：node scripts/bootstrap.mjs [--offline] [--refresh-vendor]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    INTEG, ST_DIR, HELPER_DIR, EJS_DIR, MVU_DIR, UPSTREAM_LOCK, VENDOR_LOCK, PATCH_SPEC,
    DEV, DATA_ROOT, USER_DIR, EXT_DIR, RUN_DIR, CONFIG_PATH, DERIVED_MANIFEST, VENDOR_CACHE,
    ST_PORT,
} from './lib/paths.mjs';
import { sha256File, sha512Base64, readJson, writeJson, mkdirp, run, copyTree, ok, info, fail } from './lib/util.mjs';
import { applySpecToFile } from './lib/patcher.mjs';
import { renderConfig } from './lib/config.mjs';
import { verifyStDependencyTree, verifyVendorTree, verifyPatchedDist, VENDOR_SERVE_ROOT } from './lib/verify.mjs';

const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const REFRESH_VENDOR = args.includes('--refresh-vendor');

function die(msg) { fail(msg, 2); }

// ---------- 1. 上游 commit 与工作树 ----------
function verifyUpstreams(lock) {
    const dirById = { sillytavern: ST_DIR, 'tavern-helper': HELPER_DIR, 'ejs-template': EJS_DIR, mvu: MVU_DIR };
    for (const c of lock.components) {
        const dir = dirById[c.id];
        if (!dir || !fs.existsSync(dir)) {
            die(`upstream/${c.id} 不存在。按 README「首次拉取」克隆后重跑（克隆不在 bootstrap 内自动执行，避免隐式网络写操作）。`);
        }
        const head = run('git', ['-C', dir, 'rev-parse', 'HEAD']).trim();
        if (head !== c.commit) die(`upstream/${c.id} HEAD ${head} != 锁定 ${c.commit}`);
        const dirty = run('git', ['-C', dir, 'status', '--porcelain']).trim();
        if (dirty) die(`upstream/${c.id} 工作树不干净：\n${dirty.slice(0, 400)}`);
        ok(`upstream ${c.id} @ ${head.slice(0, 10)}（干净）`);
    }
}

// ---------- 2. 原始产物 SHA ----------
function verifyArtifacts(lock) {
    const dirById = { sillytavern: ST_DIR, 'tavern-helper': HELPER_DIR, 'ejs-template': EJS_DIR, mvu: MVU_DIR };
    for (const c of lock.components) {
        for (const [rel, want] of Object.entries(c.artifact_sha256 || {})) {
            const file = path.join(dirById[c.id], rel);
            if (!fs.existsSync(file)) die(`缺少产物 ${c.id}/${rel}`);
            const got = sha256File(file);
            if (got !== want) die(`${c.id}/${rel} SHA256 不匹配：实际 ${got}，锁定 ${want}`);
        }
    }
    ok('原始产物 SHA256 全部匹配 upstream.lock.json');
}

// ---------- 3. ST 依赖（按锁定 package-lock.json：树校验不一致才 npm ci；不运行 npm install、不改上游锁） ----------
function ensureStDeps() {
    const tree = verifyStDependencyTree();
    if (tree.ok) { ok(`ST 依赖树与 package-lock 一致（${tree.checked} 个生产包）`); return; }
    info(`ST 依赖树与锁不一致：缺 ${tree.missing.length}，版本不符 ${tree.mismatched.length}`);
    if (OFFLINE) die('ST 依赖需要 npm ci 重建但处于 --offline');
    info('npm ci --omit=dev --ignore-scripts（按锁定 package-lock.json 重建 node_modules）…');
    run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error', '--no-progress', '--omit=dev', '--ignore-scripts'], { cwd: ST_DIR });
    const after = verifyStDependencyTree();
    if (!after.ok) die(`npm ci 后依赖树仍不一致：缺 ${after.missing.slice(0, 3).join(',')} 版本不符 ${after.mismatched.slice(0, 3).join(',')}`);
    const dirty = run('git', ['-C', ST_DIR, 'status', '--porcelain']).trim();
    if (dirty) die(`npm ci 改动了上游工作树：\n${dirty.slice(0, 300)}`);
    ok(`ST 依赖按锁重建完成（${after.checked} 个生产包）`);
}

// ---------- 4. vendor 资产 ----------
async function fetchTo(url, file) {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`下载失败 HTTP ${r.status} ${url}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(file, buf);
    return buf;
}

async function ensureVendorAssets(vendorLock, report) {
    mkdirp(VENDOR_CACHE, 0o700);
    for (const pkg of vendorLock.packages) {
        const tgz = path.join(VENDOR_CACHE, `${pkg.name.replace('/', '_')}-${pkg.version}.tgz`);
        let buf = REFRESH_VENDOR || !fs.existsSync(tgz) ? null : fs.readFileSync(tgz);
        if (!buf) {
            if (OFFLINE) die(`vendor 缓存缺 ${pkg.name}@${pkg.version} 且 --offline`);
            info(`下载 ${pkg.name}@${pkg.version} …`);
            buf = await fetchTo(pkg.tarball, tgz);
        }
        const digest = `sha512-${sha512Base64(buf)}`;
        if (digest !== pkg.tarball_integrity) {
            if (OFFLINE && !REFRESH_VENDOR) {
                // 缓存损坏：联网一次重取
                die(`vendor 缓存 ${path.basename(tgz)} sha512 不匹配（缓存损坏）；重跑并去掉 --offline 或带 --refresh-vendor`);
            }
            die(`${pkg.name}@${pkg.version} tarball sha512 不匹配：实际 ${digest}`);
        }
        const extractDir = path.join(VENDOR_CACHE, '.extract', pkg.name.replace('/', '_') + '-' + pkg.version);
        mkdirp(extractDir, 0o700);
        for (const f of pkg.files) {
            const dst = path.join(VENDOR_CACHE, f.to);
            if (!fs.existsSync(dst) || sha256File(dst) !== f.sha256) {
                run('tar', ['-xzf', tgz, '-C', extractDir, f.from]);
                mkdirp(path.dirname(dst), 0o700);
                fs.copyFileSync(path.join(extractDir, f.from), dst);
                fs.chmodSync(dst, 0o600);
            }
            const got = sha256File(dst);
            if (got !== f.sha256) die(`vendor 文件 ${f.to} SHA256 不匹配：实际 ${got}`);
            report.push({ package: pkg.name, version: pkg.version, file: f.to, sha256: got, license: f.license || pkg.license });
        }
        fs.rmSync(extractDir, { recursive: true, force: true });
    }
    for (const src of vendorLock.local_sources || []) {
        const from = path.join(HELPER_DIR, 'src', 'iframe', 'node_modules', 'log.js');
        const dst = path.join(VENDOR_CACHE, src.to);
        mkdirp(path.dirname(dst), 0o700);
        fs.copyFileSync(from, dst);
        const got = sha256File(dst);
        if (got !== src.sha256) die(`log.js SHA256 不匹配：实际 ${got}`);
        report.push({ package: 'tavern-helper(log.js)', version: '0af42106', file: src.to, sha256: got, license: src.license });
    }
    ok(`vendor 资产就绪并逐文件校验（${report.length} 个文件）`);
}

// ---------- 5. dataRoot 组装 ----------
function assembleDataRoot(vendorReport) {
    mkdirp(DEV, 0o700);
    mkdirp(DATA_ROOT, 0o700);            // 本切片专用 dataRoot：0700，不再沿用 W00 的 755
    mkdirp(path.join(USER_DIR, 'user', 'files'), 0o700);
    mkdirp(RUN_DIR, 0o700);

    // 扩展目录是可重放的派生物：每次整体重建
    fs.rmSync(path.join(EXT_DIR, 'JS-Slash-Runner'), { recursive: true, force: true });
    fs.rmSync(path.join(EXT_DIR, 'ST-Prompt-Template'), { recursive: true, force: true });
    copyTree(HELPER_DIR, path.join(EXT_DIR, 'JS-Slash-Runner'));
    copyTree(EJS_DIR, path.join(EXT_DIR, 'ST-Prompt-Template'));
    ok('扩展已从锁定上游复制（排除 .git）');

    // 确定性补丁：只改 dataRoot 副本，upstream/ 不动
    const spec = readJson(PATCH_SPEC);
    const result = applySpecToFile(
        path.join(EXT_DIR, 'JS-Slash-Runner', 'dist', 'index.js'),
        path.join(EXT_DIR, 'JS-Slash-Runner', 'dist', 'index.js'),
        spec,
    );
    ok(`Helper dist 补丁应用：${result.report.length} 条替换，输出 SHA256 ${result.outputSha256.slice(0, 12)}…`);

    // 自托管 vendor 资源
    fs.rmSync(VENDOR_SERVE_ROOT, { recursive: true, force: true });
    mkdirp(VENDOR_SERVE_ROOT, 0o700);
    for (const v of vendorReport) {
        const src = path.join(VENDOR_CACHE, v.file);
        const dst = path.join(VENDOR_SERVE_ROOT, v.file);
        mkdirp(path.dirname(dst), 0o700);
        fs.copyFileSync(src, dst);
        fs.chmodSync(dst, 0o600);
    }
    const vt = verifyVendorTree();
    if (!vt.ok) die(`vendor 落位后校验失败：缺 ${vt.missing.join(',')} 不符 ${vt.mismatched.join(',')}`);
    const pd = verifyPatchedDist();
    if (!pd.ok) die(`补丁产物落位后校验失败：${JSON.stringify(pd)}`);
    ok(`自托管 vendor 就位并逐文件校验（${vt.expected} 文件）：${VENDOR_SERVE_ROOT.replace(INTEG + '/', '')}（同源 /scripts/extensions/third-party/JS-Slash-Runner/lib/vendor/…）`);

    // MVU bundle（沿用 W00 已验证的自托管路径）
    const mvuLock = readJson(UPSTREAM_LOCK).components.find((c) => c.id === 'mvu');
    const mvuDst = path.join(USER_DIR, 'user', 'files', 'mvu-bundle-d03b7dc8.js');
    fs.copyFileSync(path.join(MVU_DIR, 'artifact', 'bundle.js'), mvuDst);
    fs.chmodSync(mvuDst, 0o600);
    const mvuSha = sha256File(mvuDst);
    if (mvuSha !== mvuLock.artifact_sha256['artifact/bundle.js']) die(`MVU bundle SHA256 不匹配：${mvuSha}`);
    ok('MVU bundle 自托管并校验');
}

// ---------- 6. config + manifest ----------
function writeConfigAndManifest(vendorReport, patchResult) {
    fs.writeFileSync(CONFIG_PATH, renderConfig({ dataRoot: DATA_ROOT, port: ST_PORT }), { mode: 0o600 });
    fs.chmodSync(CONFIG_PATH, 0o600);
    writeJson(DERIVED_MANIFEST, {
        generated_at: new Date().toISOString(),
        generated_by: 'V2-W03-S1 bootstrap',
        data_root: DATA_ROOT,
        config: { path: CONFIG_PATH, mode: '0600' },
        patches: [{ id: readJson(PATCH_SPEC).id, target: 'extensions/JS-Slash-Runner/dist/index.js', input_sha256: patchResult.inputSha256, output_sha256: patchResult.outputSha256, replacements: patchResult.report }],
        vendor: vendorReport,
        mvu_bundle: { file: 'user/files/mvu-bundle-d03b7dc8.js', sha256: readJson(UPSTREAM_LOCK).components.find((c) => c.id === 'mvu').artifact_sha256['artifact/bundle.js'] },
        note: '原始产物 SHA256 只存于 upstream.lock.json（未改）；本文件是派生产物记录。',
    });
    fs.writeFileSync(path.join(DEV, 'bootstrap-ok'), new Date().toISOString(), { mode: 0o600 });
    ok(`config.yaml（0600）与 derived-manifest.json 已写入 ${DEV.replace(INTEG + '/', '')}/`);
}

// ---------- main ----------
async function main() {
    process.umask(0o077);
    const lock = readJson(UPSTREAM_LOCK);
    const vendorLock = readJson(VENDOR_LOCK);
    verifyUpstreams(lock);
    verifyArtifacts(lock);
    ensureStDeps();
    const vendorReport = [];
    await ensureVendorAssets(vendorLock, vendorReport);
    let patchResult;
    {
        // 先在临时位置应用补丁以获得结果记录，再由 assembleDataRoot 正式落位
        assembleDataRoot(vendorReport);
        const spec = readJson(PATCH_SPEC);
        patchResult = { inputSha256: spec.expected_input_sha256, outputSha256: spec.expected_output_sha256, report: spec.replacements.map((r) => ({ from: r.from, to: r.to, count: r.count })) };
    }
    writeConfigAndManifest(vendorReport, patchResult);
    ok(`bootstrap 完成：start 用 node ${path.relative(INTEG, path.join(INTEG, 'scripts', 'start.mjs'))}`);
}

main().catch((e) => die(e.stack || String(e)));
