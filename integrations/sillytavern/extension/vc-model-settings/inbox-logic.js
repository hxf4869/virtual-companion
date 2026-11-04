// Virtual Companion · 主动陪伴、收件箱、通知渠道与系统通知纯逻辑
// 许可：AGPL-3.0-only（见 integrations/sillytavern/README.md）

import { ApiError, captureSessionContext, fetchRelationships, reauth, storyRequest } from './api.js';
import { listFollowUps, markInboxRead } from './inbox-client.js';
import { iconSpriteUrl } from './ui/icons.js';

export { listFollowUps, markInboxRead };

// ---------- From chat-shell.js ----------

export const CHAT_EMPTY_COPY = '这段会话还没有消息。';
export const CHAT_OFFLINE_COPY = '聊天通道已断开';
export const CHAT_PICK_COPY = '选择一位角色';

export function pendingInboxWrites(rows, scope = {}) {
    if (!Array.isArray(rows)) return [];
    const conversationId = scope?.conversationId;
    const relationshipId = scope?.relationshipId;
    return rows.filter((row) => {
        if (!row || row.intent !== 'BODY' || row.stDelivered !== false || row.linkStatus !== 'present') return false;
        if (conversationId != null && conversationId !== '' && String(row.conversationId) !== String(conversationId)) return false;
        if (relationshipId != null && relationshipId !== '' && String(row.relationshipId) !== String(relationshipId)) return false;
        return true;
    });
}

// 原生写入确认与应用已读是两个独立状态；通知、侧栏与会话计数使用后者。
export function unreadInboxEvents(rows, scope = {}) {
    if (!Array.isArray(rows)) return [];
    return rows.filter(row => row?.intent === 'BODY' && row.read !== true && row.linkStatus === 'present'
        && (scope.conversationId == null || scope.conversationId === '' || String(row.conversationId) === String(scope.conversationId))
        && (scope.relationshipId == null || scope.relationshipId === '' || String(row.relationshipId) === String(scope.relationshipId)));
}

export async function loadInboxEvents() {
    const data = await storyRequest('GET', '/api/v1/inbox');
    return Array.isArray(data) ? data : [];
}

// ---------- From desktop/notify.js ----------

export const COPY = Object.freeze({
    now: '现在',
    voice: (seconds) => `[语音] ${seconds}″`,
});
export const BANNER_MS = 5000;
export const POLL_MS = 30000;
const TITLE_PREFIX = /^\(\d+\+?\) /;
const PREVIEW_MAX = 60;

export function previewOf(row) {
    const ms = row?.voice?.durationMs;
    if (Number.isFinite(ms) && ms > 0) return COPY.voice(Math.max(1, Math.round(ms / 1000)));
    const text = String(row?.body ?? '').replace(/<[^<>]*>/g, '').replace(/\s+/g, ' ').trim();
    return [...text].slice(0, PREVIEW_MAX).join('');
}

// 未读主动消息里 eventId 没见过的；seen 会被更新。
export function newArrivals(rows, seen) {
    const fresh = [];
    for (const row of unreadInboxEvents(rows)) {
        if (!row.eventId || seen.has(row.eventId)) continue;
        seen.add(row.eventId);
        fresh.push(row);
    }
    return fresh;
}

export function titleWithCount(title, count) {
    const base = String(title ?? '').replace(TITLE_PREFIX, '');
    return count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
}

export const NOTIFY_KEY = 'vc-desktop-notify';

// 设置里的「桌面通知」开关：本机偏好，默认开（仍需浏览器授权）。
export function systemNotifyEnabled(storage = globalThis.localStorage) {
    try { return !['off', '0', 'false'].includes(String(storage?.getItem(NOTIFY_KEY) ?? '').toLowerCase()); } catch { return true; }
}

export function writeSystemNotifyEnabled(enabled, storage = globalThis.localStorage) {
    const next = Boolean(enabled);
    try {
        storage?.setItem?.(NOTIFY_KEY, next ? 'on' : 'off');
    } catch {
        // Ignore storage write errors in restricted contexts.
    }
    return next;
}

export function notifySupported() {
    return typeof Notification === 'function';
}

// 权限入口（设置里调用）：只有「未决定」才弹询问，已授予 / 已拒绝直接返回当前状态。
export async function requestNotifyPermission() {
    if (!notifySupported()) return 'denied';
    if (Notification.permission !== 'default') return Notification.permission;
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

// ---------- From inbox-page.js ----------

const DECIMAL = /^[1-9][0-9]{0,18}$/;
const EVENT = /^[A-Za-z0-9_.:-]{1,128}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const ZONE = /^[A-Za-z0-9_+./-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HIDDEN = /PRIVATE_[A-Z0-9_]+|GM_ONLY_[A-Z0-9_]+/g;

export const FOLLOW = {
    NEEDS_CLARIFICATION: '待确认时间',
    SCHEDULED: '待跟进',
    ASKED: '已询问',
    CANCELLED: '已取消',
    SILENT: '已跳过',
    DEFERRED: '已推迟',
    WAITING_HOST: '需要打开此会话继续',
    BODY_READY: '正文已就绪',
};

export const FILTERS = [['all', '全部'], ['pending', '待写入'], ['written', '已写入'], ['broken', '链接失效']];

export const PROACTIVE_MODES = ['OFF', 'FOLLOW_UP', 'DAILY', 'CLOSE_FRIEND'];
export const PROACTIVE_LABELS = { OFF: '关闭', FOLLOW_UP: '跟进', DAILY: '日常', CLOSE_FRIEND: '亲近' };

export function shown(value) {
    if (typeof value !== 'string') return '';
    return value.replace(HIDDEN, '').replace(/\s+/g, ' ').trim();
}

export function decimalId(value) {
    if (typeof value === 'string' && DECIMAL.test(value)) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
    return '';
}

export function eventIdOf(value) {
    return typeof value === 'string' && EVENT.test(value) ? value : '';
}

export function timeOf(value) {
    return typeof value === 'string' && TIME.test(value) ? value : '';
}

export function zoneOf(value) {
    return typeof value === 'string' && ZONE.test(value.trim()) ? value.trim() : '';
}

export function zoneDisplayName(zone) {
    const value = String(zone || '').trim();
    if (!value) return '';
    try {
        const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: value, timeZoneName: 'long' }).formatToParts(new Date());
        return parts.find((part) => part.type === 'timeZoneName')?.value || value;
    } catch {
        return value;
    }
}

export function quietZoneValue(shownText, stored) {
    const text = String(shownText ?? '').trim();
    const zone = String(stored ?? '').trim();
    if (!text) return '';
    if (ZONE.test(text)) return text;
    if (zone && text === zoneDisplayName(zone)) return zone;
    return text;
}

function intIn(value, min, max) {
    const number = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isInteger(number) || number < min || number > max) return null;
    return number;
}

function blank(value) {
    return value == null || String(value).trim() === '';
}

function invalid(message) {
    return new ApiError('invalid', message, { status: 0, code: 'INVALID_REQUEST' });
}

export async function getProactivePolicy(relationshipId) {
    if (!DECIMAL.test(relationshipId)) throw invalid('请求内容未通过校验，请检查表单。');
    return storyRequest('GET', `/api/v1/relationships/${relationshipId}/proactive-policy`);
}

export async function putProactivePolicy(relationshipId, body) {
    if (!DECIMAL.test(relationshipId)) throw invalid('请求内容未通过校验，请检查表单。');
    return storyRequest('PUT', `/api/v1/relationships/${relationshipId}/proactive-policy`, body);
}

export async function cancelFollowUp(followUpId) {
    if (!DECIMAL.test(followUpId)) throw invalid('请求内容未通过校验，请检查表单。');
    return storyRequest('POST', `/api/v1/follow-ups/${followUpId}/cancel`);
}

export async function listInbox() {
    const data = await storyRequest('GET', '/api/v1/inbox');
    return Array.isArray(data) ? data : [];
}

export async function listChannels() {
    const data = await storyRequest('GET', '/api/v1/notification-channels');
    return Array.isArray(data) ? data : [];
}

export async function putChannel(body) {
    return storyRequest('PUT', '/api/v1/notification-channels', body);
}

export async function listDeliveries() {
    const data = await storyRequest('GET', '/api/v1/notification-deliveries');
    return Array.isArray(data) ? data : [];
}

export function allowRelationship(raw) {
    const relationshipId = decimalId(raw?.relationshipId);
    if (!relationshipId) return null;
    const row = { relationshipId, name: shown(raw?.companionName) || '未命名角色' };
    if (raw?.mode === 'COMPANION' || raw?.mode === 'STORY') row.mode = raw.mode;
    return row;
}

export function allowPolicy(raw, relationshipId) {
    const modes = Array.isArray(raw?.allowedModes) ? raw.allowedModes.filter((item) => item === 'COMPANION' || item === 'STORY').slice(0, 2) : [];
    const supportsMode = !!raw && Object.hasOwn(raw, 'mode');
    const supportsCheckIn = !!raw && Object.hasOwn(raw, 'checkInAfterMinutes');
    const mode = PROACTIVE_MODES.includes(raw?.mode) ? raw.mode : 'OFF';
    return {
        relationshipId,
        enabled: supportsMode ? mode !== 'OFF' : raw?.enabled === true,
        supportsMode,
        supportsCheckIn,
        mode: supportsMode ? mode : '',
        checkInAfterMinutes: supportsCheckIn ? intIn(raw?.checkInAfterMinutes, 120, 4320) : null,
        quietHoursStart: timeOf(raw?.quietHoursStart),
        quietHoursEnd: timeOf(raw?.quietHoursEnd),
        quietHoursTimezone: zoneOf(raw?.quietHoursTimezone),
        dailyLimit: intIn(raw?.dailyLimit, 0, 48) ?? 0,
        recentInteractionMinutes: intIn(raw?.recentInteractionMinutes, 0, 10080) ?? 0,
        allowedModes: modes.length ? modes : ['COMPANION'],
        offlineCapable: raw?.offlineCapable === true,
    };
}

export function readProactivePolicy(raw, relationshipId) {
    return allowPolicy(raw, relationshipId);
}

export function allowFollowUp(raw) {
    const followUpId = decimalId(raw?.followUpId);
    const relationshipId = decimalId(raw?.relationshipId);
    const status = Object.hasOwn(FOLLOW, raw?.status) ? raw.status : '';
    const eventId = eventIdOf(raw?.eventId);
    if (!followUpId || !relationshipId || !status || !eventId) return null;
    const eventDate = typeof raw?.eventDate === 'string' && DATE.test(raw.eventDate) ? raw.eventDate : '';
    return {
        followUpId, relationshipId, status, eventId, eventDate,
        body: shown(raw?.body),
        eventTime: timeOf(raw?.eventTime),
        triggerAt: typeof raw?.triggerAt === 'string' ? raw.triggerAt : '',
    };
}

export function allowInbox(raw) {
    const eventId = eventIdOf(raw?.eventId);
    const relationshipId = decimalId(raw?.relationshipId ?? raw?.link?.relationshipId);
    const conversationId = decimalId(raw?.conversationId ?? raw?.link?.conversationId);
    const linkStatus = ['present', 'removed', 'invalidated'].includes(raw?.linkStatus) ? raw.linkStatus : '';
    const intent = raw?.intent === 'WAITING_HOST' || raw?.intent === 'BODY' ? raw.intent : '';
    if (!eventId || !relationshipId || !conversationId || !linkStatus || !intent) return null;
    return {
        eventId, relationshipId, conversationId, linkStatus, intent,
        body: intent === 'WAITING_HOST' ? '' : shown(raw?.body),
        voice: raw?.voice?.status === 'ready' && decimalId(raw.voice.clipId) && Number.isSafeInteger(raw.voice.durationMs) && raw.voice.durationMs > 0
            ? { clipId: raw.voice.clipId, status: 'ready', durationMs: raw.voice.durationMs } : null,
        stDelivered: raw?.stDelivered === true,
        read: raw?.read === true,
    };
}

export function allowChannel(raw) {
    const channel = raw?.channel === 'EMAIL' || raw?.channel === 'FEISHU' ? raw.channel : '';
    const channelId = decimalId(raw?.channelId);
    const configuredTarget = typeof raw?.configuredTarget === 'string' ? raw.configuredTarget.trim() : '';
    if (!channel || !channelId || !configuredTarget || configuredTarget.toLowerCase().includes('://')) return null;
    const relationshipIds = (Array.isArray(raw?.relationshipIds) ? raw.relationshipIds : []).map(decimalId).filter(Boolean).slice(0, 32);
    return {
        channelId, channel, configuredTarget, relationshipIds,
        enabled: raw?.enabled === true,
        previewBody: raw?.previewBody === true,
    };
}

export function allowDelivery(raw) {
    const deliveryId = decimalId(raw?.deliveryId);
    const eventId = eventIdOf(raw?.eventId);
    const channel = raw?.channel === 'EMAIL' || raw?.channel === 'FEISHU' ? raw.channel : '';
    const status = ['pending', 'sending', 'accepted', 'failed', 'unknown', 'stopped'].includes(raw?.status) ? raw.status : '';
    if (!deliveryId || !eventId || !channel || !status) return null;
    let configuredTarget = typeof raw?.configuredTarget === 'string' ? raw.configuredTarget.trim() : '';
    if (configuredTarget.toLowerCase().includes('://')) configuredTarget = '';
    const stoppedReason = ['cancelled', 'expired', 'consent_withdrawn'].includes(raw?.stoppedReason) ? raw.stoppedReason : '';
    return { deliveryId, eventId, channel, configuredTarget, status, stoppedReason };
}

export function blankDraft(kind, relationshipId) {
    return {
        key: `new:${kind}`, channelId: '', channel: kind, exists: false, enabled: false,
        configuredTarget: '', previewBody: false, relationshipIds: relationshipId ? [relationshipId] : [],
        credential: '', credentialMode: 'keep', credentialState: 'missing',
    };
}

export function draftFromRow(row) {
    return {
        key: row.channelId, channelId: row.channelId, channel: row.channel, exists: true,
        enabled: row.enabled, configuredTarget: row.configuredTarget, previewBody: row.previewBody,
        relationshipIds: [...row.relationshipIds], credential: '', credentialMode: 'keep', credentialState: 'withheld',
    };
}

export function draftsFromChannels(rows, relationshipId) {
    const drafts = [];
    for (const kind of ['EMAIL', 'FEISHU']) {
        const found = rows.filter((row) => row.channel === kind);
        if (found.length === 0) drafts.push(blankDraft(kind, relationshipId));
        else found.forEach((row) => drafts.push(draftFromRow(row)));
    }
    return drafts;
}

export function policyKey(draft) {
    return JSON.stringify(policyBody(draft));
}

export function noteInboxPolicy(state) {
    state.policyBaseline = policyKey(state.policyDraft);
}

export function inboxPolicyDirty(state) {
    if (!state?.relationshipId) return false;
    return policyKey(state.policyDraft) !== state.policyBaseline;
}

export function policyBody(draft) {
    const startBlank = blank(draft.quietHoursStart);
    const endBlank = blank(draft.quietHoursEnd);
    const zoneBlank = blank(draft.quietHoursTimezone);
    const body = {
        enabled: draft.supportsMode ? draft.mode !== 'OFF' : draft.enabled === true,
        quietHoursStart: startBlank ? null : String(draft.quietHoursStart).trim(),
        quietHoursEnd: endBlank ? null : String(draft.quietHoursEnd).trim(),
        quietHoursTimezone: zoneBlank ? null : String(draft.quietHoursTimezone).trim(),
        dailyLimit: intIn(draft.dailyLimit, 0, 48),
        recentInteractionMinutes: intIn(draft.recentInteractionMinutes, 0, 10080),
        allowedModes: Array.isArray(draft.allowedModes) ? draft.allowedModes.filter((item) => item === 'COMPANION' || item === 'STORY') : [],
        offlineCapable: draft.offlineCapable === true,
    };
    if (draft.supportsMode) body.mode = draft.mode;
    if (draft.supportsCheckIn) body.checkInAfterMinutes = intIn(draft.checkInAfterMinutes, 120, 4320);
    return body;
}

export function proactivePolicyPayload(draft) {
    return policyBody(draft);
}

export function validatePolicy(draft) {
    const body = policyBody(draft);
    const quiet = [body.quietHoursStart, body.quietHoursEnd, body.quietHoursTimezone];
    const any = quiet.some((item) => item);
    const all = quiet.every((item) => item);
    if (any && !all) return '静默时段需要同时填写开始、结束和时区。';
    if (all && (!TIME.test(body.quietHoursStart) || !TIME.test(body.quietHoursEnd))) return '时间格式不正确';
    if (all && !ZONE.test(body.quietHoursTimezone)) return '时区格式不正确';
    if (body.dailyLimit === null || body.recentInteractionMinutes === null || body.allowedModes.length === 0) return '请检查每日上限和间隔。';
    if (draft.supportsMode && !PROACTIVE_MODES.includes(draft.mode)) return '请检查模式。';
    if (draft.supportsCheckIn && body.checkInAfterMinutes === null) return '请检查多久没聊。';
    return '';
}

export function writeLabel(event) {
    if (event.linkStatus === 'removed') return '当前链接已移除';
    if (event.linkStatus === 'invalidated') return '链接失效';
    return event.stDelivered ? '已写入' : '待写入';
}

export function deliveryLabel(row) {
    if (row.status === 'stopped' && row.stoppedReason === 'expired') return { text: '过期', tone: 'warn', status: 'expired' };
    if (row.status === 'accepted') return { text: '渠道已接受', tone: 'ok', status: 'accepted' };
    if (row.status === 'pending') return { text: '待发送', tone: 'warn', status: 'pending' };
    if (row.status === 'sending') return { text: '发送中', tone: 'warn', status: 'sending' };
    if (row.status === 'failed') return { text: '失败', tone: 'danger', status: 'failed' };
    if (row.status === 'unknown') return { text: '结果未知', tone: 'warn', status: 'unknown' };
    if (row.status === 'stopped') return { text: '已停止', tone: 'warn', status: 'stopped' };
    return { text: '结果未知', tone: 'warn', status: 'unknown' };
}

export function credentialText(draft) {
    if (draft.credentialState === 'configured') return '已配置';
    if (draft.credentialState === 'withheld') return '不回显';
    return '未配置';
}

export function credentialPlaceholder(draft) {
    return draft.credentialState === 'missing' ? '未配置' : '已配置，留空不修改';
}

export function channelText(draft) {
    if (!draft.exists) return '未配置';
    return draft.enabled ? '已启用' : '已关闭';
}

export function safeTarget(value) {
    const text = String(value ?? '').trim();
    return text.toLowerCase().includes('://') ? '' : text;
}

export function when(item) {
    if (item.eventDate && item.eventTime) return `${item.eventDate} ${item.eventTime}`;
    if (item.eventDate) return item.eventDate;
    return '';
}

export function passesFilter(event, filter) {
    if (filter === 'pending') return event.linkStatus === 'present' && !event.stDelivered;
    if (filter === 'written') return event.linkStatus === 'present' && event.stDelivered;
    if (filter === 'broken') return event.linkStatus === 'removed' || event.linkStatus === 'invalidated';
    return true;
}

function freshState() {
    const policyDraft = allowPolicy({}, '');
    return {
        open: false, loading: false, error: '', busy: false, relationships: [], relationshipId: '',
        policyDraft, policyBaseline: policyKey(policyDraft), policyError: '', policyConflict: false, policyStash: null, policyNotice: '',
        followUps: [], cancelAsk: '', inbox: [], deliveries: [], inboxFilter: 'all', channels: [], channelDrafts: [],
        channelError: '', reauth: { open: false, action: '', password: '', key: '' },
    };
}

export function createInboxPage({ onChange = () => {}, onOpenConversation = () => {}, onPolicySaved = () => {} } = {}) {
    const state = freshState();
    let epoch = 0, dead = false;
    const emit = () => { if (!dead) onChange(state); };
    const alive = (ticket) => state.open && epoch === ticket;
    const findChannel = (key) => state.channelDrafts.find((item) => item.key === key);

    async function loadCharacter(ticket) {
        const relationshipId = state.relationshipId;
        if (!relationshipId) {
            state.followUps = [];
            state.policyDraft = allowPolicy({}, '');
            noteInboxPolicy(state);
            return;
        }
        const [policyRow, followRows] = await Promise.all([
            getProactivePolicy(relationshipId),
            listFollowUps(relationshipId),
        ]);
        if (!alive(ticket) || state.relationshipId !== relationshipId) return;
        state.policyDraft = allowPolicy(policyRow, relationshipId);
        noteInboxPolicy(state);
        state.policyConflict = false;
        state.policyStash = null;
        state.policyError = '';
        state.followUps = followRows.map(allowFollowUp).filter(Boolean);
    }

    function failWrite(error, action, key = '') {
        if (error?.kind === 'conflict-revision') {
            if (action === 'policy') state.policyConflict = true;
            else state.channelError = '这些设置已在另一处更新。你的输入已保留。';
            return;
        }
        if (error?.kind === 'forbidden') {
            state.reauth = { open: true, action, password: '', key };
            return;
        }
        if (error?.kind === 'context-changed') {
            state.policyError = error.code === 'VC_HOST_SESSION_EXPIRED'
                ? error.message : '登录状态已变化，请重新加载页面后再试。';
            return;
        }
        const message = error?.kind === 'invalid' ? (error.message || '请求内容未通过校验，请检查表单。') : '没有保存，请重试。';
        if (action === 'policy') state.policyError = message;
        else if (action === 'cancel') state.error = '没有取消，请重试。';
        else state.channelError = message;
    }

    const controller = {
        state,
        async open() {
            if (dead || state.busy) return;
            const ticket = ++epoch;
            Object.assign(state, freshState(), { open: true, loading: true });
            emit();
            try {
                await captureSessionContext();
                if (!alive(ticket)) return;
                const [relationships, events, channelRows, deliveryRows] = await Promise.all([
                    fetchRelationships(), listInbox(), listChannels(), listDeliveries(),
                ]);
                if (!alive(ticket)) return;
                state.relationships = (Array.isArray(relationships) ? relationships : [])
                    .filter((row) => row.personaRef === 'st-character').map(allowRelationship).filter(Boolean);
                state.relationshipId = state.relationships[0]?.relationshipId || '';
                state.inbox = events.map(allowInbox).filter(Boolean);
                state.channels = channelRows.map(allowChannel).filter(Boolean);
                state.deliveries = deliveryRows.map(allowDelivery).filter(Boolean);
                state.channelDrafts = draftsFromChannels(state.channels, state.relationshipId);
                await loadCharacter(ticket);
                if (!alive(ticket)) return;
                state.loading = false;
                emit();
            } catch (error) {
                if (!alive(ticket)) return;
                state.loading = false;
                state.error = error?.kind === 'unauthenticated' ? '尚未登录或登录已过期。' : '加载失败，请重试。';
                emit();
            }
        },
        close() {
            epoch += 1;
            state.open = false;
            state.busy = false;
            state.cancelAsk = '';
            state.reauth = { open: false, action: '', password: '', key: '' };
            for (const draft of state.channelDrafts) { draft.credential = ''; draft.credentialMode = 'keep'; }
            emit();
        },
        destroy() { dead = true; controller.close(); },
        async selectRelationship(relationshipId) {
            const id = decimalId(relationshipId);
            if (dead || !state.open || !id || id === state.relationshipId || state.busy) return;
            const ticket = epoch;
            state.relationshipId = id;
            state.busy = true;
            emit();
            try {
                await loadCharacter(ticket);
            } catch {
                if (alive(ticket)) state.error = '加载失败，请重试。';
            } finally {
                if (alive(ticket)) {
                    state.busy = false;
                    emit();
                }
            }
        },
        setPolicy(partial) {
            if (dead || state.busy) return;
            state.policyDraft = { ...state.policyDraft, ...partial };
            emit();
        },
        discardChanges() {
            if (dead || state.busy) return;
            if (state.policyBaseline) state.policyDraft = { ...state.policyDraft, ...JSON.parse(state.policyBaseline) };
            state.channelDrafts = draftsFromChannels(state.channels, state.relationships[0]?.relationshipId || '');
            state.policyConflict = false; state.policyStash = null; state.policyError = ''; state.channelError = '';
            emit();
        },
        togglePolicy(name) {
            if (dead || state.busy) return;
            if (name === 'enabled' || name === 'offlineCapable') state.policyDraft[name] = !state.policyDraft[name];
            emit();
        },
        setProactiveMode(mode) {
            if (dead || state.busy) return;
            if (!state.policyDraft.supportsMode || !PROACTIVE_MODES.includes(mode)) return;
            state.policyDraft.mode = mode;
            state.policyDraft.enabled = mode !== 'OFF';
            emit();
        },
        toggleMode(mode) {
            if (dead || state.busy) return;
            if (mode !== 'COMPANION' && mode !== 'STORY') return;
            const modes = new Set(state.policyDraft.allowedModes);
            if (modes.has(mode)) {
                if (modes.size === 1) return;
                modes.delete(mode);
            } else modes.add(mode);
            state.policyDraft.allowedModes = [...modes];
            emit();
        },
        async savePolicy() {
            if (dead || !state.open || state.busy || state.policyConflict || !state.relationshipId) return;
            const message = validatePolicy(state.policyDraft);
            if (message) {
                state.policyError = message;
                emit();
                return;
            }
            const ticket = epoch;
            const body = policyBody(state.policyDraft);
            state.busy = true;
            state.policyError = '';
            state.policyNotice = '';
            emit();
            try {
                const saved = allowPolicy(await putProactivePolicy(state.relationshipId, body), state.relationshipId);
                if (!alive(ticket)) return;
                state.policyDraft = saved;
                noteInboxPolicy(state);
                state.policyConflict = false;
                state.policyStash = null;
                onPolicySaved();
            } catch (error) {
                if (alive(ticket)) failWrite(error, 'policy');
            } finally {
                if (alive(ticket)) {
                    state.busy = false;
                    emit();
                }
            }
        },
        async viewLatestPolicy() {
            if (dead || !state.open || state.busy || !state.relationshipId) return;
            const ticket = epoch;
            const relationshipId = state.relationshipId;
            state.policyStash = { ...state.policyDraft };
            state.busy = true;
            emit();
            try {
                const latest = await getProactivePolicy(relationshipId);
                if (!alive(ticket) || state.relationshipId !== relationshipId) return;
                state.policyDraft = allowPolicy(latest, relationshipId);
                noteInboxPolicy(state);
                state.policyConflict = false;
                state.policyNotice = '已加载最新设置。你的输入已保留。';
            } catch {
                if (alive(ticket)) state.policyError = '加载失败，请重试。';
            } finally {
                if (alive(ticket)) {
                    state.busy = false;
                    emit();
                }
            }
        },
        keepPolicyDraft() {
            if (dead || state.busy) return;
            if (state.policyStash) state.policyDraft = state.policyStash;
            state.policyStash = null;
            state.policyConflict = false;
            emit();
        },
        setChannel(key, partial) {
            if (dead || state.busy) return;
            const draft = findChannel(key);
            if (!draft) return;
            const next = { ...draft, ...partial };
            if (Object.hasOwn(partial, 'credential')) {
                if (partial.credential) {
                    next.credential = partial.credential;
                    next.credentialMode = 'set';
                } else if (draft.credentialMode !== 'clear') {
                    next.credential = '';
                    next.credentialMode = 'keep';
                }
            }
            Object.assign(draft, next);
            emit();
        },
        toggleChannel(key, field) {
            if (dead || state.busy) return;
            const draft = findChannel(key);
            if (!draft) return;
            if (field === 'enabled' || field === 'previewBody') draft[field] = !draft[field];
            emit();
        },
        toggleRelationship(key, relationshipId) {
            if (dead || state.busy) return;
            const draft = findChannel(key);
            const id = decimalId(relationshipId);
            if (!draft || !id) return;
            const ids = new Set(draft.relationshipIds);
            if (ids.has(id)) ids.delete(id);
            else if (ids.size < 32) ids.add(id);
            draft.relationshipIds = [...ids];
            emit();
        },
        clearCredential(key) {
            if (dead || state.busy) return;
            const draft = findChannel(key);
            if (!draft) return;
            draft.credential = '';
            draft.credentialMode = 'clear';
            emit();
        },
        async saveChannel(key) {
            const draft = findChannel(key);
            if (dead || !state.open || !draft || state.busy) return;
            const configuredTarget = String(draft.configuredTarget || '').trim();
            if (configuredTarget.toLowerCase().includes('://')) {
                const saved = state.channels.find((item) => item.channelId === draft.channelId);
                draft.configuredTarget = saved?.configuredTarget || '';
                state.channelError = '地址不能是链接。';
                emit();
                return;
            }
            if (!configuredTarget || configuredTarget.length > 320) {
                state.channelError = '请填写收件地址或群名称。';
                emit();
                return;
            }
            const relationshipIds = draft.relationshipIds.filter((id) => DECIMAL.test(id)).slice(0, 32);
            const body = {
                channel: draft.channel,
                enabled: draft.enabled === true,
                configuredTarget,
                previewBody: draft.previewBody === true,
                relationshipIds,
            };
            if (draft.credentialMode === 'set') body.credential = draft.credential;
            if (draft.credentialMode === 'clear') body.credential = null;
            const sentCredential = draft.credentialMode === 'set';
            const clearedCredential = draft.credentialMode === 'clear';
            const ticket = epoch;
            state.busy = true;
            state.channelError = '';
            emit();
            try {
                const saved = allowChannel(await putChannel(body));
                if (!alive(ticket) || !saved) return;
                draft.key = saved.channelId;
                draft.channelId = saved.channelId;
                draft.exists = true;
                draft.enabled = saved.enabled;
                draft.configuredTarget = saved.configuredTarget;
                draft.previewBody = saved.previewBody;
                draft.relationshipIds = saved.relationshipIds;
                draft.credential = '';
                draft.credentialMode = 'keep';
                if (sentCredential) draft.credentialState = 'configured';
                else if (clearedCredential) draft.credentialState = 'missing';
                state.channels = state.channels.filter((item) => item.channelId !== saved.channelId).concat(saved);
            } catch (error) {
                if (alive(ticket)) failWrite(error, 'channel', key);
            } finally {
                if (alive(ticket)) {
                    state.busy = false;
                    emit();
                }
            }
        },
        askCancel(followUpId) {
            if (dead || state.busy) return;
            const row = state.followUps.find((item) => item.followUpId === followUpId);
            if (!row || row.status === 'CANCELLED') return;
            state.cancelAsk = followUpId;
            emit();
        },
        dismissCancel() {
            if (dead || state.busy) return;
            state.cancelAsk = '';
            emit();
        },
        async confirmCancel() {
            const followUpId = state.cancelAsk;
            if (dead || !state.open || !followUpId || state.busy) return;
            const ticket = epoch;
            state.busy = true;
            emit();
            try {
                const saved = allowFollowUp(await cancelFollowUp(followUpId));
                if (!alive(ticket)) return;
                if (saved) state.followUps = state.followUps.map((item) => item.followUpId === followUpId ? saved : item);
                state.cancelAsk = '';
            } catch (error) {
                if (alive(ticket)) failWrite(error, 'cancel');
            } finally {
                if (alive(ticket)) {
                    state.busy = false;
                    emit();
                }
            }
        },
        setInboxFilter(filter) {
            if (dead || state.busy) return;
            if (FILTERS.some(([value]) => value === filter)) state.inboxFilter = filter;
            emit();
        },
        async openConversation(eventId) {
            if (dead || !state.open || state.busy) return;
            const event = state.inbox.find((item) => item.eventId === eventId);
            if (!event || event.linkStatus !== 'present') return;
            const ticket = epoch;
            if (!event.read) {
                try {
                    const saved = allowInbox(await markInboxRead(eventId));
                    if (!alive(ticket)) return;
                    if (saved) state.inbox = state.inbox.map((item) => item.eventId === eventId ? saved : item);
                } catch {
                    if (alive(ticket)) state.error = '没有记下已读，请重试。';
                    emit();
                    return;
                }
            }
            onOpenConversation({ eventId: event.eventId, conversationId: event.conversationId, relationshipId: event.relationshipId });
            if (alive(ticket)) emit();
        },
        setReauthPassword(password) { if (!dead && !state.busy) state.reauth.password = String(password ?? ''); },
        cancelReauth() {
            if (dead || state.busy) return;
            state.reauth = { open: false, action: '', password: '', key: '' };
            emit();
        },
        async authenticate() {
            const password = state.reauth.password;
            state.reauth.password = '';
            const action = state.reauth.action;
            const key = state.reauth.key;
            if (dead || !state.open || !password || state.busy) return;
            const ticket = epoch;
            state.busy = true;
            state.policyError = '';
            emit();
            try {
                await reauth(password);
                if (!alive(ticket)) return;
                state.reauth = { open: false, action: '', password: '', key: '' };
                state.busy = false;
                if (action === 'policy') await controller.savePolicy();
                else if (action === 'channel') await controller.saveChannel(key);
                else if (action === 'cancel') await controller.confirmCancel();
                else emit();
            } catch (error) {
                if (!alive(ticket)) return;
                state.busy = false;
                state.reauth.password = '';
                state.reauth.open = true;
                if (error?.kind === 'context-changed') {
                    state.policyError = error.code === 'VC_HOST_SESSION_EXPIRED'
                        ? error.message : '登录状态已变化，请重新加载页面后再试。';
                } else if (error?.kind === 'unauthenticated') {
                    state.policyError = '登录已过期，请重新登录后再试。';
                } else if (error?.status === 404 && error?.code === 'NOT_FOUND_OR_FORBIDDEN') {
                    state.policyError = '密码不正确，请重试。';
                } else if (error?.status === 429) {
                    state.policyError = '验证次数过多，请稍后再试。';
                } else if (error?.kind === 'network' || error?.status >= 500) {
                    state.policyError = '暂时无法验证身份，请稍后重试。';
                } else {
                    state.policyError = '身份验证未完成，请重试。';
                }
                emit();
            }
        },
    };
    return controller;
}

export function triggerText(item) {
    if (item.triggerAt) {
        const date = new Date(item.triggerAt);
        if (!Number.isNaN(date.getTime())) {
            try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
            catch { /* 落到事件日期 */ }
        }
    }
    return when(item);
}

export function instanceLabel(item, relationships) {
    const name = item?.name || '未命名角色';
    if (item?.mode === 'STORY') return `${name} · 剧情`;
    if (item?.mode === 'COMPANION') return `${name} · 日常`;
    const same = (relationships || []).filter((row) => (row?.name || '未命名角色') === name);
    if (same.length < 2) return name;
    const index = same.findIndex((row) => row.relationshipId === item.relationshipId);
    return index < 0 ? name : `${name} · ${index + 1}`;
}

export function inboxViewProps(state, host, events, { desktop = false } = {}) {
    const { password: _password, ...reauth } = state.reauth;
    return {
        state: { ...state, reauth, channelDrafts: state.channelDrafts.map(({ credential: _credential, ...draft }) => ({ ...draft, configuredTarget: safeTarget(draft.configuredTarget) })) },
        host, events, desktop, dirty: inboxPolicyDirty(state), sprite: iconSpriteUrl(),
        labels: { follow: FOLLOW, proactive: PROACTIVE_LABELS }, modes: PROACTIVE_MODES, filters: FILTERS,
        format: { write: writeLabel, delivery: deliveryLabel, credential: credentialText, credentialPlaceholder, channel: channelText, when, trigger: triggerText, instance: instanceLabel, zone: zoneDisplayName, passes: passesFilter },
    };
}

export function hasInboxDrafts(state) {
    if (inboxPolicyDirty(state)) return true;
    const saved = draftsFromChannels(state.channels, state.relationships[0]?.relationshipId || '');
    const editable = draft => JSON.stringify({ enabled: draft.enabled, previewBody: draft.previewBody, configuredTarget: String(draft.configuredTarget || '').trim(), relationshipIds: [...draft.relationshipIds].sort(), credentialMode: draft.credentialMode });
    return state.channelDrafts.some(draft => { const prior = saved.find(row => row.key === draft.key); return !prior || editable(draft) !== editable(prior); });
}
