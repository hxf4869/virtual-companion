// UI-P04 主动陪伴 / 通知。跟进、静默、角色开关、inbox 与邮箱 / 飞书状态。
// 凭据只在本次输入里存在，不回显、不写 localStorage。渠道接受不写成手机已收到。
import { ApiError, captureSessionContext, fetchRelationships, reauth, storyRequest } from './api.js';
import { confirmAlert } from './ui/alert.js';
import { bindSegment } from './ui/controls.js';
import { releaseSegment } from './memory-page.js';

export { releaseSegment };
import { icon } from './ui/icons.js';
import { popMenu } from './ui/menu.js';
import { createNav } from './ui/nav.js';
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

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

export async function listFollowUps(relationshipId) {
    if (!DECIMAL.test(relationshipId)) throw invalid('请求内容未通过校验，请检查表单。');
    const data = await storyRequest('GET', `/api/v1/relationships/${relationshipId}/follow-ups`);
    return Array.isArray(data) ? data : [];
}

export async function cancelFollowUp(followUpId) {
    if (!DECIMAL.test(followUpId)) throw invalid('请求内容未通过校验，请检查表单。');
    return storyRequest('POST', `/api/v1/follow-ups/${followUpId}/cancel`);
}

export async function listInbox() {
    const data = await storyRequest('GET', '/api/v1/inbox');
    return Array.isArray(data) ? data : [];
}

export async function markInboxRead(eventId) {
    if (!EVENT.test(eventId)) throw invalid('请求内容未通过校验，请检查表单。');
    return storyRequest('POST', `/api/v1/inbox/${eventId}/read`);
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
    if (all && (!TIME.test(body.quietHoursStart) || !TIME.test(body.quietHoursEnd) || !ZONE.test(body.quietHoursTimezone))) {
        return '静默时段需要同时填写开始、结束和时区。';
    }
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

function button(action, text, extra = '', primary = false) {
    return `<button type="button" class="${primary ? 'vc-inbox-primary' : ''}" data-action="${action}" ${extra}>${text}</button>`;
}

function badge(text, tone = '') {
    return `<span class="vc-inbox-badge"${tone ? ` data-tone="${tone}"` : ''}>${esc(text)}</span>`;
}

function switchControl(action, label, extra, on) {
    const pressed = on ? 'true' : 'false';
    return `<button type="button" class="vc-inbox-switch" role="switch" data-action="${action}" ${extra} aria-checked="${pressed}" aria-pressed="${pressed}"><span class="vc-inbox-switch-label">${label}</span><span class="vc-inbox-switch-track" aria-hidden="true"><span class="vc-inbox-switch-knob"></span></span></button>`;
}

function channelCard(draft, relationships) {
    const preview = draft.previewBody ? 'true' : 'false';
    const people = relationships.map((item) => {
        const pressed = draft.relationshipIds.includes(item.relationshipId);
        return `<button type="button" data-action="toggle-relationship" data-key="${esc(draft.key)}" data-relationship-id="${esc(item.relationshipId)}" aria-pressed="${pressed ? 'true' : 'false'}">${esc(item.name)}</button>`;
    }).join('');
    const credentialTone = draft.credentialState === 'configured' ? 'ok' : 'warn';
    return `<article class="vc-inbox-channel" data-channel-card data-key="${esc(draft.key)}" data-channel="${esc(draft.channel)}" data-preview="${preview}">
        <div class="vc-inbox-card-head"><h3>${draft.channel === 'FEISHU' ? '飞书' : '邮箱'}</h3>${badge(channelText(draft), draft.exists && draft.enabled ? 'ok' : 'warn')}</div>
        ${draft.channel === 'FEISHU' ? '<p>群成员可见</p>' : ''}
        <label class="vc-inbox-wide">${draft.channel === 'FEISHU' ? '群名称' : '收件地址'}<input data-field="configuredTarget" maxlength="320" autocomplete="off" value="${esc(safeTarget(draft.configuredTarget))}"></label>
        <label class="vc-inbox-wide vc-inbox-credential"><span class="vc-inbox-credential-label">凭据 ${badge(credentialText(draft), credentialTone)}</span><input type="password" data-field="credential" aria-label="凭据" placeholder="${esc(credentialPlaceholder(draft))}" autocomplete="off" spellcheck="false"></label>
        ${switchControl('toggle-channel', '启用', `data-key="${esc(draft.key)}" data-field="channel-enabled"`, draft.enabled)}
        ${switchControl('toggle-preview', '正文预览', `data-key="${esc(draft.key)}" data-field="previewBody"`, draft.previewBody)}
        <div class="vc-inbox-actions">${button('clear-credential', '清除凭据', `data-key="${esc(draft.key)}"`)}${people}</div>
        <div class="vc-inbox-actions vc-inbox-savebar">${button('save-channel', '保存渠道', `data-key="${esc(draft.key)}"`, true)}</div>
    </article>`;
}

function proactiveControls(draft) {
    if (!draft?.supportsMode && !draft?.supportsCheckIn) return '';
    const modes = draft.supportsMode
        ? `<h2 class="vc-group-title">模式</h2><div class="vc-group" aria-label="模式">${PROACTIVE_MODES.map((value) => `<button type="button" class="vc-cell" data-action="set-proactive-mode" data-mode="${value}" aria-pressed="${draft.mode === value ? 'true' : 'false'}"><span class="vc-grow">${PROACTIVE_LABELS[value]}</span></button>`).join('')}</div>`
        : '';
    const check = draft.supportsCheckIn
        ? `<div class="vc-group"><label class="vc-cell"><span class="vc-grow">多久没聊</span><input data-field="checkInAfterMinutes" aria-label="多久没聊" inputmode="numeric" value="${esc(draft.checkInAfterMinutes ?? '')}"></label></div>`
        : '';
    return `${modes}${check}`;
}

export function renderInboxPage(state) {
    if (state.loading && state.relationships.length === 0 && state.inbox.length === 0) {
        return '<div class="vc-inbox-page"><p role="status">正在加载</p></div>';
    }
    const draft = state.policyDraft;
    const options = state.relationships.map((item) => `<option value="${esc(item.relationshipId)}" ${item.relationshipId === state.relationshipId ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
    const follows = state.followUps.map((item) => `<article class="vc-inbox-card vc-inbox-follow" data-follow-up-id="${esc(item.followUpId)}" data-status="${esc(item.status)}">
        <div class="vc-inbox-card-head"><h3>${esc(item.body)}</h3>${badge(FOLLOW[item.status] || '状态未知', item.status === 'CANCELLED' ? '' : 'warn')}</div>
        ${when(item) ? `<p>${esc(when(item))}</p>` : ''}
        ${item.status === 'CANCELLED' ? '' : `<div class="vc-inbox-actions">${button('ask-cancel', '取消跟进', `data-follow-up-id="${esc(item.followUpId)}"`)}</div>`}
    </article>`).join('');
    const events = state.inbox.filter((item) => passesFilter(item, state.inboxFilter)).map((item) => {
        const name = state.relationships.find((row) => row.relationshipId === item.relationshipId)?.name || '';
        const deliveries = state.deliveries.filter((row) => row.eventId === item.eventId).map((row) => {
            const label = deliveryLabel(row);
            return `<li class="vc-inbox-delivery" data-status="${esc(label.status)}"><span>${row.channel === 'FEISHU' ? '飞书' : '邮箱'}</span>${badge(label.text, label.tone)}</li>`;
        }).join('');
        const writeTone = item.linkStatus === 'present' && item.stDelivered ? 'ok' : 'warn';
        const extra = item.linkStatus !== 'present' && item.stDelivered ? badge('已写入', 'ok') : '';
        const waiting = item.voice ? `<div data-vc-inbox-voice="${esc(item.eventId)}"></div>` : item.intent === 'WAITING_HOST' ? '<p>需要打开此会话继续</p>' : (item.body ? `<p>${esc(item.body)}</p>` : '');
        const open = item.linkStatus === 'present' ? button('open-conversation', '打开此会话', `data-event-id="${esc(item.eventId)}"`, true) : '';
        return `<article class="vc-inbox-card" data-event-id="${esc(item.eventId)}" data-link="${esc(item.linkStatus)}" data-write="${item.stDelivered ? 'written' : 'pending'}">
            <div class="vc-inbox-card-head"><h3>${esc(name)}</h3>${badge(writeLabel(item), writeTone)}</div>
            ${waiting}
            <p class="vc-inbox-states">${badge(item.read ? '应用已读' : '应用未读', item.read ? 'ok' : '')}${extra}</p>
            ${deliveries ? `<ul class="vc-inbox-states">${deliveries}</ul>` : ''}
            ${open ? `<div class="vc-inbox-actions">${open}</div>` : ''}
        </article>`;
    }).join('');
    const filters = FILTERS.map(([value, label]) => button('filter-inbox', label, `data-filter="${value}" aria-pressed="${state.inboxFilter === value ? 'true' : 'false'}"`)).join('');
    const conflict = state.policyConflict ? `<div class="vc-inbox-layer" role="dialog" aria-label="保存冲突"><p data-tone="warn">这些设置已在另一处更新。你的输入已保留。</p><div class="vc-inbox-actions">${button('view-latest-policy', '查看最新')}${button('keep-policy-draft', '保留草稿', '', true)}</div></div>` : '';
    const cancel = !state.reauth.open && state.cancelAsk ? `<div class="vc-inbox-layer" role="dialog" aria-label="取消跟进"><p>取消这条跟进？</p><div class="vc-inbox-actions">${button('confirm-cancel', '取消跟进', '', true)}${button('dismiss-cancel', '返回')}</div></div>` : '';
    const reauthLayer = state.reauth.open ? `<div class="vc-inbox-layer" role="dialog" aria-label="重新验证身份"><p>需要重新验证身份。</p><label>密码<input type="password" data-field="reauth-password" autocomplete="current-password" spellcheck="false"></label><div class="vc-inbox-actions">${button('reauth-submit', '验证并继续', '', true)}${button('reauth-cancel', '取消')}</div></div>` : '';
    const waitingHost = draft.enabled && !draft.offlineCapable ? '<p>需要打开此会话继续</p>' : '';
    return `<div class="vc-inbox-page">
        ${reauthLayer}${cancel}${conflict}
        <header class="vc-inbox-bar"><button type="button" class="vc-inbox-close" data-action="close">关闭</button><h1 tabindex="-1">主动陪伴</h1><label class="vc-inbox-character">角色<select data-field="character" aria-label="角色">${options}</select></label></header>
        ${state.error ? `<p role="alert">${esc(state.error)}</p>` : ''}
        <div class="vc-inbox-grid">
            <section class="vc-inbox-section" aria-label="跟进">
                <h2>跟进</h2>
                <div class="vc-inbox-switches">${draft.supportsMode ? '' : switchControl('toggle-enabled', '主动问候', 'data-field="enabled"', draft.enabled)}${switchControl('toggle-offline', '离线生成', 'data-field="offlineCapable"', draft.offlineCapable)}</div>
                ${proactiveControls(draft)}
                ${waitingHost}
                <div class="vc-inbox-summary">
                    <article class="vc-inbox-summary-card"><h3>静默时段</h3><div class="vc-inbox-range"><input data-field="quietHoursStart" aria-label="开始" value="${esc(draft.quietHoursStart)}" inputmode="numeric" maxlength="5"><span class="vc-inbox-range-sep" aria-hidden="true">–</span><input data-field="quietHoursEnd" aria-label="结束" value="${esc(draft.quietHoursEnd)}" inputmode="numeric" maxlength="5"></div></article>
                    <article class="vc-inbox-summary-card"><h3>时区</h3><input data-field="quietHoursTimezone" aria-label="时区" value="${esc(draft.quietHoursTimezone)}" maxlength="64"></article>
                    <article class="vc-inbox-summary-card"><h3>每日上限</h3><input data-field="dailyLimit" aria-label="每日上限" inputmode="numeric" value="${esc(draft.dailyLimit)}"><label>间隔（分钟）<input data-field="recentInteractionMinutes" aria-label="间隔（分钟）" inputmode="numeric" value="${esc(draft.recentInteractionMinutes)}"></label></article>
                </div>
                <div class="vc-inbox-actions">${button('toggle-mode', '日常', `data-mode="COMPANION" aria-pressed="${draft.allowedModes.includes('COMPANION') ? 'true' : 'false'}"`)}${button('toggle-mode', '剧情', `data-mode="STORY" aria-pressed="${draft.allowedModes.includes('STORY') ? 'true' : 'false'}"`)}</div>
                ${state.policyError ? `<p role="alert">${esc(state.policyError)}</p>` : ''}
                ${state.policyNotice ? `<p role="status">${esc(state.policyNotice)}</p>` : ''}
                <div class="vc-inbox-savebar">${button('save-policy', '保存', state.policyConflict || state.busy ? 'disabled' : '', true)}</div>
                ${follows || '<p role="status">没有跟进</p>'}
            </section>
            <section class="vc-inbox-section" aria-label="消息">
                <h2>消息</h2>
                <div class="vc-inbox-filters">${filters}</div>
                ${events || '<p role="status">没有消息</p>'}
            </section>
            <section class="vc-inbox-section vc-inbox-span" aria-label="渠道">
                <h2>渠道</h2>
                ${state.channelError ? `<p role="alert">${esc(state.channelError)}</p>` : ''}
                <div class="vc-inbox-channel-row">${state.channelDrafts.map((item) => channelCard(item, state.relationships)).join('')}</div>
            </section>
        </div>
    </div>`;
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

export function createInboxPage({ onChange = () => {}, onOpenConversation = () => {} } = {}) {
    const state = freshState();
    let epoch = 0;
    const emit = () => onChange(state);
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
            state.policyError = '登录状态已变化，请重新打开。';
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
            emit();
        },
        async selectRelationship(relationshipId) {
            const id = decimalId(relationshipId);
            if (!id || id === state.relationshipId || state.busy) return;
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
            state.policyDraft = { ...state.policyDraft, ...partial };
            emit();
        },
        applyForm(form) {
            if (form?.policy) state.policyDraft = { ...state.policyDraft, ...form.policy };
            for (const item of form?.channels || []) {
                const draft = findChannel(item.key);
                if (!draft) continue;
                if (item.enabled !== undefined) draft.enabled = item.enabled;
                if (item.previewBody !== undefined) draft.previewBody = item.previewBody;
                if (item.configuredTarget !== undefined) draft.configuredTarget = item.configuredTarget;
                if (item.relationshipIds) draft.relationshipIds = item.relationshipIds;
                if (item.credential) {
                    draft.credential = item.credential;
                    draft.credentialMode = 'set';
                } else if (draft.credentialMode !== 'clear') {
                    draft.credential = '';
                    draft.credentialMode = 'keep';
                }
            }
        },
        togglePolicy(name) {
            if (name === 'enabled' || name === 'offlineCapable') state.policyDraft[name] = !state.policyDraft[name];
            emit();
        },
        setProactiveMode(mode) {
            if (!state.policyDraft.supportsMode || !PROACTIVE_MODES.includes(mode)) return;
            state.policyDraft.mode = mode;
            state.policyDraft.enabled = mode !== 'OFF';
            emit();
        },
        toggleMode(mode) {
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
            if (state.busy || state.policyConflict || !state.relationshipId) return;
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
            if (!state.relationshipId) return;
            const ticket = epoch;
            state.policyStash = { ...state.policyDraft };
            state.busy = true;
            emit();
            try {
                state.policyDraft = allowPolicy(await getProactivePolicy(state.relationshipId), state.relationshipId);
                if (!alive(ticket)) return;
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
            if (state.policyStash) state.policyDraft = state.policyStash;
            state.policyStash = null;
            state.policyConflict = false;
            emit();
        },
        setChannel(key, partial) {
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
            const draft = findChannel(key);
            if (!draft) return;
            if (field === 'enabled' || field === 'previewBody') draft[field] = !draft[field];
            emit();
        },
        toggleRelationship(key, relationshipId) {
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
            const draft = findChannel(key);
            if (!draft) return;
            draft.credential = '';
            draft.credentialMode = 'clear';
            emit();
        },
        async saveChannel(key) {
            const draft = findChannel(key);
            if (!draft || state.busy) return;
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
            const row = state.followUps.find((item) => item.followUpId === followUpId);
            if (!row || row.status === 'CANCELLED') return;
            state.cancelAsk = followUpId;
            emit();
        },
        dismissCancel() {
            state.cancelAsk = '';
            emit();
        },
        async confirmCancel() {
            const followUpId = state.cancelAsk;
            if (!followUpId || state.busy) return;
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
            if (FILTERS.some(([value]) => value === filter)) state.inboxFilter = filter;
            emit();
        },
        async openConversation(eventId) {
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
        setReauthPassword(password) { state.reauth.password = String(password ?? ''); },
        cancelReauth() {
            state.reauth = { open: false, action: '', password: '', key: '' };
            emit();
        },
        async authenticate() {
            const password = state.reauth.password;
            const action = state.reauth.action;
            const key = state.reauth.key;
            if (!password || state.busy) return;
            const ticket = epoch;
            state.busy = true;
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
                state.policyError = '身份验证未完成，请检查密码后重试。';
                emit();
            }
        },
    };
    return controller;
}

function readForm(dialog) {
    const value = (field) => dialog.querySelector(`[data-field="${field}"]`)?.value ?? '';
    const zoneInput = dialog.querySelector('[data-field="quietHoursTimezone"]');
    const pressed = (field) => dialog.querySelector(`[data-field="${field}"]`)?.getAttribute('aria-pressed') === 'true';
    const modes = ['COMPANION', 'STORY'].filter((mode) => dialog.querySelector(`[data-mode="${mode}"]`)?.getAttribute('aria-pressed') === 'true');
    const channels = [...dialog.querySelectorAll('[data-channel-card]')].map((card) => {
        const people = [...card.querySelectorAll('[data-relationship-id]')];
        return {
            key: card.dataset.key,
            enabled: card.querySelector('[data-field="channel-enabled"]')?.getAttribute('aria-pressed') === 'true',
            previewBody: card.querySelector('[data-field="previewBody"]')?.getAttribute('aria-pressed') === 'true',
            configuredTarget: card.querySelector('[data-field="configuredTarget"]')?.value ?? '',
            relationshipIds: people.length ? people.filter((item) => item.getAttribute('aria-pressed') === 'true').map((item) => item.dataset.relationshipId) : null,
            credential: card.querySelector('[data-field="credential"]')?.value ?? '',
        };
    });
    return {
        policy: {
            enabled: pressed('enabled'),
            offlineCapable: pressed('offlineCapable'),
            quietHoursStart: value('quietHoursStart'),
            quietHoursEnd: value('quietHoursEnd'),
            quietHoursTimezone: quietZoneValue(zoneInput?.value, zoneInput?.getAttribute('data-zone')),
            dailyLimit: value('dailyLimit'),
            recentInteractionMinutes: value('recentInteractionMinutes'),
            allowedModes: modes.length ? modes : undefined,
            ...(dialog.querySelector('[data-action="set-proactive-mode"]') ? { mode: dialog.querySelector('[data-action="set-proactive-mode"][aria-pressed="true"]')?.dataset.mode || '' } : {}),
            ...(dialog.querySelector('[data-field="checkInAfterMinutes"]') ? { checkInAfterMinutes: value('checkInAfterMinutes') } : {}),
        },
        channels,
    };
}

function restoreSecrets(dialog, state) {
    for (const card of dialog.querySelectorAll('[data-channel-card]')) {
        const draft = state.channelDrafts.find((item) => item.key === card.dataset.key);
        const input = card.querySelector('[data-field="credential"]');
        if (input && draft?.credential) input.value = draft.credential;
    }
}

export function mountInboxPage({ onOpenConversation } = {}) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./inbox.css', import.meta.url).href;
    style.setAttribute('data-vc-inbox', '');
    if (!document.querySelector('link[data-vc-inbox]')) (document.head || document.documentElement).append(style);
    const root = document.createElement('div');
    root.className = 'vcms-root vc-inbox-root';
    const dialog = document.createElement('dialog');
    dialog.className = 'vc-inbox-dialog';
    dialog.setAttribute('aria-label', '主动陪伴');
    root.append(dialog);
    document.body.append(root);
    let opener = null;
    let layerOpener = null;
    let layerOpen = false;
    const openerSelector = (spec) => {
        const action = String(spec.action || '').replace(/"/g, '');
        if (spec.followUpId) return `[data-action="${action}"][data-follow-up-id="${String(spec.followUpId).replace(/"/g, '')}"]`;
        if (spec.key) return `[data-action="${action}"][data-key="${String(spec.key).replace(/"/g, '')}"]`;
        return `[data-action="${action}"]`;
    };
    const rememberOpener = (target) => {
        layerOpener = {
            action: target.dataset.action || '',
            followUpId: target.dataset.followUpId || '',
            key: target.dataset.key || '',
        };
    };
    const focusRemembered = () => {
        const spec = layerOpener;
        layerOpener = null;
        if (!spec) return;
        dialog.querySelector(openerSelector(spec))?.focus();
    };
    const page = createInboxPage({
        onOpenConversation,
        onChange(next) {
            if (!next.open) return;
            const layer = Boolean(next.reauth.open || next.cancelAsk || next.policyConflict);
            dialog.innerHTML = renderInboxPage(next);
            mountInboxVoices(dialog,next);
            restoreSecrets(dialog, next);
            if (layer) dialog.querySelector('.vc-inbox-layer button')?.focus();
            else if (layerOpen) focusRemembered();
            layerOpen = layer;
        },
    });
    const closeLayer = () => {
        if (page.state.reauth.open) {
            page.cancelReauth();
            return true;
        }
        if (page.state.cancelAsk) {
            page.dismissCancel();
            return true;
        }
        if (page.state.policyConflict) {
            page.keepPolicyDraft();
            return true;
        }
        return false;
    };
    const close = () => {
        page.close();
        if (dialog.open) dialog.close();
        dialog.innerHTML = '';
        const target = opener;
        opener = null;
        target?.focus();
    };
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if (!closeLayer()) close();
    });
    dialog.addEventListener('change', (event) => {
        if (event.target?.dataset?.field === 'character') void page.selectRelationship(event.target.value);
    });
    dialog.addEventListener('click', (event) => {
        const target = event.target.closest('button');
        if (!target || target.disabled) return;
        page.applyForm(readForm(dialog));
        const action = target.dataset.action;
        const key = target.dataset.key;
        if (action === 'close') close();
        if (action === 'toggle-enabled') page.togglePolicy('enabled');
        if (action === 'toggle-offline') page.togglePolicy('offlineCapable');
        if (action === 'set-proactive-mode') page.setProactiveMode(target.dataset.mode);
        if (action === 'toggle-mode') page.toggleMode(target.dataset.mode);
        if (action === 'save-policy') {
            rememberOpener(target);
            void page.savePolicy();
        }
        if (action === 'view-latest-policy') void page.viewLatestPolicy();
        if (action === 'keep-policy-draft') page.keepPolicyDraft();
        if (action === 'toggle-channel') page.toggleChannel(key, 'enabled');
        if (action === 'toggle-preview') page.toggleChannel(key, 'previewBody');
        if (action === 'toggle-relationship') page.toggleRelationship(key, target.dataset.relationshipId);
        if (action === 'clear-credential') page.clearCredential(key);
        if (action === 'save-channel') void page.saveChannel(key);
        if (action === 'ask-cancel') {
            rememberOpener(target);
            page.askCancel(target.dataset.followUpId);
        }
        if (action === 'confirm-cancel') void page.confirmCancel();
        if (action === 'dismiss-cancel') page.dismissCancel();
        if (action === 'filter-inbox') page.setInboxFilter(target.dataset.filter);
        if (action === 'open-conversation') void page.openConversation(target.dataset.eventId);
        if (action === 'reauth-submit') {
            page.setReauthPassword(dialog.querySelector('[data-field="reauth-password"]')?.value || '');
            void page.authenticate();
        }
        if (action === 'reauth-cancel') page.cancelReauth();
    });
    return {
        page,
        open(returnFocusTarget = document.activeElement) {
            if (dialog.open) return;
            opener = returnFocusTarget;
            dialog.showModal();
            void page.open().then(() => dialog.querySelector('h1')?.focus());
        },
        close,
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

function initialOf(name) {
    const chars = [...String(name || '')];
    return chars[0] || '·';
}

function toneName(tone) {
    if (tone === 'ok') return 'ok';
    if (tone === 'danger') return 'danger';
    return tone === 'warn' ? 'warn' : 'neutral';
}

function statusLine(text, tone, extra = '') {
    const name = toneName(tone);
    return `<span class="vc-status vc-status-${name}"><i class="vc-dot vc-dot-${name}" aria-hidden="true"></i><span class="vc-inbox-badge"${tone ? ` data-tone="${esc(tone)}"` : ''}${extra}>${esc(text)}</span></span>`;
}

function uiSwitch(action, label, extra, on) {
    const pressed = on ? 'true' : 'false';
    return `<div class="vc-cell"><span class="vc-grow">${esc(label)}</span><button type="button" class="vc-inbox-switch vc-switch" role="switch" data-action="${action}" ${extra} aria-checked="${pressed}" aria-pressed="${pressed}" aria-label="${esc(label)}"><span class="vc-clip">${esc(label)}</span></button></div>`;
}

function inboxSkeleton() {
    return `<div class="vc-group" aria-hidden="true">${Array.from({ length: 3 }, () => '<div class="vc-skeleton-row"><span class="vc-skeleton vc-skeleton-avatar"></span><span class="vc-grow"><span class="vc-skeleton vc-skeleton-line"></span><span class="vc-skeleton vc-skeleton-line is-short"></span></span></div>').join('')}</div><p class="vc-clip" role="status">正在加载</p>`;
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

function metaBit(text, tone, dot) {
    const name = tone === 'danger' ? 'danger' : tone === 'warn' ? 'warn' : 'quiet';
    const badge = tone === 'danger' || tone === 'warn' ? ` data-tone="${esc(tone)}"` : '';
    return `<span class="vc-status vc-status-${name}"><i class="vc-dot vc-dot-${dot}" aria-hidden="true"></i><span class="vc-inbox-badge"${badge}>${esc(text)}</span></span>`;
}

function contractClip(text) {
    return `<span class="vc-clip" aria-hidden="true">${esc(text)}</span>`;
}

function deliveryBit(row) {
    const label = deliveryLabel(row);
    const short = {
        accepted: '已接受', pending: '待发送', sending: '发送中', failed: '失败',
        unknown: '结果未知', expired: '过期', stopped: '已停止',
    }[label.status] || label.text;
    const channel = row.channel === 'FEISHU' ? '飞书' : '邮箱';
    const danger = label.status === 'failed';
    const warn = label.status === 'unknown';
    const tone = danger ? 'danger' : warn ? 'warn' : 'quiet';
    const dot = danger ? 'danger' : warn ? 'warn' : (label.status === 'accepted' ? 'ok' : 'neutral');
    const hidden = label.text !== short ? contractClip(label.text) : '';
    return `<span class="vc-inbox-delivery" data-status="${esc(label.status)}">${metaBit(`${channel} ${short}`, tone, dot)}${hidden}</span>`;
}

function messageMeta(item, deliveries) {
    const write = writeLabel(item);
    const writeWarn = write === '链接失效' || write === '当前链接已移除';
    const bits = [metaBit(write, writeWarn ? 'warn' : 'quiet', writeWarn ? 'warn' : (write === '已写入' ? 'ok' : 'neutral'))];
    if (write !== '已写入' && item.linkStatus !== 'present' && item.stDelivered) bits.push(metaBit('已写入', 'quiet', 'ok'));
    bits.push(metaBit(item.read ? '已读' : '未读', 'quiet', item.read ? 'ok' : 'neutral') + contractClip(item.read ? '应用已读' : '应用未读'));
    for (const row of deliveries) bits.push(deliveryBit(row));
    return `<span class="vc-inbox-meta">${bits.map((bit) => `<span class="vc-inbox-meta-item">${bit}</span>`).join('')}</span>`;
}

export function renderInboxTab(state) {
    if (state.loading && state.relationships.length === 0 && state.inbox.length === 0 && !state.error) {
        return `<div class="vc-column"><h1 class="vc-large-title" tabindex="-1" data-vc-owned-title>陪伴</h1>${inboxSkeleton()}</div>`;
    }
    const draft = state.policyDraft;
    const current = state.relationships.find((item) => item.relationshipId === state.relationshipId);
    const options = state.relationships.map((item) => `<option value="${esc(item.relationshipId)}" ${item.relationshipId === state.relationshipId ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
    const character = state.relationships.length ? `<div class="vc-group"><button type="button" class="vc-cell" data-action="pick-character" aria-haspopup="menu" aria-label="角色" ${state.busy ? 'disabled' : ''}><span class="vc-grow">角色</span><span class="vc-value vc-select-value">${esc(current?.name || '未命名角色')}${icon('chevrons-up-down', { size: 16 })}</span></button><select class="vc-clip" data-field="character" aria-label="角色" tabindex="-1" aria-hidden="true">${options}</select></div>` : '';
    const filters = FILTERS.map(([value, label]) => `<button type="button" data-action="filter-inbox" data-filter="${value}" aria-pressed="${state.inboxFilter === value ? 'true' : 'false'}">${label}</button>`).join('');
    const events = state.inbox.filter((item) => passesFilter(item, state.inboxFilter));
    const messages = events.map((item) => {
        const name = state.relationships.find((row) => row.relationshipId === item.relationshipId)?.name || '未命名角色';
        const deliveries = state.deliveries.filter((row) => row.eventId === item.eventId);
        const body = item.intent === 'WAITING_HOST' ? '需要打开此会话继续' : item.body;
        const open = item.linkStatus === 'present';
        if (item.voice) return `<div class="vc-cell vc-inbox-card vc-inbox-msg" data-event-id="${esc(item.eventId)}"><span class="vc-avatar" aria-hidden="true">${esc(initialOf(name))}</span><div class="vc-grow"><b>${esc(name)}</b><div data-vc-inbox-voice="${esc(item.eventId)}"></div>${messageMeta(item,deliveries)}${open ? `<button type="button" class="vc-btn vc-btn-text" data-action="open-conversation" data-event-id="${esc(item.eventId)}">打开此会话</button>` : ''}</div></div>`;
        const tag = open ? 'button' : 'div';
        const action = open ? ' type="button" data-action="open-conversation"' : '';
        return `<${tag} class="vc-cell vc-inbox-card vc-inbox-msg" data-event-id="${esc(item.eventId)}" data-link="${esc(item.linkStatus)}" data-write="${item.stDelivered ? 'written' : 'pending'}"${action}><span class="vc-avatar" aria-hidden="true">${esc(initialOf(name))}</span><span class="vc-grow"><span class="vc-line"><b>${esc(name)}</b></span>${body ? `<span class="vc-inbox-body">${esc(body)}</span>` : ''}${messageMeta(item, deliveries)}${open ? '<span class="vc-clip">打开此会话</span>' : ''}</span></${tag}>`;
    }).join('');
    const messageBlock = state.error && !events.length && !state.inbox.length
        ? `<div class="vc-empty">${icon('wifi-off', { size: 32 })}<p role="alert">${esc(state.error)}</p><button type="button" class="vc-btn vc-btn-text" data-action="retry-open">重试</button></div>`
        : messages
            ? `<div class="vc-group">${messages}</div>`
            : `<div class="vc-empty">${icon('heart', { size: 32 })}<p role="status">没有消息</p>${state.inboxFilter === 'all' ? '' : '<button type="button" class="vc-btn vc-btn-text" data-action="filter-inbox" data-filter="all">全部</button>'}</div>`;
    const follows = state.followUps.map((item) => {
        const name = state.relationships.find((row) => row.relationshipId === item.relationshipId)?.name || '';
        const whenText = triggerText(item);
        const meta = [name, whenText].filter(Boolean).join(' · ');
        const cancelled = item.status === 'CANCELLED';
        const tone = item.status === 'WAITING_HOST' || item.status === 'NEEDS_CLARIFICATION' ? 'warn' : '';
        const main = `<span class="vc-grow"><span class="vc-inbox-body">${esc(item.body)}</span>${meta ? `<span class="vc-meta">${esc(meta)}</span>` : ''}</span><span class="vc-value">${statusLine(FOLLOW[item.status] || '状态未知', tone)}</span>`;
        const control = cancelled
            ? `<div class="vc-inbox-follow-main">${main}</div>`
            : `<button type="button" class="vc-inbox-follow-main" data-action="open-follow" data-follow-up-id="${esc(item.followUpId)}" aria-haspopup="menu">${main}</button><button type="button" class="vc-clip" data-action="ask-cancel" data-follow-up-id="${esc(item.followUpId)}">取消跟进</button>`;
        return `<article class="vc-cell vc-inbox-follow" data-follow-up-id="${esc(item.followUpId)}" data-status="${esc(item.status)}">${control}</article>`;
    }).join('');
    const waitingHost = draft.enabled && !draft.offlineCapable ? '<p class="vc-footnote" role="status">需要打开此会话继续</p>' : '';
    const zoneName = zoneDisplayName(draft.quietHoursTimezone);
    const cancel = state.cancelAsk ? `<div hidden data-vc-layer role="dialog" aria-label="取消跟进"><p>取消这条跟进？</p><button type="button" data-action="confirm-cancel">取消跟进</button><button type="button" data-action="dismiss-cancel">返回</button></div>` : '';
    const conflict = state.policyConflict ? `<div hidden data-vc-layer role="dialog" aria-label="保存冲突"><p data-tone="warn">这些设置已在另一处更新。你的输入已保留。</p><button type="button" data-action="view-latest-policy">查看最新</button><button type="button" data-action="keep-policy-draft">保留草稿</button></div>` : '';
    const reauth = state.reauth.open ? `<div hidden data-vc-layer role="dialog" aria-label="重新验证身份"><p>需要重新验证身份。</p><button type="button" data-action="reauth-submit">验证并继续</button><button type="button" data-action="reauth-cancel">取消</button></div>` : '';
    const channels = state.channelDrafts.map((item) => {
        const title = item.channel === 'FEISHU' ? '飞书' : '邮箱';
        const glyph = item.channel === 'FEISHU' ? 'link' : 'bell';
        return `<button type="button" class="vc-cell vc-inbox-channel-link" data-action="open-channel" data-key="${esc(item.key)}" data-channel="${esc(item.channel)}" data-preview="${item.previewBody ? 'true' : 'false'}"><span class="vc-tile ${item.channel === 'FEISHU' ? 'vc-tile-teal' : 'vc-tile-blue'}">${icon(glyph, { size: 18 })}</span><span class="vc-grow"><span class="vc-inbox-name">${title}</span><span class="vc-meta">${esc(channelText(item))}</span></span><span class="vc-chevron">${icon('chevron-right', { size: 16 })}</span></button>`;
    }).join('');
    return `<div class="vc-column">${reauth}${cancel}${conflict}
        <h1 class="vc-large-title" tabindex="-1" data-vc-owned-title>陪伴</h1>
        ${state.error ? `<p role="alert">${esc(state.error)}</p>` : ''}
        ${character}
        <section aria-label="消息">
            <div class="vc-segment" data-vc-inbox-segment><i class="vc-segment-thumb"></i>${filters}</div>
            ${messageBlock}
        </section>
        <section aria-label="跟进">
            <h2 class="vc-group-title">跟进</h2>
            <div class="vc-group">${follows || '<div class="vc-cell" role="status">没有跟进</div>'}</div>
            ${proactiveControls(draft)}
            <h2 class="vc-group-title">静默时段</h2>
            <div class="vc-group">
                <label class="vc-cell"><span class="vc-grow">开始</span><input data-field="quietHoursStart" aria-label="开始" placeholder="22:00" value="${esc(draft.quietHoursStart)}" inputmode="numeric" maxlength="5"></label>
                <label class="vc-cell"><span class="vc-grow">结束</span><input data-field="quietHoursEnd" aria-label="结束" placeholder="22:00" value="${esc(draft.quietHoursEnd)}" inputmode="numeric" maxlength="5"></label>
                <label class="vc-cell"><span class="vc-grow">时区</span><input data-field="quietHoursTimezone" data-zone="${esc(draft.quietHoursTimezone)}" aria-label="时区" placeholder="中国标准时间" value="${esc(zoneName)}" maxlength="64"></label>
            </div>
            <div class="vc-group vc-inbox-summary">
                <label class="vc-cell"><span class="vc-grow">每日上限</span><input data-field="dailyLimit" aria-label="每日上限" inputmode="numeric" value="${esc(draft.dailyLimit)}"></label>
                <label class="vc-cell"><span class="vc-grow">间隔（分钟）</span><input data-field="recentInteractionMinutes" aria-label="间隔（分钟）" inputmode="numeric" value="${esc(draft.recentInteractionMinutes)}"></label>
                ${draft.supportsMode ? '' : uiSwitch('toggle-enabled', '主动问候', 'data-field="enabled"', draft.enabled)}
                ${uiSwitch('toggle-offline', '离线生成', 'data-field="offlineCapable"', draft.offlineCapable)}
                ${uiSwitch('toggle-mode', '日常', 'data-mode="COMPANION"', draft.allowedModes.includes('COMPANION'))}
                ${uiSwitch('toggle-mode', '剧情', 'data-mode="STORY"', draft.allowedModes.includes('STORY'))}
                ${state.policyError ? `<p role="alert">${esc(state.policyError)}</p>` : ''}
                ${state.policyNotice ? `<p role="status">${esc(state.policyNotice)}</p>` : ''}
            </div>
            ${waitingHost}
        </section>
        <section aria-label="渠道">
            <h2 class="vc-group-title">渠道</h2>
            ${state.channelError ? `<p role="alert">${esc(state.channelError)}</p>` : ''}
            <div class="vc-group vc-inbox-channel-row">${channels}</div>
        </section>
    </div>`;
}

export function renderInboxChannel(state, key) {
    const draft = state.channelDrafts.find((item) => item.key === key);
    if (!draft) return '';
    const title = draft.channel === 'FEISHU' ? '飞书' : '邮箱';
    const preview = draft.previewBody ? 'true' : 'false';
    const people = state.relationships.map((item) => uiSwitch(
        'toggle-relationship',
        instanceLabel(item, state.relationships),
        `data-key="${esc(draft.key)}" data-relationship-id="${esc(item.relationshipId)}"`,
        draft.relationshipIds.includes(item.relationshipId),
    )).join('');
    const field = draft.channel === 'FEISHU' ? '群名称' : '收件地址';
    return `<header class="vc-navbar is-solid"><button type="button" class="vc-circle" data-action="pop-channel" aria-label="返回">${icon('chevron-left')}</button><div class="vc-nav-title">${title}</div><div class="vc-nav-spacer"></div></header>
        <div class="vc-scroll"><div class="vc-column">
            <article class="vc-inbox-channel" data-channel-card data-key="${esc(draft.key)}" data-channel="${esc(draft.channel)}" data-preview="${preview}">
                <div class="vc-group">
                    <label class="vc-cell vc-inbox-wide"><span class="vc-grow">${field}</span><input data-field="configuredTarget" maxlength="320" autocomplete="off" value="${esc(safeTarget(draft.configuredTarget))}" aria-label="${field}" placeholder="未填写"></label>
                    <label class="vc-cell vc-inbox-wide vc-inbox-credential"><span class="vc-grow"><span>凭据</span>${contractClip(credentialText(draft))}</span><input type="password" data-field="credential" aria-label="凭据" placeholder="${esc(credentialPlaceholder(draft))}" autocomplete="off" spellcheck="false"></label>
                    ${uiSwitch('toggle-channel', '启用', `data-key="${esc(draft.key)}" data-field="channel-enabled"`, draft.enabled)}
                    ${uiSwitch('toggle-preview', '正文预览', `data-key="${esc(draft.key)}" data-field="previewBody"`, draft.previewBody)}
                </div>
                ${people ? `<h2 class="vc-group-title">角色</h2><div class="vc-group">${people}</div>` : ''}
                <div class="vc-group"><button type="button" class="vc-cell is-danger" data-action="clear-credential" data-key="${esc(draft.key)}">清除凭据</button></div>
                <div class="vc-inbox-actions"><button type="button" class="vc-btn vc-btn-fill" data-action="save-channel" data-key="${esc(draft.key)}" ${state.busy ? 'disabled' : ''}>保存渠道</button></div>
                ${draft.channel === 'FEISHU' ? '<p class="vc-footnote">群成员可见</p>' : ''}
                ${state.channelError ? `<p role="alert">${esc(state.channelError)}</p>` : ''}
            </article>
        </div></div>`;
}

export function mountInboxTab(container, { onOpenConversation } = {}) {
    if (!inboxVcUi()) return { active: false, refresh() {}, destroy() {} };
    if (!container || typeof container.append !== 'function') throw new Error('mountInboxTab requires a container');
    ensureInboxStyles();
    container.classList.add('vc-inbox-tab');
    container.setAttribute('data-vc-page', 'inbox');
    container.replaceChildren();
    const listScreen = document.createElement('div');
    listScreen.className = 'vc-screen';
    container.append(listScreen);
    const nav = createNav(container);
    const ac = new AbortController();
    let channelKey = '';
    let channelEl = null;
    let menuHandle = null;
    let stopped = false;
    let segmentBinding = null;
    let conflictSheet = null;
    let conflictOpen = false;
    let reauthSheet = null;
    const signal = ac.signal;

    const page = createInboxPage({
        onOpenConversation,
        onChange(next) {
            paint(next);
        },
    });

    function paint(state) {
        if (stopped || !state.open) return;
        const top = listScreen.querySelector('.vc-scroll')?.scrollTop || 0;
        const saveDisabled = !state.relationshipId || state.policyConflict || state.busy || state.loading;
        const saveButton = inboxPolicyDirty(state)
            ? `<button type="button" class="vc-nav-save" data-action="save-policy" ${saveDisabled ? 'disabled' : ''}>保存</button>`
            : '';
        listScreen.innerHTML = `<header class="vc-navbar"><div class="vc-nav-spacer"></div>${saveButton}</header><div class="vc-scroll">${renderInboxTab(state)}</div>`;
        mountInboxVoices(listScreen,state);
        const segment = listScreen.querySelector('[data-vc-inbox-segment]');
        releaseSegment(segmentBinding);
        segmentBinding = null;
        if (segment) {
            segmentBinding = bindSegment(segment, {
                onChange(index) {
                    page.applyForm(readForm(container));
                    page.setInboxFilter(FILTERS[index]?.[0] || 'all');
                },
            });
        }
        const next = listScreen.querySelector('.vc-scroll');
        if (next) next.scrollTop = top;
        if (channelKey) {
            const html = renderInboxChannel(state, channelKey);
            if (!html) {
                channelKey = '';
                if (channelEl) {
                    nav.pop();
                    channelEl = null;
                }
            } else if (!channelEl?.isConnected) {
                channelEl = document.createElement('section');
                channelEl.className = 'vc-screen';
                channelEl.setAttribute('aria-label', '渠道');
                channelEl.innerHTML = html;
                nav.push(channelEl);
                restoreSecrets(container, state);
            } else {
                const secret = channelEl.querySelector('[data-field="credential"]')?.value || '';
                channelEl.innerHTML = html;
                restoreSecrets(container, state);
                const input = channelEl.querySelector('[data-field="credential"]');
                if (input && secret && !input.value) input.value = secret;
            }
        }
        container.classList.toggle('is-detail', Boolean(channelEl?.isConnected));
        syncConflict(state);
        syncReauth(state);
    }

    function syncConflict(state) {
        if (!state.policyConflict) {
            if (conflictSheet) {
                const current = conflictSheet;
                conflictSheet = null;
                conflictOpen = false;
                current.close();
            }
            return;
        }
        if (conflictOpen) return;
        conflictOpen = true;
        let handled = false;
        const body = document.createElement('div');
        body.innerHTML = `<p data-tone="warn">这些设置已在另一处更新。你的输入已保留。</p><div class="vc-inbox-actions"><button type="button" class="vc-btn vc-btn-text" data-action="view-latest-policy">查看最新</button><button type="button" class="vc-btn vc-btn-fill" data-action="keep-policy-draft">保留草稿</button></div>`;
        const sheet = openSheet({
            title: '保存冲突',
            body,
            onDone() {
                conflictSheet = null;
                conflictOpen = false;
                if (!handled && page.state.policyConflict) page.keepPolicyDraft();
            },
        });
        sheet.el.setAttribute('aria-label', '保存冲突');
        conflictSheet = sheet;
        body.addEventListener('click', (event) => {
            const button = event.target.closest('button');
            if (!button) return;
            if (button.dataset.action === 'view-latest-policy') {
                handled = true;
                sheet.close();
                void page.viewLatestPolicy().then(() => {
                    if (page.state.policyConflict && !stopped) {
                        handled = false;
                        conflictOpen = false;
                        syncConflict(page.state);
                    }
                });
            }
            if (button.dataset.action === 'keep-policy-draft') {
                handled = true;
                sheet.close();
                page.keepPolicyDraft();
            }
        });
    }

    function syncReauth(state) {
        if (!state.reauth.open) {
            if (reauthSheet) {
                const current = reauthSheet;
                reauthSheet = null;
                current.close();
            }
            return;
        }
        if (reauthSheet) {
            const note = reauthSheet.el.querySelector('[data-reauth-error]');
            if (note) note.textContent = state.policyError || state.channelError || '';
            return;
        }
        const body = document.createElement('div');
        body.innerHTML = `<p>需要重新验证身份。</p><label class="vc-cell">当前密码<input type="password" data-field="reauth-password" autocomplete="current-password" spellcheck="false"></label><p data-reauth-error role="alert"></p><div class="vc-inbox-actions"><button type="button" class="vc-btn vc-btn-text" data-action="reauth-cancel">取消</button><button type="button" class="vc-btn vc-btn-fill" data-action="reauth-submit">验证并继续</button></div>`;
        const sheet = openSheet({
            title: '重新验证身份',
            body,
            onDone() {
                const current = reauthSheet;
                reauthSheet = null;
                if (current && page.state.reauth.open) page.cancelReauth();
            },
        });
        sheet.el.setAttribute('aria-label', '重新验证身份');
        reauthSheet = sheet;
        const note = body.querySelector('[data-reauth-error]');
        if (note) note.textContent = state.policyError || state.channelError || '';
        body.querySelector('[data-action="reauth-cancel"]').addEventListener('click', () => page.cancelReauth());
        body.querySelector('[data-action="reauth-submit"]').addEventListener('click', () => {
            const input = body.querySelector('[data-field="reauth-password"]');
            page.setReauthPassword(input?.value || '');
            if (input) input.value = '';
            void page.authenticate();
        });
    }

    const policyFields = new Set(['quietHoursStart', 'quietHoursEnd', 'quietHoursTimezone', 'dailyLimit', 'recentInteractionMinutes', 'checkInAfterMinutes']);
    container.addEventListener('input', (event) => {
        const field = event.target?.dataset?.field;
        if (!policyFields.has(field)) return;
        page.applyForm(readForm(container));
        const bar = listScreen.querySelector('.vc-navbar');
        if (!bar) return;
        let button = bar.querySelector('[data-action="save-policy"]');
        if (!inboxPolicyDirty(page.state)) {
            button?.remove();
            return;
        }
        const saveDisabled = !page.state.relationshipId || page.state.policyConflict || page.state.busy || page.state.loading;
        if (!button) {
            button = bar.ownerDocument.createElement('button');
            button.type = 'button';
            button.className = 'vc-nav-save';
            button.dataset.action = 'save-policy';
            button.textContent = '保存';
            bar.append(button);
        }
        button.disabled = saveDisabled;
    }, { signal });
    container.addEventListener('change', (event) => {
        if (event.target?.dataset?.field === 'character') void page.selectRelationship(event.target.value);
    }, { signal });
    container.addEventListener('click', async (event) => {
        const target = event.target.closest('button');
        if (!target || !container.contains(target) || target.disabled) return;
        if (target.closest('[data-vc-layer]')) return;
        page.applyForm(readForm(container));
        const action = target.dataset.action;
        const key = target.dataset.key;
        if (action === 'pick-character') {
            menuHandle?.close();
            menuHandle = popMenu(target, page.state.relationships.map((item) => ({
                label: item.name,
                check: item.relationshipId === page.state.relationshipId,
                run: () => { void page.selectRelationship(item.relationshipId); },
            })), { below: true });
        }
        if (action === 'toggle-enabled') page.togglePolicy('enabled');
        if (action === 'toggle-offline') page.togglePolicy('offlineCapable');
        if (action === 'set-proactive-mode') page.setProactiveMode(target.dataset.mode);
        if (action === 'toggle-mode') page.toggleMode(target.dataset.mode);
        if (action === 'save-policy') void page.savePolicy();
        if (action === 'view-latest-policy') void page.viewLatestPolicy();
        if (action === 'keep-policy-draft') page.keepPolicyDraft();
        if (action === 'toggle-channel') page.toggleChannel(key, 'enabled');
        if (action === 'toggle-preview') page.toggleChannel(key, 'previewBody');
        if (action === 'toggle-relationship') page.toggleRelationship(key, target.dataset.relationshipId);
        if (action === 'clear-credential') page.clearCredential(key);
        if (action === 'save-channel') void page.saveChannel(key);
        if (action === 'open-follow') {
            const followUpId = target.dataset.followUpId;
            const row = page.state.followUps.find((item) => item.followUpId === followUpId);
            if (!row || row.status === 'CANCELLED') return;
            menuHandle?.close();
            const selectorId = globalThis.CSS?.escape ? CSS.escape(String(followUpId)) : String(followUpId).replace(/["\\]/g, '');
            menuHandle = popMenu(target, [{
                label: '取消跟进',
                danger: true,
                run: () => container.querySelector(`[data-action="ask-cancel"][data-follow-up-id="${selectorId}"]`)?.click(),
            }], { below: true });
        }
        if (action === 'ask-cancel') {
            const followUpId = target.dataset.followUpId;
            const ok = await confirmAlert({
                title: '取消这条跟进？',
                message: '取消后不会再对外发送。',
                action: '取消跟进',
                opener: target,
            });
            if (!ok || stopped) return;
            page.askCancel(followUpId);
            await page.confirmCancel();
        }
        if (action === 'confirm-cancel') void page.confirmCancel();
        if (action === 'dismiss-cancel') page.dismissCancel();
        if (action === 'filter-inbox') page.setInboxFilter(target.dataset.filter);
        if (action === 'open-conversation') void page.openConversation(target.dataset.eventId);
        if (action === 'retry-open') await page.open();
        if (action === 'open-channel') {
            channelKey = key || '';
            paint(page.state);
        }
        if (action === 'pop-channel') {
            channelKey = '';
            if (nav.depth) nav.pop();
            channelEl = null;
            container.classList.remove('is-detail');
        }
        if (action === 'reauth-submit') {
            page.setReauthPassword(container.querySelector('[data-field="reauth-password"]')?.value || '');
            void page.authenticate();
        }
        if (action === 'reauth-cancel') page.cancelReauth();
    }, { signal });

    void page.open().then(() => {
        if (!stopped) container.querySelector('h1')?.focus();
    });

    return {
        active: true,
        async refresh() {
            if (stopped) return;
            await page.open();
        },
        destroy() {
            stopped = true;
            releaseSegment(segmentBinding);
            segmentBinding = null;
            menuHandle?.close();
            conflictSheet?.close();
            reauthSheet?.close();
            ac.abort();
            page.close();
            channelEl = null;
            container.replaceChildren();
            container.classList.remove('vc-inbox-tab');
        },
    };
}
