import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOllamaEmbedding } from '../memorycore-service/embedding.mjs';
import { createCallbackRunner } from '../memorycore-service/llm-runner.mjs';

const snapshot = { provider: 'OLLAMA', endpoint: 'http://127.0.0.1:11438', model: 'qwen3-embedding:0.6b',
    artifactVersion: 'sha256:fixture', dimensions: 2, queryPreprocessingVersion: 'qwen3-retrieval-v1',
    documentPreprocessingVersion: 'identity-v1', normalization: 'l2', state: 'ENABLED', revision: 1, spaceId: 'space-1' };
test('embedding pins artifact, query preprocessing, dimensions and normalization', async () => {
    const inputs = [];
    const embedding = await createOllamaEmbedding(snapshot, { fetchImpl: async (url, init) => {
        if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: snapshot.model, digest: snapshot.artifactVersion }] });
        inputs.push(JSON.parse(init.body)); return Response.json({ embeddings: [[3, 4]] });
    } });
    assert.deepEqual([...await embedding.embed('你好')], [Math.fround(.6), Math.fround(.8)]);
    await embedding.embedQuery('我喜欢什么');
    assert.equal(inputs[0].input, '你好');
    assert.equal(inputs[1].input, 'Instruct: Given a question, retrieve relevant personal memories that answer the question.\nQuery: 我喜欢什么');
    assert.equal(embedding.spaceId, snapshot.spaceId);
    await assert.rejects(createOllamaEmbedding({ ...snapshot, endpoint: 'http://evil.test' }), /CONFIG/);
    await assert.rejects(createOllamaEmbedding(snapshot, { fetchImpl: async () => Response.json({ models: [] }) }), /ARTIFACT/);
    const wrong = await createOllamaEmbedding(snapshot, { verifyArtifact: false, fetchImpl: async () => Response.json({ embeddings: [[1]] }) });
    await assert.rejects(wrong.embed('x'), /DIMENSIONS/);
});
test('callback uses fixed destination and capability; tools stay in staging and every call is numbered', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-runner-'));
    const calls = [];
    try {
        const runner = createCallbackRunner({ baseURL: 'http://127.0.0.1:8095', token: 'x'.repeat(32), operationToken: 'capability',
            stage: 'l2-scene', stagingDir: dir, fetchImpl: async (url, init) => {
                calls.push({ url, body: JSON.parse(init.body) });
                return Response.json({ text: calls.length === 1 ? JSON.stringify({ tool: { name: 'write_to_file', path: 'scene_blocks/travel.md', content: 'synthetic' } }) : JSON.stringify({ text: 'done' }) });
            } });
        assert.equal(await runner.run({ prompt: 'input', systemPrompt: 'rules' }), 'done');
        assert.equal(await fs.readFile(path.join(dir, 'scene_blocks/travel.md'), 'utf8'), 'synthetic');
        assert.deepEqual(calls.map(x => x.body.callSequence), [1, 2]);
        assert.ok(calls.every(x => x.url === 'http://127.0.0.1:8095/api/v1/service/memorycore/llm'));
        assert.ok(calls.every(x => !Object.hasOwn(x.body, 'owner')));
        const bad = createCallbackRunner({ baseURL: 'http://127.0.0.1:8095', token: 'x'.repeat(32), operationToken: 'capability', stage: 'l2-scene', stagingDir: dir,
            fetchImpl: async () => Response.json({ text: JSON.stringify({ tool: { name: 'write_to_file', path: '../escape', content: 'no' } }) }) });
        await assert.rejects(bad.run({ prompt: 'x' }), /TOOL_PATH/);
        const timeout = createCallbackRunner({ baseURL: 'http://127.0.0.1:8095', token: 'x'.repeat(32), operationToken: 'capability', stage: 'l1-extraction',
            fetchImpl: async () => { throw new Error('secret request body'); } });
        await assert.rejects(timeout.run({ prompt: 'x' }), /^Error: MEMORYCORE_CALLBACK_FAILED$/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
