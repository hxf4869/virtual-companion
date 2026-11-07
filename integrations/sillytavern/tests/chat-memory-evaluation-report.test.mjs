import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as evaluation from '../../../scripts/lib/chat-memory-evaluation.mjs';
import { generateChatMemoryDataset, forgetStageCase, FORGET_STAGES } from '../../../scripts/lib/chat-memory-dataset.mjs';
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
    const state = { runs: 0, diagnosticRuns: 0, judgeRuns: 0, stopped: 0, coreCoverage: 1, controlCoverage: 1,
        retainAnswers: false, beforeReport: async () => {} };
    const observation = testCase => ({ caseId: testCase.id,
        status: state.coreCoverage === 1 ? 'COMPLETED' : 'NOT_RUN', rule: { passed: true, injectionCovered: true, boundaryLeak: false, answerLeak: false },
        judge: { correct: true, grounded: true, abstains: !testCase.goldFactIds.length },
        extractedFactIds: testCase.goldFactIds, legalCandidateFactIds: testCase.goldFactIds,
        injectedFactIds: testCase.goldFactIds, finalRankedFactIds: testCase.goldFactIds.map(id => [id]) });
    const resultsFor = dataset => dataset.cases.map(testCase => testCase.category === 'forget'
        ? { caseId: testCase.id, status: state.coreCoverage === 1 ? 'COMPLETED' : 'NOT_RUN', actionStatus: 'COMPLETED',
            forgetStages: Object.fromEntries(FORGET_STAGES.map(stage => [stage,
                { ...observation(forgetStageCase(dataset, testCase, stage)), cleanupStatus: 'DONE' }])) }
        : { ...observation(testCase), ...(testCase.action ? { actionStatus: 'COMPLETED' } : {}) });
    const deps = {
        loadConfig: async () => ({ routes: [PROFILE], assignments, manifest: configuration }),
        startMeter: async ({ budget }) => {
            const calls = [];
            return {
                routes: [{ baseUrl: 'http://127.0.0.1:1234' }],
                snapshot: () => ({ calls: calls.map(row => ({ ...row })) }),
                async makeCall(role = 'foreground') {
                    const { id } = await budget.reserve({ route: 0, outputCap: 32 });
                    calls.push({ id, state: 'RESERVED', evalRole: role });
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
            reviewSavedAnswersOnStack: async (_ctx, { priorReport, savedAnswers, meter }) => {
                state.judgeRuns++;
                assert.equal(state.retainAnswers, true);
                assert.equal(savedAnswers.responses.length, 220);
                await meter.makeCall('judge');
                return { ...priorReport, modelCalls: meter.snapshot().calls };
            },
            evaluateCoreOnStack: async (_ctx, { dataset, variant, meter, checkpoint, onProgress, diagnosticsOnly, saveAnswer }) => {
                state.runs++;
                if (diagnosticsOnly) state.diagnosticRuns++;
                await meter.makeCall();
                const diagnosticControls = Object.fromEntries(['memory-off', 'gold-evidence'].map(name =>
                    [name, { coverage: { value: state.controlCoverage }, results: [] }]));
                if (state.retainAnswers && !diagnosticsOnly) for (const testCase of dataset.cases) {
                    if (testCase.category === 'forget') for (const stage of FORGET_STAGES) {
                        await saveAnswer({ caseId: testCase.id, stage, control: null, answer: 'synthetic output for reevaluation' });
                    } else await saveAnswer({ caseId: testCase.id, stage: null, control: null, answer: 'synthetic output for reevaluation' });
                }
                onProgress({ phase: 'answer' });
                await checkpoint(diagnosticsOnly ? { phase: 'diagnostic-control', diagnosticControls }
                    : { phase: 'answer', results: [{ status: 'COMPLETED' }] });
                await state.beforeReport();
                const modelCalls = meter.snapshot().calls;
                if (diagnosticsOnly) return { diagnosticControls, modelCalls };
                return {
                    schemaVersion: 1, variant, dataset: { hashes: dataset.hashes },
                    results: resultsFor(dataset),
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
    const { tokenReferenceFile } = await referenceFile({ root });
    const run = options => runRealEvaluation({ root, round, configRef: 'fixture-config',
        mode: 'tokens', tokenReferenceFile, ...options }, deps);
    const read = async name => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
    const write = (name, value) => fs.writeFile(path.join(dir, name), JSON.stringify(value));
    return { root, dir, run, read, write, state, configuration, deps };
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

test('an incompatible baseline is rejected before any provider or stack starts and keeps failed final status', async t => {
    const f = await fixture(t);
    const baselineFile = path.join(f.root, 'baseline.json');
    await fs.writeFile(baselineFile, JSON.stringify({ dataset: { hashes: { dataset: 'wrong' } } }));
    await assert.rejects(f.run({ baselineFile }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    const report = await f.read('summary.json');
    assert.equal(report.executionStatus, 'INCOMPLETE');
    assert.equal(report.failureCode, 'CM_COMPARISON_GROUP_MISMATCH');
    assert.equal(report.budget.inputTokens, 0);
    assert.equal(report.budget.outputTokens, 0);
    assert.equal(report.actualCostCny, 0);
    assert.deepEqual(report.modelCalls, []);
    assert.equal(JSON.stringify(report).includes(PRIVATE_DETAIL), false);
    assert.equal(f.state.stopped, 0);
    assert.equal(f.state.runs, 0);
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

test('a failed judge preflight can resume after a rubric fix while retaining its paid ledger', async t => {
    const f = await fixture(t);
    const originalRuntime = f.deps.loadRuntime;
    f.deps.loadRuntime = async () => ({
        withIsolatedChatMemoryStack: async (_options, evaluate) => evaluate({}),
        evaluateCoreOnStack: async (_ctx, { meter, checkpoint }) => {
            await meter.makeCall('judge');
            await checkpoint({ phase: 'judge-preflight', judgePreflight: { passed: false } });
            throw new Error('CM_JUDGE_CALIBRATION_FAILED');
        },
    });
    await assert.rejects(f.run(), { message: 'CM_JUDGE_CALIBRATION_FAILED' });
    const manifest = await f.read('manifest.json');
    manifest.judgeRubricVersion = 'previous-rubric';
    manifest.attempts[0].judgeRubricVersion = 'previous-rubric';
    await f.write('manifest.json', manifest);
    f.deps.loadRuntime = originalRuntime;
    const report = await f.run({ resume: true });
    assert.equal(report.executionStatus, 'COMPLETE');
    assert.equal(report.budget.calls, 2);
    assert.equal(report.budget.inputTokens, 84);
    assert.equal(report.budget.outputTokens, 56);
    assert.deepEqual(report.modelCalls.map(row => row.id), [1, 2]);
    const resumed = await f.read('manifest.json');
    assert.equal(resumed.attempts[0].judgeRubricVersion, 'previous-rubric');
    assert.equal(resumed.attempts[0].failureCode, 'CM_JUDGE_CALIBRATION_FAILED');
    assert.equal(resumed.attempts[1].judgeRubricVersion, report.judgeRubricVersion);
    await assertClosed(f);
});

test('a changed rubric cannot fully replay a round that already reached answers', async t => {
    const f = await fixture(t);
    await f.run();
    const manifest = await f.read('manifest.json');
    await f.write('manifest.json', { ...manifest, judgeRubricVersion: 'previous-rubric' });
    await assert.rejects(f.run({ resume: true }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    assert.equal((await f.read('budget.json')).calls.length, 1);
    assert.equal(f.state.runs, 1);
    await assertClosed(f);
});

test('resume rejects a shared-state round before any model call even when model and judge match', async t => {
    const f = await fixture(t);
    await f.run();
    const manifest = await f.read('manifest.json');
    await f.write('manifest.json', { ...manifest, caseStateProtocol: 'shared-mutable-cases' });
    await assert.rejects(f.run({ resume: true }), { message: 'CM_COMPARISON_GROUP_MISMATCH' });
    assert.equal((await f.read('budget.json')).calls.length, 1);
    assert.equal(f.state.runs, 1);
    await assertClosed(f);
});

test('quality gates explicitly reject absent case isolation metadata', async t => {
    const f = await fixture(t);
    const report = await f.run();
    assert.equal(evaluation.qualityGates(report).independentCases, true);
    delete report.caseStateProtocol;
    assert.equal(evaluation.qualityGates(report).independentCases, false);
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


async function referenceFile(f, usage = { inputTokens: 600, outputTokens: 400, settledCalls: 10, unknownCalls: 0 }) {
    const tokenReferenceFile = path.join(f.root, 'reference.json');
    const reference = { schemaVersion: 1,
        source: { round: 'round-completed-flow', attempt: 1, firstCallId: 1,
            lastCallId: usage.settledCalls + usage.unknownCalls, flowComplete: true },
        recipe: evaluation.evaluationTokenRecipe(generateChatMemoryDataset({ seed: 20261106 })),
        profiles: [PROFILE, PROFILE, PROFILE], usage };
    await fs.writeFile(tokenReferenceFile, JSON.stringify(reference));
    return { tokenReferenceFile, reference };
}

test('every real evaluation requires a reference even with ownerTokenOnly or CNY mode', async () => {
    for (const options of [{}, { mode: 'tokens', ownerTokenOnly: true }, { mode: 'cny', ownerTokenOnly: true }]) {
        let loaded = false;
        await assert.rejects(runRealEvaluation({ round: 'round-default', configRef: 'fixture-config', ...options }, {
            loadConfig: async () => { loaded = true; throw new Error('fixture'); },
        }), { message: 'BUDGET_TOKEN_REFERENCE_REQUIRED' });
        assert.equal(loaded, false);
    }
});

test('default real evaluation needs no price and freezes the same recipe for a hold-out seed', async t => {
    const f = await fixture(t);
    const { tokenReferenceFile } = await referenceFile(f);
    const report = await runRealEvaluation({ root: f.root, round: 'round-holdout', configRef: 'fixture-config',
        tokenReferenceFile, seed: 20261107 }, f.deps);
    const manifest = JSON.parse(await fs.readFile(path.join(f.root, 'round-holdout', 'manifest.json'), 'utf8'));
    assert.equal(report.budget.mode, 'tokens'); assert.equal(report.budget.capMicroCny, null);
    assert.equal(report.actualCostCny, null); assert.equal(report.budget.settledMicroCny, null);
    assert.equal(manifest.tokenGuard.thresholdTokens, 2000);
    assert.deepEqual(manifest.tokenGuard, report.budget.tokenGuard);
    assert.equal(manifest.tokenGuard.reference.source.qualityBaseline, false);
});

test('token anomaly interrupts an extraction wait, cleans the stack and preserves the anomaly code', { timeout: 2000 }, async t => {
    const f = await fixture(t);
    const { tokenReferenceFile } = await referenceFile(f, { inputTokens: 10, outputTokens: 10, settledCalls: 1, unknownCalls: 0 });
    let cleaned = false;
    f.deps.startMeter = async ({ budget }) => ({
        routes: [{ baseUrl: 'http://127.0.0.1:1234' }], snapshot: () => ({ calls: [] }), stop: async () => {},
        makeCall: async () => {
            const { id } = await budget.reserve({ route: 0, outputCap: 100 });
            await budget.settle(id, { inputTokens: 42, outputTokens: 28 });
        },
    });
    f.deps.loadRuntime = async () => ({
        withIsolatedChatMemoryStack: async ({ signal }, evaluate) => {
            try { return await evaluate({ signal }); }
            finally { cleaned = true; }
        },
        evaluateCoreOnStack: async (_ctx, { meter, signal }) => {
            await meter.makeCall();
            signal.throwIfAborted();
            await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('ISOLATION_INTERRUPTED')), { once: true }));
        },
    });
    await assert.rejects(f.run({ tokenReferenceFile }), { message: 'BUDGET_TOKEN_ANOMALY' });
    const report = await f.read('summary.json');
    assert.equal(cleaned, true); assert.equal(report.failureCode, 'BUDGET_TOKEN_ANOMALY');
    assert.equal(report.budget.tokenUsage.knownTokens, 70); assert.equal(report.executionStatus, 'INCOMPLETE');
    assert.deepEqual(report.modelCalls.map(row => [row.id, row.state]), [[1, 'SETTLED']]);
    await assertClosed(f);
});

test('full resume recovers all call identities from the ledger when the previous summary is missing', async t => {
    const f = await fixture(t);
    await f.run();
    await fs.unlink(path.join(f.dir, 'summary.json'));
    const report = await f.run({ resume: true });
    assert.deepEqual(report.modelCalls.map(row => row.id), [1, 2]);
    assert.equal(report.budget.tokenUsage.knownTokens, 140);
    await assertClosed(f);
});


test('resume uses journal states when an interrupted summary still says RESERVED', async t => {
    const f = await fixture(t);
    await f.run();
    const stale = await f.read('summary.json');
    stale.modelCalls[0].state = 'RESERVED';
    await f.write('summary.json', stale);
    const report = await f.run({ resume: true });
    assert.deepEqual(report.modelCalls.map(row => [row.id, row.state]), [[1, 'SETTLED'], [2, 'SETTLED']]);
    await assertClosed(f);
});

test('saved synthetic answers can be rejudged on the same ledger with zero new foreground or extraction runs', async t => {
    const f = await fixture(t); f.state.retainAnswers = true;
    const original = await f.run();
    const cache = await fs.readFile(path.join(f.dir, 'synthetic-answers.json'), 'utf8');
    const report = await f.run({ resume: true, judgeOnly: true });
    assert.equal(f.state.runs, 1);
    assert.equal(f.state.judgeRuns, 1);
    assert.equal(report.attempt, original.attempt);
    assert.equal(report.judgeReevaluation.foregroundReplayed, false);
    assert.equal(report.judgeReevaluation.extractionReplayed, false);
    assert.equal(report.judgeReevaluation.executionStatus, 'COMPLETE');
    assert.deepEqual(report.modelCalls.map(row => row.evalRole), ['foreground', 'judge']);
    assert.equal(report.budget.calls, 2);
    assert.equal(report.budget.inputTokens, 84);
    assert.equal(await fs.readFile(path.join(f.dir, 'synthetic-answers.json'), 'utf8'), cache);
    assert.equal(JSON.stringify(await f.read('summary.json')).includes('synthetic output for reevaluation'), false);
    assert.equal((await f.read('manifest.json')).attempt, 1);
    await assert.rejects(f.run({ resume: true }), { message: 'CM_REPLAY_HAS_SAVED_ANSWERS' });
    assert.equal(f.state.runs, 1);
    assert.equal(f.state.stopped, 2);
    await assertClosed(f);
});

test('missing saved outputs refuse reevaluation before any model call instead of silently answering again', async t => {
    const f = await fixture(t);
    await f.run();
    await assert.rejects(f.run({ resume: true, judgeOnly: true }), { message: 'SYNTHETIC_ANSWERS_MISSING' });
    assert.equal(f.state.runs, 1);
    assert.equal(f.state.judgeRuns, 0);
    assert.equal(f.state.stopped, 1);
    assert.equal((await f.read('budget.json')).calls.length, 1);
    await assertClosed(f);
});

test('two fresh baselines freeze noise and candidate reports wire paired statistics and failure attribution', async t => {
    const f = await fixture(t);
    await f.run();
    const baselineFile = path.join(f.dir, 'summary.json');
    const second = await f.run({ round: 'round-test-noise', baselineFile });
    assert.equal(second.baselineNoise.overall.bound, 0);
    assert.equal(second.baselineNoise.actionsComplete, true);
    const candidate = await f.run({ round: 'round-test-candidate', variant: 'candidate', baselineFile,
        noiseReferenceFile: path.join(f.root, 'round-test-noise/summary.json') });
    assert.equal(candidate.pairedComparison.overall.delta, 0);
    assert.equal(candidate.pairedComparison.acceptedImprovement, false);
    assert.equal(candidate.failureAttribution.cases.length, 140);
    assert.equal(candidate.pairedComparison.latency.recallStatus, 'NOT_RUN');
    assert.equal(f.state.runs, 3);
});
