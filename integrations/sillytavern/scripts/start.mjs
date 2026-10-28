#!/usr/bin/env node
// V2-W03-S1 start：启动锁定 ST（仅 127.0.0.1）与本地固定 provider（可选）。
// - 预检复用 lib/verify.mjs：ST 依赖树对锁、补丁后 Helper dist SHA256、vendor 逐文件 SHA256；配置用 ST 锁定的 yaml 解析并核对安全不变量；
// - umask 077，就绪后再收紧 dataRoot 到 0700/0600（ST 复制默认文件保留 0644）；
// - PID 归属明确：dev/run/st.pid、mock.pid；mock 以 --dev/--port 参数绑定本实例；端口被占用即失败；
// - 健康等待用轮询（不 sleep）。
// 用法：node scripts/start.mjs [--no-mock]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { INTEG, ST_DIR, DEV, DATA_ROOT, RUN_DIR, CONFIG_PATH, ST_PORT, MOCK_PORT, ST_URL } from './lib/paths.mjs';
import { ok, info, fail, waitFor, tightenTree } from './lib/util.mjs';
import { loadConfig, checkInvariants } from './lib/config.mjs';
import { verifyStDependencyTree, verifyNativeRuntime } from './lib/verify.mjs';

const args = process.argv.slice(2);
const WITH_MOCK = !args.includes('--no-mock');
const MOCK_SCRIPT = path.join(INTEG, 'scripts', 'mock-provider.mjs');

function die(msg) { fail(msg, 3); }

function portOwner(port) {
    const r = spawnSync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
    const pids = [...(r.stdout || '').matchAll(/^p(\d+)$/gm)].map((m) => Number(m[1]));
    return pids.length ? pids : null;
}

async function preflight() {
    if (!fs.existsSync(path.join(DEV, 'bootstrap-ok'))) die(`bootstrap 未完成（缺 ${DEV}/bootstrap-ok）。先运行 node scripts/bootstrap.mjs`);
    const cfg = await loadConfig(CONFIG_PATH);
    if (cfg.dataRoot !== DATA_ROOT) die(`config dataRoot 异常：${cfg.dataRoot}`);
    const bad = checkInvariants(cfg);
    if (bad.length) die(`config 安全不变量被破坏：\n  ${bad.join('\n  ')}`);
    const deps = verifyStDependencyTree();
    if (!deps.ok) die(`ST 依赖树与 package-lock 不一致（缺 ${deps.missing.length}，版本不符 ${deps.mismatched.length}）；重跑 bootstrap`);
    const runtime = verifyNativeRuntime();
    if (!runtime.ok) die(`复杂卡运行栈校验失败：${runtime.problems.join(', ')}`);
    const stOwner = portOwner(ST_PORT);
    if (stOwner) die(`端口 ${ST_PORT} 已被 PID ${stOwner.join(',')} 占用（不是本脚本启动的进程不接管）`);
    const mockOwner = WITH_MOCK ? portOwner(MOCK_PORT) : null;
    if (mockOwner) die(`端口 ${MOCK_PORT} 已被 PID ${mockOwner.join(',')} 占用`);
    ok(`preflight：配置不变量、ST 依赖树（${deps.checked}）、Helper/EJS/MVU 与 vendor、端口 均通过`);
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
    await preflight();
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        SILLYTAVERN_BROWSERLAUNCH_ENABLED: 'false',
        SILLYTAVERN_EXTENSIONS_AUTOUPDATE: 'false',
        SILLYTAVERN_EXTENSIONS_MODELS_AUTODOWNLOAD: 'false',
        SILLYTAVERN_ENABLESERVERPLUGINSAUTOUPDATE: 'false',
    };
    const st = launch(process.execPath, ['server.js', '--configPath', CONFIG_PATH, '--dataRoot', DATA_ROOT, '--port', String(ST_PORT), '--listen', 'false', '--browserLaunchEnabled', 'false'], env, ST_DIR, path.join(RUN_DIR, 'st.log'));
    fs.writeFileSync(path.join(RUN_DIR, 'st.pid'), String(st.pid), { mode: 0o600 });
    info(`ST 启动 pid=${st.pid}（日志 dev/run/st.log）`);

    if (WITH_MOCK) {
        const mock = launch(process.execPath, [MOCK_SCRIPT, '--dev', DEV, '--port', String(MOCK_PORT)], { ...process.env }, INTEG, path.join(RUN_DIR, 'mock.log'));
        fs.writeFileSync(path.join(RUN_DIR, 'mock.pid'), String(mock.pid), { mode: 0o600 });
        info(`mock provider 启动 pid=${mock.pid}（日志 dev/run/mock.log，捕获仅内存）`);
    }

    try {
        await waitFor(async () => {
            try { const r = await fetch(`${ST_URL}/version`); if (!r.ok) return false; const j = await r.json(); return typeof j?.pkgVersion === 'string' ? j : false; } catch { return false; }
        }, { timeoutMs: 90000, label: 'ST /version 就绪' });
        ok(`ST 就绪 ${ST_URL}（/version 200）`);
        const t = tightenTree(DATA_ROOT);
        ok(`dataRoot 权限收紧：${t.dirs} 目录 / ${t.files} 文件，调整 ${t.changed} 项`);
        if (WITH_MOCK) {
            await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${MOCK_PORT}/__health`)).ok; } catch { return false; } }, { timeoutMs: 15000, label: 'mock /__health 就绪' });
            ok(`mock provider 就绪 http://127.0.0.1:${MOCK_PORT}`);
        }
        ok('status：node scripts/status.mjs；停止：node scripts/stop.mjs');
    } catch (e) {
        die(`健康等待失败：${e.message}（查看 dev/run/st.log；清理用 node scripts/stop.mjs）`);
    }
}

main().catch((e) => die(e.stack || String(e)));
