// SPDX-License-Identifier: AGPL-3.0-only
// Operator-only filesystem boundary. Never resolves paths supplied by a browser.
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const fail = (code = 'CHAT_MIGRATION_UNAVAILABLE') => Object.assign(new Error(code), { code });
export const checkAbort = (signal) => { if (signal?.aborted) throw fail('CHAT_MIGRATION_ABORTED'); };
export function relativePath(value) {
    if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')
        || path.isAbsolute(value) || value.split('/').some((part) => !part || part === '.' || part === '..')) throw fail('CHAT_MIGRATION_PATH_INVALID');
    return value;
}
export async function safeRoot(value) {
    if (typeof value !== 'string' || !value || value.includes('\0')) throw fail('CHAT_MIGRATION_PATH_INVALID');
    const root = path.resolve(value);
    let current = path.parse(root).root;
    for (const part of root.slice(current.length).split('/').filter(Boolean)) {
        current = path.join(current, part);
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('CHAT_MIGRATION_PATH_INVALID');
    }
    return root;
}
export async function safePath(root, relative, { missing = false } = {}) {
    let current = root;
    const parts = relativePath(relative).split('/');
    for (const [index, part] of parts.entries()) {
        current = path.join(current, part);
        let stat;
        try { stat = await fs.lstat(current); }
        catch (error) { if (missing && error.code === 'ENOENT') continue; throw error; }
        if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) throw fail('CHAT_MIGRATION_PATH_INVALID');
    }
    return current;
}
export async function readJSON(root, relative, maxBytes = 32 << 20) {
    const file = await safePath(root, relative);
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > maxBytes) throw fail();
        const bytes = await handle.readFile();
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { await handle.close(); }
}
export async function writePrivate(root, relative, value) {
    const file = await safePath(root, relative, { missing: true });
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const handle = await fs.open(file, 'wx', 0o600);
    try { await handle.writeFile(value); await handle.sync(); }
    finally { await handle.close(); }
}

// Bounded line decoding and byte-exact copy; JSON is inspected but never re-encoded.
export async function inspectJSONL(root, relative, { destinationRoot, destination, onRow = () => {}, signal } = {}) {
    const file = await safePath(root, relative);
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let output;
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 256 << 20) throw fail();
        if (destinationRoot) {
            const target = await safePath(destinationRoot, destination, { missing: true });
            await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
            output = await fs.open(target, 'wx', 0o600);
        }
        const hash = createHash('sha256');
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let pending = Buffer.alloc(0), byteCount = 0, rows = 0;
        async function row(bytes) {
            if (bytes.at(-1) === 13) bytes = bytes.subarray(0, -1);
            if (!bytes.length || bytes.length > (rows === 0 ? 8 << 20 : 1 << 20)) throw fail('CHAT_MIGRATION_JSONL_INVALID');
            let value;
            try { value = JSON.parse(decoder.decode(bytes)); } catch { throw fail('CHAT_MIGRATION_JSONL_INVALID'); }
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('CHAT_MIGRATION_JSONL_INVALID');
            await onRow(value, rows++);
        }
        const buffer = Buffer.allocUnsafe(64 << 10);
        for (;;) {
            checkAbort(signal);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            const chunk = buffer.subarray(0, bytesRead);
            byteCount += bytesRead;
            if (byteCount > 256 << 20) throw fail();
            hash.update(chunk);
            if (output) await output.writeFile(chunk);
            const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk;
            let start = 0, end;
            while ((end = bytes.indexOf(10, start)) !== -1) { await row(bytes.subarray(start, end)); start = end + 1; }
            pending = Buffer.from(bytes.subarray(start));
            if (pending.length > (rows === 0 ? (8 << 20) + 1 : (1 << 20) + 1)) throw fail('CHAT_MIGRATION_JSONL_INVALID');
        }
        if (pending.length) await row(pending);
        if (!rows) throw fail('CHAT_MIGRATION_JSONL_INVALID');
        if ((await handle.stat()).size !== stat.size || byteCount !== stat.size) throw fail();
        if (output) await output.sync();
        return { sha256: hash.digest('hex'), byteCount: String(byteCount), messageCount: String(rows - 1) };
    } finally { await output?.close(); await handle.close(); }
}

// Only a newly reserved destination is owned. Never cleans an existing ST root or backup.
export async function isolatedDirectory(destination, work, { signal } = {}) {
    const resolved = path.resolve(destination);
    const parent = await safeRoot(path.dirname(resolved));
    const name = path.basename(resolved);
    relativePath(name);
    try { await fs.lstat(resolved); throw fail('CHAT_MIGRATION_TARGET_NOT_EMPTY'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const stage = path.join(parent, `.${name}.vc-migration-${randomUUID()}.tmp`);
    await fs.mkdir(stage, { mode: 0o700 });
    let reserved = false, published = false, complete = false;
    try {
        const result = await work(stage);
        checkAbort(signal);
        // mkdir is the no-clobber reservation. rename replaces only our own empty directory.
        await fs.mkdir(resolved, { mode: 0o700 });
        reserved = true;
        await fs.rename(stage, resolved);
        reserved = false;
        published = true;
        const directory = await fs.open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { await directory.sync(); } finally { await directory.close(); }
        checkAbort(signal);
        complete = true;
        return result;
    } finally {
        await fs.rm(stage, { recursive: true, force: true });
        if (reserved) await fs.rmdir(resolved);
        if (published && !complete) await fs.rm(resolved, { recursive: true, force: true });
    }
}
