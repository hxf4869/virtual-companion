import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CASE_CATEGORIES, CORE_SEED, FORGET_STAGES, HOLDOUT_SEED, forgetStageCase, generateChatMemoryDataset,
} from '../../../scripts/lib/chat-memory-dataset.mjs';
import {
    AI_FLAVOR_FIELDS, buildJudgePrompt, mapRecordToFacts, parseJudgeResult, scoreRules, summarizeChatMemoryEvaluation,
} from '../../../scripts/lib/chat-memory-scoring.mjs';

const dataset = generateChatMemoryDataset();
const { cases, facts, instances } = dataset;
const allMessages = instances.flatMap(instance => instance.sessions.flatMap(session => session.messages));
const byMessageId = new Map(allMessages.map(message => [message.id, message]));
const byFactId = new Map(facts.map(fact => [fact.factId, fact]));

function judgment(abstains = false, flagged = []) {
    return {
        correct: true, grounded: true, abstains, reasonCode: 'OK',
        aiFlavor: Object.fromEntries(AI_FLAVOR_FIELDS.map(field => [field, flagged.includes(field)])),
    };
}

test('CM-3 fixed seeds reproduce all bytes and keep the core shape', () => {
    assert.equal(dataset.seed, CORE_SEED);
    assert.equal(JSON.stringify(dataset), JSON.stringify(generateChatMemoryDataset({ seed: CORE_SEED })));
    const independent = generateChatMemoryDataset({ seed: HOLDOUT_SEED });
    assert.equal(JSON.stringify(independent), JSON.stringify(generateChatMemoryDataset({ seed: HOLDOUT_SEED })));
    assert.notEqual(dataset.hashes.facts, independent.hashes.facts);
    assert.notEqual(dataset.hashes.dialogue, independent.hashes.dialogue);
    assert.notEqual(dataset.hashes.dataset, independent.hashes.dataset);
    assert.deepEqual(CASE_CATEGORIES.map(category => cases.filter(testCase => testCase.category === category).length), Array(7).fill(20));

    assert.equal(dataset.owners.length, 2);
    for (const owner of dataset.owners) assert.equal(instances.filter(instance => instance.ownerId === owner.id).length, 2);
    assert.deepEqual(dataset.sourceCounts, { messages: 800, userTurns: 400, eligibleUserTurns: 300, ineligibleStoryUserTurns: 100 });
    assert.equal(allMessages.length, 800);
    assert.equal(byMessageId.size, 800);
    assert.equal(allMessages.filter(message => message.role === 'user').length, 400);
    for (const instance of instances) {
        assert.equal(instance.sessions.length, 10);
        for (const session of instance.sessions) {
            assert.equal(session.messages.length, 20);
            assert.ok(session.messages.every((message, index) => message.role === (index % 2 ? 'assistant' : 'user')));
        }
        const first = Date.parse(instance.sessions[0].messages[0].timestamp);
        const last = Date.parse(instance.sessions.at(-1).messages.at(-1).timestamp);
        assert.equal(Math.floor((last - first) / 86400000), 90);
    }
});

test('gold is scoped to user facts; synthetic isolation counterparts have unequal values', () => {
    for (const testCase of cases) {
        for (const id of testCase.goldFactIds) {
            const fact = byFactId.get(id);
            assert.equal(fact.scope.ownerId, testCase.ownerId);
            assert.equal(fact.scope.instanceId, testCase.instanceId);
            assert.equal(fact.scope.mode, 'COMPANION');
            assert.ok(fact.sourceTurnIds.length > 0 && fact.sourceTurnIds.every(id => byMessageId.get(id).role === 'user'));
            assert.ok(fact.sourceTurnIds.every(id => id.startsWith(`${testCase.instanceId}-`)));
        }
    }
    const isolated = cases.filter(testCase => testCase.category === 'isolation');
    assert.equal(isolated.filter(testCase => testCase.goldFactIds.length).length, 15);
    for (const testCase of isolated) {
        const gold = testCase.goldFactIds.map(id => byFactId.get(id));
        const forbidden = testCase.forbiddenFactIds.map(id => byFactId.get(id));
        const compared = [...gold, ...forbidden];
        assert.equal(compared.length, 4);
        assert.equal(new Set(compared.map(fact => fact.subject)).size, 1);
        assert.equal(new Set(compared.map(fact => fact.value)).size, 4);
        assert.equal(new Set(compared.map(fact => fact.scope.instanceId)).size, 4);
        assert.ok(!testCase.recentMessages.some(message => compared.some(fact => message.content.includes(fact.value))));
    }
    const assistantOnly = cases.filter(testCase => testCase.tags.includes('assistant-only'));
    assert.equal(assistantOnly.length, 4);
    for (const testCase of assistantOnly) {
        const [fact] = testCase.forbiddenFactIds.map(id => byFactId.get(id));
        assert.equal(testCase.goldFactIds.length, 0);
        assert.ok(fact.sourceTurnIds.every(id => byMessageId.get(id).role === 'assistant'));
    }
});

test('extraction-window gold belongs only to the final user confirmation', () => {
    const windowCases = cases.filter(testCase => testCase.tags.includes('extraction-window'));
    assert.equal(windowCases.length, 4);
    for (const testCase of windowCases) {
        assert.equal(testCase.category, 'single');
        assert.equal(testCase.goldFactIds.length, 1);
        const fact = byFactId.get(testCase.goldFactIds[0]);
        const instance = instances.find(item => item.id === testCase.instanceId);
        assert.equal(fact.contextSourceTurnIds.length, 2);
        assert.equal(fact.sourceTurnIds.length, 1);
        const [startId, clarificationId] = fact.contextSourceTurnIds;
        const [confirmationId] = fact.sourceTurnIds;
        const session = instance.sessions.find(item => item.messages.some(message => message.id === startId));
        const startIndex = session.messages.findIndex(message => message.id === startId);
        const turns = session.messages.slice(startIndex, startIndex + 3);
        assert.deepEqual(turns.map(message => message.id), [startId, clarificationId, confirmationId]);
        assert.deepEqual(turns.map(message => message.role), ['user', 'assistant', 'user']);
        assert.equal(fact.validFrom, turns[2].timestamp);
        assert.ok(turns[1].content.includes(fact.subject) && turns[1].content.includes(fact.value));
        assert.ok([turns[0], turns[2]].every(message => !message.content.includes(fact.subject) && !message.content.includes(fact.value)));
        assert.ok([testCase.query, ...testCase.recentMessages.map(message => message.content)].every(content => !content.includes(fact.value)));
        const extracted = { content: turns[1].content, instanceId: instance.id };
        assert.deepEqual(mapRecordToFacts({ ...extracted, sourceTurnIds: fact.contextSourceTurnIds }, facts).factIds, []);
        assert.deepEqual(mapRecordToFacts({ ...extracted, sourceTurnIds: fact.sourceTurnIds }, facts).factIds, [fact.factId]);
    }
});

test('M09 keeps the original query, paired rewrites and topic clarification', () => {
    const direct = cases.filter(testCase => testCase.tags.includes('M09-direct'));
    const rewrites = cases.filter(testCase => testCase.tags.includes('M09-rewrite'));
    assert.equal(direct.length, 2);
    assert.equal(rewrites.length, 2);
    for (const testCase of direct) assert.equal(testCase.query, '我们上次谈到哪一步了？');
    assert.deepEqual(direct[0].goldFactIds, rewrites[0].goldFactIds);
    assert.deepEqual(direct[1].goldFactIds, []);
    assert.equal(rewrites[1].goldFactIds.length, 2);
    for (const testCase of [...direct, ...rewrites]) {
        assert.equal(testCase.recentMessages.length, 4);
        assert.ok(testCase.goldFactIds.every(id => testCase.recentMessages.every(message => !message.content.includes(byFactId.get(id).value))));
    }
});

test('CM-12 truncation control excludes the early source IDs and gold values', () => {
    const longCases = cases.filter(testCase => testCase.tags.includes('long-session'));
    assert.ok(longCases.length > 0);
    for (const testCase of longCases) {
        const { totalMessages, windowMessages, recentMessages } = testCase.truncationControl;
        const instance = instances.find(item => item.id === testCase.instanceId);
        const history = instance.sessions.flatMap(session => session.messages);
        assert.equal(totalMessages, history.length);
        assert.equal(windowMessages, 32);
        assert.deepEqual(recentMessages, history.slice(-32));
        for (const id of testCase.goldFactIds) {
            const fact = byFactId.get(id);
            assert.ok(fact.sourceTurnIds.every(turn => history.slice(0, -32).some(message => message.id === turn)));
            assert.ok(recentMessages.every(message => !message.content.includes(fact.value)));
        }
    }
});

test('updates distinguish current and historical values, and forget has a before control', () => {
    const updates = cases.filter(testCase => testCase.category === 'update');
    assert.equal(updates.filter(testCase => testCase.tags.includes('natural-update')).length, 10);
    assert.equal(updates.filter(testCase => testCase.tags.includes('manual-correction')).length, 10);
    for (const testCase of updates) {
        const target = byFactId.get(testCase.goldFactIds[0]);
        assert.equal(Boolean(target.supersedes), testCase.tags.includes('current'));
        if (testCase.action) {
            const old = byFactId.get(testCase.action.targetFactId), current = byFactId.get(testCase.action.replacementFactId);
            assert.equal(current.kind, 'manual');
            assert.equal(current.supersedes, old.factId);
            assert.equal(old.validTo, current.validFrom);
            assert.ok(testCase.action.replacementContent.includes(current.value));
            assert.ok(current.sourceTurnIds.every(id => !byMessageId.get(id).content.includes(current.value)));
        }
    }
    for (const testCase of cases.filter(testCase => testCase.category === 'forget')) {
        const fact = byFactId.get(testCase.action.targetFactId);
        assert.deepEqual(testCase.action.stages, FORGET_STAGES);
        const before = forgetStageCase(dataset, testCase, 'before');
        assert.deepEqual(before.goldFactIds, [fact.factId]);
        assert.ok(Date.parse(before.askedAt) < Date.parse(fact.forgottenAt));
        for (const stage of FORGET_STAGES.slice(1)) {
            const after = forgetStageCase(dataset, testCase, stage);
            assert.deepEqual(after.goldFactIds, []);
            assert.deepEqual(after.forbiddenFactIds, [fact.factId]);
            assert.deepEqual(after.recentMessages, []);
        }
    }
});

test('fact mapping requires source and value and recognizes normalized dates and assistant pollution', () => {
    const timeCase = cases.find(testCase => testCase.tags.includes('local-midnight'));
    const fact = byFactId.get(timeCase.goldFactIds[0]);
    const [sourceId] = fact.sourceTurnIds;
    const content = `${fact.subject}完成盖章。`;
    assert.deepEqual(mapRecordToFacts({ sourceTurnIds: [sourceId], content, eventDate: fact.value }, facts),
        { factIds: [fact.factId], mappingUncertain: false });
    assert.deepEqual(mapRecordToFacts({ sourceTurnIds: [sourceId], content, eventDate: '2026-10-01' }, facts),
        { factIds: [], mappingUncertain: true });
    assert.deepEqual(mapRecordToFacts({ content, eventDate: fact.value }, facts), { factIds: [], mappingUncertain: true });
    assert.deepEqual(mapRecordToFacts({ sourceTurnIds: [sourceId], content, eventDate: fact.value, instanceId: 'instance-4' }, facts),
        { factIds: [], mappingUncertain: true });

    const assistant = facts.find(item => item.kind === 'assistant');
    const [assistantId] = assistant.sourceTurnIds;
    const pairedUserId = assistantId.replace(/-m(\d+)$/u, (_match, index) => `-m${Number(index) - 1}`);
    assert.deepEqual(mapRecordToFacts({ sourceTurnIds: [pairedUserId], content: byMessageId.get(assistantId).content }, facts),
        { factIds: [assistant.factId], mappingUncertain: false });
});

test('rules enforce exact values, necessary injection, and scope leak boundaries', () => {
    const midnight = cases.find(testCase => testCase.tags.includes('local-midnight'));
    assert.equal(midnight.expectedAnswer, '2026-09-30');
    assert.equal(scoreRules(midnight, { answer: '2026年9月30号', injectedFactIds: midnight.goldFactIds }).passed, true);
    assert.equal(scoreRules(midnight, { answer: '2026年10月1日', injectedFactIds: midnight.goldFactIds }).reasonCode, 'MISSING_REQUIRED_VALUE');
    assert.equal(scoreRules(midnight, { answer: midnight.expectedAnswer }).reasonCode, 'MISSING_INJECTION');
    assert.equal(scoreRules(midnight, { answer: midnight.expectedAnswer, requireInjection: false }).passed, true);

    const interval = cases.find(testCase => testCase.tags.includes('calendar-interval'));
    assert.equal(scoreRules(interval, { answer: '116天', injectedFactIds: interval.goldFactIds }).passed, false);
    assert.equal(scoreRules(interval, { answer: '十六天', injectedFactIds: interval.goldFactIds }).passed, true);
    const dst = cases.find(testCase => testCase.tags.includes('dst-fold'));
    assert.equal(scoreRules(dst, { answer: '一小时半', injectedFactIds: dst.goldFactIds }).passed, false);

    const isolation = cases.find(testCase => testCase.category === 'isolation' && testCase.goldFactIds.length);
    const [outside] = isolation.forbiddenFactIds.map(id => byFactId.get(id));
    const request = { answer: isolation.expectedAnswer, injectedFactIds: isolation.goldFactIds, forbiddenText: `还看到${outside.value}` };
    assert.equal(scoreRules(isolation, request).boundaryLeak, true);
    assert.equal(scoreRules(isolation, { ...request, forbiddenText: '', answer: outside.value }).answerLeak, true);
});

test('judge is blind to runtime metadata and rejects free-form output', () => {
    const testCase = cases.find(item => item.goldFactIds.length);
    const prompt = buildJudgePrompt({ ...testCase, variant: 'private-candidate' }, { answer: testCase.expectedAnswer, facts });
    assert.ok(prompt.includes(testCase.query));
    assert.ok(!prompt.includes('private-candidate'));
    const good = judgment();
    assert.deepEqual(parseJudgeResult(JSON.stringify(good)), good);
    for (const bad of [{ ...good, notes: 'leaked prose' }, { ...good, correct: 1 }, { ...good, reasonCode: 'extra' }]) {
        assert.throws(() => parseJudgeResult(bad), /CM3_INVALID_JUDGE_RESULT/);
    }
});

test('scoring retains planned failures and reports retrieval, style and forget stages separately', () => {
    const single = cases.find(testCase => testCase.category === 'single' && testCase.goldFactIds.length);
    const cross = cases.find(testCase => testCase.category === 'cross_session' && testCase.goldFactIds.length === 2);
    const forget = cases.find(testCase => testCase.category === 'forget');
    const abstain = cases.find(testCase => testCase.category === 'abstain' && !testCase.goldFactIds.length);
    const singlePass = scoreRules(single, { answer: single.expectedAnswer, injectedFactIds: single.goldFactIds });
    const crossFail = scoreRules(cross, { answer: cross.expectedAnswer, injectedFactIds: cross.goldFactIds.slice(0, 1) });
    const before = forgetStageCase(dataset, forget, 'before');
    const beforeRule = scoreRules(before, { answer: before.expectedAnswer, injectedFactIds: before.goldFactIds });
    const afterRule = scoreRules(forget, { answer: '不记得了。' });
    const evaluated = summarizeChatMemoryEvaluation(cases, [
        { caseId: single.id, status: 'COMPLETED', rule: singlePass, judge: judgment(false, ['customerService']),
            extractedFactIds: single.goldFactIds, legalCandidateFactIds: single.goldFactIds,
            retrievedFactIds: [single.goldFactIds], finalRankedFactIds: [single.goldFactIds], injectedFactIds: single.goldFactIds },
        { caseId: cross.id, status: 'COMPLETED', rule: crossFail, judge: judgment(),
            extractedFactIds: cross.goldFactIds.slice(0, 1), legalCandidateFactIds: cross.goldFactIds.slice(0, 1),
            retrievedFactIds: [cross.goldFactIds.slice(0, 1)], finalRankedFactIds: [cross.goldFactIds],
            injectedFactIds: cross.goldFactIds.slice(0, 1) },
        { caseId: abstain.id, status: 'BUDGET_STOP' },
        { caseId: forget.id, status: 'COMPLETED', forgetStages: {
            before: { status: 'COMPLETED', rule: beforeRule, judge: judgment() },
            begin: { status: 'COMPLETED', rule: afterRule, judge: judgment(true) },
            done: { status: 'COMPLETED', rule: afterRule, judge: judgment(true), cleanupStatus: 'PARTIAL' },
            restart: { status: 'NOT_READY' },
            late: { status: 'TIMEOUT' },
        } },
    ], { facts });
    assert.equal(evaluated.accuracy.denominator, 140);
    assert.equal(evaluated.accuracy.numerator, 1);
    assert.equal(evaluated.coverage.numerator, 3);
    assert.equal(evaluated.byCategory.cross_session.accuracy.denominator, 20);
    assert.equal(evaluated.byCategory.cross_session.accuracy.numerator, 0);
    assert.equal(evaluated.byCategory.abstain.statuses.BUDGET_STOP, 1);
    assert.equal(evaluated.retrieval.original[1].denominator, cases.filter(testCase => testCase.goldFactIds.length).length);
    assert.equal(evaluated.retrieval.original[1].sum, 1.5);
    assert.equal(evaluated.retrieval.originalConditional[1].macro, 1);
    assert.equal(evaluated.injection.lostAfterRetrieval.numerator, 1);
    assert.equal(evaluated.forgetStages.done.cleanupPartial, 1);
    assert.equal(evaluated.forgetStages.done.accuracy.numerator, 0);
    assert.equal(evaluated.forgetStages.late.coverage.denominator, 20);
    assert.equal(evaluated.boundary.zeroLeaks, false);
    assert.equal(evaluated.aiFlavor.customerService.numerator, 1);
});
