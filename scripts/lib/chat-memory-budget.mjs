// CM-2 evaluation ledger, separate from the product's monthly USD ledger.
// A hold is fsynced before the meter may send. UNKNOWN is never a zero charge.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const OWNER = 'vc-cm-budget-v1';
const MAX_MICRO_CNY = 100_000_000;
const REASONS = new Set(['TRANSPORT', 'MISSING_USAGE', 'ABORTED', 'TIMEOUT', 'HTTP_ERROR',
    'USAGE_INVALID', 'RESTART', 'SETTLEMENT_FAILED', 'CLOSED', 'OTHER']);
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const ceilDiv = (n, d) => (n + d - 1n) / d;

// Exact fixed-point parsing; an implicit binary-float currency conversion is
// not a quote. At most six decimal places, all amounts stored as micro-CNY.
function micros(value) {
    const text = String(value ?? '');
    if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error('CONFIG_NOT_READY');
    const [whole, fraction = ''] = text.split('.');
    const n = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CONFIG_NOT_READY');
    return n;
}

function priceSnapshot(profile) {
    const p = profile.pricing;
    if (!p || !['CNY', 'USD'].includes(p.currency) || !/^\d{4}-\d{2}-\d{2}$/.test(p.verifiedOn || '')
        || profile.billableOutputCapIncludesReasoning !== true || p.otherFeesBounded !== true) throw new Error('CONFIG_NOT_READY');
    const fx = p.currency === 'CNY' ? 1_000_000n : p.fxOwnerApproved === true ? micros(p.cnyPerUsdUpper) : null;
    if (fx === null || fx <= 0n) throw new Error('CONFIG_NOT_READY');
    const convert = value => Number(ceilDiv(micros(value) * fx, 1_000_000n));
    const input = convert(p.inputPerMillionTokens), output = convert(p.outputPerMillionTokens);
    const cached = p.cachedInputPerMillionTokens == null ? input : convert(p.cachedInputPerMillionTokens);
    const other = Number(micros(p.otherCnyPerRequest ?? '0'));
    if (![input, output, cached, other].every(value => integer(value)) || cached > input) throw new Error('CONFIG_NOT_READY');
    return { input, output, cached, other, verifiedOn: p.verifiedOn, currency: p.currency };
}

function freezeProfile(profile, mode) {
    if (!profile || typeof profile.modelId !== 'string' || !/^[\w./:@+-]{1,200}$/.test(profile.modelId)
        || !['OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES'].includes(profile.protocol)
        || !integer(profile.contextWindowTokens, 1) || !integer(profile.maxOutputTokens, 1)
        || profile.maxOutputTokens > profile.contextWindowTokens) throw new Error('CONFIG_NOT_READY');
    return { modelId: profile.modelId, protocol: profile.protocol,
        contextWindowTokens: profile.contextWindowTokens, maxOutputTokens: profile.maxOutputTokens,
        revision: integer(profile.revision) ? profile.revision : 0,
        bindingRevision: integer(profile.bindingRevision) ? profile.bindingRevision : 0,
        pricing: mode === 'cny' ? priceSnapshot(profile) : null };
}

function fee(price, input, output, cached = 0) {
    const numerator = BigInt(input - cached) * BigInt(price.input) + BigInt(cached) * BigInt(price.cached)
        + BigInt(output) * BigInt(price.output);
    const amount = ceilDiv(numerator, 1_000_000n) + BigInt(price.other);
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CONFIG_NOT_READY');
    return Number(amount);
}

async function persist(file, document) {
    const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    let handle;
    try {
        handle = await fs.open(temp, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(document) + '\n');
        await handle.sync(); await handle.close(); handle = null;
        await fs.rename(temp, file);
        const directory = await fs.open(path.dirname(file), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
    } catch {
        throw new Error('BUDGET_JOURNAL_FAILED');
    } finally {
        await handle?.close().catch(() => {});
        await fs.rm(temp, { force: true });
    }
}

async function lock(file) {
    const target = file + '.lock';
    async function acquire() {
        const handle = await fs.open(target, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ owner: OWNER, pid: process.pid }));
        await handle.close();
    }
    try { await acquire(); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Serialize stale-lock recovery too: two restarters must not both
        // unlink a lock that one of them has just acquired.
        let recovery;
        try { recovery = await fs.open(target + '.recover', 'wx', 0o600); }
        catch { throw new Error('BUDGET_LOCKED'); }
        try {
            const held = JSON.parse(await fs.readFile(target, 'utf8'));
            if (held.owner !== OWNER || !integer(held.pid, 1)) throw new Error('BUDGET_LOCKED');
            try { process.kill(held.pid, 0); throw new Error('BUDGET_LOCKED'); }
            catch (probe) { if (probe.code !== 'ESRCH') throw new Error('BUDGET_LOCKED'); }
            await fs.unlink(target);
            await acquire();
        } finally { await recovery.close(); await fs.unlink(target + '.recover'); }
    }
    return () => fs.unlink(target);
}

function validUsage(usage, call) {
    return integer(usage?.inputTokens) && integer(usage?.outputTokens) && integer(usage?.cachedInputTokens ?? 0)
        && (usage.cachedInputTokens ?? 0) <= usage.inputTokens && usage.inputTokens <= call.inputUpper && usage.outputTokens <= call.outputCap;
}

function validateJournal(ledger, config) {
    if (ledger.owner !== OWNER || ledger.schemaVersion !== 1 || JSON.stringify(ledger.config) !== JSON.stringify(config)
        || !Array.isArray(ledger.calls) || ledger.calls.length > config.maxCalls || !integer(ledger.denied)
        || typeof ledger.tripped !== 'boolean') throw new Error('BUDGET_SNAPSHOT_MISMATCH');
    for (let index = 0; index < ledger.calls.length; index++) {
        const call = ledger.calls[index], profile = config.profiles[call.route];
        if (call.id !== index + 1 || !integer(call.route) || !profile || !integer(call.outputCap, 1)
            || call.outputCap > profile.maxOutputTokens || call.inputUpper !== profile.contextWindowTokens
            || !['HELD', 'UNKNOWN', 'SETTLED', 'NOT_SENT'].includes(call.state)
            || call.upperMicroCny !== (config.mode === 'cny' ? fee(profile.pricing, call.inputUpper, call.outputCap) : 0)
            || (call.state === 'UNKNOWN' && !REASONS.has(call.reason))
            || (call.state === 'SETTLED' && (!validUsage(call.usage, call)
                || call.feeMicroCny !== (config.mode === 'cny' ? fee(profile.pricing, call.usage.inputTokens, call.usage.outputTokens, call.usage.cachedInputTokens ?? 0) : 0)))) {
            throw new Error('BUDGET_JOURNAL_INVALID');
        }
    }
}

export async function createRoundBudget({ file, round, profiles, mode = 'cny', capMicroCny = MAX_MICRO_CNY,
    maxCalls = 6000, ownerTokenOnly = false, requireExisting = false } = {}) {
    if (!['cny', 'tokens'].includes(mode) || (mode === 'tokens' && ownerTokenOnly !== true)
        || !/^round-[a-z0-9-]{1,80}$/.test(round || '') || !integer(maxCalls, 1) || maxCalls > 10000
        || !integer(capMicroCny, 1) || capMicroCny > MAX_MICRO_CNY
        || !Array.isArray(profiles) || !profiles.length || profiles.length > 8) throw new Error('CONFIG_NOT_READY');
    const config = { round, mode, capMicroCny: mode === 'cny' ? capMicroCny : null, maxCalls,
        profiles: profiles.map(profile => freezeProfile(profile, mode)) };
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    for (const target of [path.dirname(file), file, file + '.lock']) {
        try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('BUDGET_PATH_INVALID'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const release = await lock(file);
    let ledger;
    try {
        try {
            if ((await fs.stat(file)).size > 10 * 1024 * 1024) throw new Error('BUDGET_JOURNAL_INVALID');
            ledger = JSON.parse(await fs.readFile(file, 'utf8'));
        }
        catch (error) {
            if (error.code !== 'ENOENT') throw new Error('BUDGET_JOURNAL_INVALID');
            if (requireExisting) throw new Error('BUDGET_RESUME_MISSING');
            ledger = { owner: OWNER, schemaVersion: 1, config, denied: 0, tripped: false, calls: [] };
        }
        validateJournal(ledger, config);
        for (const call of ledger.calls) if (call.state === 'HELD') { call.state = 'UNKNOWN'; call.reason = 'RESTART'; }
        await persist(file, ledger);
    } catch (error) { await release(); throw error; }

    let closed = false, journalFailed = false, queue = Promise.resolve();
    let sealPromise, released = false;
    const transaction = action => {
        const next = queue.then(async () => {
            if (closed || journalFailed) throw new Error('BUDGET_CLOSED');
            return action();
        });
        queue = next.catch(() => {});
        return next;
    };
    const save = async () => {
        try { await persist(file, ledger); }
        catch (error) { journalFailed = true; throw error; }
    };
    const committed = () => ledger.calls.reduce((sum, call) => sum + (call.state === 'SETTLED' ? call.feeMicroCny
        : call.state === 'NOT_SENT' ? 0 : call.upperMicroCny), 0);
    const get = id => {
        if (!integer(id, 1) || !ledger.calls[id - 1] || ledger.calls[id - 1].id !== id) throw new Error('BUDGET_CALL_INVALID');
        return ledger.calls[id - 1];
    };
    const seal = () => {
        if (!sealPromise) sealPromise = (async () => {
            await queue;
            closed = true;
            for (const call of ledger.calls) if (call.state === 'HELD') { call.state = 'UNKNOWN'; call.reason = 'CLOSED'; }
            if (!journalFailed) await save();
        })();
        return sealPromise;
    };
    return {
        reserve: ({ route, outputCap }) => transaction(async () => {
            const profile = config.profiles[route];
            if (!integer(route) || !profile || !integer(outputCap, 1) || outputCap > profile.maxOutputTokens) throw new Error('CONFIG_NOT_READY');
            const inputUpper = profile.contextWindowTokens;
            const upperMicroCny = mode === 'cny' ? fee(profile.pricing, inputUpper, outputCap) : 0;
            if (ledger.tripped || ledger.calls.length >= maxCalls || (mode === 'cny' && committed() + upperMicroCny > capMicroCny)) {
                ledger.denied++; await save(); throw new Error('BUDGET_STOP');
            }
            const call = { id: ledger.calls.length + 1, route, state: 'HELD', inputUpper, outputCap, upperMicroCny };
            ledger.calls.push(call); await save();
            return { id: call.id };
        }),
        settle: (id, usage) => transaction(async () => {
            const call = get(id);
            if (call.state !== 'HELD') return false;
            const cached = usage?.cachedInputTokens ?? 0;
            if (!validUsage(usage, call)) {
                call.state = 'UNKNOWN'; call.reason = 'USAGE_INVALID'; ledger.tripped = true;
                await save(); throw new Error('BUDGET_USAGE_INVALID');
            }
            call.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: cached };
            call.feeMicroCny = mode === 'cny' ? fee(config.profiles[call.route].pricing, usage.inputTokens, usage.outputTokens, cached) : 0;
            call.state = 'SETTLED'; await save(); return true;
        }),
        unknown: (id, reason) => transaction(async () => {
            const call = get(id);
            if (call.state !== 'HELD') return false;
            call.state = 'UNKNOWN'; call.reason = REASONS.has(reason) ? reason : 'OTHER';
            await save(); return true;
        }),
        notSent: id => transaction(async () => {
            const call = get(id);
            if (call.state !== 'HELD') return false;
            call.state = 'NOT_SENT'; await save(); return true;
        }),
        snapshot() {
            const count = state => ledger.calls.filter(call => call.state === state).length;
            const settled = ledger.calls.filter(call => call.state === 'SETTLED');
            const uncertain = ledger.calls.filter(call => ['HELD', 'UNKNOWN'].includes(call.state));
            return { schemaVersion: 1, mode, capMicroCny: config.capMicroCny, calls: ledger.calls.length,
                settled: count('SETTLED'), unknown: count('UNKNOWN'), held: count('HELD'), notSent: count('NOT_SENT'), denied: ledger.denied,
                tripped: ledger.tripped || journalFailed, inputTokens: settled.reduce((n, call) => n + call.usage.inputTokens, 0),
                outputTokens: settled.reduce((n, call) => n + call.usage.outputTokens, 0),
                cachedInputTokens: settled.reduce((n, call) => n + call.usage.cachedInputTokens, 0),
                unknownInputUpper: uncertain.reduce((n, call) => n + call.inputUpper, 0),
                unknownOutputUpper: uncertain.reduce((n, call) => n + call.outputCap, 0),
                committedMicroCny: mode === 'cny' ? committed() : null,
                settledMicroCny: mode === 'cny' ? settled.reduce((n, call) => n + call.feeMicroCny, 0) : null,
                feeStatus: mode === 'cny' ? 'priced-upper-bound' : 'unpriced-owner-authorized',
                warning80: mode === 'cny' && committed() >= 80_000_000 };
        },
        seal,
        async close() { try { await seal(); } finally { if (!released) { released = true; await release(); } } },
    };
}
