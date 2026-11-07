import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRoundArtifacts } from '../../../scripts/lib/chat-memory-artifacts.mjs';
import { createSyntheticAnswerStore } from '../../../scripts/lib/chat-memory-answers.mjs';
import { generateChatMemoryDataset } from '../../../scripts/lib/chat-memory-dataset.mjs';

const dataset = generateChatMemoryDataset();
const identity = { round: 'round-answers', attempt: 1, dataset };
const response = { caseId: 'single-01', stage: null, control: null, answer: 'x' };
const filename = 'synthetic-answers.json';
const compactDataset = { version: dataset.version, seed: dataset.seed, hashes: { dataset: dataset.hashes.dataset } };

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-cm-answers-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const artifacts = await createRoundArtifacts(root, identity);
    await artifacts.write('manifest.json', { round: identity.round, attempt: 1, dataset: compactDataset });
    return { root, artifacts, file: path.join(artifacts.dir, filename), store: createSyntheticAnswerStore(artifacts, identity) };
}

test('synthetic checkpoints are private, typed, bounded and omit other dataset fields', async t => {
    const { root, artifacts, file, store } = await fixture(t);
    await store.save(response);
    const result = await store.read();
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.responses.length, 1);
    assert.deepEqual(Object.keys(result).sort(), ['attempt', 'dataset', 'responses', 'round', 'schemaVersion']);
    assert.deepEqual(result.dataset, compactDataset);
    for (const dir of [root, artifacts.dir]) assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await assert.rejects(artifacts.write(filename, {}), /ARTIFACT_NAME_INVALID/);
    await assert.rejects(store.save({ ...response, prompt: 'x' }), /SYNTHETIC_ANSWER_INVALID/);
    await assert.rejects(store.save({ ...response, caseId: 'business-record-01' }), /SYNTHETIC_ANSWER_INVALID/);
    await assert.rejects(store.save({ ...response, stage: 'custom' }), /SYNTHETIC_ANSWER_INVALID/);
    await assert.rejects(store.save({ ...response, control: 'custom' }), /SYNTHETIC_ANSWER_INVALID/);
});

test('missing answers never become a fabricated read and saved answers survive resume', async t => {
    const { root, artifacts, store } = await fixture(t);
    await assert.rejects(store.read(), /SYNTHETIC_ANSWERS_MISSING/);
    await store.save(response);
    await artifacts.close();
    const resumed = await createRoundArtifacts(root, { round: identity.round, resume: true });
    const restored = createSyntheticAnswerStore(resumed, identity);
    assert.equal((await restored.read()).responses.length, 1);
    await assert.rejects(restored.save(response), /SYNTHETIC_ANSWER_DUPLICATE/);
    await fs.rm(path.join(artifacts.dir, filename));
    await assert.rejects(restored.read(), /SYNTHETIC_ANSWERS_MISSING/);
});

test('manifest and cache identity must match round, attempt and dataset', async t => {
    const { artifacts, file, store } = await fixture(t);
    await store.save(response);
    for (const changed of [{ round: 'round-other' }, { attempt: 2 },
        { dataset: { ...dataset, seed: dataset.seed + 1 } },
        { dataset: { ...dataset, hashes: { dataset: '0'.repeat(64) } } }]) {
        const other = createSyntheticAnswerStore(artifacts, { ...identity, ...changed });
        await assert.rejects(other.read(), /SYNTHETIC_ANSWERS_IDENTITY/);
        await assert.rejects(other.save({ ...response, caseId: 'single-02' }), /SYNTHETIC_ANSWERS_IDENTITY/);
    }
    await artifacts.write('manifest.json', { round: identity.round, attempt: 2, dataset: compactDataset });
    await assert.rejects(store.read(), /SYNTHETIC_ANSWERS_IDENTITY/);
    await artifacts.write('manifest.json', { round: identity.round, attempt: 1, dataset: compactDataset });
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    saved.attempt = 2;
    await fs.writeFile(file, JSON.stringify(saved), { mode: 0o600 });
    await assert.rejects(store.read(), /SYNTHETIC_ANSWERS_IDENTITY/);
});

test('cache rejects extra fields, invalid IDs and repeated case-stage-control keys on read', async t => {
    const { file, store } = await fixture(t);
    await store.save(response);
    const valid = JSON.parse(await fs.readFile(file, 'utf8'));
    for (const mutate of [value => { value.prompt = 'x'; }, value => { value.dataset.endpoint = 'x'; },
        value => { value.responses[0].secret = 'x'; }, value => { value.responses[0].caseId = 'single-21'; },
        value => { value.responses.push(value.responses[0]); }]) {
        const value = structuredClone(valid); mutate(value);
        await fs.writeFile(file, JSON.stringify(value));
        await assert.rejects(store.read(), /SYNTHETIC_ANSWER/);
    }
});

test('stage and diagnostic control keys stay distinct and concurrent saves cannot lose checkpoints', async t => {
    const { store } = await fixture(t);
    const rows = [response, ...['before', 'begin', 'done', 'restart', 'late'].map(stage => ({ ...response, caseId: 'forget-01', stage })),
        ...['memory-off', 'gold-evidence'].map(control => ({ ...response, control }))];
    await Promise.all(rows.map(row => store.save(row)));
    assert.equal((await store.read()).responses.length, rows.length);
    await assert.rejects(store.save(rows[3]), /SYNTHETIC_ANSWER_DUPLICATE/);
});

test('one answer is limited to 4 MiB in UTF-8 and the document to 300 responses', async t => {
    const { file, store } = await fixture(t);
    await assert.rejects(store.save({ ...response, answer: '界'.repeat(Math.ceil(4 * 1024 * 1024 / 3)) }), /SYNTHETIC_ANSWER_INVALID/);
    await store.save({ ...response, answer: 'x'.repeat(4 * 1024 * 1024) });
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    saved.responses = [];
    for (const category of ['single', 'cross_session', 'time', 'update', 'forget', 'isolation', 'abstain']) {
        for (let i = 1; i <= 20; i++) for (const control of [null, 'memory-off', 'gold-evidence']) {
            if (saved.responses.length < 300) saved.responses.push({ ...response, caseId: `${category}-${String(i).padStart(2, '0')}`, control });
        }
    }
    await fs.writeFile(file, JSON.stringify(saved));
    assert.equal((await store.read()).responses.length, 300);
    await assert.rejects(store.save({ ...response, caseId: 'abstain-20' }), /SYNTHETIC_ANSWERS_LIMIT/);
});

test('answer caches share the existing 10 MiB round cap in both write directions', async t => {
    const { artifacts, file, store } = await fixture(t);
    await store.save({ ...response, answer: 'x'.repeat(4 * 1024 * 1024) });
    await artifacts.write('summary.json', 'x'.repeat(5 * 1024 * 1024));
    await assert.rejects(store.save({ ...response, caseId: 'single-02', answer: 'x'.repeat(2 * 1024 * 1024) }), /ARTIFACT_ROUND_CAPACITY/);
    assert.equal((await store.read()).responses.length, 1);
    await assert.rejects(artifacts.write('summary.json', 'x'.repeat(7 * 1024 * 1024)), /ARTIFACT_ROUND_CAPACITY/);
    await assert.rejects(fs.stat(file + '.tmp'), { code: 'ENOENT' });
});

test('resume cleans interrupted private temporary writes and preserves committed answers', async t => {
    const { root, artifacts, file, store } = await fixture(t);
    await store.save(response);
    await fs.writeFile(file + '.tmp', 'x', { mode: 0o600 });
    const resumed = await createRoundArtifacts(root, { round: identity.round, resume: true });
    assert.equal((await createSyntheticAnswerStore(resumed, identity).read()).responses.length, 1);
    await assert.rejects(fs.stat(file + '.tmp'), { code: 'ENOENT' });
});

test('a failed atomic replacement retains the previous checkpoint and resume removes its temporary copy', async t => {
    const { root, artifacts, file, store } = await fixture(t);
    await store.save(response);
    const rename = fs.rename;
    t.mock.method(fs, 'rename', async (source, target) => {
        if (target === file) throw new Error('TEST_RENAME_FAILURE');
        return rename(source, target);
    });
    await assert.rejects(store.save({ ...response, caseId: 'single-02' }), /TEST_RENAME_FAILURE/);
    assert.equal((await store.read()).responses.length, 1);
    t.mock.restoreAll();
    const resumed = await createRoundArtifacts(root, { round: identity.round, resume: true });
    const restored = createSyntheticAnswerStore(resumed, identity);
    assert.equal((await restored.read()).responses.length, 1);
    await assert.rejects(fs.stat(file + '.tmp'), { code: 'ENOENT' });
    await restored.save({ ...response, caseId: 'single-02' });
    assert.equal((await restored.read()).responses.length, 2);
});

test('private answer and manifest symlinks or broad file permissions are refused', async t => {
    const { root, artifacts, file, store } = await fixture(t);
    const outside = path.join(root, 'outside');
    await fs.writeFile(outside, '{}', { mode: 0o600 });
    await fs.symlink(outside, file);
    await assert.rejects(store.read(), /ARTIFACT_SYMLINK/);
    await assert.rejects(store.save(response), /ARTIFACT_SYMLINK/);
    await fs.rm(file);
    await store.save(response);
    await fs.chmod(file, 0o644);
    await assert.rejects(store.read(), /ARTIFACT_PERMISSIONS/);
    await fs.chmod(file, 0o600);
    const manifest = path.join(artifacts.dir, 'manifest.json');
    await fs.rm(manifest); await fs.symlink(outside, manifest);
    await assert.rejects(store.read(), /ARTIFACT_SYMLINK/);
});

test('resume refuses symlink rounds and private temporary symlinks', async t => {
    const { root, artifacts, file, store } = await fixture(t);
    const elsewhere = path.join(root, 'elsewhere');
    await fs.mkdir(elsewhere);
    await fs.symlink(elsewhere, path.join(root, 'round-link'));
    await assert.rejects(createRoundArtifacts(root, { round: 'round-link', resume: true }), /ARTIFACT_/);
    await fs.symlink(path.join(artifacts.dir, 'manifest.json'), file + '.tmp');
    await assert.rejects(store.save(response), /ARTIFACT_SYMLINK/);
    await assert.rejects(createRoundArtifacts(root, { round: identity.round, resume: true }), /ARTIFACT_SYMLINK/);
});
