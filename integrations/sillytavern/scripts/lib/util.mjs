import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256File(file) {
    return sha256(fs.readFileSync(file));
}

export function sha512Base64(buf) {
    return crypto.createHash('sha512').update(buf).digest('base64');
}

export function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, obj, mode = 0o600) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', { mode });
    fs.chmodSync(file, mode);
}

export function mkdirp(dir, mode = 0o700) {
    fs.mkdirSync(dir, { recursive: true, mode });
    fs.chmodSync(dir, mode);
}

export function fail(msg, code = 1) {
    process.stderr.write(`FAIL  ${msg}\n`);
    process.exit(code);
}

export function info(msg) {
    process.stdout.write(`      ${msg}\n`);
}

export function ok(msg) {
    process.stdout.write(`OK    ${msg}\n`);
}

/** 同步执行外部命令；失败抛错（stderr 附带）。 */
export function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
    if (r.error) throw r.error;
    if (r.status !== 0) {
        throw new Error(`${cmd} ${args.join(' ')} 退出码 ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 800)}`);
    }
    return r.stdout;
}

/** 递归复制目录（跳过 .git），保持文件内容；目标文件按 fileMode/dirMode 收紧权限。 */
export function copyTree(src, dst, { fileMode = 0o600, dirMode = 0o700, skip = ['.git'] } = {}) {
    mkdirp(dst, dirMode);
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        if (skip.includes(ent.name)) continue;
        const s = path.join(src, ent.name);
        const d = path.join(dst, ent.name);
        if (ent.isDirectory()) copyTree(s, d, { fileMode, dirMode, skip });
        else if (ent.isFile()) {
            fs.copyFileSync(s, d);
            fs.chmodSync(d, fileMode);
        }
    }
}

export function isPidAlive(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

/** 读取进程命令行（macOS/Linux 通用 ps）；进程不存在返回 null。 */
export function pidCommand(pid) {
    const r = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    const line = (r.stdout || '').trim();
    return r.status === 0 && line ? line : null;
}

export async function waitFor(fn, { timeoutMs, intervalMs = 250, label }) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = await fn();
        if (last) return last;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`等待超时：${label}（${timeoutMs}ms）`);
}

/**
 * 收紧目录树权限：目录 0700、文件 0600。返回 { dirs, files, changed }。
 * ST 从 default/content 复制默认文件时保留源模式（0644），进程 umask 不生效，因此启动后需补一次。
 */
export function tightenTree(root) {
    const stat = { dirs: 0, files: 0, changed: 0 };
    const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name);
            if (ent.isSymbolicLink()) continue;
            const want = ent.isDirectory() ? 0o700 : 0o600;
            const cur = fs.statSync(p).mode & 0o777;
            if (cur !== want) { fs.chmodSync(p, want); stat.changed += 1; }
            if (ent.isDirectory()) { stat.dirs += 1; walk(p); } else stat.files += 1;
        }
    };
    const rootMode = fs.statSync(root).mode & 0o777;
    if (rootMode !== 0o700) { fs.chmodSync(root, 0o700); stat.changed += 1; }
    walk(root);
    return stat;
}

/** 统计目录树中不是 0700/0600 的条目（只读，供保护报告）。 */
export function looseEntries(root, limit = 20) {
    const loose = [];
    let total = 0;
    const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name);
            if (ent.isSymbolicLink()) continue;
            total += 1;
            const want = ent.isDirectory() ? 0o700 : 0o600;
            const cur = fs.statSync(p).mode & 0o777;
            if (cur !== want && loose.length < limit) loose.push({ path: path.relative(root, p), mode: cur.toString(8).padStart(4, '0') });
            if (ent.isDirectory()) walk(p);
        }
    };
    walk(root);
    return { total, loose };
}
