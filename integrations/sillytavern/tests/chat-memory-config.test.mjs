import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, randomBytes } from 'node:crypto';
import { selectEvaluationProfiles, loadEvaluationConfiguration } from '../../../scripts/lib/chat-memory-config.mjs';

function catalog(cipher = 'unused') {
    return { bindings: ['FOREGROUND_CHAT', 'MEMORY_EXTRACTION_DEDUP_SUMMARY'].map(purpose => ({ purpose, providerId: 'synthetic-provider', profileKey: 'configured', revision: 3, state: 'ENABLED' })),
        profiles: [{ providerId: 'synthetic-provider', profileKey: 'configured', revision: 7, state: 'ENABLED', providerState: 'ENABLED',
            modelId: 'synthetic-model', protocol: 'OPENAI_CHAT_COMPLETIONS', contextWindowTokens: 1000000, maxOutputTokens: 393216,
            generationParams: { reasoningEffort: 'max' }, capabilities: {}, baseUrl: 'https://private-upstream.invalid/v1', credentialCipher: cipher, pricing: {} }] };
}
test('configured bindings are preserved and an unpriced shared judge is explicit', () => {
    assert.throws(() => selectEvaluationProfiles(catalog()), /CONFIG_NOT_READY/);
    assert.throws(() => selectEvaluationProfiles(catalog(), { mode: 'tokens' }), /CONFIG_NOT_READY/);
    const selected = selectEvaluationProfiles(catalog(), { mode: 'tokens', ownerTokenOnly: true });
    assert.equal(selected.routes.length, 1);
    assert.deepEqual(selected.assignments, { foreground: 0, extraction: 0, judge: 0 });
    assert.equal(selected.manifest.judgeSharesModel, true);
    assert.equal(selected.manifest.profiles[0].maxOutputTokens, 393216);
    assert.equal(selected.manifest.profiles[0].contextWindowTokens, 1000000);
    assert.doesNotMatch(JSON.stringify(selected.manifest), /private-upstream|credential|synthetic-provider/);
});
test('a differently configured priced judge wins without modifying tested bindings', () => {
    const input = catalog();
    input.profiles.push({ ...input.profiles[0], profileKey: 'judge', modelId: 'synthetic-judge',
        pricing: { currency: 'CNY', inputPerMillionTokens: 1, outputPerMillionTokens: 2 } });
    const result = selectEvaluationProfiles(input, { mode: 'tokens', ownerTokenOnly: true });
    assert.deepEqual(result.assignments, { foreground: 0, extraction: 0, judge: 1 });
    assert.equal(result.manifest.judgeSharesModel, false);
});
test('configuration reference decrypts in memory and never exports secrets in its manifest', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-cm-config-'));
    try {
        const key = randomBytes(32), iv = randomBytes(12), secret = 'synthetic-secret-not-an-output';
        const enc = createCipheriv('aes-256-gcm', key, iv);
        const cipher = 'enc2:default:1:' + Buffer.concat([iv, enc.update(secret), enc.final(), enc.getAuthTag()]).toString('base64');
        const secretFile = path.join(dir, 'runtime.env');
        await fs.writeFile(secretFile, `VC_CRYPTO_REST_KEY=${key.toString('base64')}\nVC_CRYPTO_REST_KEY_ID=default\nVC_CRYPTO_REST_KEY_VERSION=1\n`, { mode: 0o600 });
        const args = { ref: 'local-catalog', mode: 'tokens', ownerTokenOnly: true, localDirectory: dir, readCatalog: () => catalog(cipher) };
        const result = await loadEvaluationConfiguration(args);
        assert.equal(result.routes[0].credential, secret);
        assert.equal(JSON.stringify(result.manifest).includes(secret), false);
        const quotes = path.join(dir, 'quotes.json');
        await fs.writeFile(quotes, JSON.stringify([{ providerId: 'synthetic-provider', profileKey: 'configured',
            billableOutputCapIncludesReasoning: true, pricing: { currency: 'CNY', inputPerMillionTokens: 1, outputPerMillionTokens: 2,
                verifiedOn: '2026-11-07', otherFeesBounded: true } }]));
        const priced = await loadEvaluationConfiguration({ ...args, mode: 'cny', quoteFile: quotes });
        assert.equal(priced.routes[0].billableOutputCapIncludesReasoning, true);
        assert.equal(priced.routes[0].pricing.currency, 'CNY');
        await fs.chmod(secretFile, 0o644);
        await assert.rejects(() => loadEvaluationConfiguration(args), /CONFIG_NOT_READY/);
        await assert.rejects(() => loadEvaluationConfiguration({ ...args, ref: 'arbitrary-file' }), /CONFIG_NOT_READY/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
