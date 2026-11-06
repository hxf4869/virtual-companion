// CM-1: numeric samples only. Process-local monotonic durations must be
// calculated at their source; this module never subtracts cross-process clocks.
import { REPLY_QUALITY_RULE_CODES } from '../../integrations/sillytavern/extension/vc-model-settings/reply-pipeline.js';
export const METRICS = Object.freeze([
    'ttft_visible_ms', 'ttft_upstream_ms', 'first_byte_ms', 'first_reasoning_ms',
    'reply_complete_ms', 'reply_durable_ms', 'last_delta_paint_ms', 'last_delta_durable_ms',
    'open_paint_ms', 'open_ready_ms', 'send_echo_ms', 'send_ack_ms',
    'recall_ms', 'memory_recheck_ms', 'source_ready_ms', 'l1_ready_ms', 'profile_ready_ms',
    'query_embedding_ms', 'retrieval_ms', 'rerank_ms', 'summary_gate_ms',
    'repetition_3gram', 'rewrite_extra_ms', 'send_outcome', 'open_outcome',
    'pipeline_first_body_ms', 'pipeline_complete_ms', 'cleanup_ms',
    'scope_leaks', 'forgotten_leaks',
]);
export const OUTCOMES = Object.freeze([
    'ok', 'http_error', 'provider_error', 'stream_error', 'empty_reply', 'save_error',
    'memory_degraded', 'timeout', 'cancelled', 'auth_denied', 'budget_stop',
    'invalid_input', 'silence', 'not_run',
]);
const FAILURES = new Set(['http_error', 'provider_error', 'stream_error', 'empty_reply', 'save_error', 'timeout']);
const EXCLUDED = new Set(['invalid_input', 'not_run']);
const DIMENSIONS = {
    variant: ['baseline', 'candidate'],
    cache: ['cold-browser', 'first-open', 'warm', 'search', 'not_applicable'],
    modelCache: ['cold', 'warm', 'unknown', 'not_applicable'],
    network: ['local', 'controlled', 'weak', 'remote'],
    surface: ['browser', 'pipeline', 'local-model', 'collector-fixture'],
    content: ['text', 'rich'],
};
const COUNTS = ['sample', 'historyMessages', 'historyBytes', 'historyTokens', 'attempts'];
const ALLOWED = new Set(['metric', 'value', 'outcome', 'lowerBound', 'warmup', ...Object.keys(DIMENSIONS), ...COUNTS]);

export function validateSample(row) {
    if (!row || Object.keys(row).some(key => !ALLOWED.has(key)) || !METRICS.includes(row.metric)
        || !OUTCOMES.includes(row.outcome)) throw new Error('METRIC_SCHEMA_INVALID');
    const out = { metric: row.metric, value: row.value, outcome: row.outcome };
    if (row.value !== null && (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0)) throw new Error('METRIC_VALUE_INVALID');
    if (row.metric === 'repetition_3gram' && row.value !== null && row.value > 1) throw new Error('METRIC_VALUE_INVALID');
    if (row.outcome === 'timeout' && (row.lowerBound !== true || row.value === null)) throw new Error('METRIC_TIMEOUT_BOUND_REQUIRED');
    for (const [key, values] of Object.entries(DIMENSIONS)) {
        if (!values.includes(row[key])) throw new Error('METRIC_DIMENSION_INVALID');
        out[key] = row[key];
    }
    for (const key of COUNTS) {
        if (!Number.isSafeInteger(row[key]) || row[key] < 0 || (key === 'attempts' && row[key] < 1)) throw new Error('METRIC_COUNT_INVALID');
        out[key] = row[key];
    }
    out.lowerBound = row.lowerBound === true;
    out.warmup = row.warmup === true;
    return out;
}

// Nearest-rank quantiles, including the slowest observation for small n.
export function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

export function wilson(successes, total) {
    if (!total) return null;
    const z = 1.959963984540054, p = successes / total, denominator = 1 + z * z / total;
    const center = (p + z * z / (2 * total)) / denominator;
    const radius = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
    return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

function groupKey(row) {
    return [row.metric, row.historyMessages, row.cache, row.modelCache, row.network, row.surface, row.content].join('|');
}
function identity(row) { return `${row.variant}|${groupKey(row)}|${row.sample}`; }

export function summarizeSamples(input) {
    const groups = new Map(), seen = new Set();
    let warmup = 0;
    for (const raw of input) {
        const row = validateSample(raw);
        if (seen.has(identity(row))) throw new Error('METRIC_DUPLICATE_SAMPLE');
        seen.add(identity(row));
        if (row.warmup) { warmup++; continue; }
        const key = `${row.variant}|${groupKey(row)}`;
        if (!groups.has(key)) groups.set(key, { rows: [], dimensions: Object.fromEntries(['metric', 'historyMessages', ...Object.keys(DIMENSIONS)].map(k => [k, row[k]])) });
        groups.get(key).rows.push(row);
    }
    return { schemaVersion: 1, warmup, groups: [...groups.values()].map(({ rows, dimensions }) => {
        const outcomes = Object.fromEntries(OUTCOMES.map(key => [key, rows.filter(row => row.outcome === key).length]));
        const measured = rows.filter(row => row.value !== null && (row.outcome === 'ok' || FAILURES.has(row.outcome)));
        const successes = rows.filter(row => row.outcome === 'ok' && row.value !== null);
        const failures = rows.filter(row => FAILURES.has(row.outcome)).length;
        const denominator = rows.filter(row => !EXCLUDED.has(row.outcome)).length;
        return { ...dimensions, planned: rows.length, denominator, measured: measured.length, successes: successes.length,
            failures, attempts: rows.reduce((sum, row) => sum + row.attempts, 0), outcomes,
            // Inclusive quantiles retain censored timeout lower bounds. They are
            // explicitly lower bounds, alongside the success-only diagnostic.
            p50: percentile(measured.map(row => row.value), .5), p95: percentile(measured.map(row => row.value), .95),
            censored: measured.filter(row => row.lowerBound).length,
            successP50: percentile(successes.map(row => row.value), .5), successP95: percentile(successes.map(row => row.value), .95),
            failureRate: denominator ? failures / denominator : null, failureWilson95: wilson(failures, denominator),
        };
    }) };
}

// Fixed PRNG gives reproducible intervals. Resample pairs, never independent
// baseline/candidate populations, and leave missing/failed pairs visible.
export function pairedBootstrap(deltas, iterations = 2000) {
    if (!deltas.length) return null;
    let state = 20261106;
    const roll = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
    const means = [];
    for (let i = 0; i < iterations; i++) {
        let sum = 0;
        for (let j = 0; j < deltas.length; j++) sum += deltas[Math.floor(roll() * deltas.length)];
        means.push(sum / deltas.length);
    }
    return [percentile(means, .025), percentile(means, .975)];
}

export function compareSamples(baseline, candidate) {
    const rows = [...baseline, ...candidate].map(validateSample);
    const summary = summarizeSamples(rows), keys = new Set(rows.filter(row => !row.warmup).map(groupKey));
    return [...keys].map(key => {
        const before = rows.filter(row => !row.warmup && row.variant === 'baseline' && groupKey(row) === key);
        const after = rows.filter(row => !row.warmup && row.variant === 'candidate' && groupKey(row) === key);
        const deltas = [];
        for (const row of after) {
            const previous = before.find(item => item.sample === row.sample);
            if (previous?.outcome === 'ok' && row.outcome === 'ok' && !row.lowerBound && !previous.lowerBound
                && row.value !== null && previous.value !== null) deltas.push(row.value - previous.value);
        }
        const b = summary.groups.find(row => row.variant === 'baseline' && groupKey(row) === key);
        const c = summary.groups.find(row => row.variant === 'candidate' && groupKey(row) === key);
        const latencyRegression = Boolean(b?.p95 !== null && c?.p95 !== null && c?.metric?.endsWith('_ms')
            && c.p95 - b.p95 > 50 && c.p95 > b.p95 * 1.1);
        const errorsWorse = Boolean(b && c && (c.failureRate > b.failureRate || c.failures > b.failures));
        const leakage = after.some(row => ['scope_leaks', 'forgotten_leaks'].includes(row.metric) && row.value > 0);
        return { key, pairs: deltas.length, baselineN: before.length, candidateN: after.length,
            incompletePairs: Math.max(before.length, after.length) - deltas.length,
            baselineP95: b?.p95 ?? null, candidateP95: c?.p95 ?? null,
            pairedMeanDelta: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null,
            pairedMeanDelta95: pairedBootstrap(deltas), latencyRegression, errorsWorse, leakage,
            status: latencyRegression || errorsWorse || leakage ? 'FAIL' : deltas.length && deltas.length === before.length && deltas.length === after.length ? 'PASS' : 'INCOMPLETE',
        };
    });
}

export function comparisonMarkdown(summary, comparison = []) {
    const fmt = value => value === null ? 'NOT_RUN' : Number(value.toFixed(3));
    return ['# Chat / memory measurement', '', 'Durations are milliseconds; repetition is a ratio. Censored observations remain lower bounds. No p99 is inferred.', '',
        '| Metric / variant / history / page cache / model cache / surface | n / planned | p50 | p95 | failures | censored |',
        '| --- | --- | --- | --- | --- | --- |',
        ...summary.groups.map(row => `| ${row.metric} / ${row.variant} / ${row.historyMessages} / ${row.cache} / ${row.modelCache} / ${row.surface} | ${row.measured}/${row.planned} | ${fmt(row.p50)} | ${fmt(row.p95)} | ${row.failures}/${row.denominator} | ${row.censored} |`),
        '', '| Paired comparison | pairs | mean delta [95% bootstrap] | status |', '| --- | --- | --- | --- |',
        ...comparison.map(row => `| ${row.key} | ${row.pairs} | ${fmt(row.pairedMeanDelta)} ${row.pairedMeanDelta95 ? JSON.stringify(row.pairedMeanDelta95.map(fmt)) : 'NOT_RUN'} | ${row.status} |`), '',
    ].join('\n');
}

export function summarizeReplyQuality({ samples = [], dropped = 0, pending = 0 }) {
    const raw = samples.filter(row => row.rawFirstRules !== null);
    const final = samples.filter(row => row.finalRules !== null);
    const overlap = samples.filter(row => row.outcome === 'ok' && row.overlap !== null).map(row => row.overlap);
    const extra = samples.filter(row => row.rewriteCompleted && row.rewriteExtraMs !== null).map(row => row.rewriteExtraMs);
    const rates = (rows, field) => Object.fromEntries(REPLY_QUALITY_RULE_CODES.map(code => {
        const hard = rows.filter(row => row[field]?.hard?.includes(code)).length;
        const soft = rows.filter(row => row[field]?.soft?.includes(code)).length;
        return [code, { hard, soft, denominator: rows.length, hardRate: rows.length ? hard / rows.length : null, softRate: rows.length ? soft / rows.length : null }];
    }));
    const requested = raw.filter(row => row.rewriteRequested).length;
    return { planned: samples.length + pending + dropped, completed: samples.length, pending, dropped,
        status: raw.length ? 'active' : 'inactive', rawFirst: rates(raw, 'rawFirstRules'), final: rates(final, 'finalRules'),
        repetition: { n: overlap.length, p50: percentile(overlap, .5), p95: percentile(overlap, .95) },
        rewrite: { requested, completed: extra.length, denominator: raw.length,
            rate: raw.length ? requested / raw.length : null, extraP50Ms: percentile(extra, .5), extraP95Ms: percentile(extra, .95) },
    };
}
