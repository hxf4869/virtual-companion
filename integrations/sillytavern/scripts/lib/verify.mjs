// 共享完整性校验（bootstrap 落位后、start 预检、status 汇报共用同一实现，不建第二套机制）。
import fs from 'node:fs';
import path from 'node:path';
import { sha256File, readJson } from './util.mjs';
import { ST_DIR, EXT_DIR, PATCH_SPEC, VENDOR_LOCK } from './paths.mjs';

export const VENDOR_SERVE_ROOT = path.join(EXT_DIR, 'JS-Slash-Runner', 'lib', 'vendor');
export const PATCHED_DIST = path.join(EXT_DIR, 'JS-Slash-Runner', 'dist', 'index.js');

/** vendor 目录逐文件 SHA256 对照 vendor.lock.json。返回 { expected, missing[], mismatched[] }。 */
export function verifyVendorTree(root = VENDOR_SERVE_ROOT, vendorLock = readJson(VENDOR_LOCK)) {
    const all = [...vendorLock.packages.flatMap((p) => p.files), ...(vendorLock.local_sources || [])];
    const missing = []; const mismatched = [];
    for (const f of all) {
        const p = path.join(root, f.to);
        if (!fs.existsSync(p)) missing.push(f.to);
        else if (sha256File(p) !== f.sha256) mismatched.push(f.to);
    }
    return { expected: all.length, missing, mismatched, ok: missing.length === 0 && mismatched.length === 0 };
}

/** 补丁后 Helper dist 的 SHA256 必须等于补丁规格声明的输出值。 */
export function verifyPatchedDist(dist = PATCHED_DIST, spec = readJson(PATCH_SPEC)) {
    if (!fs.existsSync(dist)) return { ok: false, reason: 'dist 不存在' };
    const got = sha256File(dist);
    return { ok: got === spec.expected_output_sha256, got, want: spec.expected_output_sha256 };
}

/**
 * ST 生产依赖树是否与锁定 package-lock.json 一致：对 lock.packages 中每个非 dev 的 node_modules/* 条目，
 * 校验安装目录存在且 package.json.version 相同。返回 { checked, missing[], mismatched[] }。
 */
export function verifyStDependencyTree(stDir = ST_DIR) {
    const lock = readJson(path.join(stDir, 'package-lock.json'));
    const missing = []; const mismatched = []; let checked = 0;
    for (const [key, entry] of Object.entries(lock.packages || {})) {
        if (!key.startsWith('node_modules/') || entry.dev || entry.optional && !entry.version) continue;
        const pkgJson = path.join(stDir, key, 'package.json');
        checked += 1;
        if (!fs.existsSync(pkgJson)) { if (!entry.optional) missing.push(key); continue; }
        try {
            const v = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version;
            if (entry.version && v !== entry.version) mismatched.push(`${key}: ${v} != ${entry.version}`);
        } catch { mismatched.push(`${key}: package.json 不可读`); }
    }
    return { checked, missing, mismatched, ok: missing.length === 0 && mismatched.length === 0 };
}
