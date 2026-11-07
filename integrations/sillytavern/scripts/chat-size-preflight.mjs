// SPDX-License-Identifier: AGPL-3.0-only
// Explicit, read-only size inventory. No JSON decoding, line buffering, or data identifiers.
import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { dirname, join, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HEADER_LIMIT_BYTES = 8 * 1024 * 1024;
export const MESSAGE_LIMIT_BYTES = 1024 * 1024;
const BUCKET_MAX_BYTES = [0, 1024, 64 * 1024, MESSAGE_LIMIT_BYTES, HEADER_LIMIT_BYTES];
const READ_BUFFER_BYTES = 64 * 1024;

function sizes() {
    return { count: 0, minBytes: null, maxBytes: null, histogramCounts: [0, 0, 0, 0, 0, 0] };
}

function addSize(stats, bytes) {
    stats.count++;
    stats.minBytes = stats.minBytes === null ? bytes : Math.min(stats.minBytes, bytes);
    stats.maxBytes = stats.maxBytes === null ? bytes : Math.max(stats.maxBytes, bytes);
    const index = BUCKET_MAX_BYTES.findIndex((max) => bytes <= max);
    stats.histogramCounts[index < 0 ? BUCKET_MAX_BYTES.length : index]++;
}

function mergeSizes(target, source) {
    if (!source.count) return;
    target.count += source.count;
    target.minBytes = target.minBytes === null ? source.minBytes : Math.min(target.minBytes, source.minBytes);
    target.maxBytes = target.maxBytes === null ? source.maxBytes : Math.max(target.maxBytes, source.maxBytes);
    source.histogramCounts.forEach((count, index) => { target.histogramCounts[index] += count; });
}

// Check all root components, including ancestors: an explicitly supplied root must not
// silently traverse a symlink. Child links are skipped separately during enumeration.
async function rootHasSymlink(path) {
    const components = [];
    let current = path;
    while (current !== parse(current).root) {
        components.push(current);
        current = dirname(current);
    }
    for (const component of components.reverse()) {
        if ((await lstat(component)).isSymbolicLink()) return true;
    }
    return false;
}

async function measureFile(path, rootIndex, fileIndex) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        if (!(await handle.stat()).isFile()) return null;
        const result = {
            type: 'file', rootIndex, fileIndex, bytes: 0,
            headers: sizes(), messages: sizes(), invalidBlankLines: 0,
            overLimitHeaders: 0, overLimitMessages: 0,
        };
        let lineBytes = 0;
        let previousByte = -1;
        let lineIndex = 0;
        const finishLine = (bytes) => {
            if (bytes === 0) result.invalidBlankLines++;
            if (lineIndex++ === 0) {
                addSize(result.headers, bytes);
                if (bytes > HEADER_LIMIT_BYTES) result.overLimitHeaders++;
            } else {
                addSize(result.messages, bytes);
                if (bytes > MESSAGE_LIMIT_BYTES) result.overLimitMessages++;
            }
        };
        const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            result.bytes += bytesRead;
            let start = 0;
            while (start < bytesRead) {
                const newline = buffer.indexOf(10, start);
                if (newline < 0 || newline >= bytesRead) {
                    lineBytes += bytesRead - start;
                    previousByte = buffer[bytesRead - 1];
                    break;
                }
                const trailingByte = newline > start ? buffer[newline - 1] : previousByte;
                lineBytes += newline - start;
                finishLine(lineBytes - (trailingByte === 13 ? 1 : 0));
                lineBytes = 0;
                previousByte = -1;
                start = newline + 1;
            }
        }
        // A final LF does not invent a new empty line. A bare final CR remains data.
        if (lineBytes) finishLine(lineBytes);
        return result;
    } finally {
        await handle.close();
    }
}

export async function scanChatSizes(roots, { onEvent = () => {} } = {}) {
    const summary = {
        type: 'summary', roots: roots.length, files: 0, completedFiles: 0, failedFiles: 0,
        bytes: 0, skippedSymlinks: 0, skippedOtherEntries: 0, errors: 0,
        headers: sizes(), messages: sizes(), invalidBlankLines: 0,
        overLimitHeaders: 0, filesWithOverLimitHeaders: 0,
        overLimitMessages: 0, filesWithOverLimitMessages: 0,
        histogramMaxBytes: [...BUCKET_MAX_BYTES, null],
    };
    const error = (code, rootIndex, fileIndex) => {
        summary.errors++;
        onEvent({ type: 'error', code, rootIndex, ...(fileIndex === undefined ? {} : { fileIndex }) });
    };
    async function walk(path, rootIndex) {
        let directory;
        try {
            directory = await opendir(path);
            for await (const entry of directory) {
                const child = join(path, entry.name);
                let stat;
                try { stat = await lstat(child); } catch {
                    error('ROOT_ENTRY_UNREADABLE', rootIndex);
                    continue;
                }
                if (stat.isSymbolicLink()) {
                    summary.skippedSymlinks++;
                } else if (stat.isDirectory()) {
                    await walk(child, rootIndex);
                } else if (stat.isFile() && entry.name.endsWith('.jsonl')) {
                    const fileIndex = ++summary.files;
                    let result;
                    try { result = await measureFile(child, rootIndex, fileIndex); } catch {
                        summary.failedFiles++;
                        error('FILE_READ_FAILED', rootIndex, fileIndex);
                        continue;
                    }
                    if (!result) {
                        summary.failedFiles++;
                        error('FILE_NOT_REGULAR', rootIndex, fileIndex);
                        continue;
                    }
                    summary.completedFiles++;
                    summary.bytes += result.bytes;
                    summary.invalidBlankLines += result.invalidBlankLines;
                    mergeSizes(summary.headers, result.headers);
                    mergeSizes(summary.messages, result.messages);
                    summary.overLimitHeaders += result.overLimitHeaders;
                    summary.filesWithOverLimitHeaders += Number(result.overLimitHeaders > 0);
                    summary.overLimitMessages += result.overLimitMessages;
                    summary.filesWithOverLimitMessages += Number(result.overLimitMessages > 0);
                    onEvent(result);
                } else {
                    summary.skippedOtherEntries++;
                }
            }
        } catch {
            error('ROOT_ENUMERATE_FAILED', rootIndex);
        }
    }
    for (const [index, root] of roots.entries()) {
        const rootIndex = index + 1;
        let path;
        try {
            if (typeof root !== 'string' || !root || root.includes('\0')) {
                error('ROOT_INVALID', rootIndex);
                continue;
            }
            path = resolve(root);
            if (await rootHasSymlink(path)) {
                summary.skippedSymlinks++;
                error('ROOT_SYMLINK', rootIndex);
                continue;
            }
            if (!(await lstat(path)).isDirectory()) {
                error('ROOT_NOT_DIRECTORY', rootIndex);
                continue;
            }
        } catch {
            error('ROOT_UNREADABLE', rootIndex);
            continue;
        }
        await walk(path, rootIndex);
    }
    onEvent(summary);
    return summary;
}

export async function main(args) {
    const roots = [];
    for (let index = 0; index < args.length; index++) {
        if (args[index] !== '--root' || !args[index + 1] || args[index + 1].startsWith('--')) {
            process.stdout.write(`${JSON.stringify({ type: 'error', code: 'ARGUMENTS_INVALID' })}\n`);
            return 1;
        }
        roots.push(args[++index]);
    }
    if (!roots.length) {
        process.stdout.write(`${JSON.stringify({ type: 'error', code: 'ROOT_REQUIRED' })}\n`);
        return 1;
    }
    const summary = await scanChatSizes(roots, {
        onEvent: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    });
    return summary.errors ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch(() => {
        process.stdout.write(`${JSON.stringify({ type: 'error', code: 'PREFLIGHT_FAILED' })}\n`);
        process.exitCode = 1;
    });
}
