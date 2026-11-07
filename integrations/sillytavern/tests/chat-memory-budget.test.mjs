import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRoundBudget } from '../../../scripts/lib/chat-memory-budget.mjs';

const profile = { modelId: 'synthetic-model', protocol: 'OPENAI_CHAT_COMPLETIONS', contextWindowTokens: 10, maxOutputTokens: 5,
    billableOutputCapIncludesReasoning: true,
    pricing: { currency: 'CNY', inputPerMillionTokens: '1', outputPerMillionTokens: '2', verifiedOn: '2026-11-07', otherFeesBounded: true } };
async function fixture(run) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-cm-budget-'));
    const config = { file: path.join(dir, 'budget.json'), round: 'round-test', profiles: [profile], capMicroCny: 60, maxCalls: 100 };
    try { await run(config); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('concurrent holds are durable before admission; committed upper never exceeds cap', async () => fixture(async config => {
    const budget = await createRoundBudget(config);
    try {
        const results = await Promise.allSettled(Array.from({ length: 100 }, () => budget.reserve({ route: 0, outputCap: 5 })));
        const holds = results.filter(row => row.status === 'fulfilled').map(row => row.value);
        assert.equal(holds.length, 3); assert.equal(budget.snapshot().denied, 97);
        assert.equal(budget.snapshot().committedMicroCny, 60);
        const saved = JSON.parse(await fs.readFile(config.file, 'utf8'));
        assert.equal(saved.calls.filter(row => row.state === 'HELD').length, 3);
        assert.equal((await fs.stat(config.file)).mode & 0o777, 0o600);
        for (const hold of holds) await budget.settle(hold.id, { inputTokens: 1, outputTokens: 1 });
        assert.equal(budget.snapshot().settledMicroCny, 9);
        const retry = await budget.reserve({ route: 0, outputCap: 5 });
        assert.equal(retry.id, 4); assert.equal(budget.snapshot().committedMicroCny, 29);
    } finally { await budget.close(); }
}));

test('unknown usage is never released by retry, repeated settlement or not-sent cancellation', async () => fixture(async config => {
    let budget = await createRoundBudget(config);
    const first = await budget.reserve({ route: 0, outputCap: 5 });
    await budget.unknown(first.id, 'MISSING_USAGE');
    assert.equal(await budget.notSent(first.id), false);
    assert.equal(await budget.settle(first.id, { inputTokens: 0, outputTokens: 0 }), false);
    const second = await budget.reserve({ route: 0, outputCap: 5 });
    await budget.close();
    budget = await createRoundBudget(config);
    try {
        assert.equal(budget.snapshot().unknown, 2); assert.equal(budget.snapshot().committedMicroCny, 40);
        const third = await budget.reserve({ route: 0, outputCap: 5 });
        assert.equal(third.id, second.id + 1);
        await assert.rejects(() => budget.reserve({ route: 0, outputCap: 5 }), /BUDGET_STOP/);
        await budget.notSent(third.id);
        assert.equal(budget.snapshot().committedMicroCny, 40);
    } finally { await budget.close(); }
}));

test('process crash recovers in-flight reservation as UNKNOWN without resetting the round', async () => fixture(async config => {
    const module = new URL('../../../scripts/lib/chat-memory-budget.mjs', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import {createRoundBudget} from ${JSON.stringify(module)}; const budget=await createRoundBudget(${JSON.stringify(config)}); await budget.reserve({route:0,outputCap:5}); process.exit(0);`], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const budget = await createRoundBudget(config);
    try {
        assert.equal(budget.snapshot().unknown, 1); assert.equal(budget.snapshot().committedMicroCny, 20);
        assert.equal(JSON.parse(await fs.readFile(config.file, 'utf8')).calls[0].reason, 'RESTART');
        await assert.rejects(() => createRoundBudget(config), /BUDGET_LOCKED/);
    } finally { await budget.close(); }
    await assert.rejects(() => createRoundBudget({ ...config, capMicroCny: 100 }), /SNAPSHOT_MISMATCH/);
}));

test('missing quote, exchange-rate approval or billable output bound fails closed; token mode is explicit', async () => fixture(async config => {
    for (const changed of [
        { ...profile, pricing: {} }, { ...profile, billableOutputCapIncludesReasoning: false },
        { ...profile, pricing: { ...profile.pricing, currency: 'USD', cnyPerUsdUpper: '7.5' } },
        { ...profile, pricing: { ...profile.pricing, otherFeesBounded: false } },
    ]) await assert.rejects(() => createRoundBudget({ ...config, profiles: [changed] }), /CONFIG_NOT_READY/);
    await assert.rejects(() => createRoundBudget({ ...config, mode: 'tokens' }), /CONFIG_NOT_READY/);
    const budget = await createRoundBudget({ ...config, mode: 'tokens', ownerTokenOnly: true, profiles: [{ ...profile, pricing: {} }] });
    try {
        const held = await budget.reserve({ route: 0, outputCap: 5 });
        await budget.settle(held.id, { inputTokens: 4, outputTokens: 3, cachedInputTokens: 2 });
        assert.equal(budget.snapshot().inputTokens, 4); assert.equal(budget.snapshot().outputTokens, 3);
        assert.equal(budget.snapshot().committedMicroCny, null); assert.equal(budget.snapshot().settledMicroCny, null);
        assert.equal(budget.snapshot().feeStatus, 'unpriced-owner-authorized');
    } finally { await budget.close(); }
}));

test('integer micro-CNY rounding uses an approved FX upper and cached subset', async () => fixture(async config => {
    const priced = { ...profile, pricing: { ...profile.pricing, currency: 'USD', inputPerMillionTokens: '0.1',
        outputPerMillionTokens: '0.2', cachedInputPerMillionTokens: '0.01', fxOwnerApproved: true, cnyPerUsdUpper: '7.5' } };
    const budget = await createRoundBudget({ ...config, profiles: [priced] });
    try {
        const held = await budget.reserve({ route: 0, outputCap: 5 });
        assert.equal(budget.snapshot().committedMicroCny, 15);
        await budget.settle(held.id, { inputTokens: 2, outputTokens: 1, cachedInputTokens: 1 });
        assert.equal(budget.snapshot().settledMicroCny, 3); // ceil(.75 + .075 + 1.5)
    } finally { await budget.close(); }
}));

test('invalid usage trips future admissions and preserves full bound; corrupt journals cannot reopen', async () => fixture(async config => {
    const budget = await createRoundBudget(config);
    const held = await budget.reserve({ route: 0, outputCap: 5 });
    await assert.rejects(() => budget.settle(held.id, { inputTokens: 10, outputTokens: 6 }), /USAGE_INVALID/);
    await assert.rejects(() => budget.reserve({ route: 0, outputCap: 5 }), /BUDGET_STOP/);
    assert.equal(budget.snapshot().unknown, 1); assert.equal(budget.snapshot().committedMicroCny, 20);
    await budget.close();
    const raw = JSON.parse(await fs.readFile(config.file, 'utf8')); raw.calls[0].upperMicroCny = 0;
    await fs.writeFile(config.file, JSON.stringify(raw));
    await assert.rejects(() => createRoundBudget(config), /JOURNAL_INVALID/);
}));

test('sealing preserves the round lock through final artifact writes; missing resume never resets a journal', async () => fixture(async config => {
    await assert.rejects(() => createRoundBudget({ ...config, requireExisting: true }), /RESUME_MISSING/);
    const budget = await createRoundBudget(config);
    await budget.reserve({ route: 0, outputCap: 5 });
    await budget.seal();
    assert.equal(budget.snapshot().unknown, 1);
    await assert.rejects(() => budget.reserve({ route: 0, outputCap: 5 }), /BUDGET_CLOSED/);
    await assert.rejects(() => createRoundBudget(config), /BUDGET_LOCKED/);
    await budget.close();
    const resumed = await createRoundBudget({ ...config, requireExisting: true });
    assert.equal(resumed.snapshot().committedMicroCny, 20);
    await resumed.close();
}));


function tokenOptions(config, extra = {}) {
    const profiles = [{ ...profile, contextWindowTokens: 1_000_000, maxOutputTokens: 1000, pricing: undefined }];
    const recipe = { datasetVersion: 'fixture-v1', sourceCount: 400, cases: 140 };
    const tokenReference = { schemaVersion: 1,
        source: { round: 'round-historical', attempt: 2, firstCallId: 1001, lastCallId: 1011, flowComplete: true },
        profiles, recipe, usage: { inputTokens: 600, outputTokens: 400, settledCalls: 10, unknownCalls: 1 } };
    return { ...config, mode: 'tokens', ownerTokenOnly: true, maxCalls: 100, profiles, recipe, tokenReference, ...extra };
}

test('token anomaly persists every concurrent settlement, freezes 2x reference, then denies all admissions', async () => fixture(async config => {
    const options = tokenOptions(config);
    const budget = await createRoundBudget(options);
    try {
        assert.equal(budget.snapshot().tokenGuard.thresholdTokens, 2200);
        const holds = await Promise.all(Array.from({ length: 23 }, () => budget.reserve({ route: 0, outputCap: 1000 })));
        await Promise.all(holds.map(({ id }) => budget.settle(id, { inputTokens: 60, outputTokens: 40 })));
        assert.equal(budget.signal.aborted, true);
        assert.equal(budget.signal.reason.message, 'BUDGET_TOKEN_ANOMALY');
        const saved = JSON.parse(await fs.readFile(config.file, 'utf8'));
        assert.equal(saved.calls.filter(row => row.state === 'SETTLED').length, 23);
        assert.equal(saved.tripped, true);
        assert.equal(budget.snapshot().tokenUsage.knownTokens, 2300);
        assert.equal(budget.snapshot().tokenGuard.referenceEstimatedTokens, 1100);
        await assert.rejects(budget.reserve({ route: 0, outputCap: 1000 }), /BUDGET_TOKEN_ANOMALY/);
    } finally { await budget.close(); }
    const resumed = await createRoundBudget({ ...options, requireExisting: true });
    try {
        assert.equal(resumed.signal.aborted, true);
        assert.equal(resumed.snapshot().calls, 23);
        await assert.rejects(resumed.reserve({ route: 0, outputCap: 1000 }), /BUDGET_TOKEN_ANOMALY/);
    } finally { await resumed.close(); }
}));

test('UNKNOWN has separate estimate and bounds; context ceiling is never actual token usage', async () => fixture(async config => {
    const budget = await createRoundBudget(tokenOptions(config));
    try {
        for (let i = 0; i < 20; i++) {
            const { id } = await budget.reserve({ route: 0, outputCap: 1000 });
            await budget.unknown(id, 'HTTP_ERROR');
        }
        const usage = budget.snapshot().tokenUsage;
        assert.equal(usage.knownTokens, 0); assert.equal(usage.actualTokens, null);
        assert.equal(usage.lowerBoundTokens, 0); assert.equal(usage.upperBoundTokens, 20_020_000);
        assert.equal(usage.unknownEstimatedTokens, 2000); assert.equal(usage.estimatedTokens, 2000);
        assert.equal(budget.signal.aborted, false);
        const { id } = await budget.reserve({ route: 0, outputCap: 1000 });
        await budget.settle(id, { inputTokens: 300, outputTokens: 1 });
        assert.equal(budget.signal.aborted, true);
        assert.equal(budget.snapshot().tokenGuard.tripBasis, 'estimated-with-unknown');
    } finally { await budget.close(); }
}));

test('reference rejects different model or recipe and cannot be raised on resume', async () => fixture(async config => {
    const options = tokenOptions(config);
    await assert.rejects(createRoundBudget({ ...options, profiles: [{ ...options.profiles[0], modelId: 'different' }] }), /TOKEN_REFERENCE_MISMATCH/);
    await assert.rejects(createRoundBudget({ ...options, recipe: { ...options.recipe, cases: 7 } }), /TOKEN_REFERENCE_MISMATCH/);
    const budget = await createRoundBudget(options); await budget.close();
    await assert.rejects(createRoundBudget({ ...options, tokenReference: { ...options.tokenReference,
        usage: { ...options.tokenReference.usage, inputTokens: 6000 } } }), /SNAPSHOT_MISMATCH/);
}));

test('adding a token guard to a legacy token ledger preserves all usage and keeps it frozen', async () => fixture(async config => {
    const options = tokenOptions(config);
    const { tokenReference, recipe, ...legacyOptions } = options;
    const legacy = await createRoundBudget(legacyOptions);
    const { id } = await legacy.reserve({ route: 0, outputCap: 1000 });
    await legacy.settle(id, { inputTokens: 600, outputTokens: 400 });
    await legacy.close();
    const before = JSON.parse(await fs.readFile(config.file, 'utf8')).calls;
    const resumed = await createRoundBudget({ ...options, requireExisting: true });
    try {
        assert.deepEqual(JSON.parse(await fs.readFile(config.file, 'utf8')).calls, before);
        assert.equal(resumed.snapshot().tokenUsage.knownTokens, 1000);
        assert.equal(resumed.snapshot().tokenGuard.thresholdTokens, 2200);
        assert.equal((await resumed.reserve({ route: 0, outputCap: 1000 })).id, 2);
    } finally { await resumed.close(); }
    await assert.rejects(createRoundBudget(legacyOptions), /SNAPSHOT_MISMATCH/);
}));
