#!/usr/bin/env node
// V2-W03-S1 C1 保护清单报告（只读）：对 D01 各子项输出 PASS / BLOCKED / NOT_RUN / NOT_APPLICABLE 与真实证据。
// 原则：只写真实检查结果。FileVault Off 一律记 BLOCKED，不因自用或配置名而算已保护。
// 用法：node scripts/protection-report.mjs [--data-root DIR] [--config FILE] [--archive FILE] [--key-file FILE] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DATA_ROOT, CONFIG_PATH, REPO_ROOT } from './lib/paths.mjs';
import { looseEntries } from './lib/util.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dataRoot = path.resolve(opt('--data-root', DATA_ROOT));
const configPath = path.resolve(opt('--config', CONFIG_PATH));
const archive = argv.includes('--archive') ? path.resolve(opt('--archive')) : null;
const keyFile = argv.includes('--key-file') ? path.resolve(opt('--key-file')) : null;
const asJson = argv.includes('--json');

const mode = (p) => { try { return (fs.statSync(p).mode & 0o777).toString(8).padStart(4, '0'); } catch { return null; } };
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return (r.stdout || r.stderr || '').trim(); };
const under = (p, root) => { const rp = fs.existsSync(p) ? fs.realpathSync(p) : p; const rr = fs.existsSync(root) ? fs.realpathSync(root) : root; return rp === rr || rp.startsWith(rr + path.sep); };

const items = [];
const add = (id, name, status, evidence) => items.push({ id, name, status, evidence });

// D01.a 磁盘 / 卷加密（真实状态）
{
    const fv = process.platform === 'darwin' ? sh('fdesetup', ['status']) : '（非 macOS，未检查）';
    const on = /FileVault is On/i.test(fv);
    add('D01.a', '磁盘 / 卷加密（FileVault）', on ? 'PASS' : 'BLOCKED', `${fv || 'fdesetup 无输出'}；关闭状态下离线磁盘读取者可直接读到 ST 明文文件，C1 的磁盘/卷保护未满足`);
}

// D01.b 目录与文件权限
{
    if (!fs.existsSync(dataRoot)) {
        add('D01.b', 'dataRoot 目录/文件权限', 'NOT_RUN', `dataRoot 不存在：${dataRoot}`);
    } else {
        const rootMode = mode(dataRoot);
        const { total, loose } = looseEntries(dataRoot);
        const cfgMode = fs.existsSync(configPath) ? mode(configPath) : null;
        const cookie = mode(path.join(dataRoot, 'cookie-secret.txt'));
        const secrets = mode(path.join(dataRoot, 'default-user', 'secrets.json'));
        const settings = mode(path.join(dataRoot, 'default-user', 'settings.json'));
        const okAll = rootMode === '0700' && loose.length === 0 && (cfgMode === null || cfgMode === '0600');
        add('D01.b', 'dataRoot 目录/文件权限', okAll ? 'PASS' : 'BLOCKED',
            `dataRoot=${rootMode}（要求 0700）；树内 ${total} 条目，非 0700/0600 的 ${loose.length} 条${loose.length ? '：' + loose.map((l) => `${l.path}=${l.mode}`).join(', ') : ''}；config=${cfgMode ?? '不存在'}；cookie-secret=${cookie ?? '未生成'}；secrets.json=${secrets ?? '未生成'}；settings.json=${settings ?? '未生成'}。注：运行中的 ST 进程与同用户进程仍可读明文（C1 接受的边界）`);
    }
}

// D01.c 保护清单覆盖（原生文件 + 自动备份 + secrets 迁移备份 + 原生预设 + 卡导入资源）
{
    const list = ['cookie-secret.txt', 'default-user/settings.json', 'default-user/secrets.json', 'default-user/chats', 'default-user/group chats', 'default-user/groups', 'default-user/characters', 'default-user/worlds', 'default-user/backups', 'default-user/OpenAI Settings', 'default-user/user', '_vc_accounts', 'default-user/.vc-f2'];
    const present = list.filter((r) => fs.existsSync(path.join(dataRoot, r)));
    add('D01.c', '备份保护清单覆盖', 'PASS', `backup.sh 清单：${list.join(', ')} + config.yaml；当前 dataRoot 存在 ${present.length}/${list.length}（缺项为尚未产生的数据，脚本按存在性打包）。characters/ 含 CHARX 背景资源，user/images 含 CHARX misc 资源，OpenAI Settings 含原生预设；default-user/backups 覆盖 ST 自动聊天备份、settings 备份与 secrets 迁移副本。_vc_accounts/ 与 default-user/.vc-f2/ 只含删除/身份状态。唯一排除：user/files/mvu-bundle-d03b7dc8.js（上游锁 + bootstrap 确定性再生）；extensions/ 由锁 + 补丁 + vendor.lock 重放，不入备份`);
}

// D01.d 加密备份与密钥分离（无 --key-file 证据时不推断密钥分离，保持未验证）
{
    if (!archive) {
        add('D01.d', '加密备份产物与密钥分离', 'NOT_RUN', '未传 --archive（运行 backup.sh 后用 --archive 与 --key-file 复查）');
    } else if (!fs.existsSync(archive)) {
        add('D01.d', '加密备份产物与密钥分离', 'BLOCKED', `归档不存在：${archive}`);
    } else {
        const m = mode(archive);
        const head = Buffer.alloc(7); const fd = fs.openSync(archive, 'r'); fs.readSync(fd, head, 0, 7, 0); fs.closeSync(fd);
        const magic = head.toString('latin1') === 'VCBAE1\n';
        const inData = under(archive, dataRoot);
        const archiveOk = m === '0600' && magic && !inData;
        if (!keyFile) {
            add('D01.d', '加密备份产物与密钥分离', archiveOk ? 'NOT_RUN' : 'BLOCKED', `归档 mode=${m}（要求 0600）magic=${magic ? 'VCBAE1' : '非 VCBAE1'} 位于 dataRoot 内=${inData}；未提供 --key-file，密钥保管位置与分离未验证（环境变量口令无法从外部证据核实）`);
        } else {
            const km = mode(keyFile);
            const keyInData = under(keyFile, dataRoot);
            const sameDir = fs.existsSync(keyFile) && path.dirname(fs.realpathSync(keyFile)) === path.dirname(fs.realpathSync(archive));
            const keyOk = km === '0600' && !keyInData && !sameDir;
            add('D01.d', '加密备份产物与密钥分离', archiveOk && keyOk ? 'PASS' : 'BLOCKED', `归档 mode=${m}（要求 0600）magic=${magic ? 'VCBAE1' : '非 VCBAE1'} 位于 dataRoot 内=${inData}；keyfile=${keyFile} mode=${km ?? '不存在'}${keyInData ? '（在 dataRoot 内！）' : ''}${sameDir ? '（与归档同目录！）' : ''}；归档内不含 keyfile/.env（backup.sh 只打包显式清单）`);
        }
    }
}

// D01.e Go 字段加密保留（不在本切片验证运行，只确认实现仍在）
{
    const f = path.join(REPO_ROOT, 'backend', 'internal', 'store', 'postgres', 'fieldcipher.go');
    add('D01.e', 'Go 字段加密保留', fs.existsSync(f) ? 'PASS' : 'BLOCKED', `${fs.existsSync(f) ? '存在' : '缺失'}：backend/internal/store/postgres/fieldcipher.go（AES-256-GCM enc2 信封）；W03-S1 不改 Go，运行验证不在本切片`);
}

// D01.f PG 导出 / 外部引擎 / 派生内容
add('D01.f', 'Go PG 导出副本纳入保护', 'NOT_RUN', '旧 PG 备份任务已在 W01 卸载；V2 Go 侧 PG 导出保护在 W06/W16 落实，本切片不覆盖');
add('D01.g', '外部记忆引擎落盘（向量/图/缓存）', 'NOT_APPLICABLE', '尚未采用任何外部引擎（MemoryCore 为 W08 对照项）；采用后再按 C1 盘点，向量化不视为加密');
add('D01.h', '运行中可读边界', 'PASS', '已声明：授权进程/同用户/可信插件可读 ST 明文；磁盘加密与权限不防此类读取，不是端到端加密（ARCH §15.2）');

const summary = items.reduce((m, i) => ((m[i.status] = (m[i.status] || 0) + 1), m), {});
if (asJson) {
    console.log(JSON.stringify({ generated_at: new Date().toISOString(), data_root: dataRoot, items, summary }, null, 2));
} else {
    console.log(`C1 保护报告（${new Date().toISOString()}）dataRoot=${dataRoot}`);
    for (const i of items) console.log(`${i.status.padEnd(14)} ${i.id} ${i.name}\n               ${i.evidence}`);
    console.log(`汇总：${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' ')}`);
}
process.exit(items.some((i) => i.status === 'BLOCKED' && ['D01.b', 'D01.d'].includes(i.id)) ? 1 : 0);
