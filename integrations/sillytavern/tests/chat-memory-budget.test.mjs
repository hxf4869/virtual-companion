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
