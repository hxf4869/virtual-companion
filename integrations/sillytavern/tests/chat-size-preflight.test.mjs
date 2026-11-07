// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, open, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { HEADER_LIMIT_BYTES, MESSAGE_LIMIT_BYTES, scanChatSizes } from '../scripts/chat-size-preflight.mjs';

const script = fileURLToPath(new URL('../scripts/chat-size-preflight.mjs', import.meta.url));
async function fixture(t) {
    // macOS /var and /tmp can themselves be symlinks; explicitly use their real directory.
    const root = await mkdtemp(join(await realpath(tmpdir()), 'vc-size-synthetic-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}
async function inventory(roots) {
    const events = [];
    const summary = await scanChatSizes(roots, { onEvent: (event) => events.push(event) });
    return { events, summary, files: events.filter((event) => event.type === 'file') };
}
function cli(args, options = {}) {
    return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...options });
}

test('requires explicit roots and anonymizes invalid arguments and roots', async (t) => {
    const root = await fixture(t);
    assert.deepEqual(JSON.parse(cli([]).stdout), { type: 'error', code: 'ROOT_REQUIRED' });
    for (const args of [['--root'], ['--unknown', 'PRIVATE_ARG'], ['--root', '--root'], ['PRIVATE_ARG']]) {
        const result = cli(args);
        assert.equal(result.status, 1);
        assert.equal(result.stderr, '');
        assert.deepEqual(JSON.parse(result.stdout), { type: 'error', code: 'ARGUMENTS_INVALID' });
    }
    const file = join(root, 'PRIVATE_FILE.jsonl');
    await writeFile(file, 'PRIVATE_BODY');
    const { events } = await inventory([join(root, 'PRIVATE_MISSING'), file, '\0PRIVATE_INVALID']);
    assert.deepEqual(events.slice(0, -1), [
        { type: 'error', code: 'ROOT_UNREADABLE', rootIndex: 1 },
        { type: 'error', code: 'ROOT_NOT_DIRECTORY', rootIndex: 2 },
        { type: 'error', code: 'ROOT_INVALID', rootIndex: 3 },
    ]);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|ENOENT|path|chatID/);
});

test('counts raw UTF8, CRLF, blanks, final unterminated lines, nested and multiple roots without writes', async (t) => {
    const root = await fixture(t);
    const chats = join(root, 'PRIVATE_CHATS');
    const groups = join(root, 'PRIVATE_GROUPS');
    await mkdir(join(chats, 'PRIVATE_CHILD'), { recursive: true });
    await mkdir(groups);
    const first = join(chats, 'PRIVATE_CHILD', 'PRIVATE_NAME.jsonl');
    const second = join(groups, 'PRIVATE_GROUP.jsonl');
    const content = Buffer.from('PRIVATE_HEADER\r\n你好\r\n\nRAW\r');
    await writeFile(first, content);
    await writeFile(second, Buffer.alloc(0));
    await writeFile(join(chats, 'ignore.txt'), 'PRIVATE_IGNORED');
    const before = await stat(first);
    const result = cli(['--root', chats, '--root', groups]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /PRIVATE|你好|RAW|chatID/);
    const events = result.stdout.trim().split('\n').map(JSON.parse);
    const summary = events.at(-1);
    assert.equal(summary.roots, 2);
    assert.equal(summary.completedFiles, 2);
    assert.equal(summary.bytes, content.length);
    assert.equal(summary.headers.count, 1);
    assert.equal(summary.headers.maxBytes, 14);
    assert.deepEqual(summary.messages, {
        count: 3, minBytes: 0, maxBytes: 6, histogramCounts: [1, 2, 0, 0, 0, 0],
    });
    assert.equal(summary.invalidBlankLines, 1);
    assert.deepEqual(await readFile(first), content);
    assert.equal((await stat(first)).mtimeMs, before.mtimeMs);
});

test('thresholds are strict, CRLF spanning chunks is removed, and blank header counts as zero', async (t) => {
    const root = await fixture(t);
    await writeFile(join(root, 'exact.jsonl'), Buffer.concat([
        Buffer.alloc(HEADER_LIMIT_BYTES, 97), Buffer.from('\r\n'),
        Buffer.alloc(MESSAGE_LIMIT_BYTES, 98), Buffer.from('\r\n'),
        Buffer.alloc(MESSAGE_LIMIT_BYTES + 1, 99),
    ]));
    await writeFile(join(root, 'over.jsonl'), Buffer.concat([
        Buffer.alloc(HEADER_LIMIT_BYTES + 1, 97), Buffer.from('\n\n'),
    ]));
    await writeFile(join(root, 'split.jsonl'), Buffer.concat([
        Buffer.alloc(65535, 97), Buffer.from('\r\n\r\n'),
    ]));
    await writeFile(join(root, 'blank.jsonl'), '\n');
    const { summary, files } = await inventory([root]);
    assert.equal(summary.headers.count, 4);
    assert.equal(summary.headers.minBytes, 0);
    assert.equal(summary.headers.maxBytes, HEADER_LIMIT_BYTES + 1);
    assert.equal(summary.messages.count, 4);
    assert.equal(summary.invalidBlankLines, 3);
    assert.equal(summary.overLimitHeaders, 1);
    assert.equal(summary.filesWithOverLimitHeaders, 1);
    assert.equal(summary.overLimitMessages, 1);
    assert.equal(summary.filesWithOverLimitMessages, 1);
    assert.deepEqual(files.find((file) => file.headers.maxBytes === 65535).messages.histogramCounts, [1, 0, 0, 0, 0, 0]);
    assert.equal(summary.headers.histogramCounts.reduce((a, b) => a + b), 4);
});

test('does not follow file, directory, root or ancestor symlinks and skips non-regular entries', async (t) => {
    const root = await fixture(t);
    const scan = join(root, 'scan');
    const outside = join(root, 'PRIVATE_OUTSIDE');
    await mkdir(scan);
    await mkdir(outside);
    await writeFile(join(outside, 'PRIVATE.jsonl'), 'PRIVATE_HEADER\nPRIVATE_MESSAGE');
    await symlink(outside, join(scan, 'directory-link'));
    await symlink(join(outside, 'PRIVATE.jsonl'), join(scan, 'file-link.jsonl'));
    await symlink(join(outside, 'missing'), join(scan, 'broken-link.jsonl'));
    await writeFile(join(scan, 'ordinary.txt'), 'ignored');
    const { summary } = await inventory([scan]);
    assert.equal(summary.files, 0);
    assert.equal(summary.skippedSymlinks, 3);
    assert.equal(summary.skippedOtherEntries, 1);
    assert.equal(summary.errors, 0);
    await symlink(scan, join(root, 'root-link'));
    const rejected = await inventory([join(root, 'root-link'), join(root, 'root-link', 'child')]);
    assert.equal(rejected.summary.skippedSymlinks, 2);
    assert.deepEqual(rejected.events.slice(0, -1).map((event) => event.code), ['ROOT_SYMLINK', 'ROOT_SYMLINK']);
});

test('covers files above 256MiB and huge unterminated lines with a 16MiB JS heap', async (t) => {
    const root = await fixture(t);
    const file = join(root, 'PRIVATE_LARGE.jsonl');
    const handle = await open(file, 'w');
    const messageBytes = 270 * 1024 * 1024;
    await handle.write(Buffer.from('h\n'));
    await handle.truncate(2 + messageBytes);
    await handle.close();
    const before = await stat(file);
    const result = spawnSync(process.execPath, ['--max-old-space-size=16', script, '--root', root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(summary.bytes, 2 + messageBytes);
    assert.equal(summary.messages.maxBytes, messageBytes);
    assert.equal(summary.overLimitMessages, 1);
    assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
    assert.equal((await stat(file)).size, before.size);
});

test('permission failures expose only fixed codes and anonymous indices', async (t) => {
    const root = await fixture(t);
    const blockedRoot = join(root, 'PRIVATE_BLOCKED_ROOT');
    const readableRoot = join(root, 'PRIVATE_READABLE_ROOT');
    await mkdir(blockedRoot);
    await mkdir(readableRoot);
    const blockedFile = join(readableRoot, 'PRIVATE_BLOCKED_FILE.jsonl');
    await writeFile(blockedFile, 'PRIVATE_CONTENT');
    await chmod(root, 0o755);
    await chmod(readableRoot, 0o755);
    await chmod(blockedRoot, 0);
    await chmod(blockedFile, 0);
    const result = cli(['--root', blockedRoot, '--root', readableRoot],
        process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {});
    await chmod(blockedRoot, 0o700);
    await chmod(blockedFile, 0o600);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /PRIVATE|EACCES|permission|path|chatID/);
    const events = result.stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.slice(0, -1), [
        { type: 'error', code: 'ROOT_ENUMERATE_FAILED', rootIndex: 1 },
        { type: 'error', code: 'FILE_READ_FAILED', rootIndex: 2, fileIndex: 1 },
    ]);
    assert.equal(events.at(-1).failedFiles, 1);
    assert.equal(events.at(-1).errors, 2);
});
