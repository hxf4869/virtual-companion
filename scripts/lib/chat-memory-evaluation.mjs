import path from 'node:path';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRoundArtifacts } from './chat-memory-artifacts.mjs';
import { createRoundBudget } from './chat-memory-budget.mjs';
import { loadEvaluationConfiguration } from './chat-memory-config.mjs';
import { generateChatMemoryDataset } from './chat-memory-dataset.mjs';
import { createSyntheticAnswerStore } from './chat-memory-answers.mjs';
import { JUDGE_RUBRIC_VERSION } from './chat-memory-scoring.mjs';
import { attributeMemoryFailures, compareMemoryRounds, freezeBaselineNoise } from './chat-memory-round-statistics.mjs';
import { compareSamples, comparisonMarkdown, summarizeSamples } from './chat-memory-metrics.mjs';
import { startEvaluationMeter } from '../../integrations/sillytavern/scripts/lib/real-model-meter.mjs';

export const QUALITY_ROOT = fileURLToPath(new URL('../../integrations/sillytavern/.local/chat-memory-quality', import.meta.url));

// Seed and fact hashes vary between development and hold-out runs. The shape
// of the full round, the generator version, and the ordered role profiles do not.
export function evaluationTokenRecipe(dataset) {
    return { datasetVersion: dataset.version, sourceCounts: dataset.sourceCounts,
        casesByCategory: Object.fromEntries([...new Set(dataset.cases.map(row => row.category))]
            .sort().map(category => [category, dataset.cases.filter(row => row.category === category).length])),
        controls: { 'memory-off': 7, 'gold-evidence': 7 },
        roles: ['extraction', 'foreground', 'judge'], instrumentation: 'cm-final-recall-before-budget-v1' };
}

async function readTokenReference(file) {
    // Every real round has the same frozen anomaly guard, regardless of the
    // optional financial mode or the historical ownerTokenOnly flag.
    if (!file) throw new Error('BUDGET_TOKEN_REFERENCE_REQUIRED');
    try {
        const reference = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!reference || typeof reference !== 'object' || Array.isArray(reference)) throw new Error();
        return reference;
    }
    catch { throw new Error('BUDGET_TOKEN_REFERENCE_INVALID'); }
}

// Config-only preflight never opens a provider socket. This is also the
// boundary the real runner uses before giving local route tokens to its stack.
export async function preflightEvaluation({ round, configRef, mode = 'tokens', ownerTokenOnly = false, quoteFile,
    root = QUALITY_ROOT, maxCalls = 6000, seed = 20261106, tokenReferenceFile } = {}) {
    const tokenReference = await readTokenReference(tokenReferenceFile);
    ownerTokenOnly ||= mode === 'tokens' && Boolean(tokenReference);
    const artifacts = await createRoundArtifacts(root, { round });
    let budget;
    try {
        const config = await loadEvaluationConfiguration({ ref: configRef, mode, ownerTokenOnly, quoteFile });
        budget = await createRoundBudget({ file: path.join(artifacts.dir, 'budget.json'), round,
            profiles: ['extraction', 'foreground', 'judge'].map(role => config.routes[config.assignments[role]]),
            mode, ownerTokenOnly, maxCalls, tokenReference, recipe: evaluationTokenRecipe(generateChatMemoryDataset({ seed })) });
        const report = { schemaVersion: 1, status: 'READY', preflightOnly: true, config: config.manifest,
            modelCalls: 0, actualCostCny: 0, budget: budget.snapshot() };
        await artifacts.write('manifest.json', report);
        return report;
    } catch (error) {
        const code = evaluationFailure(error, 'EVALUATION_PREFLIGHT_FAILED');
        await artifacts.write('manifest.json', { schemaVersion: 1, status: code, preflightOnly: true, modelCalls: 0, actualCostCny: 0 });
        throw new Error(code);
    } finally { try { await budget?.close(); } finally { await artifacts.close(); } }
}

export function qualityGates(report) {
    const q = report.quality;
    return {
        extractionPrecision: q.extraction.supportedRecordRate.value >= .95,
        recallAt5: q.retrieval.final[5].macro >= .90,
        recallAt20: q.retrieval.final[20].macro >= .95,
        allEvidenceInjected: q.injection.allEvidence.value >= .90,
        answerable: q.answerable.accuracy.value >= .85,
        everyCategory: Object.values(q.byCategory).every(row => row.accuracy.value >= .75),
        correctionCurrent: (q.byTag.current.accuracy.value ?? 0) >= .95,
        zeroBoundaryLeaks: q.boundary.zeroLeaks,
        abstention: q.abstention.accuracy.value >= .95,
        falseAbstention: q.answerableFalseAbstentions.value <= .05,
        judgeAgreement: (report.judgeCalibration.agreement ?? 0) >= .90,
        judgePreflight: report.judgePreflight ? report.judgePreflight.passed === true : true,
        actionsCompleted: q.actions ? q.actions.coverage.value === 1 : true,
    };
}

export function compareQuality(baseline, candidate) {
    if (baseline.dataset.hashes.dataset !== candidate.dataset.hashes.dataset
        || JSON.stringify(baseline.configuration) !== JSON.stringify(candidate.configuration)
        || baseline.judgeRubricVersion !== candidate.judgeRubricVersion) throw new Error('CM_COMPARISON_GROUP_MISMATCH');
    return Object.fromEntries(Object.keys(baseline.quality.byCategory).map(category => {
        const before = baseline.quality.byCategory[category].accuracy, after = candidate.quality.byCategory[category].accuracy;
        return [category, { baseline: before, candidate: after, delta: after.value - before.value,
            status: after.value < before.value ? 'FAIL' : 'PASS' }];
    }));
}

async function loadRealRuntime() {
    const [{ withIsolatedChatMemoryStack }, { evaluateCoreOnStack, reviewSavedAnswersOnStack }] = await Promise.all([
        import('../../integrations/sillytavern/scripts/lib/chat-memory-isolated-stack.mjs'),
        import('../../integrations/sillytavern/scripts/chat-memory-real-eval.mjs'),
    ]);
    return { withIsolatedChatMemoryStack, evaluateCoreOnStack, reviewSavedAnswersOnStack };
}

function evaluationFailure(error, fallback) {
    const message = error?.message;
    return /^(?:CM|ISOLATION|BUDGET|CONFIG|ARTIFACT|SYNTHETIC)_[A-Z0-9_]{1,60}$/.test(message) ? message : fallback;
}

function archiveAttempts(manifest, summary) {
    const { commit, worktreeDirty, variant, dataset, configuration } = manifest;
    const attempts = manifest.attempts ?? [{ commit, worktreeDirty, variant, dataset, configuration }];
    // A crash before the first checkpoint can leave the previous summary on
    // disk. Its status belongs to the previous attempt, never to this one.
    const current = summary?.attempt === (manifest.attempts ? attempts.length : undefined);
    return [...attempts.slice(0, -1), { ...attempts.at(-1),
        executionStatus: current && summary?.executionStatus === 'COMPLETE' ? 'COMPLETE' : 'INCOMPLETE',
        failureCode: current ? evaluationFailure({ message: summary?.failureCode }) : undefined,
    }];
}

function journalCall(record, annotation) {
    return annotation ? { ...annotation, state: record.state === 'HELD' ? 'RESERVED' : record.state,
        ...(record.reason ? { reason: record.reason } : {}) } : record;
}

export async function runRealEvaluation({ round, configRef, seed = 20261106, variant = 'baseline',
    mode = 'tokens', ownerTokenOnly = false, quoteFile, root = QUALITY_ROOT, maxCalls = 6000, tokenReferenceFile,
    baselineFile, noiseReferenceFile, previousRoundFiles = [], resume = false, diagnosticsOnly = false, judgeOnly = false,
    signal, onProgress = () => {}, caseTimeoutMs, extractionTimeoutMs } = {},
{ loadConfig = loadEvaluationConfiguration, startMeter = startEvaluationMeter, loadRuntime = loadRealRuntime } = {}) {
    if (!/^round-[a-z0-9-]{1,80}$/.test(round || '') || !['baseline', 'candidate'].includes(variant)) throw new Error('CONFIG_NOT_READY');
    if (diagnosticsOnly && (!resume || baselineFile)) throw new Error('CONFIG_NOT_READY');
    if (judgeOnly && (!resume || baselineFile || diagnosticsOnly)) throw new Error('CONFIG_NOT_READY');
    const tokenReference = await readTokenReference(tokenReferenceFile);
    ownerTokenOnly ||= mode === 'tokens' && Boolean(tokenReference);
    const dataset = generateChatMemoryDataset({ seed });
    const config = await loadConfig({ ref: configRef, mode, ownerTokenOnly, quoteFile });
    const roles = [
        { name: 'extraction', purpose: 'MEMORY_EXTRACTION_DEDUP_SUMMARY', profile: config.routes[config.assignments.extraction] },
        { name: 'foreground', purpose: 'FOREGROUND_CHAT', profile: config.routes[config.assignments.foreground] },
        { name: 'judge', purpose: null, profile: config.routes[config.assignments.judge] },
    ];
    const dir = path.join(root, round);
    const budgetFile = path.join(dir, 'budget.json');
    const budgetOptions = { file: budgetFile, round, profiles: roles.map(row => row.profile), mode, ownerTokenOnly, maxCalls,
        tokenReference, recipe: evaluationTokenRecipe(dataset) };
    const provenance = { round, variant, judgeRubricVersion: JUDGE_RUBRIC_VERSION,
        dataset: { version: dataset.version, seed, hashes: dataset.hashes, sourceCounts: dataset.sourceCounts },
        configuration: config.manifest, replayMode: resume ? 'full-replay-existing-ledger' : 'fresh' };
    let artifacts, budget, meter, outboundObserver, pipelineFailureCode, failureCode;
    let priorCalls = [], attempts = [], manifestWritten = false, priorManifest, priorSummary, callAnnotations = [], answerStore;
    let report = { schemaVersion: 1, ...provenance, executionStatus: 'INCOMPLETE' };
    const progress = entry => {
        // A display callback must not surface its error or interrupt the paid run.
        try { Promise.resolve(onProgress(entry)).catch(() => {}); } catch { /* best effort */ }
    };
    const write = async (name, data) => {
        try { await artifacts.write(name, data); }
        catch (error) { throw new Error(evaluationFailure(error, 'CM_ARTIFACT_WRITE_FAILED')); }
    };
    const calls = () => {
        const annotations = new Map([...(report.modelCalls || []), ...callAnnotations].map(row => [row.id, row]));
        const observed = new Map([...priorCalls, ...(meter?.snapshot().calls || [])
            .map(row => ({ ...annotations.get(row.id), ...row }))].map(row => [row.id, row]));
        // A missing/crashed summary never deletes already journaled call IDs.
        return (budget?.callRecords() || []).map(row => journalCall(row, observed.get(row.id)));
    };
    const finalize = async (action, fallback) => {
        try { await action(); }
        catch (error) { failureCode ||= evaluationFailure(error, fallback); }
    };
    try {
        if (resume) {
            try { await fs.access(budgetFile); }
            catch (error) { if (error.code === 'ENOENT') throw new Error('ARTIFACT_RESUME_MISSING'); throw error; }
            budget = await createRoundBudget({ ...budgetOptions, requireExisting: true });
            let prior;
            try { prior = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')); }
            catch { throw new Error('ARTIFACT_RESUME_INVALID'); }
            if (prior.variant !== variant || prior.dataset?.hashes?.dataset !== dataset.hashes.dataset
                || JSON.stringify(prior.configuration) !== JSON.stringify(config.manifest)) throw new Error('CM_COMPARISON_GROUP_MISMATCH');
            if (!judgeOnly && prior.judgeRubricVersion !== undefined && prior.judgeRubricVersion !== JUDGE_RUBRIC_VERSION) {
                throw new Error('CM_COMPARISON_GROUP_MISMATCH');
            }
            priorManifest = prior;
            try { priorSummary = JSON.parse(await fs.readFile(path.join(dir, 'summary.json'), 'utf8')); } catch { /* journal is authoritative */ }
            if ((diagnosticsOnly || judgeOnly) && (!priorSummary?.quality || !priorSummary?.extraction || !priorSummary?.judgeCalibration
                || !Array.isArray(priorSummary?.modelCalls) || priorSummary.modelCalls.length !== budget.snapshot().calls
                || priorSummary.attempt !== prior.attempt
                || priorSummary.attempt !== (prior.attempts ? prior.attempts.length : undefined))) {
                throw new Error('ARTIFACT_RESUME_INVALID');
            }
            if (diagnosticsOnly && (priorSummary.variant !== variant || priorSummary.dataset?.hashes?.dataset !== dataset.hashes.dataset
                || JSON.stringify(priorSummary.configuration) !== JSON.stringify(config.manifest))) throw new Error('CM_COMPARISON_GROUP_MISMATCH');
            artifacts = await createRoundArtifacts(root, { round, resume: true });
            if (!diagnosticsOnly && !judgeOnly) {
                try { await fs.access(path.join(artifacts.dir, 'synthetic-answers.json')); throw new Error('CM_REPLAY_HAS_SAVED_ANSWERS'); }
                catch (error) { if (error.code !== 'ENOENT') throw error; }
            }
            const recorded = new Map((priorSummary?.modelCalls || []).map(row => [row.id, row]));
            priorCalls = budget.callRecords().map(row => journalCall(row, recorded.get(row.id)));
            attempts = archiveAttempts(prior, priorSummary);
        } else {
            artifacts = await createRoundArtifacts(root, { round });
            budget = await createRoundBudget(budgetOptions);
        }
        const runSignal = AbortSignal.any([budget.signal, ...(signal ? [signal] : [])]);
        budget.signal.addEventListener('abort', () => progress({ phase: 'budget', status: 'STOPPED',
            code: 'BUDGET_TOKEN_ANOMALY', budget: budget.snapshot() }), { once: true });
        const git = args => execFileSync('git', args, { encoding: 'utf8', cwd: fileURLToPath(new URL('../../', import.meta.url)) }).trim();
        const attempt = { ...provenance, commit: git(['rev-parse', 'HEAD']), worktreeDirty: Boolean(git(['status', '--porcelain'])),
            instrumentation: 'cm-final-recall-before-budget-v1' };
        const identity = { schemaVersion: 1, ...provenance, attempt: judgeOnly ? priorManifest.attempt : attempts.length + 1,
            ...(budget.snapshot().tokenGuard ? { tokenGuard: budget.snapshot().tokenGuard } : {}) };
        if (judgeOnly) {
            answerStore = createSyntheticAnswerStore(artifacts, { round, attempt: priorManifest.attempt, dataset });
            // Read before starting the meter/stack: old rounds without retained
            // outputs cannot silently regenerate answers during reevaluation.
            await answerStore.read();
            const judgeReevaluation = { sourceAttempt: priorManifest.attempt, sourceCommit: priorManifest.commit,
                commit: attempt.commit, rubricVersion: JUDGE_RUBRIC_VERSION, foregroundReplayed: false,
                extractionReplayed: false, priorModelCalls: priorCalls.length, executionStatus: 'INCOMPLETE' };
            report = { ...priorSummary, judgeReevaluation };
            await write('manifest.json', { ...priorManifest, judgeReevaluation });
        } else if (diagnosticsOnly) {
            const supplementIdentity = { schemaVersion: 1, ...attempt,
                ...(identity.tokenGuard ? { tokenGuard: identity.tokenGuard } : {}),
                replayMode: 'diagnostic-controls-only-existing-ledger',
                baselineCommit: priorManifest.commit, baselineAttempt: priorManifest.attempt ?? null,
                history: 'empty-isolated-bindings-no-source-replay', extractionReplayed: false, coreReplayed: false,
                planned: { 'memory-off': 7, 'gold-evidence': 7 }, priorModelCalls: priorCalls.length };
            // Keep only the latest supplement inside the existing bounded
            // report; the baseline identity/results and every paid call stay.
            report = { ...priorSummary, diagnosticSupplement: { ...supplementIdentity, executionStatus: 'INCOMPLETE' } };
            await write('manifest.json', { ...priorManifest, diagnosticSupplement: supplementIdentity });
        } else {
            attempts.push(attempt);
            report = { ...identity, executionStatus: 'INCOMPLETE' };
            await write('manifest.json', { ...identity, ...attempt, attempts, mode: 'real', protocol: 'actual-source-and-node-outbound',
                requestOutputCap: roles[1].profile.maxOutputTokens, queryMemorySaving: false,
                querySourcePolicy: 'eligible-unsettled-no-answer-save', foregroundRules: 'inactive', humanReview: 'NOT_RUN' });
            answerStore = createSyntheticAnswerStore(artifacts, { round, attempt: identity.attempt, dataset });
        }
        manifestWritten = true;
        await write('summary.json', { ...report, modelCalls: priorCalls, budget: budget.snapshot() });
        if (baselineFile) {
            const baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
            if (baseline.dataset?.hashes?.dataset !== dataset.hashes.dataset
                || JSON.stringify(baseline.configuration) !== JSON.stringify(config.manifest)
                || baseline.judgeRubricVersion !== JUDGE_RUBRIC_VERSION) throw new Error('CM_COMPARISON_GROUP_MISMATCH');
        }
        runSignal.throwIfAborted();
        meter = await startMeter({ routes: roles.map(row => row.profile), budget,
            upstreamTimeoutMs: 330000, onOutbound: entry => outboundObserver?.(entry) });
        const { withIsolatedChatMemoryStack, evaluateCoreOnStack, reviewSavedAnswersOnStack } = await loadRuntime();
        progress({ phase: 'isolated-stack', status: 'STARTING' });
        const result = await withIsolatedChatMemoryStack({ round, meterPort: Number(new URL(meter.routes[0].baseUrl).port), signal: runSignal }, async ctx => {
            ctx.scope = round;
            ctx.setOutboundObserver = observer => { outboundObserver = observer; };
            try {
                if (judgeOnly) return await reviewSavedAnswersOnStack(ctx, { dataset, roles, modelRoutes: meter.routes, meter, budget,
                    priorReport: priorSummary, savedAnswers: await answerStore.read(),
                    signal: AbortSignal.any([runSignal, ...(ctx.signal ? [ctx.signal] : [])]), onProgress: progress, caseTimeoutMs,
                    checkpoint: async partial => {
                        report = { ...report, ...partial, executionStatus: 'INCOMPLETE' };
                        await write('summary.json', { ...report, modelCalls: calls() });
                    } });
                return await evaluateCoreOnStack(ctx, { dataset, roles, modelRoutes: meter.routes, meter, budget, variant,
                    signal: AbortSignal.any([runSignal, ...(ctx.signal ? [ctx.signal] : [])]), onProgress: progress, caseTimeoutMs, extractionTimeoutMs, diagnosticsOnly,
                    saveAnswer: answerStore ? row => answerStore.save(row) : undefined,
                    checkpoint: async partial => {
                        if (diagnosticsOnly) report.diagnosticSupplement = { ...report.diagnosticSupplement,
                            phase: partial.phase, diagnosticControls: partial.diagnosticControls };
                        else report = { ...partial, ...identity, executionStatus: 'INCOMPLETE' };
                        await write('summary.json', { ...report, modelCalls: calls() });
                    } });
            } catch (error) {
                pipelineFailureCode = budget.signal.aborted ? 'BUDGET_TOKEN_ANOMALY' : evaluationFailure(error, 'CM_PIPELINE_FAILED');
                progress({ phase: 'pipeline', status: 'FAILED', code: pipelineFailureCode, budget: budget.snapshot() });
                throw new Error(pipelineFailureCode);
            }
        });
        if (diagnosticsOnly) {
            callAnnotations = result.modelCalls;
            const complete = ['memory-off', 'gold-evidence'].every(name => result.diagnosticControls?.[name]?.coverage.value === 1);
            report.diagnosticSupplement = { ...report.diagnosticSupplement, diagnosticControls: result.diagnosticControls,
                executionStatus: complete ? 'COMPLETE' : 'INCOMPLETE' };
        } else {
            const judgeReevaluation = report.judgeReevaluation;
            report = { ...result, ...identity, ...(judgeOnly ? { judgeReevaluation } : {}) };
            report.gates = qualityGates(report);
            const controlsComplete = ['memory-off', 'gold-evidence'].every(name => report.diagnosticControls?.[name]?.coverage.value === 1);
            report.questionExecutionStatus = report.quality.coverage.value === 1 && controlsComplete && !report.extraction.timedOut ? 'COMPLETE' : 'INCOMPLETE';
            report.actionExecutionStatus = !report.quality.actions || report.quality.actions.coverage.value === 1 ? 'COMPLETE' : 'INCOMPLETE';
            report.executionStatus = report.questionExecutionStatus === 'COMPLETE' && report.actionExecutionStatus === 'COMPLETE' ? 'COMPLETE' : 'INCOMPLETE';
            report.verdict = Object.values(report.gates).every(Boolean) ? 'NOT_RUN' : 'FAIL'; // Human calibration remains unperformed.
            report.failureAttribution = attributeMemoryFailures(dataset, report);
            if (judgeOnly) {
                report.judgeReevaluation.executionStatus = 'COMPLETE';
                await write('manifest.json', { ...priorManifest, judgeReevaluation: report.judgeReevaluation });
            }
            if (baselineFile) {
                const baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
                report.comparison = compareQuality(baseline, report);
                report.latencyComparison = compareSamples(baseline.metricRows, report.metricRows);
                if (variant === 'baseline') {
                    report.baselineNoise = freezeBaselineNoise(dataset, baseline, report);
                } else if (noiseReferenceFile) {
                    const reference = JSON.parse(await fs.readFile(noiseReferenceFile, 'utf8'));
                    const previous = await Promise.all(previousRoundFiles.map(async file => {
                        const summary = JSON.parse(await fs.readFile(file, 'utf8'));
                        return summary.pairedComparison;
                    }));
                    report.pairedComparison = compareMemoryRounds(dataset, baseline, report,
                        { noiseReference: reference.baselineNoise ?? reference, priorImprovementRounds: previous });
                }
            }
            await write('samples.jsonl', report.metricRows.map(row => JSON.stringify(row)).join('\n') + '\n');
            await write('comparison.md', comparisonMarkdown(summarizeSamples(report.metricRows), report.latencyComparison || []));
        }
    } catch (error) {
        failureCode = budget?.signal.aborted ? 'BUDGET_TOKEN_ANOMALY' : pipelineFailureCode || evaluationFailure(error, 'CM_EVALUATION_FAILED');
    } finally {
        await finalize(() => meter?.stop(), 'CM_METER_STOP_FAILED');
        await finalize(() => budget?.seal(), 'BUDGET_JOURNAL_FAILED');
        if (budget?.signal.aborted) failureCode = 'BUDGET_TOKEN_ANOMALY';
        if (artifacts && (!resume || manifestWritten)) {
            await finalize(async () => {
                if (failureCode) Object.assign(diagnosticsOnly ? report.diagnosticSupplement : report,
                    { executionStatus: 'INCOMPLETE', failureCode });
                if (failureCode && judgeOnly && report.judgeReevaluation) report.judgeReevaluation.executionStatus = 'INCOMPLETE';
                report.budget = budget?.snapshot() ?? null;
                report.actualCostCny = report.budget?.calls ? null : 0;
                report.modelCalls = calls();
                if (diagnosticsOnly) {
                    report.diagnosticSupplement.modelCallCount = report.modelCalls.length - priorCalls.length;
                }
                await write('summary.json', report);
            }, 'CM_ARTIFACT_WRITE_FAILED');
        }
        await finalize(() => artifacts?.close(), 'CM_ARTIFACT_CLOSE_FAILED');
        await finalize(() => budget?.close(), 'BUDGET_JOURNAL_FAILED');
    }
    if (failureCode) throw new Error(failureCode);
    return report;
}
