import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runRealEvaluation } from '../../../scripts/lib/chat-memory-evaluation.mjs';

const PRIVATE_DETAIL = 'fixture-only progress and upstream detail';
const PROFILE = { modelId: 'fixture-model', protocol: 'OPENAI_CHAT_COMPLETIONS',
    contextWindowTokens: 1000, maxOutputTokens: 100, credential: PRIVATE_DETAIL };
const RATE = { value: 1 };

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-cm-report-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const round = 'round-test-report';
    const dir = path.join(root, round);
    const assignments = { extraction: 0, foreground: 0, judge: 0 };
    const configuration = { configRef: 'fixture-config', mode: 'tokens', assignments,
        profiles: [{ modelId: PROFILE.modelId }] };
    const state = { runs: 0, stopped: 0, controlCoverage: 1, beforeReport: async () => {} };
    const deps = {
        loadConfig: async () => ({ routes: [PROFILE], assignments, manifest: configuration }),
        startMeter: async ({ budget }) => {
            const calls = [];
            return {
                routes: [{ baseUrl: 'http://127.0.0.1:1234' }],
                snapshot: () => ({ calls: calls.map(row => ({ ...row })) }),
                async makeCall() {
                    const { id } = await budget.reserve({ route: 0, outputCap: 32 });
                    calls.push({ id, state: 'RESERVED' });
                },
                async stop() {
                    state.stopped++;
                    for (const call of calls) {
                        await budget.settle(call.id, { inputTokens: 42, outputTokens: 28 });
                        call.state = 'SETTLED';
                    }
                },
            };
        },
        loadRuntime: async () => ({
            withIsolatedChatMemoryStack: async (_options, evaluate) => evaluate({}),
            evaluateCoreOnStack: async (_ctx, { dataset, variant, meter, checkpoint, onProgress }) => {
                state.runs++;
                await meter.makeCall();
                onProgress({ phase: 'answer' });
                await checkpoint({ phase: 'answer', results: [{ status: 'COMPLETED' }] });
                await state.beforeReport();
                return {
                    schemaVersion: 1, variant, dataset: { hashes: dataset.hashes },
                    quality: { coverage: RATE, extraction: { supportedRecordRate: RATE },
                        retrieval: { final: { 5: { macro: 1 }, 20: { macro: 1 } } },
                        injection: { allEvidence: RATE }, answerable: { accuracy: RATE },
                        byCategory: { correction: { accuracy: RATE } }, byTag: { current: { accuracy: RATE } },
                        boundary: { zeroLeaks: true }, abstention: { accuracy: RATE },
                        answerableFalseAbstentions: { value: 0 } },
                    extraction: { timedOut: false }, judgeCalibration: { agreement: 1 },
                    diagnosticControls: Object.fromEntries(['memory-off', 'gold-evidence'].map(name => [name, { coverage: { value: state.controlCoverage } }])),
                    modelCalls: meter.snapshot().calls.map(row => ({ ...row, evalRole: 'foreground' })), metricRows: [],
                };
            },
        }),
    };
    const run = options => runRealEvaluation({ root, round, configRef: 'fixture-config',
        mode: 'tokens', ownerTokenOnly: true, ...options }, deps);
    const read = async name => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    const write = (name, value) => fs.writeFile(path.join(dir, name), JSON.stringify(value));
    return { root, dir, run, read, write, state, configuration };
}

async function assertClosed(f) {
    assert.equal((await f.read('.owner.json')).closed, true);
    await assert.rejects(fs.access(path.join(f.dir, 'budget.json.lock')), { code: 'ENOENT' });
}

test('incomplete diagnostic controls cannot be reported as complete core execution', async t => {
    const f = await fixture(t); f.state.controlCoverage = 0;
    assert.equal((await f.run()).executionStatus, 'INCOMPLETE');
    assert.equal((await f.read('summary.json')).executionStatus, 'INCOMPLETE');
    await assertClosed(f);
});

test('incompatible baseline keeps failed final status after the meter settles', async t => {
    const f = await fixture(t);
    const baselineFile = path.join(f.root, 'baseline.json');
    await fs.writeFile(baselineFile, JSON.stringify({ dataset: { hashes: { dataset: 'wrong' } } }));
    await assert.rejects(f.run({ baselineFile }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    const report = await f.read('summary.json');
    assert.equal(report.executionStatus, 'INCOMPLETE');
    assert.equal(report.failureCode, 'CM_COMPARISON_GROUP_MISMATCH');
    assert.equal(report.budget.inputTokens, 42);
    assert.equal(report.budget.outputTokens, 28);
    assert.equal(report.actualCostCny, null);
    assert.deepEqual(report.modelCalls, [{ id: 1, state: 'SETTLED', evalRole: 'foreground' }]);
    assert.equal(JSON.stringify(report).includes(PRIVATE_DETAIL), false);
    assert.equal(f.state.stopped, 1);
    await assertClosed(f);
});

test('a report artifact write failure leaves an incomplete summary and closes resources', async t => {
    const f = await fixture(t);
    f.state.beforeReport = () => fs.mkdir(path.join(f.dir, 'samples.jsonl'));
    await assert.rejects(f.run(), { message: 'ARTIFACT_PATH_INVALID' });
    const report = await f.read('summary.json');
    assert.equal(report.executionStatus, 'INCOMPLETE');
    assert.equal(report.failureCode, 'ARTIFACT_PATH_INVALID');
    assert.equal(report.budget.settled, 1);
    assert.equal(f.state.stopped, 1);
    await assertClosed(f);
});

test('an unwritable final summary does not skip meter, budget or artifact cleanup', async t => {
    const f = await fixture(t);
    f.state.beforeReport = () => fs.writeFile(path.join(f.dir, 'summary.json.tmp'), '');
    await assert.rejects(f.run(), { message: 'CM_ARTIFACT_WRITE_FAILED' });
    const report = await f.read('summary.json');
    assert.equal(report.executionStatus, 'INCOMPLETE');
    assert.equal(f.state.stopped, 1);
    assert.equal((await f.read('budget.json')).calls[0].state, 'SETTLED');
    await assertClosed(f);
});

test('resume rejects variant, dataset, and configuration changes and requires the existing journal', async t => {
    const f = await fixture(t);
    await f.run();
    const manifest = await f.read('manifest.json');
    await assert.rejects(f.run({ resume: true, variant: 'candidate' }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    await assert.rejects(f.run({ resume: true, seed: 20261108 }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    f.configuration.profiles[0].modelId = 'changed';
    await assert.rejects(f.run({ resume: true }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    f.configuration.profiles[0].modelId = PROFILE.modelId;
    assert.deepEqual(await f.read('manifest.json'), manifest);
    assert.equal((await f.read('budget.json')).calls.length, 1);
    await assertClosed(f);
    await fs.unlink(path.join(f.dir, 'budget.json'));
    await assert.rejects(f.run({ resume: true }), { message: 'ARTIFACT_RESUME_MISSING' });
    await assert.rejects(fs.access(path.join(f.dir, 'budget.json')), { code: 'ENOENT' });
    assert.equal(f.state.runs, 1);
});

test('resume archives a legacy complete attempt and a failed replay on the same journal', async t => {
    const f = await fixture(t);
    await f.run();
    const { attempts, replayMode, ...legacyManifest } = await f.read('manifest.json');
    const { attempt, replayMode: _mode, ...legacyReport } = await f.read('summary.json');
    await f.write('manifest.json', { ...legacyManifest, commit: 'fixture-prior-commit', worktreeDirty: false });
    await f.write('summary.json', legacyReport);

    f.state.beforeReport = async () => { throw new Error(PRIVATE_DETAIL); };
    await assert.rejects(f.run({ resume: true, onProgress: progress => {
        if (progress.phase === 'answer') return Promise.reject(new Error(PRIVATE_DETAIL));
        throw new Error(PRIVATE_DETAIL);
    } }), { message: 'CM_PIPELINE_FAILED' });
    assert.equal(JSON.stringify(await f.read('summary.json')).includes(PRIVATE_DETAIL), false);

    f.state.beforeReport = async () => {};
    const report = await f.run({ resume: true });
    const manifest = await f.read('manifest.json');
    assert.equal(report.executionStatus, 'COMPLETE');
    assert.equal(report.replayMode, 'full-replay-existing-ledger');
    assert.equal(manifest.replayMode, report.replayMode);
    assert.equal(report.attempt, 3);
    assert.equal(manifest.attempts.length, 3);
    assert.deepEqual(manifest.attempts[0], {
        commit: 'fixture-prior-commit', worktreeDirty: false, variant: 'baseline',
        dataset: manifest.dataset, configuration: manifest.configuration, executionStatus: 'COMPLETE',
    });
    assert.equal(manifest.attempts[1].replayMode, report.replayMode);
    assert.equal(manifest.attempts[1].executionStatus, 'INCOMPLETE');
    assert.equal(manifest.attempts[1].failureCode, 'CM_PIPELINE_FAILED');
    assert.notEqual(manifest.attempts[2].commit, manifest.attempts[0].commit);
    assert.deepEqual(report.modelCalls.map(row => row.id), [1, 2, 3]);
    assert.equal(report.budget.calls, 3);
    assert.equal(report.budget.inputTokens, 126);
    assert.equal(report.budget.outputTokens, 84);
    assert.equal(f.state.runs, 3);
    await assertClosed(f);
});
