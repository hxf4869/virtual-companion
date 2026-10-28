import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstanceBinding, StaleBindingError } from '../extension/vc-model-settings/instance-binding.js';

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const source = (chatIdentity, relationshipId = null) => ({
    chatIdentity, characterRef: 'card-one', mode: 'COMPANION', relationshipId, displayName: '澄夏',
});
const body = (chatIdentity) => ({
    chatIdentity, characterRef: 'card-one', mode: 'COMPANION',
    relationshipId: '9007199254740993', conversationId: '9007199254740995',
});

test('同快照合并在途请求，原样返回真实 body；完成后不缓存结果', async () => {
    const current = source('chat-one');
    const response = body('chat-one');
    const gate = deferred();
    let calls = 0;
    const bindings = createInstanceBinding({
        getSource: () => current,
        resolveBinding: () => { calls++; return calls === 1 ? gate.promise : Promise.resolve(response); },
    });
    assert.equal(calls, 0, '构造控制器不能自动发请求');
    const first = bindings.ensure(current);
    const same = bindings.ensure({ ...current });
    assert.strictEqual(first, same);
    await Promise.resolve();
    assert.equal(calls, 1);
    gate.resolve(response);
    assert.strictEqual(await first, response);
    assert.strictEqual(await same, response);
    assert.equal(response.relationshipId, '9007199254740993');
    assert.strictEqual(await bindings.ensure(current), response);
    assert.equal(calls, 2, '下一次调用仍由服务端幂等解析');
});

test('聊天切换后的迟到成功或错误均拒绝为 StaleBindingError', async () => {
    for (const reject of [false, true]) {
        let current = source('chat-old');
        const gate = deferred();
        const bindings = createInstanceBinding({ getSource: () => current, resolveBinding: () => gate.promise });
        const pending = bindings.ensure(current);
        current = source('chat-new');
        const check = assert.rejects(pending, (error) => error instanceof StaleBindingError && error.name === 'StaleBindingError');
        if (reject) gate.reject(new Error('旧请求失败'));
        else gate.resolve(body('chat-old'));
        await check;
    }
});

test('不同 chat 独立请求，快照不受调用方后续修改影响，显式关系 ID 原样传递', async () => {
    const a = source('chat-a');
    const b = source('chat-b', '9007199254740993');
    let current = a;
    const sent = [];
    const aGate = deferred(), bGate = deferred();
    const bindings = createInstanceBinding({
        getSource: () => current,
        resolveBinding: (snapshot) => {
            sent.push(snapshot);
            return snapshot.chatIdentity === 'chat-a' ? aGate.promise : bGate.promise;
        },
    });
    const aPending = bindings.ensure(a);
    current = b;
    const bPending = bindings.ensure(b);
    assert.notStrictEqual(aPending, bPending);
    b.relationshipId = '7';
    await Promise.resolve();
    assert.equal(sent.length, 2);
    assert.equal(sent[0].relationshipId, null);
    assert.equal(sent[1].relationshipId, '9007199254740993');
    bGate.resolve(body('chat-b'));
    assert.equal((await bPending).chatIdentity, 'chat-b');
    current = a;
    aGate.resolve(body('chat-a'));
    assert.equal((await aPending).chatIdentity, 'chat-a');
});
