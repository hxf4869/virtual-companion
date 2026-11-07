import test from 'node:test';
import assert from 'node:assert/strict';
import { extractionRunner } from '../memorycore-service/memory-policy.mjs';
import { extractionPrimary, requireUserEvidence } from '../memorycore-service/extraction-window.mjs';
import { createNativeFactory } from '../memorycore-service/native-engine.mjs';

test('window prompt identifies current user and excludes assistant guesses without changing conflict calls', async () => {
    let sent;
    const runner = extractionRunner({ run: async params => { sent = params; return '[]'; } }, null, 'source-user');
    await runner.run({ taskId: 'l1-extraction', systemPrompt: 'base' });
    assert.match(sent.systemPrompt, /source-user/);
    assert.match(sent.systemPrompt, /助手的问题、建议、猜测和自述都不是用户事实/);
    assert.match(sent.systemPrompt, /source_message_ids/);
    await runner.run({ taskId: 'l1-conflict-detection', systemPrompt: 'conflict' });
    assert.equal(sent.systemPrompt, 'conflict');
});

test('each contextual fact must cite a real window user', () => {
    const messages = [{ id: 'old-user', role: 'user' }, { id: 'assistant', role: 'assistant' }, { id: 'current-user', role: 'user' }];
    const primary = extractionPrimary(messages, 'current-user');
    for (const sources of [undefined, [], ['assistant'], ['current-user', 'foreign']]) {
        assert.throws(() => requireUserEvidence({ source_message_ids: sources }, messages, primary), /PRIMARY_SOURCE/);
    }
    assert.deepEqual(requireUserEvidence({ source_message_ids: ['assistant', 'current-user'] }, messages, primary),
        { cited: ['assistant', 'current-user'], primarySourceId: 'current-user' });
    assert.deepEqual(requireUserEvidence({ source_message_ids: ['old-user'] }, messages, primary),
        { cited: ['old-user'], primarySourceId: 'old-user' });
    assert.throws(() => extractionPrimary(messages, 'old-user'), /PRIMARY_SOURCE/);
});

test('native extraction forwards the original role-bearing window and current-user prompt anchor', async () => {
    let seen, prompt;
    const native = await (await createNativeFactory({
        VectorStore: class { async init() {} getSpace() { return { rebuilding: true }; } },
        shouldExtractL1: () => true,
        async extractL1Memories(input) {
            seen = input.messages;
            await input.options.llmRunner.run({ taskId: 'l1-extraction', systemPrompt: 'base' });
            return { success: true, proposal: { records: [], targets: [] } };
        },
    }))('/synthetic-unused');
    const messages = [{ id: 'assistant', role: 'assistant', content: '每周三游泳？' }, { id: 'user', role: 'user', content: '对' }];
    await native.prepare({ messages, scope: {}, allowedRecordIds: [], primarySourceId: 'user',
        recordedAt: '2026-10-28T00:00:00Z', embedding: {}, runner: { run: async p => { prompt = p.systemPrompt; return '[]'; } } });
    assert.deepEqual(seen, messages);
    assert.match(prompt, /当前用户主来源 ID（数据）："user"/);
});

test('native prepare resolves identical relative terms using each cited user clock', async () => {
    let prompt, observed;
    const native = await (await createNativeFactory({
        VectorStore: class { async init() {} getSpace() { return { rebuilding: true }; } },
        shouldExtractL1: () => true,
        async extractL1Memories({ options }) {
            const memories = [
                { content: '明天买书。', source_message_ids: ['user-a', 'assistant'] },
                { content: '明天游泳。', source_message_ids: ['user-b'] },
            ];
            await options.llmRunner.run({ taskId: 'l1-extraction', systemPrompt: 'base' });
            observed = memories.map(memory => {
                const transformed = options.transformMemory(memory);
                return [transformed.content, transformed.metadata.eventDate, options.recordedAtForMemory(transformed)];
            });
            return { success: true, proposal: { records: [], targets: [] } };
        },
    }))('/synthetic-unused');
    const time = eventDate => ({ sourceExpression: '明天', normalizationStatus: 'normalized', eventDate });
    const a = { id: 'user-a', role: 'user', content: '明天买书', timestamp: '2026-11-04T12:00:00Z', sourceTime: time('2026-11-05') };
    const b = { id: 'user-b', role: 'user', content: '明天游泳', timestamp: '2026-11-06T12:00:00Z', sourceTime: time('2026-11-07') };
    await native.prepare({ messages: [a, { id: 'assistant', role: 'assistant', content: '是说买书？', sourceTime: time('2040-12-31') }, b],
        scope: {}, allowedRecordIds: [], primarySourceId: b.id, recordedAt: b.timestamp, embedding: {}, sourceTime: time('2099-12-31'),
        runner: { run: async p => { prompt = p.systemPrompt; return '[]'; } } });
    assert.deepEqual(observed, [
        ['2026-11-05买书。', '2026-11-05', a.timestamp],
        ['2026-11-07游泳。', '2026-11-07', b.timestamp],
    ]);
    assert.match(prompt, /"user-a".*2026-11-05.*"user-b".*2026-11-07/);
    assert.match(prompt, /助手和未引用的消息不提供时钟/);
    assert.doesNotMatch(prompt, /2040-12-31|2099-12-31/);
});
