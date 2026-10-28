// W14 剧情写接口。校验与路径在这里；会话头仍走 api.js 的同一条桥。
import { ApiError, storyRequest } from './api.js';

const DECIMAL_ID = /^[1-9][0-9]{0,18}$/;
const ACTOR_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const CHAT_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CASTABLE = new Set(['lin', 'zhou', 'su']);

function invalid() {
    throw new ApiError('invalid', '请求内容未通过校验，请检查表单。', { status: 0, code: 'INVALID_REQUEST' });
}

function requireDecimal(value) {
    if (typeof value !== 'string' || !DECIMAL_ID.test(value)) invalid();
    return value;
}

function requireActor(value) {
    if (typeof value !== 'string' || !ACTOR_ID.test(value)) invalid();
    return value;
}

function requireVersion(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
    return value;
}

function requireActionId(value) {
    if (typeof value !== 'string' || value === '' || value !== value.trim() || [...value].length > 128) invalid();
    return value;
}

export async function commitStoryAction({
    runId, branchId, expectedWorldVersion, actionId, actorId, action = '', target = '', clueId = '', text = '',
} = {}) {
    const body = {
        branchId: requireDecimal(branchId),
        expectedWorldVersion: requireVersion(expectedWorldVersion),
        actionId: requireActionId(actionId),
        actorId: requireActor(actorId),
    };
    if (action) body.action = requireActor(action);
    if (target) body.target = requireActor(target);
    if (clueId) body.clueId = requireActor(clueId);
    if (text) {
        if (typeof text !== 'string' || [...text].length > 4000) invalid();
        body.text = text;
    }
    return storyRequest('POST', `/api/v1/story/runs/${requireDecimal(runId)}/actions`, body);
}

export async function rewindStory({ runId, toWorldVersion, chatIdentity } = {}) {
    if (typeof chatIdentity !== 'string' || !CHAT_IDENTITY.test(chatIdentity)) invalid();
    return storyRequest('POST', `/api/v1/story/runs/${requireDecimal(runId)}/rewind`, {
        toWorldVersion: requireVersion(toWorldVersion),
        chatIdentity,
    });
}

export async function confirmStoryProjection({ runId, worldEventId } = {}) {
    return storyRequest('POST', `/api/v1/story/runs/${requireDecimal(runId)}/projections/${requireDecimal(worldEventId)}/confirm`, {});
}

export async function mapStoryParticipant({ runId, actorId, relationshipId } = {}) {
    if (!CASTABLE.has(actorId)) invalid();
    return storyRequest('POST', `/api/v1/story/runs/${requireDecimal(runId)}/participants/${requireActor(actorId)}`, {
        relationshipId: requireDecimal(relationshipId),
    });
}

export async function decideStoryEpilogue({ runId, decision, relationshipId = '', summary = '' } = {}) {
    const path = `/api/v1/story/runs/${requireDecimal(runId)}/epilogue`;
    if (decision === 'discard') {
        if (relationshipId || summary) invalid();
        return storyRequest('POST', path, { decision: 'discard' });
    }
    if (decision !== 'save') invalid();
    if (typeof summary !== 'string' || summary.trim() === '' || [...summary].length > 2000) invalid();
    return storyRequest('POST', path, {
        decision: 'save',
        relationshipId: requireDecimal(relationshipId),
        summary,
    });
}
