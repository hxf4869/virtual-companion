// 聊天首屏使用的陪伴查询，不加载 inbox 页面。
import { ApiError, storyRequest } from './api.js';

const DECIMAL = /^[1-9][0-9]{0,18}$/;
const EVENT = /^[A-Za-z0-9_.:-]{1,128}$/;
function invalid(message) {
    return new ApiError('invalid', message, { status: 0, code: 'INVALID_REQUEST' });
}

export async function listFollowUps(relationshipId) {
    if (!DECIMAL.test(relationshipId)) throw invalid('请求内容未通过校验，请检查表单。');
    const data = await storyRequest('GET', `/api/v1/relationships/${relationshipId}/follow-ups`);
    return Array.isArray(data) ? data : [];
}

export async function markInboxRead(eventId) {
    if (!EVENT.test(eventId)) throw invalid('请求内容未通过校验，请检查表单。');
    return storyRequest('POST', `/api/v1/inbox/${eventId}/read`);
}
