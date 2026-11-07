import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChatOperations } from '../extension/vc-model-settings/desktop/standalone/chat-operations.js';

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const revision = '9007199254740997';
const orderRevision = '9007199254741001';
const metadataRevision = '9007199254741003';
const epoch = '9007199254741007';

function candidate(n, fields = {}) {
    const candidateId = id(n);
    return {
        candidateId, sourceRevision: revision, sourceGeneration: revision,
        data: { mes: 'synthetic', ...fields, extra: { ...fields.extra, vc_source: {
            id: candidateId, revision: 2, generation: 3, settled: true, sourceTimestamp: null, sourceTimezone: '',
        } } },
    };
}

function row(n, candidates = [candidate(n + 1000)], selected = 0) {
    const active = candidates[selected].data;
    const data = {
        vc_message_id: id(n), name: 'synthetic', mes: active.mes, extra: structuredClone(active.extra),
        swipes: candidates.map(c => c.data.mes), swipe_id: selected,
        swipe_info: candidates.map(({ data: { mes, variables, ...wrapper } }) => structuredClone(wrapper)),
    };
    for (const key of ['send_date', 'gen_started', 'gen_finished']) {
        if (Object.hasOwn(active, key)) data[key] = active[key];
    }
    if (candidates.some(c => Object.hasOwn(c.data, 'variables'))) {
        data.variables = candidates.map(c => Object.hasOwn(c.data, 'variables') ? structuredClone(c.data.variables) : null);
    }
    return { messageId: id(n), messageRevision: revision, position: '900719925474099' + n,
        view: 'full', selectedCandidateId: candidates[selected].candidateId, candidateCount: candidates.length, candidates, data };
}

function fixture(messages) {
    const chat = { chatId: id(800), branchRoot: id(801), kind: 'SINGLE', conversationId: null, relationshipId: null,
        characterRef: 'synthetic.png', groupRef: null, title: 'synthetic', messageCount: messages.length,
        updatedAt: '2026-11-07T00:00:00Z', chatRevision: revision, orderRevision, metadataRevision, authorityEpoch: epoch,
        header: { vc_f2: { id: id(800), revision }, vc_branch_root: id(801), extension: { preserved: true } },
        metadata: { variables: { count: 1, untouched: 'value' }, unknown: null } };
    return { base: { chat, messages }, next: structuredClone({ header: chat.header, metadata: chat.metadata, messages: messages.map(m => m.data) }) };
}

const present = value => ({ exists: true, value });
const absent = { exists: false };
const wire = (path, before, after) => ({ path, before, after });
const invalid = { code: 'CHAT_INVALID_OPERATION' };
const tooLarge = { code: 'CHAT_PAYLOAD_TOO_LARGE' };

test('unchanged canonical full message, projected null placeholder and protected client changes are no-ops', () => {
    const { base, next } = fixture([row(1, [candidate(11), candidate(12, { variables: null })])]);
    assert.deepEqual(buildChatOperations(base, next), { operations: [] });
    next.messages[0].extra.vc_source.revision = 55;
    next.messages[0].swipe_info[1].extra.vc_source.generation = 66;
    next.messages[0].swipe_info[1].extra.vc_source.settled = false;
    next.header.vc_f2 = null;
    next.metadata.vc_binding = { mode: 'STORY' };
    assert.deepEqual(buildChatOperations(base, next), { operations: [] });
});

test('shared and candidate changes use precise paths, including guarded whole state trees', () => {
    const message = row(1, [candidate(11, {
        extra: { left: 1, right: 2, stats: { stat_data: { hp: 3, armor: 5 } }, array: [1, null] },
        variables: { value: 1, untouched: true }, send_date: null, custom_null: null, custom_remove: 'present',
    }), candidate(12)]);
    const { base, next } = fixture([message]);
    const original = structuredClone(base);
    const edited = next.messages[0];
    edited.name = 'changed';
    edited.mes = 'top edit';
    edited.extra.left = 9;
    edited.extra.array.push(3);
    edited.extra.stats.stat_data.hp = 4;
    edited.extra.vc_source.id = id(99); // Canonical candidate identity is still in the wrapper.
    edited.variables[0].value = 7;
    edited.swipe_info[0].custom_add = null;
    delete edited.swipe_info[0].custom_remove;
    delete edited.send_date;
    const { operations } = buildChatOperations(base, next);
    assert.deepEqual(operations[0], {
        kind: 'edit', target: { messageId: id(1) }, preconditions: { baseRevision: revision },
        payload: { changes: [wire(['name'], present('synthetic'), present('changed'))] },
    });
    assert.deepEqual(operations[1], {
        kind: 'edit', target: { messageId: id(1), candidateId: id(11) }, preconditions: { baseRevision: revision },
        payload: { changes: operations[1].payload.changes },
    });
    assert.equal(operations.length, 2);
    assert.deepEqual(new Map(operations[1].payload.changes.map(change => [change.path.join('/'), change])), new Map([
        ['mes', wire(['mes'], present('synthetic'), present('top edit'))],
        ['extra/left', wire(['extra', 'left'], present(1), present(9))],
        ['extra/stats/stat_data', wire(['extra', 'stats', 'stat_data'], present({ hp: 3, armor: 5 }), present({ hp: 4, armor: 5 }))],
        ['extra/array', wire(['extra', 'array'], present([1, null]), present([1, null, 3]))],
        ['variables', wire(['variables'], present({ value: 1, untouched: true }), present({ value: 7, untouched: true }))],
        ['send_date', wire(['send_date'], present(null), absent)],
        ['custom_remove', wire(['custom_remove'], present('present'), absent)],
        ['custom_add', wire(['custom_add'], absent, present(null))],
    ]));
    assert.deepEqual(base, original);
});

test('ancestor changes retain protected source while removing ordinary extra keys', () => {
    const { base, next } = fixture([row(1, [candidate(11, { extra: { ordinary: 1, blocked: { vc_source: { opaque: true }, other: 2 } } })])]);
    next.messages[0].extra = null;
    const { operations } = buildChatOperations(base, next);
    assert.deepEqual(operations[0].payload.changes, [
        wire(['extra', 'ordinary'], present(1), absent),
        wire(['extra', 'blocked', 'other'], present(2), absent),
    ]);
});

test('a swipe-only edit and selected candidate switch use stable IDs and do not copy stale top-level time', () => {
    const { base, next } = fixture([row(1, [
        candidate(11, { send_date: '2026-11-07T00:00:00Z' }),
        candidate(12, { custom_wrapper: { data: null } }),
    ])]);
    const message = next.messages[0];
    message.swipe_id = 1;
    message.swipes[1] = 'mirror edit';
    const { operations } = buildChatOperations(base, next);
    assert.deepEqual(operations, [{
        kind: 'edit', target: { messageId: id(1), candidateId: id(12) }, preconditions: { baseRevision: revision },
        payload: { changes: [wire(['mes'], present('synthetic'), present('mirror edit'))] },
    }, {
        kind: 'selectSwipe', target: { messageId: id(1), candidateId: id(12) },
        preconditions: { messageRevision: revision, selectedCandidateId: id(11) }, payload: null,
    }]);
});

test('a protected change in the top projection does not suppress a real extra change in the wrapper', () => {
    const { base, next } = fixture([row(1, [candidate(11, { extra: { value: 1, other: 2 } })])]);
    const message = next.messages[0];
    message.extra.vc_source.settled = false;
    message.swipe_info[0].extra.value = 3;
    assert.deepEqual(buildChatOperations(base, next).operations, [{
        kind: 'edit', target: { messageId: id(1), candidateId: id(11) }, preconditions: { baseRevision: revision },
        payload: { changes: [wire(['extra', 'value'], present(1), present(3))] },
    }]);
});

test('same-size replacement adds a new ID and removes the previously selected ID with its replacement', () => {
    const { base, next } = fixture([row(1, [candidate(11), candidate(12)])]);
    const message = next.messages[0];
    message.swipes = ['synthetic', 'synthetic'];
    message.swipe_info = [message.swipe_info[1], { extra: { new: true }, new_wrapper: null }];
    message.swipe_id = 1;
    message.extra = { new: true, vc_f2: 'server-owned' };
    const uuid = () => id(13);
    const first = buildChatOperations(base, next, { uuid });
    assert.deepEqual(first.operations, [{
        kind: 'addSwipe', target: { messageId: id(1) }, preconditions: { messageRevision: revision },
        payload: { candidate: { candidateId: id(13), data: { mes: 'synthetic', extra: { new: true }, new_wrapper: null } } },
    }, {
        kind: 'removeSwipe', target: { messageId: id(1), candidateId: id(11) },
        preconditions: { messageRevision: revision, selectedCandidateId: id(11) }, payload: { replacementCandidateId: id(13) },
    }]);
    assert.deepEqual(buildChatOperations(base, next, { uuid: () => assert.fail('retry reused a different ID') }), first);
    assert.equal(message.swipe_info[1].extra.vc_source.id, id(13));
    assert.equal(message.extra.vc_source.id, id(13));
});

test('nonselected removal and add plus select share the observed revision and selection', () => {
    const { base, next } = fixture([row(1, [candidate(11), candidate(12)])]);
    const message = next.messages[0];
    message.swipe_info[1] = { gen_finished: null, extra: { vc_source: { id: null } } };
    message.swipes[1] = 'new swipe';
    message.swipe_id = 1;
    const { operations } = buildChatOperations(base, next, { uuid: () => id(13) });
    assert.deepEqual(operations, [{
        kind: 'addSwipe', target: { messageId: id(1) }, preconditions: { messageRevision: revision },
        payload: { candidate: { candidateId: id(13), data: { mes: 'new swipe', gen_finished: null, extra: {} } } },
    }, {
        kind: 'removeSwipe', target: { messageId: id(1), candidateId: id(12) },
        preconditions: { messageRevision: revision, selectedCandidateId: id(11) }, payload: { replacementCandidateId: null },
    }, {
        kind: 'selectSwipe', target: { messageId: id(1), candidateId: id(13) },
        preconditions: { messageRevision: revision, selectedCandidateId: id(11) }, payload: null,
    }]);
    assert.deepEqual(buildChatOperations(base, next, { uuid: () => assert.fail('retry reused a different ID') }).operations, operations);
});

test('metadata changes distinguish null, absent and whole variables in a single operation', () => {
    const { base, next } = fixture([]);
    next.title = 'renamed';
    next.header.extension.another = null;
    delete next.metadata.unknown;
    next.metadata.variables.count = 2;
    assert.deepEqual(buildChatOperations(base, next).operations, [{
        kind: 'metadata', target: {}, preconditions: { baseRevision: metadataRevision }, payload: { changes: [
            wire(['title'], present('synthetic'), present('renamed')),
            wire(['header', 'extension', 'another'], absent, present(null)),
            wire(['metadata', 'variables'], present({ count: 1, untouched: 'value' }), present({ count: 2, untouched: 'value' })),
            wire(['metadata', 'unknown'], present(null), absent),
        ] },
    }]);
});

test('append uses only clientMessageId for identity and sends consistent selected mirrors', () => {
    const { base, next } = fixture([row(1)]);
    next.messages.push({
        mes: 'selected current', name: 'synthetic', extra: { vc_source: { id: id(88), revision }, visible: true },
        send_date: null, swipes: ['first', 'old selected'], swipe_id: 1, vc_f2: { id: id(80) },
        swipe_info: [{ marker: 'nonselected', extra: { vc_source: { id: id(87) } } },
            { marker: null, extra: { stale: true }, send_date: 'stale' }],
        variables: [, null],
    });
    const first = buildChatOperations(base, next, { uuid: () => id(2) });
    assert.deepEqual(first.operations, [{
        kind: 'append', target: {}, preconditions: {}, payload: { messages: [{
            clientMessageId: id(2), data: {
                name: 'synthetic', mes: 'selected current', swipes: ['first', 'selected current'], swipe_id: 1,
                swipe_info: [{ marker: 'nonselected', extra: {} }, { marker: null, extra: { visible: true }, send_date: null }],
                extra: { visible: true }, variables: { 1: null },
            },
        }] },
    }]);
    assert.equal(next.messages[1].vc_message_id, id(2));
    assert.deepEqual(buildChatOperations(base, next, { uuid: () => assert.fail('retry reused a different ID') }), first);
});

test('delete and reorder use initial stable IDs, exact revisions and legal minimal intervals', () => {
    const { base, next } = fixture([row(1), row(2), row(3), row(4), row(5), row(6), row(7)]);
    next.messages = [next.messages[0], next.messages[2], next.messages[1], next.messages[5], next.messages[4], next.messages[6]];
    assert.deepEqual(buildChatOperations(base, next).operations, [{
        kind: 'delete', target: { messageId: id(4) }, preconditions: { messageRevision: revision }, payload: null,
    }, {
        kind: 'reorder', target: { firstMessageId: id(2), lastMessageId: id(3) },
        preconditions: { orderRevision }, payload: { messageIds: [id(3), id(2)] },
    }, {
        kind: 'reorder', target: { firstMessageId: id(5), lastMessageId: id(6) },
        preconditions: { orderRevision }, payload: { messageIds: [id(6), id(5)] },
    }]);
});

test('consecutive new messages share an initial anchor, with separate inserts and a tail append in one batch', () => {
    const { base, next } = fixture([row(1), row(2)]);
    const [first, second] = next.messages;
    const added = [{ mes: 'head A' }, { mes: 'head B' }, { mes: 'middle' }, { mes: 'tail' }];
    next.messages = [added[0], added[1], first, added[2], second, added[3]];
    let counter = 10;
    const result = buildChatOperations(base, next, { uuid: () => id(++counter) });
    const entry = (n, mes) => ({ clientMessageId: id(n), data: { mes, swipes: [mes], swipe_id: 0, swipe_info: [{}] } });
    assert.deepEqual(result.operations, [{
        kind: 'insert', target: { beforeMessageId: id(1) }, preconditions: { orderRevision },
        payload: { messages: [entry(11, 'head A'), entry(12, 'head B')] },
    }, {
        kind: 'insert', target: { beforeMessageId: id(2) }, preconditions: { orderRevision },
        payload: { messages: [entry(13, 'middle')] },
    }, {
        kind: 'append', target: {}, preconditions: {}, payload: { messages: [entry(14, 'tail')] },
    }]);
    assert.deepEqual(added.map(message => message.vc_message_id), [id(11), id(12), id(13), id(14)]);
    assert.deepEqual(buildChatOperations(base, next, { uuid: () => assert.fail('retry reused a different ID') }), result);
});

test('generation terminal commit rejects a batch containing insert and still permits a tail append', () => {
    const { base, next } = fixture([row(1)]);
    const options = { uuid: () => id(9), generation: { generationRunId: id(50), state: 'settled' } };
    next.messages.unshift({ mes: 'insert' });
    const before = structuredClone(next);
    assert.throws(() => buildChatOperations(base, next, options), invalid);
    assert.deepEqual(next, before);
    next.messages.reverse();
    assert.equal(buildChatOperations(base, next, options).operations[0].kind, 'append');
});

test('a legal reorder of existing messages runs before inserting at the anchor’s new position', () => {
    const { base, next } = fixture([row(1), row(2), row(3), row(4)]);
    const [first, second, third] = next.messages;
    next.messages = [third, { mes: 'insert' }, second, first];
    assert.deepEqual(buildChatOperations(base, next, { uuid: () => id(9) }).operations, [{
        kind: 'delete', target: { messageId: id(4) }, preconditions: { messageRevision: revision }, payload: null,
    }, {
        kind: 'reorder', target: { firstMessageId: id(1), lastMessageId: id(3) },
        preconditions: { orderRevision }, payload: { messageIds: [id(3), id(2), id(1)] },
    }, {
        kind: 'insert', target: { beforeMessageId: id(2) }, preconditions: { orderRevision },
        payload: { messages: [{ clientMessageId: id(9), data: { mes: 'insert', swipes: ['insert'], swipe_id: 0, swipe_info: [{}] } }] },
    }]);
});

test('a reorder spanning a delete rejects an entire batch including inserts', () => {
    const { base, next } = fixture([row(1), row(2), row(3)]);
    next.messages = [next.messages[2], { mes: 'insert here' }, next.messages[0]];
    const before = structuredClone(next);
    assert.throws(() => buildChatOperations(base, next, { uuid: () => id(9) }), invalid);
    assert.deepEqual(next, before);
});

test('candidate permutations and candidate insertion before an existing candidate reject the whole draft', () => {
    const { base, next } = fixture([row(1, [candidate(11), candidate(12)])]);
    const message = next.messages[0];
    message.swipe_info.reverse();
    assert.throws(() => buildChatOperations(base, next), invalid);
    message.swipe_info.reverse();
    message.swipe_info.unshift({ extra: {} });
    message.swipes.unshift('new');
    message.swipe_id = 1;
    const before = structuredClone(next);
    assert.throws(() => buildChatOperations(base, next, { uuid: () => id(13) }), invalid);
    assert.deepEqual(next, before);
});

test('count and UTF-8 request budgets reject atomically', () => {
    const { base, next } = fixture([]);
    let counter = 0;
    const uuid = () => id(++counter);
    next.messages = Array.from({ length: 101 }, () => ({ mes: 'new' }));
    assert.throws(() => buildChatOperations(base, next, { uuid }), invalid);
    assert.equal(next.messages.some(m => Object.hasOwn(m, 'vc_message_id')), false);
    const many = fixture(Array.from({ length: 101 }, (_, index) => row(index + 1)));
    many.next.messages = [];
    assert.throws(() => buildChatOperations(many.base, many.next), invalid);
    next.messages = [{ mes: 'new', extra: { unicode: '汉'.repeat(2_800_000) } }];
    assert.throws(() => buildChatOperations(base, next, { uuid }), tooLarge);
    assert.equal(Object.hasOwn(next.messages[0], 'vc_message_id'), false);
});

test('insert and append share message, command and UTF-8 request budgets', () => {
    const { base, next } = fixture([row(1)]);
    let counter = 1000;
    const uuid = () => id(++counter);
    const [anchor] = next.messages;
    const added = Array.from({ length: 101 }, () => ({ mes: 'new' }));
    next.messages = [...added.slice(0, 50), anchor, ...added.slice(50)];
    assert.throws(() => buildChatOperations(base, next, { uuid }), invalid);
    assert.equal(added.some(m => Object.hasOwn(m, 'vc_message_id')), false);
    next.messages.pop();
    assert.deepEqual(buildChatOperations(base, next, { uuid }).operations.map(op => op.payload.messages.length), [50, 50]);

    const many = fixture(Array.from({ length: 100 }, (_, index) => row(index + 1)));
    many.next.messages = [{ mes: 'head' }, many.next.messages[0], { mes: 'tail' }];
    const before = structuredClone(many.next);
    assert.throws(() => buildChatOperations(many.base, many.next, { uuid }), invalid);
    assert.deepEqual(many.next, before);

    const large = Array.from({ length: 18 }, () => ({ mes: '汉'.repeat(80_000) }));
    next.messages = [...large.slice(0, 9), anchor, ...large.slice(9)];
    assert.throws(() => buildChatOperations(base, next, { uuid }), tooLarge);
    assert.equal(large.some(m => Object.hasOwn(m, 'vc_message_id')), false);
});
