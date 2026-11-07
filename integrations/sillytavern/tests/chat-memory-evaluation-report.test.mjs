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
    const state = { runs: 0, diagnosticRuns: 0, stopped: 0, coreCoverage: 1, controlCoverage: 1, beforeReport: async () => {} };
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
            evaluateCoreOnStack: async (_ctx, { dataset, variant, meter, checkpoint, onProgress, diagnosticsOnly }) => {
                state.runs++;
                if (diagnosticsOnly) state.diagnosticRuns++;
                await meter.makeCall();
                const diagnosticControls = Object.fromEntries(['memory-off', 'gold-evidence'].map(name =>
                    [name, { coverage: { value: state.controlCoverage } }]));
                onProgress({ phase: 'answer' });
                await checkpoint(diagnosticsOnly ? { phase: 'diagnostic-control', diagnosticControls }
                    : { phase: 'answer', results: [{ status: 'COMPLETED' }] });
                await state.beforeReport();
                const modelCalls = meter.snapshot().calls.map(row => ({ ...row, evalRole: 'foreground' }));
                if (diagnosticsOnly) return { diagnosticControls, modelCalls };
                return {
                    schemaVersion: 1, variant, dataset: { hashes: dataset.hashes },
                    quality: { coverage: { value: state.coreCoverage }, extraction: { supportedRecordRate: RATE },
                        retrieval: { final: { 5: { macro: 1 }, 20: { macro: 1 } } },
                        injection: { allEvidence: RATE }, answerable: { accuracy: RATE },
                        byCategory: { correction: { accuracy: RATE } }, byTag: { current: { accuracy: RATE } },
                        boundary: { zeroLeaks: true }, abstention: { accuracy: RATE },
                        answerableFalseAbstentions: { value: 0 } },
                    extraction: { timedOut: false }, judgeCalibration: { agreement: 1 },
                    diagnosticControls, modelCalls, metricRows: [],
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

test('diagnostic supplement preserves baseline core, controls, calibration, provenance and metrics on the same budget', async t => {
    const f = await fixture(t);
    f.state.coreCoverage = 132 / 140; f.state.controlCoverage = 0;
    const baseline = await f.run(), originalManifest = await f.read('manifest.json');
    const metricFiles = await Promise.all(['samples.jsonl', 'comparison.md'].map(name => fs.readFile(path.join(f.dir, name), 'utf8')));
    f.state.controlCoverage = 1;
    const report = await f.run({ resume: true, diagnosticsOnly: true });
    const { diagnosticSupplement, budget, modelCalls, actualCostCny, ...preserved } = report;
    const { budget: _oldBudget, modelCalls: _oldCalls, actualCostCny: _oldCost, ...original } = baseline;
    assert.deepEqual(preserved, original, 'all baseline quality, controls, calibration, status and identity remain unchanged');
    assert.equal(report.executionStatus, 'INCOMPLETE');
    assert.equal(diagnosticSupplement.executionStatus, 'COMPLETE');
    assert.equal(diagnosticSupplement.baselineCommit, originalManifest.commit);
    assert.equal(diagnosticSupplement.baselineAttempt, baseline.attempt);
    assert.equal(diagnosticSupplement.coreReplayed, false);
    assert.equal(diagnosticSupplement.extractionReplayed, false);
    assert.equal(diagnosticSupplement.history, 'empty-isolated-bindings-no-source-replay');
    assert.equal(diagnosticSupplement.priorModelCalls, 1); assert.equal(diagnosticSupplement.modelCallCount, 1);
    assert.deepEqual(diagnosticSupplement.planned, { 'memory-off': 7, 'gold-evidence': 7 });
    assert.equal(modelCalls.length, 2); assert.deepEqual(modelCalls[0], baseline.modelCalls[0]);
    assert.equal(modelCalls[1].evalRole, 'foreground'); assert.equal(modelCalls[1].state, 'SETTLED');
    assert.equal(budget.calls, 2); assert.equal(budget.inputTokens, 84); assert.equal(budget.outputTokens, 56);
    assert.equal((await f.read('budget.json')).config.maxCalls, 6000);
    const { diagnosticSupplement: manifestSupplement, ...manifest } = await f.read('manifest.json');
    assert.deepEqual(manifest, originalManifest);
    const { executionStatus: _supplementStatus, phase: _supplementPhase, diagnosticControls: _supplementControls,
        modelCallCount: _supplementCalls, ...supplementIdentity } = diagnosticSupplement;
    assert.deepEqual(manifestSupplement, supplementIdentity);
    assert.deepEqual(await Promise.all(['samples.jsonl', 'comparison.md'].map(name => fs.readFile(path.join(f.dir, name), 'utf8'))), metricFiles);
    assert.equal(f.state.runs, 2); assert.equal(f.state.diagnosticRuns, 1);
    await assertClosed(f);
});

test('diagnostic supplements reject fresh runs, changed comparison groups or budgets, and missing baseline summaries before running', async t => {
    const f = await fixture(t);
    await assert.rejects(f.run({ diagnosticsOnly: true }), { message: 'CONFIG_NOT_READY' });
    await f.run();
    const baseline = await f.read('summary.json'), manifest = await f.read('manifest.json');
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true, baselineFile: 'unused' }), { message: 'CONFIG_NOT_READY' });
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true, variant: 'candidate' }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true, seed: 20261108 }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true, maxCalls: 6001 }), { message: 'BUDGET_SNAPSHOT_MISMATCH' });
    f.configuration.profiles[0].modelId = 'changed';
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    f.configuration.profiles[0].modelId = PROFILE.modelId;
    assert.deepEqual(await f.read('manifest.json'), manifest);
    assert.deepEqual(await f.read('summary.json'), baseline);
    await f.write('summary.json', { ...baseline, dataset: { hashes: { dataset: 'different' } } });
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    await f.write('summary.json', { ...baseline, modelCalls: [] });
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true }), { message: 'ARTIFACT_RESUME_INVALID' });
    await fs.unlink(path.join(f.dir, 'summary.json'));
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true }), { message: 'ARTIFACT_RESUME_INVALID' });
    assert.equal(f.state.runs, 1); assert.equal(f.state.diagnosticRuns, 0);
    assert.equal((await f.read('budget.json')).calls.length, 1);
    await assertClosed(f);
});

test('failed diagnostic supplements preserve the baseline and paid calls, and never reset an exhausted budget', async t => {
    const f = await fixture(t);
    f.state.coreCoverage = 132 / 140;
    const baseline = await f.run({ maxCalls: 2 });
    f.state.beforeReport = async () => { throw new Error(PRIVATE_DETAIL); };
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true, maxCalls: 2 }), { message: 'CM_PIPELINE_FAILED' });
    let report = await f.read('summary.json');
    assert.equal(report.executionStatus, baseline.executionStatus);
    assert.deepEqual(report.quality, baseline.quality);
    assert.deepEqual(report.judgeCalibration, baseline.judgeCalibration);
    assert.equal(report.diagnosticSupplement.executionStatus, 'INCOMPLETE');
    assert.equal(report.diagnosticSupplement.failureCode, 'CM_PIPELINE_FAILED');
    assert.equal(report.modelCalls.length, 2); assert.equal(report.budget.settled, 2);
    assert.equal(JSON.stringify(report).includes(PRIVATE_DETAIL), false);
    await assertClosed(f);
    f.state.beforeReport = async () => {};
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true, maxCalls: 2 }), { message: 'BUDGET_STOP' });
    report = await f.read('summary.json');
    assert.equal(report.executionStatus, baseline.executionStatus);
    assert.equal(report.modelCalls.length, 2); assert.equal(report.budget.calls, 2);
    assert.equal(report.diagnosticSupplement.failureCode, 'BUDGET_STOP');
    await assertClosed(f);
});

test('diagnostic supplements reject a stale summary after full resume advanced the manifest attempt', async t => {
    const f = await fixture(t);
    await f.run();
    const summary = await f.read('summary.json'), manifest = await f.read('manifest.json');
    // Full resume can crash between writing the new manifest and its first
    // summary. The previous quality report must not acquire the new commit.
    const nextAttempt = { ...manifest.attempts.at(-1), commit: 'fixture-next-commit' };
    const advanced = { ...manifest, ...nextAttempt, attempt: manifest.attempt + 1,
        attempts: [...manifest.attempts, nextAttempt] };
    await f.write('manifest.json', advanced);
    await assert.rejects(f.run({ resume: true, diagnosticsOnly: true }), { message: 'ARTIFACT_RESUME_INVALID' });
    assert.deepEqual(await f.read('summary.json'), summary);
    assert.deepEqual(await f.read('manifest.json'), advanced);
    assert.equal(f.state.runs, 1); assert.equal(f.state.diagnosticRuns, 0);
    assert.equal((await f.read('budget.json')).calls.length, 1);
    await assertClosed(f);
});
