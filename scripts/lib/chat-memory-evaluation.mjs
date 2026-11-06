import path from 'node:path';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRoundArtifacts } from './chat-memory-artifacts.mjs';
import { createRoundBudget } from './chat-memory-budget.mjs';
import { loadEvaluationConfiguration } from './chat-memory-config.mjs';
import { generateChatMemoryDataset } from './chat-memory-dataset.mjs';
import { compareSamples, comparisonMarkdown, summarizeSamples } from './chat-memory-metrics.mjs';
import { startEvaluationMeter } from '../../integrations/sillytavern/scripts/lib/real-model-meter.mjs';

export const QUALITY_ROOT = fileURLToPath(new URL('../../integrations/sillytavern/.local/chat-memory-quality', import.meta.url));

// Config-only preflight never opens a provider socket. This is also the
// boundary the real runner uses before giving local route tokens to its stack.
export async function preflightEvaluation({ round, configRef, mode = 'cny', ownerTokenOnly = false, quoteFile,
    root = QUALITY_ROOT, maxCalls = 6000 } = {}) {
    const artifacts = await createRoundArtifacts(root, { round });
    let budget;
    try {
        const config = await loadEvaluationConfiguration({ ref: configRef, mode, ownerTokenOnly, quoteFile });
        budget = await createRoundBudget({ file: path.join(artifacts.dir, 'budget.json'), round, profiles: config.routes,
            mode, ownerTokenOnly, maxCalls });
        const report = { schemaVersion: 1, status: 'READY', preflightOnly: true, config: config.manifest,
            modelCalls: 0, actualCostCny: 0, budget: budget.snapshot() };
        await artifacts.write('manifest.json', report);
        return report;
    } catch (error) {
        const code = ['CONFIG_NOT_READY', 'BUDGET_STOP', 'BUDGET_LOCKED', 'BUDGET_SNAPSHOT_MISMATCH'].includes(error.message)
            ? error.message : 'EVALUATION_PREFLIGHT_FAILED';
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
    };
}

export function compareQuality(baseline, candidate) {
    if (baseline.dataset.hashes.dataset !== candidate.dataset.hashes.dataset
        || JSON.stringify(baseline.configuration) !== JSON.stringify(candidate.configuration)) throw new Error('CM_COMPARISON_GROUP_MISMATCH');
    return Object.fromEntries(Object.keys(baseline.quality.byCategory).map(category => {
        const before = baseline.quality.byCategory[category].accuracy, after = candidate.quality.byCategory[category].accuracy;
        return [category, { baseline: before, candidate: after, delta: after.value - before.value,
            status: after.value < before.value ? 'FAIL' : 'PASS' }];
    }));
}

async function loadRealRuntime() {
    const [{ withIsolatedChatMemoryStack }, { evaluateCoreOnStack }] = await Promise.all([
        import('../../integrations/sillytavern/scripts/lib/chat-memory-isolated-stack.mjs'),
        import('../../integrations/sillytavern/scripts/chat-memory-real-eval.mjs'),
    ]);
    return { withIsolatedChatMemoryStack, evaluateCoreOnStack };
}

function evaluationFailure(error, fallback) {
    const message = error?.message;
    return /^(?:CM|ISOLATION|BUDGET|CONFIG|ARTIFACT)_[A-Z0-9_]{1,60}$/.test(message) ? message : fallback;
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

export async function runRealEvaluation({ round, configRef, seed = 20261106, variant = 'baseline',
    mode = 'cny', ownerTokenOnly = false, quoteFile, root = QUALITY_ROOT, maxCalls = 6000,
    baselineFile, resume = false, signal, onProgress = () => {}, caseTimeoutMs, extractionTimeoutMs } = {},
{ loadConfig = loadEvaluationConfiguration, startMeter = startEvaluationMeter, loadRuntime = loadRealRuntime } = {}) {
    if (!/^round-[a-z0-9-]{1,80}$/.test(round || '') || !['baseline', 'candidate'].includes(variant)) throw new Error('CONFIG_NOT_READY');
    const dataset = generateChatMemoryDataset({ seed });
    const config = await loadConfig({ ref: configRef, mode, ownerTokenOnly, quoteFile });
    const roles = [
        { name: 'extraction', purpose: 'MEMORY_EXTRACTION_DEDUP_SUMMARY', profile: config.routes[config.assignments.extraction] },
        { name: 'foreground', purpose: 'FOREGROUND_CHAT', profile: config.routes[config.assignments.foreground] },
        { name: 'judge', purpose: null, profile: config.routes[config.assignments.judge] },
    ];
    const dir = path.join(root, round);
    const budgetFile = path.join(dir, 'budget.json');
    const budgetOptions = { file: budgetFile, round, profiles: roles.map(row => row.profile), mode, ownerTokenOnly, maxCalls };
    const provenance = { variant, dataset: { version: dataset.version, seed, hashes: dataset.hashes, sourceCounts: dataset.sourceCounts },
        configuration: config.manifest, replayMode: resume ? 'full-replay-existing-ledger' : 'fresh' };
    let artifacts, budget, meter, outboundObserver, pipelineFailureCode, failureCode;
    let priorCalls = [], attempts = [], manifestWritten = false;
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
        const annotations = new Map((report.modelCalls || []).map(row => [row.id, row]));
        return [...priorCalls, ...(meter?.snapshot().calls || []).map(row => ({ ...annotations.get(row.id), ...row }))];
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
            artifacts = await createRoundArtifacts(root, { round, resume: true });
            let priorSummary;
            try { priorSummary = JSON.parse(await fs.readFile(path.join(dir, 'summary.json'), 'utf8')); } catch { /* journal is authoritative */ }
            priorCalls = priorSummary?.modelCalls || [];
            attempts = archiveAttempts(prior, priorSummary);
        } else {
            artifacts = await createRoundArtifacts(root, { round });
            budget = await createRoundBudget(budgetOptions);
        }
        const git = args => execFileSync('git', args, { encoding: 'utf8', cwd: fileURLToPath(new URL('../../', import.meta.url)) }).trim();
        const attempt = { ...provenance, commit: git(['rev-parse', 'HEAD']), worktreeDirty: Boolean(git(['status', '--porcelain'])),
            instrumentation: 'cm-final-recall-before-budget-v1' };
        attempts.push(attempt);
        const identity = { schemaVersion: 1, ...provenance, attempt: attempts.length };
        report = { ...identity, executionStatus: 'INCOMPLETE' };
        await write('manifest.json', { ...identity, ...attempt, attempts, mode: 'real', protocol: 'actual-source-and-node-outbound',
            requestOutputCap: roles[1].profile.maxOutputTokens, queryMemorySaving: false,
            querySourcePolicy: 'eligible-unsettled-no-answer-save', foregroundRules: 'inactive', humanReview: 'NOT_RUN' });
        manifestWritten = true;
        await write('summary.json', { ...report, modelCalls: priorCalls, budget: budget.snapshot() });
        meter = await startMeter({ routes: roles.map(row => row.profile), budget,
            upstreamTimeoutMs: 330000, onOutbound: entry => outboundObserver?.(entry) });
        const { withIsolatedChatMemoryStack, evaluateCoreOnStack } = await loadRuntime();
        progress({ phase: 'isolated-stack', status: 'STARTING' });
        const result = await withIsolatedChatMemoryStack({ round, meterPort: Number(new URL(meter.routes[0].baseUrl).port), signal }, async ctx => {
            ctx.scope = round;
            ctx.setOutboundObserver = observer => { outboundObserver = observer; };
            try {
                return await evaluateCoreOnStack(ctx, { dataset, roles, modelRoutes: meter.routes, meter, budget, variant,
                    signal: ctx.signal, onProgress: progress, caseTimeoutMs, extractionTimeoutMs,
                    checkpoint: async partial => {
                        report = { ...partial, ...identity, executionStatus: 'INCOMPLETE' };
                        await write('summary.json', { ...report, modelCalls: calls() });
                    } });
            } catch (error) {
                pipelineFailureCode = evaluationFailure(error, 'CM_PIPELINE_FAILED');
                progress({ phase: 'pipeline', status: 'FAILED', code: pipelineFailureCode, budget: budget.snapshot() });
                throw new Error(pipelineFailureCode);
            }
        });
        report = { ...result, ...identity };
        report.gates = qualityGates(report);
        const controlsComplete = ['memory-off', 'gold-evidence'].every(name => report.diagnosticControls?.[name]?.coverage.value === 1);
        report.executionStatus = report.quality.coverage.value === 1 && controlsComplete && !report.extraction.timedOut ? 'COMPLETE' : 'INCOMPLETE';
        report.verdict = Object.values(report.gates).every(Boolean) ? 'NOT_RUN' : 'FAIL'; // Human calibration remains unperformed.
        if (baselineFile) {
            const baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
            report.comparison = compareQuality(baseline, report);
            report.latencyComparison = compareSamples(baseline.metricRows, report.metricRows);
        }
        await write('samples.jsonl', report.metricRows.map(row => JSON.stringify(row)).join('\n') + '\n');
        await write('comparison.md', comparisonMarkdown(summarizeSamples(report.metricRows), report.latencyComparison || []));
    } catch (error) {
        failureCode = pipelineFailureCode || evaluationFailure(error, 'CM_EVALUATION_FAILED');
    } finally {
        await finalize(() => meter?.stop(), 'CM_METER_STOP_FAILED');
        await finalize(() => budget?.seal(), 'BUDGET_JOURNAL_FAILED');
        if (artifacts && (!resume || manifestWritten)) {
            await finalize(async () => {
                if (failureCode) Object.assign(report, { executionStatus: 'INCOMPLETE', failureCode });
                report.budget = budget?.snapshot() ?? null;
                report.actualCostCny = report.budget?.calls ? null : 0;
                report.modelCalls = calls();
                await write('summary.json', report);
            }, 'CM_ARTIFACT_WRITE_FAILED');
        }
        await finalize(() => artifacts?.close(), 'CM_ARTIFACT_CLOSE_FAILED');
        await finalize(() => budget?.close(), 'BUDGET_JOURNAL_FAILED');
    }
    if (failureCode) throw new Error(failureCode);
    return report;
}
