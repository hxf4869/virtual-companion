// 按源码内容戳决定是否跳过受管组装。戳只覆盖输入，不含生成时间。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function hashTree(root) {
    const hash = crypto.createHash('sha256');
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) files.push(full);
        }
    };
    walk(root);
    files.sort();
    for (const file of files) {
        hash.update(path.relative(root, file).split(path.sep).join('/'));
        hash.update('\0');
        hash.update(fs.readFileSync(file));
        hash.update('\0');
    }
    return hash.digest('hex');
}

export function assembleSourceStamp({ dirs = [], files = [], gitDirs = [] } = {}) {
    const hash = crypto.createHash('sha256');
    for (const dir of gitDirs) {
        hash.update(`git:${dir}\0`);
        hash.update(spawnGit(dir, ['rev-parse', 'HEAD']));
        hash.update('\0');
        hash.update(spawnGit(dir, ['status', '--porcelain']));
        hash.update('\0');
    }
    for (const dir of dirs) {
        hash.update(`dir:${dir}\0`);
        hash.update(fs.existsSync(dir) ? hashTree(dir) : 'missing');
        hash.update('\0');
    }
    for (const file of files) {
        hash.update(`file:${file}\0`);
        hash.update(fs.existsSync(file) ? fs.readFileSync(file) : 'missing');
        hash.update('\0');
    }
    return hash.digest('hex');
}

function spawnGit(dir, args) {
    const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    if (result.status !== 0) return `git-failed:${args.join(' ')}`;
    return result.stdout || '';
}

export function shouldSkipAssemble({ stamp, stampPath, okPath, runPath }) {
    if (!stamp || !stampPath || !okPath || !runPath) return false;
    if (!fs.existsSync(stampPath) || !fs.existsSync(okPath) || !fs.existsSync(runPath)) return false;
    let saved = '';
    try {
        saved = fs.readFileSync(stampPath, 'utf8').trim();
    } catch {
        return false;
    }
    return saved === stamp;
}
