// W14-T4：剧情五个写接口的浏览器客户端。假 fetch，不启服务。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../extension/vc-model-settings/api.js';
import {
    commitStoryAction,
    confirmStoryProjection,
    decideStoryEpilogue,
    mapStoryParticipant,
    rewindStory,
} from '../extension/vc-model-settings/story-action.js';

const realFetch = globalThis.fetch;
const realDocument = globalThis.document;
let calls;

test.beforeEach(async () => {
    calls = [];
    globalThis.document = { cookie: 'vc_csrf=go-token' };
    api.setStHeadersProvider(() => ({ 'X-CSRF-Token': 'st-token' }));
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers, body: init.body, credentials: init.credentials });
        if (String(url).endsWith('/auth/session')) {
            return new Response(JSON.stringify({ accountId: '11', sessionId: '42' }), { status: 200 });
        }
        if (String(url).endsWith('/actions') && init.body?.includes('"expectedWorldVersion":1')) {
            return new Response(JSON.stringify({ code: 'REVISION_CONFLICT', message: 'story world conflict PRIVATE_LIN_LOAN_31' }), { status: 409 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    await api.captureSessionContext();
    calls = [];
});

test.after(() => {
    globalThis.fetch = realFetch;
    globalThis.document = realDocument;
});

test('提交行动只带有值字段，并带上会话头', async () => {
    await commitStoryAction({
        runId: '11', branchId: '13', expectedWorldVersion: 0, actionId: 'a1', actorId: 'player', action: 'request_evidence', target: 'lin',
    });
    const call = calls.at(-1);
    assert.equal(call.method, 'POST');
    assert.equal(call.url, `${api.BRIDGE_PREFIX}/api/v1/story/runs/11/actions`);
    assert.deepEqual(JSON.parse(call.body), {
        branchId: '13', expectedWorldVersion: 0, actionId: 'a1', actorId: 'player', action: 'request_evidence', target: 'lin',
    });
    assert.equal(call.credentials, 'same-origin');
    assert.equal(call.headers['X-CSRF-Token'], 'st-token');
    assert.equal(call.headers['X-VC-CSRF-Token'], 'go-token');
    assert.equal(call.headers['X-VC-Expected-Account-ID'], '11');
    assert.equal(call.headers['X-VC-Expected-Session-ID'], '42');
    calls = [];
    await commitStoryAction({
        runId: '11', branchId: '13', expectedWorldVersion: 2, actionId: 's1', actorId: 'player', target: 'lin', text: '只说这一句',
    });
    const said = JSON.parse(calls.at(-1).body);
    assert.equal(said.action, undefined);
    assert.equal(said.clueId, undefined);
    assert.equal(said.text, '只说这一句');
    assert.equal(said.target, 'lin');
});

test('回档、投影确认、入局与结局按约定的空字段发送', async () => {
    await rewindStory({ runId: '11', toWorldVersion: 1, chatIdentity: 'w14-chat' });
    assert.deepEqual(JSON.parse(calls.at(-1).body), { toWorldVersion: 1, chatIdentity: 'w14-chat' });
    assert.equal(calls.at(-1).url, `${api.BRIDGE_PREFIX}/api/v1/story/runs/11/rewind`);
    await confirmStoryProjection({ runId: '11', worldEventId: '101' });
    assert.equal(calls.at(-1).url, `${api.BRIDGE_PREFIX}/api/v1/story/runs/11/projections/101/confirm`);
    assert.equal(calls.at(-1).body, '{}');
    await mapStoryParticipant({ runId: '11', actorId: 'lin', relationshipId: '8' });
    assert.equal(calls.at(-1).url, `${api.BRIDGE_PREFIX}/api/v1/story/runs/11/participants/lin`);
    assert.deepEqual(JSON.parse(calls.at(-1).body), { relationshipId: '8' });
    await decideStoryEpilogue({ runId: '11', decision: 'discard' });
    assert.equal(calls.at(-1).url, `${api.BRIDGE_PREFIX}/api/v1/story/runs/11/epilogue`);
    assert.deepEqual(JSON.parse(calls.at(-1).body), { decision: 'discard' });
    await decideStoryEpilogue({ runId: '11', decision: 'save', relationshipId: '8', summary: '一起查过怀表' });
    assert.deepEqual(JSON.parse(calls.at(-1).body), { decision: 'save', relationshipId: '8', summary: '一起查过怀表' });
});

test('玩家不能入局，放弃结局不能夹带摘要，版本冲突是 409', async () => {
    await assert.rejects(() => mapStoryParticipant({ runId: '11', actorId: 'player', relationshipId: '8' }), (error) => error instanceof api.ApiError);
    assert.equal(calls.length, 0);
    await assert.rejects(() => decideStoryEpilogue({ runId: '11', decision: 'discard', summary: '不该写' }), (error) => error instanceof api.ApiError);
    assert.equal(calls.length, 0);
    await assert.rejects(
        () => commitStoryAction({ runId: '11', branchId: '13', expectedWorldVersion: 1, actionId: 'late', actorId: 'player', action: 'inspect', target: 'workshop_cabinet' }),
        (error) => error instanceof api.ApiError && error.status === 409 && error.code === 'REVISION_CONFLICT',
    );
});
