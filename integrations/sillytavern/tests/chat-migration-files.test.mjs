// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRoot, safePath, relativePath, isolatedDirectory, inspectJSONL } from '../scripts/lib/chat-migration-files.mjs';

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vc-sx8-synthetic-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}
test('operator paths reject traversal, symlinks and special files', async (t) => {
    const root = await fixture(t);
    for (const value of ['', '../outside', '/absolute', 'a/../b', './a', 'a//b', 'a\\b', 'a\0b']) assert.throws(() => relativePath(value));
    await fs.mkdir(path.join(root, 'real'));
    await fs.symlink(path.join(root, 'real'), path.join(root, 'link'));
    await assert.rejects(safeRoot(path.join(root, 'link')));
    await assert.rejects(safePath(root, 'link/file', { missing: true }));
    await fs.symlink('missing', path.join(root, 'dangling'));
    await assert.rejects(safePath(root, 'dangling'));
    await assert.rejects(inspectJSONL(root, 'real'));
});
test('byte-exact bounded JSONL inspection preserves unknown fields and huge numeric literals', async (t) => {
    const root = await fixture(t);
    const raw = Buffer.from('{"unknown":900719925474099312345}\r\n{"mes":"synthetic","variables":[null,{"x":true}]}');
    await fs.writeFile(path.join(root, 'source.jsonl'), raw);
    const rows = [];
    const output = path.join(root, 'artifact');
    await isolatedDirectory(output, async (stage) => {
        const measured = await inspectJSONL(root, 'source.jsonl', { destinationRoot: stage, destination: 'files/1.jsonl', onRow: (row) => rows.push(row) });
        assert.deepEqual(measured, { sha256: createHash('sha256').update(raw).digest('hex'), byteCount: String(raw.length), messageCount: '1' });
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(await fs.readFile(path.join(output, 'files/1.jsonl')), raw);
    assert.equal((await fs.stat(output)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(output, 'files/1.jsonl'))).mode & 0o777, 0o600);
    await assert.rejects(isolatedDirectory(output, () => {}), { code: 'CHAT_MIGRATION_TARGET_NOT_EMPTY' });
});
test('failed validation and abort clean owned stage without publishing partial output', async (t) => {
    const root = await fixture(t);
    for (const [index, raw] of ['{}\n\n{}', '{}\n{"mes":', Buffer.from([123, 125, 10, 123, 34, 120, 34, 58, 34, 255, 34, 125])].entries()) {
        await fs.writeFile(path.join(root, 'source.jsonl'), raw);
        await assert.rejects(isolatedDirectory(path.join(root, `bad-${index}`), (stage) => inspectJSONL(root, 'source.jsonl', { destinationRoot: stage, destination: 'chat.jsonl' })));
    }
    const controller = new AbortController();
    await assert.rejects(isolatedDirectory(path.join(root, 'abort'), async () => { controller.abort(); }, { signal: controller.signal }), { code: 'CHAT_MIGRATION_ABORTED' });
    assert.deepEqual((await fs.readdir(root)).sort(), ['source.jsonl']);
});
