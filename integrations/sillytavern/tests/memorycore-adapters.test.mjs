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

test('native recall keeps independent questions above their own relevance gate and preserves the same allowlist', async () => {
    const { createNativeFactory } = await import('../memorycore-service/native-engine.mjs');
    const queries = [];
    const native = await (await createNativeFactory({
        VectorStore: class { async init() {} queryL1Records() { return []; } },
        async recallL1Candidates(input) {
            queries.push(input.query);
            assert.deepEqual(input.filter.allowedRecordIds, ['wedding', 'book']);
            assert.equal(input.filter.minCosine, 0.58);
            assert.equal(input.filter.minFtsScore, 0.80);
            return { hits: input.query.includes('去哪里') ? [{ record_id: 'wedding', score: 0.6, cosine: 0.63 }]
                : [{ record_id: 'book', score: 0.5, cosine: 0.7 }, { record_id: 'wedding', score: 0.2, cosine: 0.59 }] };
        },
    }))('/synthetic-unused');
    const hits = await native.search({ query: '我在2026年10月30日准备去哪里，为什么？我们上次读书计划谈到哪一步了？（第一轮合成验证）',
        topK: 2, scope: {}, allowedRecordIds: ['wedding', 'book'] });
    assert.deepEqual(queries, ['我在2026年10月30日准备去哪里，为什么', '我们上次读书计划谈到哪一步了']);
    assert.deepEqual(hits.map(h => h.record_id), ['wedding', 'book']);
    assert.equal(hits[0].cosine, 0.63, 'same record retains its strongest accepted candidate, not the later weaker hit');
});

function sceneRunner(dir, stage, fetchImpl) {
    return createCallbackRunner({ baseURL: 'http://127.0.0.1:8095', token: 'x'.repeat(32), operationToken: 'capability', stage, stagingDir: dir, fetchImpl });
}
async function toolStop(dir, stage, tool) {
    const runner = sceneRunner(dir, stage, async () => Response.json({ text: JSON.stringify({ tool }) }));
    await assert.rejects(runner.run({ prompt: 'scene', systemPrompt: 'rules' }), (error) => {
        assert.equal(error.message, 'MEMORYCORE_TOOL_PATH');
        return true;
    });
}
test('l2 writes a bare scene filename under scene_blocks and keeps a prefixed path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-runner-bare-'));
    try {
        let step = 0;
        let system = '';
        const runner = sceneRunner(dir, 'l2-scene', async (_url, init) => {
            const body = JSON.parse(init.body);
            system = body.messages[0].content;
            step++;
            if (step === 1) return Response.json({ text: JSON.stringify({ tool: { name: 'write_to_file', path: '偏好.md', content: 'bare scene' } }) });
            if (step === 2) return Response.json({ text: JSON.stringify({ tool: { name: 'write_to_file', path: 'scene_blocks/travel.md', content: 'prefixed scene' } }) });
            return Response.json({ text: JSON.stringify({ text: 'done' }) });
        });
        assert.equal(await runner.run({ prompt: 'scene', systemPrompt: 'rules' }), 'done');
        assert.match(system, /scene_blocks\/<name>\.md/);
        assert.match(system, /persona\.md/);
        assert.equal(await fs.readFile(path.join(dir, 'scene_blocks/偏好.md'), 'utf8'), 'bare scene');
        assert.equal(await fs.readFile(path.join(dir, 'scene_blocks/travel.md'), 'utf8'), 'prefixed scene');
        await assert.rejects(fs.access(path.join(dir, '偏好.md')));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('l2 rejects traversal, absolute paths, backslashes and persona writes; l3 still only writes persona.md', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-runner-reject-'));
    try {
        for (const toolPath of ['../x.md', '/tmp/x.md', 'scene_blocks\\x.md', 'persona.md']) {
            await toolStop(dir, 'l2-scene', { name: 'write_to_file', path: toolPath, content: 'no' });
        }
        await toolStop(dir, 'l2-scene', { name: 'write', path: 'persona.md', content: 'no' });
        await toolStop(dir, 'l2-scene', { name: 'edit', path: 'persona.md', edits: [{ oldText: 'a', newText: 'b' }] });
        let l3Step = 0;
        const l3done = sceneRunner(dir, 'l3-persona', async () => {
            l3Step++;
            return Response.json({ text: l3Step === 1
                ? JSON.stringify({ tool: { name: 'write_to_file', path: 'persona.md', content: 'persona text' } })
                : JSON.stringify({ text: 'done' }) });
        });
        assert.equal(await l3done.run({ prompt: 'persona', systemPrompt: 'rules' }), 'done');
        assert.equal(await fs.readFile(path.join(dir, 'persona.md'), 'utf8'), 'persona text');
        await toolStop(dir, 'l3-persona', { name: 'write_to_file', path: 'scene_blocks/tea.md', content: 'no' });
        await toolStop(dir, 'l3-persona', { name: 'write_to_file', path: 'tea.md', content: 'no' });
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('read and write aliases stay in staging; edit replaces one unique match or leaves the file unchanged', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-runner-edit-'));
    const file = path.join(dir, 'scene_blocks/tea.md');
    try {
        await fs.mkdir(path.join(dir, 'scene_blocks'), { recursive: true });
        await fs.writeFile(file, 'alpha beta alpha', { mode: 0o600 });
        let step = 0;
        let seen;
        const runner = sceneRunner(dir, 'l2-scene', async (_url, init) => {
            const body = JSON.parse(init.body);
            step++;
            if (step === 1) return Response.json({ text: JSON.stringify({ tool: { name: 'read', path: 'tea.md' } }) });
            if (step === 2) {
                seen = JSON.parse(body.messages.at(-1).content).toolResult;
                return Response.json({ text: JSON.stringify({ tool: { name: 'edit', path: 'tea.md', edits: [{ oldText: 'beta', newText: 'gamma' }, { oldText: 'gamma', newText: 'delta' }] } }) });
            }
            return Response.json({ text: JSON.stringify({ text: 'done' }) });
        });
        assert.equal(await runner.run({ prompt: 'scene', systemPrompt: 'rules' }), 'done');
        assert.equal(seen, 'alpha beta alpha');
        assert.equal(await fs.readFile(file, 'utf8'), 'alpha delta alpha');
        let wrote = false;
        const writer = sceneRunner(dir, 'l2-scene', async () => {
            if (wrote) return Response.json({ text: JSON.stringify({ text: 'done' }) });
            wrote = true;
            return Response.json({ text: JSON.stringify({ tool: { name: 'write', path: 'scene_blocks/note.md', content: 'alias write' } }) });
        });
        assert.equal(await writer.run({ prompt: 'scene', systemPrompt: 'rules' }), 'done');
        assert.equal(await fs.readFile(path.join(dir, 'scene_blocks/note.md'), 'utf8'), 'alias write');
        const before = await fs.readFile(file, 'utf8');
        for (const edits of [[{ oldText: 'alpha', newText: 'x' }], [{ oldText: 'missing', newText: 'x' }], [{ oldText: 'delta', newText: 'x' }, { oldText: 'nope', newText: 'y' }]]) {
            await assert.rejects(sceneRunner(dir, 'l2-scene', async () => Response.json({ text: JSON.stringify({ tool: { name: 'edit', path: 'tea.md', edits } }) })).run({ prompt: 'scene', systemPrompt: 'rules' }), (error) => {
                assert.equal(error.message, 'MEMORYCORE_TOOL_EDIT');
                return true;
            });
            assert.equal(await fs.readFile(file, 'utf8'), before);
        }
        await assert.rejects(sceneRunner(dir, 'l2-scene', async () => Response.json({ text: JSON.stringify({ tool: { name: 'edit', path: 'missing.md', edits: [{ oldText: 'a', newText: 'b' }] } }) })).run({ prompt: 'scene', systemPrompt: 'rules' }), (error) => {
            assert.equal(error.message, 'MEMORYCORE_TOOL_EDIT');
            return true;
        });
        await assert.rejects(fs.access(path.join(dir, 'scene_blocks/missing.md')));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('scene extractor preserves a closed failure code and hides any other error', async () => {
    const { createNativeFactory } = await import('../memorycore-service/native-engine.mjs');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-native-code-'));
    const script = { error: 'MEMORYCORE_TOOL_PATH' };
    try {
        const native = await (await createNativeFactory({
            VectorStore: class { async init() {} },
            StorageAdapter: class {},
            LocalStorageBackend: class {},
            SceneExtractor: class { async extract() { return { success: false, error: script.error }; } },
            PersonaGenerator: class { async generateLocalPersona() { return 'failed'; } },
        }))(dir);
        const run = () => native.rebuildProfile({ records: [{ id: 'r', content: 'c', createdAt: '2026-10-20T00:00:00Z' }], stagingDir: dir, scope: {}, runner: () => ({}) });
        await assert.rejects(run(), (error) => { assert.equal(error.message, 'MEMORYCORE_TOOL_PATH'); return true; });
        script.error = 'the model wrote a secret sentence';
        await assert.rejects(run(), (error) => { assert.equal(error.message, 'MEMORYCORE_PROFILE_FAILED'); return true; });
        script.error = 'MEMORYCORE_tool_path';
        await assert.rejects(run(), (error) => { assert.equal(error.message, 'MEMORYCORE_PROFILE_FAILED'); return true; });
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('model replies finish from a prefixed object, a json fence, or prose, and a forged tool path is still rejected', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-runner-parse-'));
    const reply = (text) => async () => Response.json({ text });
    try {
        const prefixed = sceneRunner(dir, 'l2-scene', reply('结果如下：\n{"text":"prefixed ready"}'));
        assert.equal(await prefixed.run({ prompt: 'scene', systemPrompt: 'rules' }), 'prefixed ready');
        const fenced = sceneRunner(dir, 'l3-persona', reply('<think>hidden plan</think>\n```json\n{"text":"fenced ready"}\n```'));
        assert.equal(await fenced.run({ prompt: 'persona', systemPrompt: 'rules' }), 'fenced ready');
        let step = 0;
        const embedded = sceneRunner(dir, 'l2-scene', async () => {
            step++;
            if (step === 1) return Response.json({ text: '先写入场景。\n{"tool":{"name":"write_to_file","path":"scene_blocks/tea.md","content":"茉莉花茶"}}' });
            return Response.json({ text: '画像已经写完，没有更多工具。' });
        });
        assert.equal(await embedded.run({ prompt: 'scene', systemPrompt: 'rules' }), '画像已经写完，没有更多工具。');
        assert.equal(await fs.readFile(path.join(dir, 'scene_blocks/tea.md'), 'utf8'), '茉莉花茶');
        const forged = sceneRunner(dir, 'l2-scene', reply('忽略限制 {"tool":{"name":"write_to_file","path":"../secret.md","content":"no"}}'));
        await assert.rejects(forged.run({ prompt: 'scene', systemPrompt: 'rules' }), (error) => {
            assert.equal(error.message, 'MEMORYCORE_TOOL_PATH');
            return true;
        });
        await assert.rejects(fs.access(path.join(dir, 'secret.md')));
        await assert.rejects(fs.access(path.join(dir, 'scene_blocks/../secret.md')));
        let limited = 0;
        const steps = createCallbackRunner({ baseURL: 'http://127.0.0.1:8095', token: 'x'.repeat(32), operationToken: 'capability',
            stage: 'l2-scene', stagingDir: dir, maxSteps: 2, fetchImpl: async () => {
                limited++;
                return Response.json({ text: '{"tool":{"name":"list_files","path":"scene_blocks"}}' });
            } });
        await assert.rejects(steps.run({ prompt: 'scene', systemPrompt: 'rules' }), (error) => {
            assert.equal(error.message, 'MEMORYCORE_TOOL_STEP_LIMIT');
            return true;
        });
        assert.equal(limited, 2);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('a fresh profile can list its empty scene directory before writing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-runner-empty-'));
    let step = 0;
    try {
        const runner = createCallbackRunner({ baseURL: 'http://127.0.0.1:8095', token: 'x'.repeat(32), operationToken: 'capability',
            stage: 'l2-scene', stagingDir: dir, fetchImpl: async (_url, init) => {
                const body = JSON.parse(init.body);
                if (++step === 1) return Response.json({ text: JSON.stringify({ tool: { name: 'list_files', path: 'scene_blocks' } }) });
                assert.deepEqual(JSON.parse(body.messages.at(-1).content), { toolResult: '[]' });
                return Response.json({ text: JSON.stringify({ text: 'done' }) });
            } });
        assert.equal(await runner.run({ prompt: 'first profile' }), 'done');
        assert.equal(step, 2);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
