#!/usr/bin/env node
// V2-W03 受管停止：只停止 start-managed.mjs 记录在受管 run 目录（dev-managed/run/st.pid）的 PID。
// 杀前核对进程命令行确属本受管实例：须含 server.js、受管 config 路径与受管 dataRoot 路径
// （防 PID 复用时误停 8742/8743 上的原生实例）。不匹配只报 PID，不打印外来进程命令行。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MANAGED_DEV, MANAGED_RUN_DIR, MANAGED_CONFIG_PATH, MANAGED_DATA_ROOT, MANAGED_ST_PORT } from './lib/paths.mjs';
import { isPidAlive, pidCommand, ok, info } from './lib/util.mjs';

import { stopMemorycore } from './lib/memorycore-managed.mjs';

let memorycoreFailed = false;
try { await stopMemorycore(); ok('MemoryCore stopped (owned PID only)'); }
catch (error) { process.stderr.write(`REFUSE ${error.message}\n`); memorycoreFailed = true; }
if (process.argv.includes('--memorycore-only')) process.exit(memorycoreFailed ? 1 : 0);

const PID_FILE = 'st.pid';
const matchesManaged = (cmd) => cmd.includes('server.js') && cmd.includes(`--configPath ${MANAGED_CONFIG_PATH}`) && cmd.includes(`--dataRoot ${MANAGED_DATA_ROOT}`);

let failures = memorycoreFailed ? 1 : 0;
const p = path.join(MANAGED_RUN_DIR, PID_FILE);
if (!fs.existsSync(p)) {
    info(`${PID_FILE} 不存在（受管实例未运行或已停止）`);
} else {
    const pid = Number(fs.readFileSync(p, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 1) { info(`${PID_FILE} 内容异常，删除`); fs.rmSync(p); }
    else if (!isPidAlive(pid)) { info(`${PID_FILE} pid=${pid} 已不存在，清理 pid 文件`); fs.rmSync(p); }
    else {
        const cmd = pidCommand(pid) || '';
        if (!matchesManaged(cmd)) {
            process.stderr.write(`REFUSE ${PID_FILE} pid=${pid} 不是本受管实例的进程（命令行不匹配），不停止；请人工核对后删除 ${p}\n`);
            failures += 1;
        } else {
            process.kill(pid, 'SIGTERM');
            const deadline = Date.now() + 10000;
            while (isPidAlive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
            if (isPidAlive(pid)) { process.kill(pid, 'SIGKILL'); await new Promise((r) => setTimeout(r, 300)); }
            if (isPidAlive(pid)) { process.stderr.write(`FAIL  pid=${pid} 仍存活\n`); failures += 1; }
            else { fs.rmSync(p); ok(`已停止受管 ST pid=${pid}`); }
        }
    }
}

const r = spawnSync('lsof', ['-nP', '-iTCP:' + MANAGED_ST_PORT, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
const pids = [...(r.stdout || '').matchAll(/^p(\d+)$/gm)].map((m) => m[1]);
if (pids.length) info(`端口 ${MANAGED_ST_PORT} 仍有监听者 pid=${pids.join(',')}——不是受管 pid 文件记录的进程，未处理`);
else ok(`端口 ${MANAGED_ST_PORT} 已释放`);
process.exit(failures ? 1 : 0);
