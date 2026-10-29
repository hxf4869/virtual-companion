// UI-P04 主动陪伴 / 通知。跟进、静默、角色开关、inbox 与邮箱 / 飞书状态。
// 凭据只在本次输入里存在，不回显、不写 localStorage。渠道接受不写成手机已收到。
import { ApiError, captureSessionContext, fetchRelationships, reauth, storyRequest } from './api.js';

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
    return { relationshipId, name: shown(raw?.companionName) || '未命名角色' };
}

function allowPolicy(raw, relationshipId) {
    const modes = Array.isArray(raw?.allowedModes) ? raw.allowedModes.filter((item) => item === 'COMPANION' || item === 'STORY').slice(0, 2) : [];
    return {
        relationshipId,
        enabled: raw?.enabled === true,
        quietHoursStart: timeOf(raw?.quietHoursStart),
        quietHoursEnd: timeOf(raw?.quietHoursEnd),
        quietHoursTimezone: zoneOf(raw?.quietHoursTimezone),
        dailyLimit: intIn(raw?.dailyLimit, 0, 48) ?? 0,
        recentInteractionMinutes: intIn(raw?.recentInteractionMinutes, 0, 10080) ?? 0,
        allowedModes: modes.length ? modes : ['COMPANION'],
        offlineCapable: raw?.offlineCapable === true,
    };
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
    const status = ['pending', 'accepted', 'failed', 'unknown', 'stopped'].includes(raw?.status) ? raw.status : '';
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

function policyBody(draft) {
    const startBlank = blank(draft.quietHoursStart);
    const endBlank = blank(draft.quietHoursEnd);
    const zoneBlank = blank(draft.quietHoursTimezone);
    return {
        enabled: draft.enabled === true,
        quietHoursStart: startBlank ? null : String(draft.quietHoursStart).trim(),
        quietHoursEnd: endBlank ? null : String(draft.quietHoursEnd).trim(),
        quietHoursTimezone: zoneBlank ? null : String(draft.quietHoursTimezone).trim(),
        dailyLimit: intIn(draft.dailyLimit, 0, 48),
        recentInteractionMinutes: intIn(draft.recentInteractionMinutes, 0, 10080),
        allowedModes: Array.isArray(draft.allowedModes) ? draft.allowedModes.filter((item) => item === 'COMPANION' || item === 'STORY') : [],
        offlineCapable: draft.offlineCapable === true,
    };
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

function channelCard(draft, relationships) {
    const preview = draft.previewBody ? 'true' : 'false';
    const people = relationships.map((item) => {
        const pressed = draft.relationshipIds.includes(item.relationshipId);
        return `<button type="button" data-action="toggle-relationship" data-key="${esc(draft.key)}" data-relationship-id="${esc(item.relationshipId)}" aria-pressed="${pressed ? 'true' : 'false'}">${esc(item.name)}</button>`;
    }).join('');
    return `<article class="vc-inbox-channel" data-channel-card data-key="${esc(draft.key)}" data-channel="${esc(draft.channel)}" data-preview="${preview}">
        <div class="vc-inbox-card-head"><h3>${draft.channel === 'FEISHU' ? '飞书' : '邮箱'}</h3><span data-tone="${draft.exists && draft.enabled ? 'ok' : 'warn'}">${esc(channelText(draft))}</span></div>
        ${draft.channel === 'FEISHU' ? '<p>群成员可见</p>' : ''}
        <label class="vc-inbox-wide">${draft.channel === 'FEISHU' ? '群名称' : '收件地址'}<input data-field="configuredTarget" maxlength="320" autocomplete="off" value="${esc(safeTarget(draft.configuredTarget))}"></label>
        <p>凭据 <span>${esc(credentialText(draft))}</span></p>
        <label class="vc-inbox-wide"><input type="password" data-field="credential" aria-label="凭据" autocomplete="off" spellcheck="false"></label>
        <div class="vc-inbox-actions">
            ${button('toggle-channel', draft.enabled ? '已启用' : '已关闭', `data-key="${esc(draft.key)}" data-field="channel-enabled" aria-pressed="${draft.enabled ? 'true' : 'false'}"`)}
            ${button('toggle-preview', `正文预览 ${draft.previewBody ? '开' : '关'}`, `data-key="${esc(draft.key)}" data-field="previewBody" aria-pressed="${preview}"`)}
            ${button('clear-credential', '清除凭据', `data-key="${esc(draft.key)}"`)}
        </div>
        <div class="vc-inbox-actions">${people}</div>
        <div class="vc-inbox-actions">${button('save-channel', '保存渠道', `data-key="${esc(draft.key)}"`, true)}</div>
    </article>`;
}

export function renderInboxPage(state) {
    if (state.loading && state.relationships.length === 0 && state.inbox.length === 0) {
        return '<div class="vc-inbox-page"><p role="status">正在加载</p></div>';
    }
    const draft = state.policyDraft;
    const options = state.relationships.map((item) => `<option value="${esc(item.relationshipId)}" ${item.relationshipId === state.relationshipId ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
    const follows = state.followUps.map((item) => `<article class="vc-inbox-card vc-inbox-follow" data-follow-up-id="${esc(item.followUpId)}" data-status="${esc(item.status)}">
        <div class="vc-inbox-card-head"><h3>${esc(item.body)}</h3><span>${esc(FOLLOW[item.status] || '状态未知')}</span></div>
        ${when(item) ? `<p>${esc(when(item))}</p>` : ''}
        ${item.status === 'CANCELLED' ? '' : `<div class="vc-inbox-actions">${button('ask-cancel', '取消跟进', `data-follow-up-id="${esc(item.followUpId)}"`)}</div>`}
    </article>`).join('');
    const events = state.inbox.filter((item) => passesFilter(item, state.inboxFilter)).map((item) => {
        const name = state.relationships.find((row) => row.relationshipId === item.relationshipId)?.name || '';
        const deliveries = state.deliveries.filter((row) => row.eventId === item.eventId).map((row) => {
            const label = deliveryLabel(row);
            return `<li class="vc-inbox-delivery" data-status="${esc(label.status)}"><span>${row.channel === 'FEISHU' ? '飞书' : '邮箱'}</span><span data-tone="${label.tone}">${esc(label.text)}</span></li>`;
        }).join('');
        const extra = item.linkStatus !== 'present' && item.stDelivered ? '<span data-tone="ok">已写入</span>' : '';
        const waiting = item.intent === 'WAITING_HOST' ? '<p>需要打开此会话继续</p>' : (item.body ? `<p>${esc(item.body)}</p>` : '');
        const open = item.linkStatus === 'present' ? button('open-conversation', '打开此会话', `data-event-id="${esc(item.eventId)}"`, true) : '';
        return `<article class="vc-inbox-card" data-event-id="${esc(item.eventId)}" data-link="${esc(item.linkStatus)}" data-write="${item.stDelivered ? 'written' : 'pending'}">
            <div class="vc-inbox-card-head"><h3>${esc(name)}</h3></div>
            ${waiting}
            <p class="vc-inbox-states"><span data-tone="${item.linkStatus === 'present' && item.stDelivered ? 'ok' : 'warn'}">${esc(writeLabel(item))}</span><span>${item.read ? '应用已读' : '应用未读'}</span>${extra}</p>
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
        <header class="vc-inbox-bar"><h1 tabindex="-1">主动陪伴</h1><label>角色<select data-field="character" aria-label="角色">${options}</select></label>${button('close', '关闭')}</header>
        ${state.error ? `<p role="alert">${esc(state.error)}</p>` : ''}
        <div class="vc-inbox-grid">
            <section class="vc-inbox-section" aria-label="跟进">
                <h2>跟进</h2>
                <div class="vc-inbox-actions">${button('toggle-enabled', draft.enabled ? '主动问候开' : '主动问候关', `data-field="enabled" aria-pressed="${draft.enabled ? 'true' : 'false'}"`)}${button('toggle-offline', draft.offlineCapable ? '离线生成开' : '离线生成关', `data-field="offlineCapable" aria-pressed="${draft.offlineCapable ? 'true' : 'false'}"`)}</div>
                ${waitingHost}
                <div class="vc-inbox-quiet">
                    <label>开始<input data-field="quietHoursStart" value="${esc(draft.quietHoursStart)}" inputmode="numeric" maxlength="5"></label>
                    <label>结束<input data-field="quietHoursEnd" value="${esc(draft.quietHoursEnd)}" inputmode="numeric" maxlength="5"></label>
                    <label>时区<input data-field="quietHoursTimezone" value="${esc(draft.quietHoursTimezone)}" maxlength="64"></label>
                </div>
                <div class="vc-inbox-fields">
                    <label>每日上限<input data-field="dailyLimit" inputmode="numeric" value="${esc(draft.dailyLimit)}"></label>
                    <label>间隔（分钟）<input data-field="recentInteractionMinutes" inputmode="numeric" value="${esc(draft.recentInteractionMinutes)}"></label>
                </div>
                <div class="vc-inbox-actions">${button('toggle-mode', '日常', `data-mode="COMPANION" aria-pressed="${draft.allowedModes.includes('COMPANION') ? 'true' : 'false'}"`)}${button('toggle-mode', '剧情', `data-mode="STORY" aria-pressed="${draft.allowedModes.includes('STORY') ? 'true' : 'false'}"`)}</div>
                ${state.policyError ? `<p role="alert">${esc(state.policyError)}</p>` : ''}
                ${state.policyNotice ? `<p role="status">${esc(state.policyNotice)}</p>` : ''}
                ${follows || '<p role="status">没有跟进</p>'}
                <div class="vc-inbox-actions">${button('save-policy', '保存', state.policyConflict || state.busy ? 'disabled' : '', true)}</div>
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
    return {
        open: false, loading: false, error: '', busy: false, relationships: [], relationshipId: '',
        policyDraft: allowPolicy({}, ''), policyError: '', policyConflict: false, policyStash: null, policyNotice: '',
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
            return;
        }
        const [policyRow, followRows] = await Promise.all([
            getProactivePolicy(relationshipId),
            listFollowUps(relationshipId),
        ]);
        if (!alive(ticket) || state.relationshipId !== relationshipId) return;
        state.policyDraft = allowPolicy(policyRow, relationshipId);
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
                state.relationships = (Array.isArray(relationships) ? relationships : []).map(allowRelationship).filter(Boolean);
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
            quietHoursTimezone: value('quietHoursTimezone'),
            dailyLimit: value('dailyLimit'),
            recentInteractionMinutes: value('recentInteractionMinutes'),
            allowedModes: modes.length ? modes : undefined,
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
