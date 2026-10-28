#!/usr/bin/env node
// V2-W03 受管（managed）运行装配：在 dev-managed/（VC_ST_DEV_DIR 可覆盖）下构建最小可重放运行副本。
// 步骤（任一失败即硬失败退出，不产出半成品）：
//   1) 防线：受管目录不得指向原生 dev/；
//   2) 校验 upstream/SillyTavern HEAD == upstream.lock.json 且工作树干净，两个核心补丁规格结构有效；
//   3) 校验 ST 依赖树（bootstrap 已按锁定 package-lock 重建 upstream node_modules，受管只用符号链接复用，不重建）；
//   4) 整体重建 st-run 运行副本：复制源码树（顶层排除 .git/node_modules/data/backups/colab）、
//      node_modules 符号链接指向 upstream、应用两个核心补丁（输入/输出 SHA 硬校验；upstream/ 不动）；
//   5) 部署 server-plugin/virtual-companion → st-run/plugins/ 与 extension/vc-model-settings →
//      受管 dataRoot 用户扩展目录（排除 harness/）；两者同为可重放派生物，整体重建；
//   6) 写受管 config.yaml（enableServerPlugins:true，0600）、derived-manifest.json（派生产物记录，
//      upstream.lock.json 不改）与 assemble-ok 标记。
// 幂等：st-run 与部署目录整体重建，重跑逐字节一致。PG 与 Go 进程不在本脚本生命周期内（由验收侧管理）。
// 用法：node scripts/assemble-managed.mjs
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
    INTEG, UPSTREAM_LOCK, MANAGED_DEV, MANAGED_DATA_ROOT, MANAGED_USER_DIR, MANAGED_EXT_DIR,
    MANAGED_RUN_DIR, MANAGED_CONFIG_PATH, MANAGED_MANIFEST, MANAGED_ST_PORT,
} from './lib/paths.mjs';
import { readJson, writeJson, mkdirp, ok, fail } from './lib/util.mjs';
import { renderConfig } from './lib/config.mjs';
import { verifyStDependencyTree } from './lib/verify.mjs';
import {
    assertManagedDevIsolated, verifyStUpstreamClean, buildRunCopy,
    deployManagedAssets, verifyCorePatches, verifyManagedDeployment,
} from './lib/managed.mjs';

function die(msg) { fail(msg, 4); }

// ---------- main ----------
function main() {
    process.umask(0o077);
    assertManagedDevIsolated();
    const lock = readJson(UPSTREAM_LOCK);
    const commit = verifyStUpstreamClean({ lock });
    ok(`upstream sillytavern @ ${commit.slice(0, 10)}（干净）`);

    const deps = verifyStDependencyTree();
    if (!deps.ok) die(`ST 依赖树与 package-lock 不一致（缺 ${deps.missing.length}，版本不符 ${deps.mismatched.length}）；受管不重建依赖树，先运行 node scripts/bootstrap.mjs`);
    ok(`ST 依赖树与 package-lock 一致（${deps.checked} 个生产包，st-run 经符号链接复用）`);

    mkdirp(MANAGED_DEV, 0o700);
    mkdirp(MANAGED_DATA_ROOT, 0o700);
    mkdirp(MANAGED_USER_DIR, 0o700);
    mkdirp(MANAGED_RUN_DIR, 0o700);

    // 复用原生 bootstrap 装配锁定 Helper/EJS/MVU；仅复用静态 vendor 缓存，不复制聊天或凭据。
    const native = spawnSync(process.execPath, [path.join(INTEG, 'scripts/bootstrap.mjs'), '--offline'], {
        env: { ...process.env, VC_ST_DEV_DIR: MANAGED_DEV, VC_ST_PORT: String(MANAGED_ST_PORT),
            VC_ST_VENDOR_CACHE: process.env.VC_ST_VENDOR_CACHE || path.join(INTEG, 'dev/vendor-cache') },
        stdio: 'inherit',
    });
    if (native.status !== 0) die('锁定复杂卡运行栈装配失败；先完成原生 bootstrap 的 vendor 缓存');
    const nativeManifest = readJson(MANAGED_MANIFEST);

    const corePatches = buildRunCopy({});
    for (const p of corePatches) ok(`核心补丁 ${p.id}：${p.replacements.length} 条替换，输出 SHA256 ${p.output_sha256.slice(0, 12)}…`);

    const deployment = deployManagedAssets({});
    ok(`server plugin 已部署：${path.relative(INTEG, deployment.plugin.target)}（${deployment.plugin.files} 个文件）`);
    ok(`用户扩展已部署：${path.relative(INTEG, deployment.extension.target)}（${deployment.extension.files} 个文件，排除 ${deployment.extension.excluded.join('/')}）`);

    // 落位后立即以 start 预检同一实现复核（原始与派生分别校验）
    const cp = verifyCorePatches({});
    if (!cp.ok) die(`核心补丁落位校验失败：\n  ${cp.problems.join('\n  ')}`);
    const dp = verifyManagedDeployment({});
    if (!dp.ok) die(`受管部署校验失败：\n  ${dp.problems.join('\n  ')}`);
    ok('核心补丁输入/输出 SHA 与插件/扩展落位复核通过');

    fs.writeFileSync(MANAGED_CONFIG_PATH, renderConfig({ dataRoot: MANAGED_DATA_ROOT, port: MANAGED_ST_PORT, enableServerPlugins: true }), { mode: 0o600 });
    fs.chmodSync(MANAGED_CONFIG_PATH, 0o600);
    writeJson(MANAGED_MANIFEST, {
        generated_at: new Date().toISOString(),
        generated_by: 'V2-W03 assemble-managed',
        managed_dev: MANAGED_DEV,
        st_run: {
            path: path.join(MANAGED_DEV, 'st-run'),
            source: { component: 'sillytavern', commit },
            skip: ['.git', 'node_modules', 'data', 'backups', 'colab'],
            node_modules: 'symlink -> upstream/SillyTavern/node_modules（bootstrap 按锁定 package-lock 重建）',
        },
        core_patches: corePatches,
        plugin: { source: 'server-plugin/virtual-companion', target: 'st-run/plugins/virtual-companion', files: deployment.plugin.files },
        extension: { source: 'extension/vc-model-settings', target: 'data/default-user/extensions/vc-model-settings', excluded: ['harness'], files: deployment.extension.files },
        mvu_bundle: nativeManifest.mvu_bundle,
        config: { path: MANAGED_CONFIG_PATH, mode: '0600', enable_server_plugins: true, port: MANAGED_ST_PORT },
        note: '原始产物 SHA256 只存于 upstream.lock.json（未改）；本文件是受管派生产物记录。',
    });
    fs.writeFileSync(path.join(MANAGED_DEV, 'assemble-ok'), new Date().toISOString(), { mode: 0o600 });
    ok(`受管 config.yaml（0600）与 derived-manifest.json 已写入 ${path.relative(INTEG, MANAGED_DEV)}/`);
    ok('assemble-managed 完成：启动用 VC_ST_GO_BASE_URL=… VC_ST_PLUGIN_SERVICE_TOKEN=… node scripts/start-managed.mjs');
}

try { main(); } catch (e) { die(e.stack || String(e)); }
