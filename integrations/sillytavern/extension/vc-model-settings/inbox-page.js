import { listFollowUps, markInboxRead } from './inbox-client.js';
export { listFollowUps, markInboxRead } from './inbox-client.js';
// UI-P04 主动陪伴 / 通知。跟进、静默、角色开关、inbox 与邮箱 / 飞书状态。
// 凭据只在本次输入里存在，不回显、不写 localStorage。渠道接受不写成手机已收到。
import { ApiError, captureSessionContext, fetchRelationships, reauth, storyRequest } from './api.js';
import { confirmAlert, confirmDiscard } from './ui/alert.js';
import { showToast } from './ui/toast.js';
import { iconSpriteUrl } from './ui/icons.js';
import { mountInboxListView, mountInboxChannelView, mountInboxContentsView, inboxConflictContent, mountInboxReauthView } from './desktop/build/index.js';
import { popMenu } from './ui/menu.js';
import { createNav } from './ui/nav.js';
import { desktopLayout } from './desktop/presentation.js';
import { openSheet } from './ui/sheet.js';
import { readVcUiFlag } from './ui/theme.js';
import { createVoiceBubble } from './voice.js';

const DECIMAL = /^[1-9][0-9]{0,18}$/;
const EVENT = /^[A-Za-z0-9_.:-]{1,128}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const ZONE = /^[A-Za-z0-9_+./-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HIDDEN = /PRIVATE_[A-Z0-9_]+|GM_ONLY_[A-Z0-9_]+/g;
const FOLLOW = {
    NEEDS_CLARIFICATION: '待确认时间',
    SCHEDULED: '待跟进',
    ASKED: '已询问',
    CANCELLED: '已取消',
    SILENT: '已跳过',
    DEFERRED: '已推迟',
    WAITING_HOST: '需要打开此会话继续',
    BODY_READY: '正文已就绪',
};
const FILTERS = [['all', '全部'], ['pending', '待写入'], ['written', '已写入'], ['broken', '链接失效']];


function shown(value) {
    if (typeof value !== 'string') return '';
    return value.replace(HIDDEN, '').replace(/\s+/g, ' ').trim();
}

function decimalId(value) {
    if (typeof value === 'string' && DECIMAL.test(value)) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
    return '';
}

function eventIdOf(value) {
    return typeof value === 'string' && EVENT.test(value) ? value : '';
}

function timeOf(value) {
    return typeof value === 'string' && TIME.test(value) ? value : '';
}

function zoneOf(value) {
    return typeof value === 'string' && ZONE.test(value.trim()) ? value.trim() : '';
}

function zoneDisplayName(zone) {
    const value = String(zone || '').trim();
    if (!value) return '';
    try {
        const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: value, timeZoneName: 'long' }).formatToParts(new Date());
        return parts.find((part) => part.type === 'timeZoneName')?.value || value;
    } catch {
        return value;
    }
}

export function quietZoneValue(shown, stored) {
    const text = String(shown ?? '').trim();
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

function allowRelationship(raw) {
    const relationshipId = decimalId(raw?.relationshipId);
    if (!relationshipId) return null;
    const row = { relationshipId, name: shown(raw?.companionName) || '未命名角色' };
    if (raw?.mode === 'COMPANION' || raw?.mode === 'STORY') row.mode = raw.mode;
    return row;
}

const PROACTIVE_MODES = ['OFF', 'FOLLOW_UP', 'DAILY', 'CLOSE_FRIEND'];
const PROACTIVE_LABELS = { OFF: '关闭', FOLLOW_UP: '跟进', DAILY: '日常', CLOSE_FRIEND: '亲近' };

function allowPolicy(raw, relationshipId) {
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

function allowFollowUp(raw) {
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

export function mountInboxVoices(root,state) {
    for (const slot of root.querySelectorAll('[data-vc-inbox-voice]')) {
        const item=state.inbox.find((row)=>row.eventId===slot.getAttribute('data-vc-inbox-voice'));
        if (item?.voice) slot.replaceChildren(createVoiceBubble({text:item.body,voice:item.voice}));
    }
}

function allowInbox(raw) {
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

function allowChannel(raw) {
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

function allowDelivery(raw) {
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

function blankDraft(kind, relationshipId) {
    return {
        key: `new:${kind}`, channelId: '', channel: kind, exists: false, enabled: false,
        configuredTarget: '', previewBody: false, relationshipIds: relationshipId ? [relationshipId] : [],
        credential: '', credentialMode: 'keep', credentialState: 'missing',
    };
}

function draftFromRow(row) {
    return {
        key: row.channelId, channelId: row.channelId, channel: row.channel, exists: true,
        enabled: row.enabled, configuredTarget: row.configuredTarget, previewBody: row.previewBody,
        relationshipIds: [...row.relationshipIds], credential: '', credentialMode: 'keep', credentialState: 'withheld',
    };
}

function draftsFromChannels(rows, relationshipId) {
    const drafts = [];
    for (const kind of ['EMAIL', 'FEISHU']) {
        const found = rows.filter((row) => row.channel === kind);
        if (found.length === 0) drafts.push(blankDraft(kind, relationshipId));
        else found.forEach((row) => drafts.push(draftFromRow(row)));
    }
    return drafts;
}

function policyKey(draft) {
    return JSON.stringify(policyBody(draft));
}

function noteInboxPolicy(state) {
    state.policyBaseline = policyKey(state.policyDraft);
}

export function inboxPolicyDirty(state) {
    if (!state?.relationshipId) return false;
    return policyKey(state.policyDraft) !== state.policyBaseline;
}

function policyBody(draft) {
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

function validatePolicy(draft) {
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

function writeLabel(event) {
    if (event.linkStatus === 'removed') return '当前链接已移除';
    if (event.linkStatus === 'invalidated') return '链接失效';
    return event.stDelivered ? '已写入' : '待写入';
}

function deliveryLabel(row) {
    if (row.status === 'stopped' && row.stoppedReason === 'expired') return { text: '过期', tone: 'warn', status: 'expired' };
    if (row.status === 'accepted') return { text: '渠道已接受', tone: 'ok', status: 'accepted' };
    if (row.status === 'pending') return { text: '待发送', tone: 'warn', status: 'pending' };
    if (row.status === 'sending') return { text: '发送中', tone: 'warn', status: 'sending' };
    if (row.status === 'failed') return { text: '失败', tone: 'danger', status: 'failed' };
    if (row.status === 'unknown') return { text: '结果未知', tone: 'warn', status: 'unknown' };
    if (row.status === 'stopped') return { text: '已停止', tone: 'warn', status: 'stopped' };
    return { text: '结果未知', tone: 'warn', status: 'unknown' };
}

function credentialText(draft) {
    if (draft.credentialState === 'configured') return '已配置';
    if (draft.credentialState === 'withheld') return '不回显';
    return '未配置';
}

function credentialPlaceholder(draft) {
    return draft.credentialState === 'missing' ? '未配置' : '已配置，留空不修改';
}

function channelText(draft) {
    if (!draft.exists) return '未配置';
    return draft.enabled ? '已启用' : '已关闭';
}

function safeTarget(value) {
    const text = String(value ?? '').trim();
    return text.toLowerCase().includes('://') ? '' : text;
}

function when(item) {
    if (item.eventDate && item.eventTime) return `${item.eventDate} ${item.eventTime}`;
    if (item.eventDate) return item.eventDate;
    return '';
}

function passesFilter(event, filter) {
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
            } catch (error) {
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
            } catch (error) {
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
                } catch (error) {
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

export function mountInboxPage({ onOpenConversation } = {}) {
    ensureInboxStyles();
    const root = document.createElement('div'); root.className = 'vcms-root vc-inbox-root';
    const dialog = document.createElement('dialog'); dialog.className = 'vc-inbox-dialog'; dialog.setAttribute('aria-label', '主动陪伴');
    root.append(dialog); document.body.append(root);
    let opener = null, layerOpener = null, view = null, dead = false;
    const page = createInboxPage({ onOpenConversation, onChange: paint });
    const events = {
        action, policy: (field, value) => page.setPolicy({ [field]: value }),
        channel: (key, field, value) => page.setChannel(key, { [field]: value }),
        relationship: id => void page.selectRelationship(id), filter: value => page.setInboxFilter(value), mode: value => page.setProactiveMode(value),
        readSecret: key => dead ? '' : page.state.channelDrafts.find(row => row.key === key)?.credential || '',
        voice: id => inboxVoice(page.state, id), authenticate: password => { page.setReauthPassword(password); void page.authenticate(); },
        layerDismiss: closeLayer, returnFocus,
    };
    function paint(state) {
        if (dead || !state.open) return;
        const props = inboxViewProps(state, dialog, events);
        if (view) view.update(props); else view = mountInboxContentsView(dialog, props);
    }
    function returnFocus() {
        const spec = layerOpener; layerOpener = null;
        if (!spec) return null;
        return [...dialog.querySelectorAll('[data-action]')].find(node => node.dataset.action === spec.action
            && (!spec.key || node.dataset.key === spec.key) && (!spec.followUpId || node.dataset.followUpId === spec.followUpId)) || null;
    }
    function closeLayer() {
        if (dead || page.state.busy) return true;
        if (page.state.reauth.open) { page.cancelReauth(); return true; }
        if (page.state.cancelAsk) { page.dismissCancel(); return true; }
        if (page.state.policyConflict) { page.keepPolicyDraft(); return true; }
        return false;
    }
    function close() {
        if (dead || page.state.busy) return;
        page.close(); view?.unmount(); view = null; dialog.close();
        const target = opener; opener = null; layerOpener = null; target?.focus();
    }
    async function action(action, target) {
        if (dead || page.state.busy) return;
        layerOpener = { action, key: target.dataset.key || '', followUpId: target.dataset.followUpId || '' };
        const key = target.dataset.key;
        if (action === 'close') close();
        if (action === 'toggle-enabled') page.togglePolicy('enabled');
        if (action === 'toggle-offline') page.togglePolicy('offlineCapable');
        if (action === 'set-proactive-mode') page.setProactiveMode(target.dataset.mode);
        if (action === 'toggle-mode') page.toggleMode(target.dataset.mode);
        if (action === 'save-policy') await page.savePolicy();
        if (action === 'view-latest-policy') await page.viewLatestPolicy();
        if (action === 'keep-policy-draft') page.keepPolicyDraft();
        if (action === 'toggle-channel') page.toggleChannel(key, 'enabled');
        if (action === 'toggle-preview') page.toggleChannel(key, 'previewBody');
        if (action === 'toggle-relationship') page.toggleRelationship(key, target.dataset.relationshipId);
        if (action === 'clear-credential') page.clearCredential(key);
        if (action === 'save-channel') await page.saveChannel(key);
        if (action === 'ask-cancel') page.askCancel(target.dataset.followUpId);
        if (action === 'confirm-cancel') await page.confirmCancel();
        if (action === 'dismiss-cancel') page.dismissCancel();
        if (action === 'filter-inbox') page.setInboxFilter(target.dataset.filter);
        if (action === 'open-conversation') await page.openConversation(target.dataset.eventId);
        if (action === 'reauth-submit') {
            const input = dialog.querySelector('[data-field="reauth-password"]'), password = input?.value || '';
            if (input) input.value = '';
            page.setReauthPassword(password); await page.authenticate();
        }
        if (action === 'reauth-cancel') page.cancelReauth();
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!closeLayer()) close(); });
    return {
        page,
        open(returnFocusTarget = document.activeElement) {
            if (dead || dialog.open) return;
            opener = returnFocusTarget; dialog.showModal();
            return page.open().then(() => { if (!dead && dialog.open) dialog.querySelector('h1')?.focus(); });
        }, close,
        destroy() { if (dead) return; dead = true; page.destroy(); view?.unmount(); view = null; dialog.close(); root.remove(); },
    };
}

// F4a：vc-ui 开启时把陪伴渲染进外壳容器。关闭时不渲染，仍走上面的对话框。
function inboxVcUi() {
    const body = globalThis.document?.body;
    if (!body?.classList) return false;
    try {
        if (readVcUiFlag()) body.classList.add('vc-ui');
    } catch { /* 存储不可用时只看类名 */ }
    return body.classList.contains('vc-ui') === true;
}

function ensureInboxStyles() {
    const head = document.head || document.documentElement;
    if (!document.getElementById('vc-ui-css')) {
        const ui = document.createElement('link');
        ui.id = 'vc-ui-css';
        ui.rel = 'stylesheet';
        ui.href = new URL('./vc-ui.css', import.meta.url).href;
        head.append(ui);
    }
    if (!document.querySelector('link[data-vc-inbox]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL('./inbox.css', import.meta.url).href;
        link.setAttribute('data-vc-inbox', '');
        head.append(link);
    }
}

function triggerText(item) {
    if (item.triggerAt) {
        const date = new Date(item.triggerAt);
        if (!Number.isNaN(date.getTime())) {
            try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
            catch { /* 落到事件日期 */ }
        }
    }
    return when(item);
}


function instanceLabel(item, relationships) {
    const name = item?.name || '未命名角色';
    if (item?.mode === 'STORY') return `${name} · 剧情`;
    if (item?.mode === 'COMPANION') return `${name} · 日常`;
    const same = (relationships || []).filter((row) => (row?.name || '未命名角色') === name);
    if (same.length < 2) return name;
    const index = same.findIndex((row) => row.relationshipId === item.relationshipId);
    return index < 0 ? name : `${name} · ${index + 1}`;
}

function inboxVoice(state, id) {
    const item = state.inbox.find(row => row.eventId === id);
    return item?.voice ? createVoiceBubble({ text: item.body, voice: item.voice }) : null;
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

function hasInboxDrafts(state) {
    if (inboxPolicyDirty(state)) return true;
    const saved = draftsFromChannels(state.channels, state.relationships[0]?.relationshipId || '');
    const editable = draft => JSON.stringify({ enabled: draft.enabled, previewBody: draft.previewBody, configuredTarget: String(draft.configuredTarget || '').trim(), relationshipIds: [...draft.relationshipIds].sort(), credentialMode: draft.credentialMode });
    return state.channelDrafts.some(draft => { const prior = saved.find(row => row.key === draft.key); return !prior || editable(draft) !== editable(prior); });
}

export function mountInboxTab(container, { onOpenConversation } = {}) {
    if (!inboxVcUi()) return { active: false, refresh() {}, destroy() {} };
    if (!container || typeof container.append !== 'function') throw new Error('mountInboxTab requires a container');
    ensureInboxStyles();
    container.classList.add('vc-inbox-tab', 'vc-desktop-inbox'); container.setAttribute('data-vc-page', 'inbox'); container.replaceChildren();
    const listScreen = document.createElement('div'); listScreen.className = 'vc-screen'; container.append(listScreen);
    const channelViews = new Map();
    const removeChannel = el => { channelViews.get(el)?.unmount(); channelViews.delete(el); };
    const nav = createNav(container, { onRemove: removeChannel });
    const ac = new AbortController(), signal = ac.signal;
    let channelKey = '', channelEl = null, menuHandle = null, listView = null, stopped = false, desktop = desktopLayout();
    let conflictLayer = null, conflictPending = false, reauthDialog = null, reauthView = null;
    const conflictLayers = new Set();
    const page = createInboxPage({ onOpenConversation, onChange: paint, onPolicySaved() { if (!stopped) showToast('已保存', { type: 'ok' }); } });
    const events = {
        action, policy: (field, value) => { if (!stopped) page.setPolicy({ [field]: field === 'quietHoursTimezone' ? quietZoneValue(value, page.state.policyDraft.quietHoursTimezone) : value }); },
        channel: (key, field, value) => { if (!stopped) page.setChannel(key, { [field]: value }); },
        relationship: id => void changeRelationship(id), filter: value => { if (!stopped) page.setInboxFilter(value); }, mode: value => { if (!stopped) page.setProactiveMode(value); },
        readSecret: key => stopped ? '' : page.state.channelDrafts.find(row => row.key === key)?.credential || '',
        voice: id => inboxVoice(page.state, id), authenticate: password => { if (!stopped) { page.setReauthPassword(password); void page.authenticate(); } },
        layerDismiss: () => page.cancelReauth(), returnFocus: () => null,
    };
    const props = () => inboxViewProps(page.state, container, events, { desktop: desktopLayout() });
    function paint(state) {
        if (stopped || !state.open) return;
        const next = props();
        if (listView) listView.update(next); else listView = mountInboxListView(listScreen, next);
        if (channelKey) {
            if (!state.channelDrafts.some(row => row.key === channelKey)) {
                channelKey = ''; if (channelEl) nav.pop(); channelEl = null;
            } else if (!channelEl) {
                const el = document.createElement('section'); el.className = 'vc-screen'; el.setAttribute('aria-label', '渠道');
                channelEl = el;
                nav.push(el, { prepare: node => channelViews.set(node, mountInboxChannelView(node, { ...next, channelKey })) });
            } else channelViews.get(channelEl)?.update({ ...next, channelKey });
        }
        container.classList.toggle('is-detail', Boolean(channelEl?.isConnected));
        syncConflict(next); syncReauth(next);
    }
    async function requestLeave(opener) {
        if (stopped || page.state.busy || page.state.reauth.open) return false;
        if (!inboxPolicyDirty(page.state)) return true;
        if (!await confirmDiscard({ opener, owner: listScreen }) || stopped) return false;
        page.discardChanges(); return true;
    }
    async function changeRelationship(id, opener = document.activeElement) {
        if (await requestLeave(opener)) await page.selectRelationship(id);
    }
    function syncConflict(next) {
        if (!page.state.policyConflict) {
            const current = conflictLayer; conflictLayer = null; void current?.sheet.close(); return;
        }
        if (conflictPending) return;
        if (conflictLayer) { conflictLayer.sheet.setContent(inboxConflictContent(next)); return; }
        let resolveDone;
        const entry = { sheet: null, handled: false, done: new Promise(resolve => { resolveDone = resolve; }) };
        entry.finish = () => { conflictLayers.delete(entry); resolveDone(); };
        entry.sheet = openSheet({ title: '保存冲突', ariaLabel: '保存冲突', owner: listScreen, content: inboxConflictContent(next), canClose: () => !page.state.busy,
            onDone() {
                entry.finish();
                if (conflictLayer !== entry) return;
                conflictLayer = null;
                if (!entry.handled && !stopped && page.state.policyConflict) page.keepPolicyDraft();
            },
        });
        conflictLayers.add(entry); conflictLayer = entry;
    }
    function syncReauth(next) {
        if (!page.state.reauth.open) {
            if (reauthDialog) {
                const current = reauthDialog, targetAction = current.dataset.returnAction;
                reauthDialog = null; reauthView?.unmount(); reauthView = null; current.close(); current.remove();
                (container.querySelector(`[data-action="${targetAction}"]:not(:disabled)`) || container.querySelector('h1'))?.focus({ preventScroll: true });
            }
            return;
        }
        if (!reauthDialog) {
            const dialog = document.createElement('dialog'); dialog.className = 'vc-reauth-dialog';
            dialog.dataset.returnAction = page.state.reauth.action === 'channel' ? 'save-channel' : 'save-policy';
            dialog.setAttribute('aria-labelledby', 'vc-inbox-reauth-title'); dialog.setAttribute('aria-describedby', 'vc-inbox-reauth-description');
            dialog.addEventListener('cancel', event => { event.preventDefault(); page.cancelReauth(); });
            document.body.append(dialog); reauthDialog = dialog;
            reauthView = mountInboxReauthView(dialog, next); dialog.showModal();
        } else reauthView.update(next);
        reauthDialog.setAttribute('aria-busy', String(page.state.busy));
    }
    async function askCancel(id, opener) {
        const ok = await confirmAlert({ title: '取消这条跟进？', message: '取消后不会再对外发送。', action: '取消跟进', opener, owner: listScreen });
        if (!ok || stopped) return;
        page.askCancel(id); await page.confirmCancel();
    }
    async function action(action, target) {
        if (stopped || !page.state.open || page.state.busy || target.closest('.vc-screen')?.inert) return;
        const key = target.dataset.key;
        if (action === 'pick-character') {
            menuHandle?.close(); menuHandle = popMenu(target, page.state.relationships.map(item => ({ label: item.name, check: item.relationshipId === page.state.relationshipId, run: () => void changeRelationship(item.relationshipId, target) })), { below: true });
        }
        if (action === 'toggle-enabled') page.togglePolicy('enabled');
        if (action === 'toggle-offline') page.togglePolicy('offlineCapable');
        if (action === 'set-proactive-mode') page.setProactiveMode(target.dataset.mode);
        if (action === 'toggle-mode') page.toggleMode(target.dataset.mode);
        if (action === 'save-policy') await page.savePolicy();
        if (action === 'view-latest-policy') {
            const current = conflictLayer;
            if (current) {
                current.handled = true; conflictPending = true; void current.sheet.close();
                await Promise.all([current.done, page.viewLatestPolicy()]); conflictPending = false;
                if (!stopped && page.state.policyConflict) syncConflict(props());
            } else await page.viewLatestPolicy();
        }
        if (action === 'keep-policy-draft') { if (conflictLayer) conflictLayer.handled = true; page.keepPolicyDraft(); }
        if (action === 'toggle-channel') page.toggleChannel(key, 'enabled');
        if (action === 'toggle-preview') page.toggleChannel(key, 'previewBody');
        if (action === 'toggle-relationship') page.toggleRelationship(key, target.dataset.relationshipId);
        if (action === 'clear-credential') page.clearCredential(key);
        if (action === 'save-channel') await page.saveChannel(key);
        if (action === 'open-follow') {
            const row = page.state.followUps.find(item => item.followUpId === target.dataset.followUpId);
            if (!row || row.status === 'CANCELLED') return;
            menuHandle?.close(); menuHandle = popMenu(target, [{ label: '取消跟进', danger: true, run: () => { if (!stopped) void askCancel(row.followUpId, target); } }], { below: true });
        }
        if (action === 'ask-cancel') await askCancel(target.dataset.followUpId, target);
        if (action === 'confirm-cancel') await page.confirmCancel();
        if (action === 'dismiss-cancel') page.dismissCancel();
        if (action === 'filter-inbox') page.setInboxFilter(target.dataset.filter);
        if (action === 'open-conversation' && await requestLeave(target)) await page.openConversation(target.dataset.eventId);
        if (action === 'retry-open' && await requestLeave(target)) await page.open();
        if (action === 'open-channel') { channelKey = key || ''; paint(page.state); }
        if (action === 'pop-channel') { channelKey = ''; if (nav.depth) nav.pop(); channelEl = null; container.classList.remove('is-detail'); }
        if (action === 'reauth-cancel') page.cancelReauth();
    }
    globalThis.addEventListener('resize', () => { const next = desktopLayout(); if (desktop !== next && !stopped) { desktop = next; paint(page.state); } }, { signal });
    const shell = container.closest('#vc-shell'); let leaveConfirmed = false;
    shell?.addEventListener('click', async event => {
        const target = event.target?.closest?.('[data-nav],[data-settings]');
        if (!target || leaveConfirmed || stopped || shell.dataset.settings === 'page' || shell.dataset.destination !== 'inbox' || target.getAttribute('data-nav') === 'inbox') return;
        if (page.state.busy || page.state.reauth.open) { event.preventDefault(); event.stopImmediatePropagation(); return; }
        if (!inboxPolicyDirty(page.state)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!await requestLeave(target)) return;
        leaveConfirmed = true; try { target.click(); } finally { leaveConfirmed = false; }
    }, { capture: true, signal });
    void page.open().then(() => { if (!stopped) container.querySelector('h1')?.focus(); });
    return {
        active: true,
        async refresh() { if (stopped || page.state.busy || page.state.reauth.open || hasInboxDrafts(page.state)) return; await page.open(); },
        destroy() {
            if (stopped) return; stopped = true; ac.abort();
            for (const entry of conflictLayers) { entry.sheet.dismiss(); entry.finish(); }
            conflictLayer = null;
            reauthView?.unmount(); reauthView = null; reauthDialog?.close(); reauthDialog?.remove(); reauthDialog = null;
            page.destroy(); listView?.unmount(); listView = null;
            for (const el of channelViews.keys()) { removeChannel(el); el.remove(); }
            channelEl = null; container.replaceChildren(); container.classList.remove('vc-inbox-tab', 'vc-desktop-inbox', 'is-detail');
        },
    };
}
