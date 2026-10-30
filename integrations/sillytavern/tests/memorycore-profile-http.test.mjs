import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCoreServer } from '../memorycore-service/http.mjs';

test('published profile reads use the authenticated internal HTTP route', async t => {
    const token = 'synthetic-private-memorycore-token-32';
    const calls = [];
    const server = createMemoryCoreServer({ token, commit: 'fixture', engine: {
        ready: async () => true,
        invoke: async (action, input) => { calls.push({ action, input }); return { dependencies: ['source-1'], files: { 'persona.md': 'synthetic profile' } }; },
    } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const url = `http://127.0.0.1:${server.address().port}/internal/read-profile`;
    const result = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'op-profile', allowedRecordIds: ['record-1'] }) });
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).dependencies, ['source-1']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'read-profile');
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
});

test('profile verification keeps its closed code instead of a generic conflict', async t => {
    const token = 'synthetic-private-memorycore-token-32';
    const server = createMemoryCoreServer({ token, commit: 'fixture', engine: {
        ready: async () => true,
        invoke: async () => { throw new Error('MEMORYCORE_PROFILE_VERIFICATION'); },
    } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const result = await fetch(`http://127.0.0.1:${server.address().port}/internal/rebuild-profile`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
    });
    assert.equal(result.status, 422);
    assert.deepEqual(await result.json(), { code: 'MEMORYCORE_PROFILE_VERIFICATION' });
});
