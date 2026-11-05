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
    INTEG, HELPER_DIR, EJS_DIR, MVU_DIR, UPSTREAM_LOCK, VENDOR_LOCK, PATCH_SPEC,
    DEV, DATA_ROOT, USER_DIR, EXT_DIR, RUN_DIR, CONFIG_PATH, DERIVED_MANIFEST, VENDOR_CACHE,
    ST_PORT, MVU_PATCH_SPEC, EJS_DESKTOP_PATCH_SPEC, MVU_DESKTOP_PATCH_SPEC,
} from './lib/paths.mjs';
import { sha256File, sha512Base64, readJson, writeJson, mkdirp, run, copyTree, ok, info, fail } from './lib/util.mjs';
import { applySpecToFile } from './lib/patcher.mjs';
import { createEjsEditorSource } from './lib/ejs-editor.mjs';
import { ensureLockedStDependencies, prepareHelperPackages, verifyLockedCheckouts } from './lib/desktop-source-inputs.mjs';
import { renderConfig } from './lib/config.mjs';
import { verifyVendorTree, verifyPatchedDist, VENDOR_SERVE_ROOT } from './lib/verify.mjs';

const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const REFRESH_VENDOR = args.includes('--refresh-vendor');

function die(msg) { fail(msg, 2); }

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
    applySpecToFile(path.join(EJS_DIR, 'dist/index.js'), path.join(EXT_DIR, 'ST-Prompt-Template/dist/desktop.js'), readJson(EJS_DESKTOP_PATCH_SPEC));
    const editorFile=path.join(EXT_DIR,'ST-Prompt-Template/dist/desktop-editor.js');
    fs.writeFileSync(editorFile,createEjsEditorSource(fs.readFileSync(path.join(EJS_DIR,'dist/index.js'),'utf8')),{mode:0o600});
    if(sha256File(editorFile)!==readJson(EJS_DESKTOP_PATCH_SPEC).desktop_editor_sha256)die('EJS编辑器派生产物不匹配');
    // 原生/手机与桌面共用同一设置；原发布树漏掉的worker也落到原调用路径。
    fs.copyFileSync(path.join(INTEG, 'extension/vc-model-settings/desktop/standalone/cards/ejs-worker.js'), path.join(EXT_DIR, 'ST-Prompt-Template/dist/ejs.workers.js'));
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
    const mvuSpec = readJson(MVU_PATCH_SPEC);
    if (mvuSpec.expected_input_sha256 !== mvuLock.artifact_sha256['artifact/bundle.js']) die('MVU 补丁输入与上游锁不符');
    applySpecToFile(path.join(MVU_DIR, 'artifact', 'bundle.js'), mvuDst, mvuSpec);
    applySpecToFile(mvuDst, path.join(EXT_DIR, 'JS-Slash-Runner/lib/mvu-desktop.js'), readJson(MVU_DESKTOP_PATCH_SPEC));
    fs.copyFileSync(path.join(MVU_DIR, 'artifact/bundle.js.LICENSE.txt'), path.join(EXT_DIR, 'JS-Slash-Runner/lib/mvu-desktop.js.LICENSE.txt'));
    const licenseDst = path.join(USER_DIR, 'user/files/bundle.js.LICENSE.txt');
    fs.copyFileSync(path.join(MVU_DIR, 'artifact/bundle.js.LICENSE.txt'), licenseDst);
    fs.chmodSync(licenseDst, 0o600);
    ok('MVU bundle 生命周期补丁、自托管与输入输出校验');
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
        mvu_bundle: { file: 'user/files/mvu-bundle-d03b7dc8.js', patch: readJson(MVU_PATCH_SPEC).id, sha256: readJson(MVU_PATCH_SPEC).expected_output_sha256 },
        ejs_desktop: { file: 'extensions/ST-Prompt-Template/dist/desktop.js', patch: readJson(EJS_DESKTOP_PATCH_SPEC).id, sha256: readJson(EJS_DESKTOP_PATCH_SPEC).expected_output_sha256 },
        ejs_desktop_editor: {file:'extensions/ST-Prompt-Template/dist/desktop-editor.js',sha256:readJson(EJS_DESKTOP_PATCH_SPEC).desktop_editor_sha256},
        mvu_desktop: { file: 'extensions/JS-Slash-Runner/lib/mvu-desktop.js', patch: readJson(MVU_DESKTOP_PATCH_SPEC).id, sha256: readJson(MVU_DESKTOP_PATCH_SPEC).expected_output_sha256 },
        note: '原始产物 SHA256 只存于 upstream.lock.json（未改）；本文件是派生产物记录。',
    });
    fs.writeFileSync(path.join(DEV, 'bootstrap-ok'), new Date().toISOString(), { mode: 0o600 });
    ok(`config.yaml（0600）与 derived-manifest.json 已写入 ${DEV.replace(INTEG + '/', '')}/`);
}

// ---------- main ----------
async function main() {
    process.umask(0o077);
    const lock = readJson(UPSTREAM_LOCK);
    if (args.includes('--memorycore-only')) {
        verifyLockedCheckouts(lock, ['memorycore']);
        ok('MemoryCore foundation bootstrap complete (no npm install / postinstall)'); return;
    }
    const vendorLock = readJson(VENDOR_LOCK);
    verifyLockedCheckouts(lock);
    ok('上游检出及原始产物与 upstream.lock.json 一致');
    const tree = ensureLockedStDependencies({ offline: OFFLINE });
    ok(`ST 依赖树与 package-lock 一致（${tree.checked} 个生产包）`);
    prepareHelperPackages({ offline: OFFLINE });
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
