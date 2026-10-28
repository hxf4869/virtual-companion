#!/usr/bin/env node
// V2-W03 受管启动：在受管运行副本（st-run）上启动 ST（仅 127.0.0.1，默认 8752，VC_ST_PORT 可覆盖）。
// - 预检：assemble-ok、Go 桥接环境硬校验（VC_ST_GO_BASE_URL / VC_ST_PLUGIN_SERVICE_TOKEN >=32 字节，
//   缺失或为空即硬失败退出，绝不静默降级回 ST 本地密钥）、upstream 工作树干净、两个核心补丁
//   输入/输出 SHA、ST 依赖树（经符号链接复用 upstream node_modules）、插件/扩展部署完整性、
//   受管 config 安全不变量（enableServerPlugins:true 为受管唯一差异）、端口归属；
// - 启动：cwd=st-run 运行 node server.js；VC_ST_GO_BASE_URL / VC_ST_PLUGIN_SERVICE_TOKEN /
//   VC_ST_GO_TIMEOUT_MS 透传给 ST 进程环境；PID/日志落在受管 run 目录；
// - 健康等待 /version 后收紧受管 dataRoot 权限（0700/0600）。
// 用法：VC_ST_GO_BASE_URL=http://127.0.0.1:8095 VC_ST_PLUGIN_SERVICE_TOKEN=<>=32字节 node scripts/start-managed.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
    ST_DIR, MANAGED_DEV, MANAGED_DATA_ROOT, MANAGED_RUN_DIR, MANAGED_CONFIG_PATH,
    MANAGED_ST_RUN, MANAGED_ST_PORT, MANAGED_ST_URL,
} from './lib/paths.mjs';
import { ok, info, fail, waitFor, tightenTree } from './lib/util.mjs';
import { loadConfig, checkInvariants, MANAGED_CONFIG_INVARIANTS } from './lib/config.mjs';
import { verifyStDependencyTree } from './lib/verify.mjs';
import { verifyStUpstreamClean, verifyCorePatches, verifyManagedDeployment, requireManagedGoEnv } from './lib/managed.mjs';

function die(msg) { fail(msg, 5); }

function portOwner(port) {
    const r = spawnSync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
    return [...(r.stdout || '').matchAll(/^p(\d+)$/gm)].map((m) => Number(m[1]));
}

async function preflight(goEnv) {
    if (!fs.existsSync(path.join(MANAGED_DEV, 'assemble-ok'))) die(`受管装配未完成（缺 ${path.join(MANAGED_DEV, 'assemble-ok')}）。先运行 node scripts/assemble-managed.mjs`);
    if (!goEnv.ok) die(`Go 桥接环境缺失，受管模式不静默降级回原生 Key：\n  ${goEnv.problems.join('\n  ')}`);
    ok(`Go 桥接环境就绪：VC_ST_GO_BASE_URL=${goEnv.baseUrl}，VC_ST_PLUGIN_SERVICE_TOKEN 已配置（>=32 字节）`);
    verifyStUpstreamClean();
    ok('upstream sillytavern 工作树干净（HEAD 对锁）');
    const cp = verifyCorePatches({});
    if (!cp.ok) die(`核心补丁校验失败：\n  ${cp.problems.join('\n  ')}`);
    ok(`核心补丁输入/输出 SHA 校验通过（${cp.patches.length} 个规格）`);
    const nmReal = fs.realpathSync(path.join(MANAGED_ST_RUN, 'node_modules'));
    if (nmReal !== fs.realpathSync(path.join(ST_DIR, 'node_modules'))) {
        die(`st-run/node_modules 符号链接异常：实际指向 ${nmReal}`);
    }
    const deps = verifyStDependencyTree();
    if (!deps.ok) die(`ST 依赖树与 package-lock 不一致（缺 ${deps.missing.length}，版本不符 ${deps.mismatched.length}）；重跑 assemble-managed 前先运行 bootstrap`);
    const dp = verifyManagedDeployment({});
    if (!dp.ok) die(`受管部署校验失败：\n  ${dp.problems.join('\n  ')}`);
    const cfg = await loadConfig(MANAGED_CONFIG_PATH);
    if (cfg.dataRoot !== MANAGED_DATA_ROOT) die(`config dataRoot 异常：${cfg.dataRoot}`);
    const bad = checkInvariants(cfg, MANAGED_CONFIG_INVARIANTS);
    if (bad.length) die(`受管 config 安全不变量被破坏：\n  ${bad.join('\n  ')}`);
    const owner = portOwner(MANAGED_ST_PORT);
    if (owner.length) die(`端口 ${MANAGED_ST_PORT} 已被 PID ${owner.join(',')} 占用（不是本脚本启动的进程不接管）`);
    ok(`preflight：Go 环境、upstream 干净、核心补丁 SHA、依赖树（${deps.checked}）、部署完整性、受管配置不变量、端口 均通过`);
}

function launch(cmd, argv, env, cwd, logFile) {
    const log = fs.openSync(logFile, 'a');
    const child = spawn(cmd, argv, { cwd, env, detached: true, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    child.unref();
    return child;
}

async function main() {
    process.umask(0o077);
    const goEnv = requireManagedGoEnv();
    await preflight(goEnv);
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        SILLYTAVERN_BROWSERLAUNCH_ENABLED: 'false',
        SILLYTAVERN_EXTENSIONS_AUTOUPDATE: 'false',
        SILLYTAVERN_EXTENSIONS_MODELS_AUTODOWNLOAD: 'false',
        SILLYTAVERN_ENABLESERVERPLUGINSAUTOUPDATE: 'false',
        // 受管桥接环境（预检已硬校验；显式列出以表明透传意图，不落盘）
        VC_ST_GO_BASE_URL: goEnv.baseUrl,
        VC_ST_PLUGIN_SERVICE_TOKEN: process.env.VC_ST_PLUGIN_SERVICE_TOKEN,
        ...(process.env.VC_ST_GO_TIMEOUT_MS ? { VC_ST_GO_TIMEOUT_MS: process.env.VC_ST_GO_TIMEOUT_MS } : {}),
    };
    const st = launch(process.execPath, ['server.js', '--configPath', MANAGED_CONFIG_PATH, '--dataRoot', MANAGED_DATA_ROOT, '--port', String(MANAGED_ST_PORT), '--listen', 'false', '--browserLaunchEnabled', 'false'], env, MANAGED_ST_RUN, path.join(MANAGED_RUN_DIR, 'st.log'));
    fs.writeFileSync(path.join(MANAGED_RUN_DIR, 'st.pid'), String(st.pid), { mode: 0o600 });
    info(`受管 ST 启动 pid=${st.pid}（cwd=st-run，日志 ${path.relative(MANAGED_DEV, path.join(MANAGED_RUN_DIR, 'st.log'))}）`);
    try {
        await waitFor(async () => {
            try { const r = await fetch(`${MANAGED_ST_URL}/version`); if (!r.ok) return false; const j = await r.json(); return typeof j?.pkgVersion === 'string' ? j : false; } catch { return false; }
        }, { timeoutMs: 90000, label: '受管 ST /version 就绪' });
        ok(`受管 ST 就绪 ${MANAGED_ST_URL}（/version 200）`);
        const t = tightenTree(MANAGED_DATA_ROOT);
        ok(`受管 dataRoot 权限收紧：${t.dirs} 目录 / ${t.files} 文件，调整 ${t.changed} 项`);
        ok('status：node scripts/status-managed.mjs；停止：node scripts/stop-managed.mjs');
    } catch (e) {
        die(`健康等待失败：${e.message}（查看 dev-managed/run/st.log；清理用 node scripts/stop-managed.mjs）`);
    }
}

main().catch((e) => die(e.stack || String(e)));
