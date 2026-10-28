#!/usr/bin/env node
// V2-W03-S1 stop：只停止本任务通过 start.mjs 记录的 PID（dev/run/*.pid）。
// 杀前核对进程命令行确属本 DEV 实例：ST 须含 server.js 与本 config 路径；mock 须含本仓库 mock-provider.mjs 完整路径、
// 本 DEV 目录与本端口参数（防 PID 复用时误停另一个同名 mock）。不匹配只报 PID，不打印外来进程命令行。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { INTEG, DEV, RUN_DIR, CONFIG_PATH, DATA_ROOT, ST_PORT, MOCK_PORT } from './lib/paths.mjs';
import { isPidAlive, pidCommand, ok, info } from './lib/util.mjs';

const MOCK_SCRIPT = path.join(INTEG, 'scripts', 'mock-provider.mjs');
const expectations = {
    'st.pid': (cmd) => cmd.includes('server.js') && cmd.includes(`--configPath ${CONFIG_PATH}`) && cmd.includes(`--dataRoot ${DATA_ROOT}`),
    'mock.pid': (cmd) => cmd.includes(MOCK_SCRIPT) && cmd.includes(`--dev ${DEV}`) && cmd.includes(`--port ${MOCK_PORT}`),
};

let failures = 0;
async function stopOne(file, matches) {
    const p = path.join(RUN_DIR, file);
    if (!fs.existsSync(p)) { info(`${file} 不存在，跳过`); return; }
    const pid = Number(fs.readFileSync(p, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 1) { info(`${file} 内容异常，删除`); fs.rmSync(p); return; }
    if (!isPidAlive(pid)) { info(`${file} pid=${pid} 已不存在，清理 pid 文件`); fs.rmSync(p); return; }
    const cmd = pidCommand(pid) || '';
    if (!matches(cmd)) {
        process.stderr.write(`REFUSE ${file} pid=${pid} 不是本 DEV 实例的进程（命令行不匹配），不停止；请人工核对后删除 ${p}\n`);
        failures += 1;
        return;
    }
    process.kill(pid, 'SIGTERM');
    const deadline = Date.now() + 10000;
    while (isPidAlive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    if (isPidAlive(pid)) { process.kill(pid, 'SIGKILL'); await new Promise((r) => setTimeout(r, 300)); }
    if (isPidAlive(pid)) { process.stderr.write(`FAIL  pid=${pid} 仍存活\n`); failures += 1; return; }
    fs.rmSync(p);
    ok(`已停止 ${file.replace('.pid', '')} pid=${pid}`);
}

for (const [file, matches] of Object.entries(expectations)) await stopOne(file, matches);

for (const port of [ST_PORT, MOCK_PORT]) {
    const r = spawnSync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
    const pids = [...(r.stdout || '').matchAll(/^p(\d+)$/gm)].map((m) => m[1]);
    if (pids.length) info(`端口 ${port} 仍有监听者 pid=${pids.join(',')}——不是本任务 pid 文件记录的进程，未处理`);
    else ok(`端口 ${port} 已释放`);
}
process.exit(failures ? 1 : 0);
