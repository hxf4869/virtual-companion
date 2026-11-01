// UI-P03：沿用扩展深色 tokens；桌面阅读分栏，手机列表/详情独立呈现。
// Go 为唯一数据入口。发生时间使用 time，不从记录时间推算；关闭/切换会废弃迟到响应。
import * as api from './api.js';
import { confirmAlert, confirmDiscard } from './ui/alert.js';
import { desktopLayout } from './desktop/presentation.js';
import { bindSegment, bindSwitch } from './ui/controls.js';
import { icon } from './ui/icons.js';
import { popMenu } from './ui/menu.js';
import { animate } from './ui/motion.js';
import { createNav } from './ui/nav.js';
import { readVcUiFlag } from './ui/theme.js';
import { showToast } from './ui/toast.js';
import { createDiaryPage, DIARY_FONTS, ensureHandwriting, readDiaryFont, renderDiary, writeDiaryFont } from './diary-page.js';
import { createFavoritesPage, glyph, renderFavorites } from './favorites-page.js';

if (typeof globalThis.addEventListener !== 'function' || typeof globalThis.dispatchEvent !== 'function') {
    const bus = new EventTarget();
    globalThis.addEventListener = (type, listener, options) => bus.addEventListener(type, listener, options);
    globalThis.removeEventListener = (type, listener, options) => bus.removeEventListener(type, listener, options);
    globalThis.dispatchEvent = (event) => bus.dispatchEvent(event);
}

export const FORGET_NOTICE = '聊天原文仍保留，可能继续用于当前对话。';
export const MEMORY_EMPTY_DIALOG = '没有找到记忆。试试其他关键词或筛选条件。';
export const MEMORY_EMPTY_TAB = '没有找到记忆';
export const OPEN_MEMORY_EVENT = 'vc-open-memory';
/** 记忆来源 / 收藏「回到对话」：detail = { relationshipId, chatIdentity?, chatFile?, mesId }。 */
export const OPEN_MESSAGE_EVENT = 'vc-open-message';
let memoryOpener = null;

export function bindOpenMemory(open) {
    memoryOpener = typeof open === 'function' ? open : null;
}

export function releaseSegment(handle) {
    if (typeof handle?.dispose === 'function') handle.dispose();
}

export function requestOpenMemory(opener) {
    const detail = { opener };
    globalThis.dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail }));
    if (globalThis.document?.body?.classList?.contains('vc-ui') === true) return detail;
    if (typeof memoryOpener === 'function') memoryOpener(opener);
    return detail;
}
const lifecycleLabels = { ACTIVE: '生效中', SUPERSEDED: '已被替代', FORGETTING: '清理中', FORGOTTEN: '已遗忘' };
const sourceLabels = { VALID: '来源已核验', PENDING_VERIFICATION: '来源待核验', INVALID: '来源已失效' };
const typeLabels = { FACT: '事实', PREFERENCE: '偏好', EVENT: '经历', GOAL: '目标', COMMITMENT: '承诺', SUMMARY: '摘要' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const idOf = item => String(item.memoryId);
const canEdit = item => item?.lifecycle === 'ACTIVE';
function errorText(error) {
    if (error?.kind === 'unauthenticated') return '登录已过期，请重新登录后打开记忆页。';
    if (error?.kind === 'context-changed') return '登录状态已变化，请重新打开记忆页。';
    if (error?.kind === 'not-found') return '这条记忆已不可用，请刷新列表。';
    return '加载失败或操作未完成，请重试。';
}

export function createMemoryPage({ onChange = () => {}, schedule = setTimeout, cancel = clearTimeout } = {}) {
    const state = { open: false, relationships: [], relationshipId: '', filters: {}, filterDraft: {}, items: [], nextCursor: null,
        loading: false, detailLoading: false, selectedId: '', detail: null, evidence: [], evidenceError: '', listError: '', detailError: '',
        editing: false, draft: '', conflict: false, busy: false, reauthAction: null, view: 'list', notice: '' };
    let epoch = 0, listRun = 0, detailRun = 0, timer;
    const emit = () => onChange(state);
    const stopPoll = () => { cancel(timer); timer = undefined; };
    const alive = (e) => state.open && epoch === e;
    const currentDetail = (e, run) => alive(e) && detailRun === run;
    function patchItem(record) { state.items = state.items.map(item => idOf(item) === idOf(record) ? { ...item, ...record } : item); }
    function poll() {
        stopPoll();
        if (!state.open || state.detail?.cleanup?.state !== 'PENDING') return;
        const e = epoch, run = detailRun, id = idOf(state.detail);
        timer = schedule(async () => {
            if (!currentDetail(e, run)) return;
            try {
                const record = await api.fetchMemory(id);
                if (!currentDetail(e, run)) return;
                state.detail = record; patchItem(record); state.detailError = ''; emit(); poll();
            } catch (error) {
                if (currentDetail(e, run)) { state.detailError = '清理状态更新失败，请刷新详情。'; emit(); }
            }
        }, 2000);
    }
    async function loadList(append = false) {
        if (!state.open || !state.relationshipId || (append && (!state.nextCursor || state.loading))) return;
        const e = epoch, run = ++listRun;
        state.loading = true; state.listError = '';
        if (!append) { state.items = []; state.nextCursor = null; }
        emit();
        try {
            const result = await api.fetchMemories(state.relationshipId, { ...state.filters, limit: 20, ...(append ? { cursor: state.nextCursor } : {}) });
            if (!alive(e) || listRun !== run) return;
            state.items = append ? [...state.items, ...result.items] : result.items;
            state.nextCursor = result.nextCursor;
        } catch (error) { if (alive(e) && listRun === run) state.listError = errorText(error); }
        finally { if (alive(e) && listRun === run) { state.loading = false; emit(); } }
    }
    function clearDetail() {
        detailRun++; stopPoll(); state.detail = null; state.selectedId = ''; state.evidence = []; state.evidenceError = ''; state.detailError = '';
        state.detailLoading = false; state.editing = false; state.draft = ''; state.conflict = false; state.notice = ''; state.view = 'list'; state.reauthAction = null;
    }
    async function select(id, preserveDraft = false) {
        if (state.busy) return;
        const e = epoch, run = ++detailRun;
        stopPoll(); state.selectedId = String(id); state.detailLoading = true; state.detailError = ''; state.evidenceError = ''; state.evidence = []; state.view = 'detail';
        if (!preserveDraft) { state.detail = null; state.editing = false; state.draft = ''; state.conflict = false; state.notice = ''; }
        emit();
        try {
            let record = await api.fetchMemory(id);
            // A concurrent correction creates a new identity. Only explicit refresh follows it.
            if (preserveDraft && record.supersededByMemoryId) record = await api.fetchMemory(record.supersededByMemoryId);
            if (!currentDetail(e, run)) return;
            state.detail = record; state.selectedId = idOf(record); state.conflict = false;
            if (!preserveDraft) state.draft = record.summary;
            if (preserveDraft && !canEdit(record)) { state.editing = true; state.notice = '记忆状态已变化，草稿已保留；当前记录无法继续纠正。'; }
            patchItem(record); poll();
            try {
                const evidence = await api.fetchMemoryEvidence(idOf(record));
                if (currentDetail(e, run)) state.evidence = evidence;
            } catch (error) { if (currentDetail(e, run)) state.evidenceError = '来源加载失败，请刷新详情。'; }
        } catch (error) { if (currentDetail(e, run)) state.detailError = errorText(error); }
        finally { if (currentDetail(e, run)) { state.detailLoading = false; emit(); } }
    }
    async function write(action) {
        if (state.busy || !state.detail || state.detailLoading) return;
        if (action === 'save' && (!state.editing || state.conflict || !canEdit(state.detail) || !state.draft.trim())) return;
        if (action === 'forget' && ['FORGETTING', 'FORGOTTEN'].includes(state.detail.lifecycle)) return;
        const e = epoch, run = detailRun, previous = state.detail;
        state.busy = true; state.detailError = ''; state.notice = ''; emit();
        try {
            if (action === 'save') {
                const result = await api.correctMemory(idOf(previous), { summary: state.draft, expectedVersion: previous.version });
                if (!currentDetail(e, run)) return;
                patchItem({ ...previous, lifecycle: 'SUPERSEDED', recallEligible: false, supersededByMemoryId: result.memoryId });
                state.detail = result; state.selectedId = idOf(result); state.draft = result.summary; state.editing = false; state.conflict = false;
                state.notice = '纠正已保存，原记录已被替代。';
                // Do not pretend the old evidence belongs to the replacement.
                state.evidence = [];
                try { const evidence = await api.fetchMemoryEvidence(idOf(result)); if (currentDetail(e, run)) state.evidence = evidence; }
                catch { if (currentDetail(e, run)) state.evidenceError = '来源加载失败，请刷新详情。'; }
            } else {
                const result = await api.forgetMemory(idOf(previous));
                if (!currentDetail(e, run)) return;
                state.detail = { ...previous, lifecycle: 'FORGETTING', recallEligible: false, cleanup: result.cleanup };
                state.editing = false; state.conflict = false; patchItem(state.detail); poll();
            }
            state.reauthAction = null;
            await loadList();
        } catch (error) {
            if (!currentDetail(e, run)) return;
            if (error.status === 409 && error.code === 'MEMORY_VERSION_CONFLICT') state.conflict = true;
            else if (error.kind === 'forbidden') state.reauthAction = action;
            else state.detailError = errorText(error);
        } finally { if (currentDetail(e, run)) { state.busy = false; emit(); } }
    }
    const controller = {
        state,
        async open(preferredRelationshipId) {
            epoch++; listRun++; clearDetail(); state.open = true; state.loading = true; state.busy = false;
            state.items = []; state.relationships = []; state.relationshipId = ''; state.filters = {}; state.filterDraft = {}; state.listError = ''; emit();
            const e = epoch;
            try {
                await api.captureSessionContext();
                if (!alive(e)) return;
                const relationships = (await api.fetchRelationships()).filter((row) => row.personaRef === 'st-character');
                if (!alive(e)) return;
                state.relationships = relationships;
                state.relationshipId = String(relationships.find(r => String(r.relationshipId) === String(preferredRelationshipId))?.relationshipId ?? relationships[0]?.relationshipId ?? '');
                state.loading = false;
                await loadList(); emit();
            } catch (error) { if (alive(e)) { state.loading = false; state.listError = errorText(error); emit(); } }
        },
        close() { epoch++; listRun++; clearDetail(); state.open = false; state.busy = false; state.items = []; emit(); },
        loadList, more: () => loadList(true), select,
        async changeRelationship(id) { if (state.busy) return; clearDetail(); state.relationshipId = String(id); await loadList(); },
        async filter(filters) { if (state.busy) return; clearDetail(); state.filters = filters; state.filterDraft = { ...filters }; await loadList(); },
        back() { if (state.busy || state.editing) return; state.view = 'list'; emit(); },
        edit() { if (!canEdit(state.detail) || state.busy) return; state.editing = true; state.draft = state.detail.summary; state.notice = ''; emit(); },
        setDraft(value) { state.draft = value; },
        setFilterDraft(name, value) { state.filterDraft[name] = value; },
        cancelEdit() { state.editing = false; state.draft = state.detail?.summary || ''; state.conflict = false; emit(); },
        refreshDetail: () => state.selectedId ? select(state.selectedId, state.editing) : undefined,
        save: () => write('save'), forget: () => write('forget'),
        cancelReauth() { state.reauthAction = null; emit(); },
        async authenticate(password) {
            if (state.busy || !password || !state.reauthAction) return;
            const e = epoch, action = state.reauthAction; state.busy = true; emit();
            try { await api.reauth(password); if (!alive(e)) return; state.reauthAction = null; state.busy = false; await write(action); }
            catch { if (alive(e)) { state.busy = false; state.detailError = '身份验证未完成，请检查密码后重试。'; emit(); } }
        },
    };
    return controller;
}

const button = (action, text, disabled = false, style = 'ghost') => `<button type="button" class="vcms-btn vcms-btn-${style}" data-action="${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;
function stamp(value, zone) {
    if (!value) return '未记录';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone || undefined }).format(date); }
    catch { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
}
function statuses(item) {
    return `<span class="vc-memory-state" data-state="${esc(item.lifecycle)}">${esc(lifecycleLabels[item.lifecycle] || '状态未知')}</span><span class="vc-memory-source" data-state="${esc(item.sourceStatus)}">${esc(sourceLabels[item.sourceStatus] || '来源状态未知')}</span>`;
}
function cleanupMarkup(cleanup) {
    if (!cleanup || cleanup.state === 'NONE') return '';
    const text = { PENDING: '清理中：已停止召回，正在清理派生记忆。', DONE: '本次记忆清理已完成。聊天原文和备份不在本次删除范围内。', PARTIAL: '清理部分完成：记忆已停止召回，仍有内容未清理。' }[cleanup.state] || '清理状态未知，请刷新详情。';
    return `<div class="vc-memory-notice" role="status">${text}${cleanup.detail ? `<p>${esc(cleanup.detail)}</p>` : ''}</div>`;
}
function renderDetail(s) {
    if (!s.detail) return `<p class="vc-memory-empty" role="status">${s.detailLoading ? '正在加载记忆…' : s.detailError || '选择一条记忆，查看来源与修订。'}</p>${s.detailError ? button('refresh-detail', '重试详情', s.detailLoading) : ''}`;
    const m = s.detail, time = m.time || {}, instance = s.relationships.find(r => String(r.relationshipId) === String(m.relationshipId));
    return `<div class="vc-memory-detail-body">
        <div class="vc-memory-meta">${statuses(m)}<span>修订 ${esc(m.version)}</span></div>
        <p class="vc-memory-content">${esc(m.summary)}</p>
        <dl class="vc-memory-facts"><div><dt>发生日期</dt><dd>${esc(time.eventDate || '未知')}${time.eventTime ? ` ${esc(time.eventTime)}` : ''}${time.eventTimezone ? ` · ${esc(time.eventTimezone)}` : ''}</dd></div>
        <div><dt>记录时间</dt><dd>${esc(stamp(time.recordedAt))}</dd></div>
        <div><dt>作用范围</dt><dd>${esc(instance?.companionName || '当前角色')} · ${m.mode === 'STORY' ? '剧情' : m.mode === 'DAILY' ? '日常' : '模式未知'} · 仅此角色实例</dd></div>
        <div><dt>召回资格</dt><dd>${m.recallEligible ? '具备资格，实际使用取决于会话与分支' : '当前不参与召回'}</dd></div></dl>
        ${m.sourceStatus === 'PENDING_VERIFICATION' ? '<p class="vc-memory-notice">来源待核验，暂不能作为已确认事实。</p>' : ''}
        ${m.sourceStatus === 'INVALID' ? '<p class="vc-memory-notice">来源已失效，不用于后续召回。</p>' : ''}
        ${cleanupMarkup(m.cleanup)}
        <section><h3>来源</h3>${s.evidenceError ? `<p role="alert">${esc(s.evidenceError)}</p>` : s.detailLoading ? '<p>正在核对来源…</p>' : !s.evidence.length ? '<p>暂无可展示的来源。</p>' : s.evidence.map(e => `<article class="vc-memory-evidence"><strong>${esc(e.chatDisplayName || '来源会话')}</strong><span class="vc-memory-source" data-state="${esc(e.status)}">${esc(sourceLabels[e.status] || '来源状态未知')}</span><p class="vc-memory-secondary">消息 ${esc(e.messageId)} · 修订 ${esc(e.revision)} · ${esc(stamp(e.sourceTimestamp, e.sourceTimezone))}${e.sourceTimezone ? ` · ${esc(e.sourceTimezone)}` : ''}</p>${e.excerpt ? `<blockquote>${esc(e.excerpt)}</blockquote>` : '<p>原文片段不可用。</p>'}</article>`).join('')}</section>
        <section><h3>修订历史</h3>${m.history?.length ? `<ol class="vc-memory-history">${m.history.map(h => `<li><div class="vc-memory-meta"><strong>修订 ${esc(h.version)}</strong><span>${esc(lifecycleLabels[h.lifecycle] || '状态未知')}</span><time>${esc(stamp(h.time?.recordedAt))}</time></div><p>${esc(h.summary)}</p></li>`).join('')}</ol>` : '<p>暂无更早的修订。</p>'}</section>
        ${s.conflict ? '<div class="vc-memory-notice" role="alert">这条记忆已在另一处更新。你的输入已保留，请刷新详情后继续。</div>' : ''}
        ${s.detailError ? `<p role="alert">${esc(s.detailError)}</p>` : ''}${s.notice ? `<p role="status">${esc(s.notice)}</p>` : ''}
        ${s.editing ? `<form data-form="edit"><label for="vc-memory-draft">纠正记忆</label><textarea id="vc-memory-draft" name="summary" rows="5" required ${s.busy ? 'disabled' : ''}>${esc(s.draft)}</textarea><div class="vc-memory-actions">${button('cancel-edit', '取消编辑', s.busy)}<button class="vcms-btn vcms-btn-primary" type="submit" ${s.busy || s.conflict || s.detailLoading || !canEdit(m) ? 'disabled' : ''}>${s.busy ? '保存中…' : '保存修订'}</button></div></form>` : ''}
        <div class="vc-memory-actions">${!s.editing && canEdit(m) ? button('edit', '纠正', s.busy || s.detailLoading, 'primary') : ''}${button('refresh-detail', '刷新详情', s.busy || s.detailLoading)}${!['FORGETTING', 'FORGOTTEN'].includes(m.lifecycle) ? button('confirm-forget', '删除长期记忆', s.busy || s.detailLoading, 'danger') : ''}</div>
    </div>`;
}
export function renderMemoryPage(s) {
    const locked = s.busy || s.editing;
    return `<header class="vcms-header"><h1 class="vcms-title" tabindex="-1">记忆</h1>${button('close', '返回聊天', s.busy)}</header>
    <main class="vc-memory-layout" data-view="${s.view}">
      <section class="vc-memory-list-pane" aria-label="记忆列表"><form class="vc-memory-filters" data-form="filters">
        <label for="vc-memory-instance">角色实例</label><select id="vc-memory-instance" name="relationshipId" ${locked || s.loading ? 'disabled' : ''}>${s.relationships.map(r => `<option value="${esc(r.relationshipId)}" ${String(r.relationshipId) === s.relationshipId ? 'selected' : ''}>${esc(r.companionName || '未命名角色')} · 实例 ${esc(r.relationshipId)}</option>`).join('')}</select>
        <div class="vc-memory-search"><input type="search" name="q" aria-label="搜索记忆" placeholder="搜索记忆" value="${esc(s.filterDraft.q)}" ${locked ? 'disabled' : ''}><button class="vcms-btn vcms-btn-ghost" type="submit" ${locked ? 'disabled' : ''}>搜索</button></div>
        <div class="vc-memory-filter-row"><select name="status" aria-label="记忆状态" ${locked ? 'disabled' : ''}>${[['', '全部状态'], ...Object.entries(lifecycleLabels), ['PENDING_VERIFICATION', '来源待核验'], ['INVALID', '来源已失效']].map(([value, label]) => `<option value="${value}" ${s.filterDraft.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select><details><summary>发生日期</summary><div class="vc-memory-dates"><label>从<input type="date" name="eventDateFrom" value="${esc(s.filterDraft.eventDateFrom)}" ${locked ? 'disabled' : ''}></label><label>至<input type="date" name="eventDateTo" value="${esc(s.filterDraft.eventDateTo)}" ${locked ? 'disabled' : ''}></label><button class="vcms-btn vcms-btn-ghost" type="submit" ${locked ? 'disabled' : ''}>应用日期</button></div></details></div>
      </form>
      <div class="vc-memory-results" aria-busy="${s.loading}">${s.listError ? `<p role="alert">${esc(s.listError)}</p>${button('retry-list', '重试')}` : ''}${!s.relationships.length && !s.loading && !s.listError ? '<p class="vc-memory-empty">还没有角色实例，请先在聊天中绑定角色。</p>' : !s.items.length && !s.loading && !s.listError ? `<p class="vc-memory-empty" role="status">${MEMORY_EMPTY_DIALOG}</p>` : ''}
      <ul class="vc-memory-list">${s.items.map(m => `<li><button type="button" class="vc-memory-row" data-memory-id="${esc(m.memoryId)}" aria-current="${s.detail && idOf(s.detail) === idOf(m) ? 'true' : 'false'}" ${locked ? 'disabled' : ''}><span class="vc-memory-meta">${statuses(m)}${typeLabels[m.type] ? `<span>${typeLabels[m.type]}</span>` : ''}</span><span class="vc-memory-content">${esc(m.summary)}</span><span class="vc-memory-secondary">发生 ${esc(m.time?.eventDate || '日期未知')} · 记录 ${esc(stamp(m.time?.recordedAt))}</span></button></li>`).join('')}</ul>
      ${s.loading ? '<p role="status">正在加载记忆…</p>' : ''}${s.nextCursor ? button('more', '加载更多', s.loading || locked) : ''}</div></section>
      <section class="vc-memory-detail" aria-label="记忆详情" aria-busy="${s.detailLoading}"><header class="vc-memory-detail-header">${button('back', '返回列表', s.busy || s.editing)}<h2 tabindex="-1">记忆详情</h2></header>${renderDetail(s)}</section>
    </main>
    <dialog class="vc-memory-confirm" data-forget-dialog aria-labelledby="vc-memory-forget-title"><h2 id="vc-memory-forget-title">删除这条长期记忆？</h2><p>${FORGET_NOTICE}</p><p>将停止召回这条记忆并清理相关派生内容，不会自动删除聊天原文或全部备份。</p><div class="vc-memory-actions">${button('cancel-forget', '取消')}${button('forget', '删除长期记忆', false, 'danger')}</div></dialog>
    ${s.reauthAction ? `<dialog class="vc-memory-confirm" data-reauth-dialog aria-labelledby="vc-memory-reauth-title"><h2 id="vc-memory-reauth-title">重新验证身份</h2><form data-form="reauth"><label>当前密码<input type="password" name="password" autocomplete="current-password" required ${s.busy ? 'disabled' : ''}></label>${s.detailError ? `<p role="alert">${esc(s.detailError)}</p>` : ''}<div class="vc-memory-actions">${button('cancel-reauth', '取消', s.busy)}<button class="vcms-btn vcms-btn-primary" type="submit" ${s.busy ? 'disabled' : ''}>验证并继续</button></div></form></dialog>` : ''}`;
}

export function mountMemoryPage({ getRelationshipId = () => '' } = {}) {
    const root = document.createElement('div'); root.className = 'vcms-root vc-memory-root';
    const dialog = document.createElement('dialog'); dialog.className = 'vc-memory-dialog'; dialog.setAttribute('aria-label', '记忆');
    root.append(dialog); document.body.append(root);
    let opener;
    function render(state) {
        if (!state.open) return;
        const active = document.activeElement;
        const focusId = active?.id, action = active?.dataset?.action, field = active?.name;
        const datesOpen = dialog.querySelector('.vc-memory-filters details')?.open;
        const selection = active?.tagName === 'TEXTAREA' || active?.type === 'search' ? [active.selectionStart, active.selectionEnd] : null;
        dialog.innerHTML = renderMemoryPage(state);
        if (datesOpen) dialog.querySelector('.vc-memory-filters details').open = true;
        const reauth = dialog.querySelector('[data-reauth-dialog]');
        if (reauth) { reauth.showModal(); reauth.querySelector('input')?.focus(); }
        else {
            const focus = focusId ? dialog.querySelector(`#${focusId}`) : action ? dialog.querySelector(`[data-action="${action}"]`) : field ? dialog.querySelector(`[name="${field}"]`) : null;
            focus?.focus(); if (selection && focus) focus.setSelectionRange(...selection);
        }
    }
    const page = createMemoryPage({ onChange: render });
    const close = () => {
        if (page.state.busy) return;
        if (page.state.editing && page.state.draft !== page.state.detail?.summary && !globalThis.confirm('放弃尚未保存的纠正？')) return;
        page.close(); dialog.close(); dialog.innerHTML = ''; opener?.focus();
    };
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if (event.target.matches('[data-forget-dialog]')) event.target.close();
        else if (event.target.matches('[data-reauth-dialog]')) { if (!page.state.busy) page.cancelReauth(); }
        else close();
    }, true);
    dialog.addEventListener('input', event => {
        if (event.target.name === 'summary') page.setDraft(event.target.value);
        if (['q', 'status', 'eventDateFrom', 'eventDateTo'].includes(event.target.name)) page.setFilterDraft(event.target.name, event.target.value);
        if (['eventDateFrom', 'eventDateTo'].includes(event.target.name)) event.target.form.elements.eventDateTo.setCustomValidity('');
    });
    dialog.addEventListener('change', event => {
        if (event.target.name === 'relationshipId') void page.changeRelationship(event.target.value);
        if (event.target.name === 'status') { page.setFilterDraft('status', event.target.value); event.target.form.requestSubmit(); }
    });
    dialog.addEventListener('submit', event => {
        event.preventDefault(); const form = event.target;
        if (form.dataset.form === 'edit') void page.save();
        if (form.dataset.form === 'filters') {
            const { q, status, eventDateFrom, eventDateTo } = Object.fromEntries(new FormData(form));
            const end = form.elements.eventDateTo;
            end.setCustomValidity(eventDateFrom && eventDateTo && eventDateFrom > eventDateTo ? '结束日期不能早于开始日期。' : '');
            if (form.reportValidity()) void page.filter({ q, status, eventDateFrom, eventDateTo });
        }
        if (form.dataset.form === 'reauth') { const password = form.elements.password.value; form.elements.password.value = ''; void page.authenticate(password); }
    });
    dialog.addEventListener('click', async event => {
        const target = event.target.closest('button'); if (!target || target.disabled) return;
        if (target.dataset.memoryId) { await page.select(target.dataset.memoryId); dialog.querySelector('.vc-memory-detail h2')?.focus(); return; }
        switch (target.dataset.action) {
            case 'close': close(); break;
            case 'back': page.back(); dialog.querySelector('.vc-memory-row[aria-current="true"]')?.focus(); break;
            case 'more': await page.more(); break;
            case 'retry-list': if (!page.state.relationships.length) await page.open(getRelationshipId()); else await page.loadList(); break;
            case 'refresh-detail': await page.refreshDetail(); break;
            case 'edit': page.edit(); dialog.querySelector('textarea')?.focus(); break;
            case 'cancel-edit': page.cancelEdit(); break;
            case 'confirm-forget': dialog.querySelector('[data-forget-dialog]').showModal(); break;
            case 'cancel-forget': dialog.querySelector('[data-forget-dialog]').close(); break;
            case 'forget': dialog.querySelector('[data-forget-dialog]').close(); await page.forget(); break;
            case 'cancel-reauth': page.cancelReauth(); break;
        }
    });
    const controller = {
        open(returnFocusTarget = document.activeElement) {
            if (dialog.open) return;
            opener = returnFocusTarget;
            dialog.showModal();
            void page.open(getRelationshipId());
            dialog.querySelector('h1')?.focus();
        },
        close,
    };
    bindOpenMemory((target) => controller.open(target));
    return controller;
}

// F4a：vc-ui 开启时把记忆渲染进外壳容器。关闭时不渲染，仍走上面的对话框。
const MEMORY_SEGMENTS = [
    ['', '全部'],
    ['PENDING_VERIFICATION', '待核验'],
    ['INVALID', '已失效'],
];
const STATUS_OPTIONS = [['', '全部状态'], ...Object.entries(lifecycleLabels), ['PENDING_VERIFICATION', '来源待核验'], ['INVALID', '来源已失效']];

function vcUiEnabled() {
    const body = globalThis.document?.body;
    if (!body?.classList) return false;
    try {
        if (readVcUiFlag()) body.classList.add('vc-ui');
    } catch { /* 存储不可用时只看类名 */ }
    return body.classList.contains('vc-ui') === true;
}

function ensureMemoryStyles() {
    const head = document.head || document.documentElement;
    if (!document.getElementById('vc-ui-css')) {
        const ui = document.createElement('link');
        ui.id = 'vc-ui-css';
        ui.rel = 'stylesheet';
        ui.href = new URL('./vc-ui.css', import.meta.url).href;
        head.append(ui);
    }
    if (!document.querySelector('link[data-vc-memory-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL('./memory.css', import.meta.url).href;
        link.setAttribute('data-vc-memory-css', '');
        head.append(link);
    }
}

function relationshipLabel(rel, relationships) {
    const name = rel?.companionName || '未命名角色';
    const same = (relationships || []).filter((item) => (item.companionName || '未命名角色') === name);
    if (same.length < 2) return name;
    const index = same.findIndex((item) => String(item.relationshipId) === String(rel.relationshipId));
    if (index < 0) return name;
    return `${name} ${index + 1}`;
}

function modeLabel(mode) {
    if (mode === 'STORY') return '剧情';
    if (mode === 'DAILY') return '日常';
    return '模式未知';
}

function dayLabel(value) {
    if (!value) return '日期未知';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '日期未知';
    try { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date); }
    catch { return String(value); }
}

function toneForLifecycle(lifecycle) {
    if (lifecycle === 'ACTIVE') return 'ok';
    if (lifecycle === 'SUPERSEDED') return 'warn';
    if (lifecycle === 'FORGETTING' || lifecycle === 'FORGOTTEN') return 'danger';
    return 'neutral';
}

function toneForSource(status) {
    if (status === 'VALID') return 'ok';
    if (status === 'PENDING_VERIFICATION') return 'warn';
    if (status === 'INVALID') return 'danger';
    return 'neutral';
}

function dotStatus(cls, state, tone, text) {
    return `<span class="vc-status vc-status-${tone} ${cls}" data-state="${esc(state)}"><i class="vc-dot vc-dot-${tone}" aria-hidden="true"></i>${esc(text)}</span>`;
}

function memoryStatuses(item) {
    const life = lifecycleLabels[item.lifecycle] || '状态未知';
    const source = sourceLabels[item.sourceStatus] || '来源状态未知';
    return `${dotStatus('vc-memory-state', item.lifecycle, toneForLifecycle(item.lifecycle), life)}${dotStatus('vc-memory-source', item.sourceStatus, toneForSource(item.sourceStatus), source)}`;
}

function dateFilterLabel(draft) {
    const from = draft?.eventDateFrom || '';
    const to = draft?.eventDateTo || '';
    if (from && to) return `${from} – ${to}`;
    if (from || to) return [from, to].filter(Boolean).join(' – ');
    return '全部';
}

function listStatus(item) {
    const life = item?.lifecycle;
    const source = item?.sourceStatus;
    if (life === 'FORGETTING' || item?.cleanup?.state === 'PENDING') return dotStatus('vc-memory-state', life || 'FORGETTING', 'danger', lifecycleLabels.FORGETTING);
    if (life === 'FORGOTTEN') return dotStatus('vc-memory-state', life, 'danger', lifecycleLabels.FORGOTTEN);
    if (life === 'SUPERSEDED') return dotStatus('vc-memory-state', life, 'warn', lifecycleLabels.SUPERSEDED);
    if (source === 'INVALID') return dotStatus('vc-memory-source', source, 'danger', sourceLabels.INVALID);
    if (source === 'PENDING_VERIFICATION') return dotStatus('vc-memory-source', source, 'warn', sourceLabels.PENDING_VERIFICATION);
    return '';
}

function tabBtn(action, text, { disabled = false, fill = false, danger = false, extra = '' } = {}) {
    const cls = fill ? 'vc-btn vc-btn-fill' : `vc-btn vc-btn-text${danger ? ' is-danger' : ''}`;
    return `<button type="button" class="${cls}" data-action="${action}" ${extra} ${disabled ? 'disabled' : ''}>${text}</button>`;
}

function skeletonRows(count = 3) {
    return `<div class="vc-group" aria-hidden="true">${Array.from({ length: count }, () => '<div class="vc-skeleton-row"><span class="vc-grow"><span class="vc-skeleton vc-skeleton-line"></span><span class="vc-skeleton vc-skeleton-line is-short"></span></span></div>').join('')}</div>`;
}

function emptyBlock(glyph, text, action, label) {
    return `<div class="vc-empty">${icon(glyph, { size: 32 })}<p class="vc-memory-empty" role="status">${text}</p>${action ? tabBtn(action, label, { fill: true }) : ''}</div>`;
}

export function renderMemoryTab(s) {
    const locked = s.busy || s.editing;
    const current = (s.relationships || []).find((item) => String(item.relationshipId) === String(s.relationshipId));
    const segment = MEMORY_SEGMENTS.findIndex(([value]) => value === (s.filters?.status || ''));
    const pressed = segment >= 0 ? segment : 0;
    const statusSelect = STATUS_OPTIONS.map(([value, label]) => `<option value="${esc(value)}" ${(s.filterDraft?.status || '') === value ? 'selected' : ''}>${label}</option>`).join('');
    const instanceOptions = (s.relationships || []).map((item) => `<option value="${esc(item.relationshipId)}" ${String(item.relationshipId) === String(s.relationshipId) ? 'selected' : ''}>${esc(relationshipLabel(item, s.relationships))}</option>`).join('');
    const segments = MEMORY_SEGMENTS.map(([value, label], index) => `<button type="button" data-status="${esc(value)}" aria-pressed="${index === pressed ? 'true' : 'false'}">${label}</button>`).join('');
    const disableField = locked ? 'disabled' : '';
    const instanceRow = (s.relationships || []).length ? `<div class="vc-group"><button type="button" class="vc-cell" id="vc-memory-instance" data-action="pick-instance" aria-haspopup="menu" ${locked || s.loading ? 'disabled' : ''}><span class="vc-grow">实例</span><span class="vc-value vc-select-value">${esc(current ? relationshipLabel(current, s.relationships) : '未命名角色')}${icon('chevrons-up-down', { size: 16 })}</span></button></div>` : '';
    let results = '';
    if (s.listError) {
        results = `<div class="vc-empty">${icon('wifi-off', { size: 32 })}<p role="alert">${esc(s.listError)}</p>${tabBtn('retry-list', '重试', { fill: true })}</div>`;
    } else if (s.loading && !(s.items || []).length) {
        results = `${skeletonRows()}<p class="vc-clip" role="status">正在加载记忆…</p>`;
    } else if (!(s.relationships || []).length) {
        results = emptyBlock('brain', '还没有角色实例，请先在聊天中绑定角色。', 'retry-list', '重试');
    } else if (!(s.items || []).length) {
        // 桌面无筛选时没有可清除的条件，只给图标与一句话（DESIGN 16.5）；手机保持原样。
        const filtered = Object.values(s.filters || {}).some((value) => String(value ?? '').trim() !== '');
        results = `<div class="vc-empty">${icon('brain', { size: 32 })}<p class="vc-memory-empty" role="status">${MEMORY_EMPTY_TAB}</p>${filtered || !desktopLayout() ? tabBtn('clear-filters', '清除筛选', { fill: true }) : ''}</div>`;
    } else {
        const rows = s.items.map((item) => {
            const rel = (s.relationships || []).find((row) => String(row.relationshipId) === String(item.relationshipId));
            const meta = `${rel?.companionName || '未命名角色'} · ${modeLabel(item.mode)} · ${dayLabel(item.time?.eventDate)}`;
            const status = listStatus(item);
            const currentRow = s.detail && idOf(s.detail) === idOf(item);
            return `<li><button type="button" class="vc-cell vc-memory-row" data-memory-id="${esc(item.memoryId)}" aria-current="${currentRow ? 'true' : 'false'}" ${locked ? 'disabled' : ''}><span class="vc-grow"><span class="vc-memory-summary vc-memory-content">${esc(item.summary)}</span><span class="vc-meta">${esc(meta)}</span>${status}</span><span class="vc-chevron">${icon('chevron-right', { size: 16 })}</span></button></li>`;
        }).join('');
        results = `<div class="vc-group"><ul class="vc-memory-list">${rows}</ul></div>${s.loading ? '<p role="status">正在加载记忆…</p>' : ''}${s.nextCursor ? tabBtn('more', '加载更多', { disabled: s.loading || locked }) : ''}`;
    }
    return `<div class="vc-column">
        <h1 class="vc-large-title" tabindex="-1" data-vc-owned-title>记忆</h1>
        <form class="vc-memory-filters" data-form="filters">
            <select class="vc-clip" name="relationshipId" aria-label="角色实例" tabindex="-1" aria-hidden="true" ${locked || s.loading ? 'disabled' : ''}>${instanceOptions}</select>
            <select class="vc-clip" name="status" aria-label="记忆状态" tabindex="-1" aria-hidden="true" ${disableField}>${statusSelect}</select>
            ${instanceRow}
            <label class="vc-search"><span class="vc-clip">搜索记忆</span>${icon('search', { size: 18 })}<input type="search" name="q" aria-label="搜索记忆" placeholder="搜索记忆" value="${esc(s.filterDraft?.q || '')}" ${disableField}><button class="vc-clip" type="submit" ${disableField}>搜索</button></label>
            <div class="vc-segment" data-vc-memory-segment aria-label="记忆状态"><i class="vc-segment-thumb"></i>${segments}</div>
            <div class="vc-group"><details><summary class="vc-cell"><span class="vc-grow">发生日期</span><span class="vc-value vc-select-value">${esc(dateFilterLabel(s.filterDraft))}${icon('chevrons-up-down', { size: 16 })}</span></summary><div class="vc-memory-dates"><label>从<input type="date" name="eventDateFrom" value="${esc(s.filterDraft?.eventDateFrom || '')}" ${disableField}></label><label>至<input type="date" name="eventDateTo" value="${esc(s.filterDraft?.eventDateTo || '')}" ${disableField}></label><button class="vc-btn vc-btn-text" type="submit" ${disableField}>应用日期</button></div></details></div>
        </form>
        <div class="vc-memory-results" aria-busy="${s.loading ? 'true' : 'false'}" aria-label="记忆列表">${results}</div>
    </div>`;
}

// ---- UX-31 桌面时间线（左栏分区 + 按日分组的卡片）。手机与上面的 renderMemoryTab 保持原样。 ----
export const MEMORY_SECTIONS = Object.freeze([
    ['timeline', '时间线', 'clock', ''],
    ['pinned', '已钉住', 'pin', 'ACTIVE'],
    ['pending', '待核验', 'circle-check', 'PENDING_VERIFICATION'],
    ['invalid', '已失效', 'ban', 'INVALID'],
]);
export const SECTION_STATUS = Object.freeze(Object.fromEntries(MEMORY_SECTIONS.map(([key, , , status]) => [key, status])));
export const INCOGNITO_LABEL = '新对话不记';
const pad2 = (n) => String(n).padStart(2, '0');
const localKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export function dayKeyOf(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : localKey(date);
}

/** 今天 / 昨天 / M月D日（跨年带年份）。 */
export function dayGroupLabel(key, now = new Date()) {
    if (!key) return '日期未知';
    if (key === localKey(now)) return '今天';
    if (key === localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return '昨天';
    const [year, month, day] = key.split('-').map(Number);
    return year === now.getFullYear() ? `${month}月${day}日` : `${year}年${month}月${day}日`;
}

export function clockOf(value) {
    if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export const memoryMoment = (item) => item?.time?.recordedAt || item?.createdAt || item?.time?.eventDate || '';

/** 按本地日期分组，保持接口返回的顺序（新的在前）。 */
export function groupTimeline(items, now = new Date()) {
    const groups = [];
    for (const item of items) {
        const key = dayKeyOf(memoryMoment(item));
        let group = groups.find((entry) => entry.key === key);
        if (!group) { group = { key, label: dayGroupLabel(key, now), items: [] }; groups.push(group); }
        group.items.push(item);
    }
    return groups;
}

export function excerptOf(text, max = 36) {
    const chars = [...String(text ?? '').replace(/\s+/g, ' ').trim()];
    return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

/** st:<chatIdentity>:<messageId>:… */
export function parseSourceRef(ref) {
    const match = /^st:([^:]+):([^:]+):/.exec(String(ref ?? ''));
    if (!match) return null;
    return { chatIdentity: match[1], messageId: match[2], mesId: /^\d+$/.test(match[2]) ? Number(match[2]) : null };
}

/** 卡片上的「来自 今天 15:42：「……」」；没有可展示的摘录时返回 null。 */
export function pickSource(evidence, now = new Date()) {
    const row = (evidence || []).find((item) => item?.status === 'VALID' && String(item.excerpt ?? '').trim())
        || (evidence || []).find((item) => String(item?.excerpt ?? '').trim());
    if (!row) return null;
    const key = dayKeyOf(row.sourceTimestamp);
    const when = key ? `${dayGroupLabel(key, now)} ${clockOf(row.sourceTimestamp)}`.trim() : '';
    const ref = parseSourceRef(row.sourceRef);
    return { line: `来自${when ? ` ${when}` : ''}：「${excerptOf(row.excerpt)}」`, chatIdentity: ref?.chatIdentity || '', messageId: String(row.messageId || ref?.messageId || ''), mesId: ref?.mesId ?? (/^\d+$/.test(String(row.messageId)) ? Number(row.messageId) : null) };
}

function memoryCard(item, s, ui, locked) {
    const id = idOf(item);
    const pinned = Boolean(item.pinnedAt);
    const editing = ui.inlineId === id && s.editing;
    const at = memoryMoment(item);
    const status = listStatus(item);
    const forgetting = ['FORGETTING', 'FORGOTTEN'].includes(item.lifecycle);
    const source = ui.sources?.get(id);
    const sourceButton = `<button type="button" class="vc-mem-source" data-action="open-source" data-mid="${esc(id)}" ${source ? '' : 'hidden'}>${source ? esc(source.line) : ''}</button>`;
    if (editing) {
        return `<li class="vc-mem-card is-editing" data-mid="${esc(id)}"><div class="vc-mem-edit"><textarea id="vc-memory-draft" name="summary" rows="2" aria-label="编辑" required ${s.busy ? 'disabled' : ''}>${esc(s.draft)}</textarea>
            <div class="vc-mem-edit-actions"><button type="button" class="vc-btn vc-btn-gray" data-action="cancel-inline" ${s.busy ? 'disabled' : ''}>取消</button><button type="button" class="vc-btn vc-btn-fill" data-action="save-inline" ${s.busy ? 'disabled' : ''}>保存</button></div></div>${sourceButton}</li>`;
    }
    const actions = [
        `<button type="button" class="vc-circle" data-action="pin" data-mid="${esc(id)}" aria-pressed="${pinned}" aria-label="${pinned ? '取消钉住' : '钉住'}" ${locked || item.lifecycle !== 'ACTIVE' ? 'disabled' : ''}>${glyph('pin', 18)}</button>`,
        item.lifecycle === 'ACTIVE' ? `<button type="button" class="vc-circle" data-action="edit-inline" data-mid="${esc(id)}" aria-label="编辑" ${locked ? 'disabled' : ''}>${icon('pencil', { size: 18 })}</button>` : '',
        forgetting ? '' : `<button type="button" class="vc-circle" data-action="forget-inline" data-mid="${esc(id)}" aria-label="忘记" ${locked ? 'disabled' : ''}>${icon('trash-2', { size: 18 })}</button>`,
    ].join('');
    const current = s.detail && idOf(s.detail) === id;
    return `<li class="vc-mem-card" data-pinned="${pinned}">
        <button type="button" class="vc-cell vc-memory-row vc-mem-row" data-memory-id="${esc(id)}" aria-current="${current ? 'true' : 'false'}" ${locked ? 'disabled' : ''}><span class="vc-grow"><span class="vc-memory-summary vc-memory-content">${esc(item.summary)}</span>${status}</span></button>
        ${sourceButton}
        <div class="vc-mem-side"><div class="vc-mem-actions">${actions}</div><time class="vc-mem-time">${esc(clockOf(at))}</time>${pinned ? `<span class="vc-mem-pin" role="img" aria-label="已钉住">${glyph('pin', 16)}</span>` : ''}</div></li>`;
}

export function renderDesktopMemory(s, ui = {}) {
    const section = ui.section || 'timeline';
    const now = ui.now || new Date();
    const locked = s.busy || s.editing;
    const relationships = s.relationships || [];
    const current = relationships.find((item) => String(item.relationshipId) === String(s.relationshipId));
    const memorySection = MEMORY_SECTIONS.some(([key]) => key === section);
    const items = section === 'pinned' ? (s.items || []).filter((item) => item.pinnedAt) : (s.items || []);
    const loaded = !s.loading && !s.listError && relationships.length > 0;
    const navItem = ([key, label, mark]) => `<button type="button" class="vc-mem-nav-item" data-action="section" data-section="${key}" aria-pressed="${section === key}" ${locked ? 'disabled' : ''}>${key === 'diary' ? icon('file-text', { size: 20 }) : glyph(mark, 20)}<span class="vc-grow">${label}</span>${key === section && memorySection && loaded ? `<span class="vc-mem-count">${items.length}${s.nextCursor ? '+' : ''}</span>` : ''}</button>`;
    const instance = relationships.length
        ? `<div class="vc-group"><button type="button" class="vc-cell" id="vc-memory-instance" data-action="pick-instance" aria-haspopup="menu" ${locked || s.loading ? 'disabled' : ''}><span class="vc-grow">实例</span><span class="vc-value vc-select-value">${esc(current ? relationshipLabel(current, relationships) : '未命名角色')}${icon('chevrons-up-down', { size: 16 })}</span></button></div>` : '';
    const side = `<aside class="vc-memory-sidebar">${instance}<nav class="vc-mem-nav" aria-label="记忆">${MEMORY_SECTIONS.map(navItem).join('')}<hr>${navItem(['diary', '日记', ''])}<button type="button" class="vc-mem-nav-item" data-action="section" data-section="favorites" aria-pressed="${section === 'favorites'}" ${locked ? 'disabled' : ''}>${glyph('star', 20)}<span class="vc-grow">收藏</span></button></nav>
        <div class="vc-mem-incognito"><span class="vc-grow">${INCOGNITO_LABEL}</span><button type="button" class="vc-switch" role="switch" data-vc-incognito aria-label="${INCOGNITO_LABEL}" aria-checked="${ui.incognito === true ? 'true' : 'false'}"></button></div></aside>`;
    let main;
    if (section === 'diary') main = ui.diary ? renderDiary(ui.diary, { font: ui.font }) : '';
    else if (section === 'favorites') {
        const names = Object.fromEntries(relationships.map((item) => [String(item.relationshipId), item.companionName || '']));
        main = ui.favorites ? renderFavorites(ui.favorites, { names, now }) : '';
    } else {
        const disable = locked ? 'disabled' : '';
        const search = `<form class="vc-mem-search" data-form="dfilters"><label class="vc-search"><span class="vc-clip">搜索记忆</span>${icon('search', { size: 18 })}<input type="search" name="q" aria-label="搜索记忆" placeholder="搜索记忆" value="${esc(s.filterDraft?.q || '')}" ${disable}><button class="vc-clip" type="submit" ${disable}>搜索</button></label>
            <details class="vc-mem-dates"><summary class="vc-circle" aria-label="发生日期">${icon('sliders-horizontal', { size: 18 })}</summary><div class="vc-memory-dates"><label>从<input type="date" name="eventDateFrom" value="${esc(s.filterDraft?.eventDateFrom || '')}" ${disable}></label><label>至<input type="date" name="eventDateTo" value="${esc(s.filterDraft?.eventDateTo || '')}" ${disable}></label><button class="vc-btn vc-btn-text" type="submit" ${disable}>应用日期</button></div></details></form>`;
        let results;
        if (s.listError) results = `<div class="vc-empty">${icon('wifi-off', { size: 32 })}<p role="alert">${esc(s.listError)}</p>${tabBtn('retry-list', '重试', { fill: true })}</div>`;
        else if (s.loading && !items.length) results = `${skeletonRows()}<p class="vc-clip" role="status">正在加载记忆…</p>`;
        else if (!relationships.length) results = emptyBlock('brain', '还没有角色实例，请先在聊天中绑定角色。', 'retry-list', '重试');
        else if (!items.length) {
            const filtered = Object.entries(s.filters || {}).some(([key, value]) => key !== 'status' && String(value ?? '').trim() !== '');
            results = `<div class="vc-empty">${icon('brain', { size: 32 })}<p class="vc-memory-empty" role="status">${MEMORY_EMPTY_TAB}</p>${filtered ? tabBtn('clear-filters', '清除筛选', { fill: true }) : ''}</div>`;
        } else {
            results = groupTimeline(items, now).map((group) => `<section class="vc-mem-day" aria-label="${esc(group.label)}"><h2>${esc(group.label)}</h2><ul class="vc-memory-list">${group.items.map((item) => memoryCard(item, s, ui, locked)).join('')}</ul></section>`).join('')
                + `${s.loading ? '<p role="status">正在加载记忆…</p>' : ''}${s.nextCursor ? tabBtn('more', '加载更多', { disabled: s.loading || locked }) : ''}`;
        }
        main = `${search}<div class="vc-memory-results" aria-busy="${s.loading ? 'true' : 'false'}" aria-label="记忆列表">${results}</div>`;
    }
    return `<div class="vc-column" data-vc-section="${esc(section)}"><h1 class="vc-large-title" tabindex="-1" data-vc-owned-title>记忆</h1><div class="vc-memory-filters">${side}<div class="vc-memory-main">${main}</div></div></div>`;
}

export function renderMemoryDetailTab(s) {
    const backDisabled = s.busy || s.editing;
    const refreshDisabled = s.busy || s.detailLoading || s.editing;
    return `<header class="vc-navbar is-solid"><button type="button" class="vc-circle" data-action="back" aria-label="返回列表" ${backDisabled ? 'disabled' : ''}>${icon('chevron-left')}</button><div class="vc-nav-title">记忆详情</div><div class="vc-nav-spacer"></div><button type="button" class="vc-circle" data-action="refresh-detail" aria-label="刷新详情" ${refreshDisabled ? 'disabled' : ''}>${icon('refresh-cw')}</button></header><div class="vc-scroll"><div class="vc-column">${renderMemoryDetailBody(s)}</div></div>`;
}

function renderMemoryDetailBody(s) {
    if (!s.detail) {
        if (s.detailLoading) return `${skeletonRows()}<p class="vc-clip" role="status">正在加载记忆…</p>`;
        return `<div class="vc-empty">${icon(s.detailError ? 'wifi-off' : 'brain', { size: 32 })}<p class="vc-memory-empty" role="${s.detailError ? 'alert' : 'status'}">${esc(s.detailError || '选择一条记忆，查看来源与修订。')}</p>${s.detailError ? tabBtn('refresh-detail', '重试详情', { fill: true, disabled: s.detailLoading }) : ''}</div>`;
    }
    const m = s.detail;
    const time = m.time || {};
    const instance = (s.relationships || []).find((item) => String(item.relationshipId) === String(m.relationshipId));
    const evidence = s.evidenceError
        ? `<p role="alert">${esc(s.evidenceError)}</p>`
        : s.detailLoading
            ? '<p role="status">正在核对来源…</p>'
            : !(s.evidence || []).length
                ? '<p>暂无可展示的来源。</p>'
                : (s.evidence || []).map((item) => `<article class="vc-cell vc-memory-evidence"><strong>${esc(item.chatDisplayName || '来源会话')}</strong><p class="vc-memory-secondary">消息 ${esc(item.messageId)} · 修订 ${esc(item.revision)} · ${esc(stamp(item.sourceTimestamp, item.sourceTimezone))}${item.sourceTimezone ? ` · ${esc(item.sourceTimezone)}` : ''}</p>${item.excerpt ? `<blockquote>${esc(item.excerpt)}</blockquote>` : '<p>原文片段不可用。</p>'}</article>`).join('');
    const history = m.history?.length
        ? `<ol class="vc-memory-history">${m.history.map((item) => `<li class="vc-cell vc-memory-rev"><strong>修订 ${esc(item.version)}</strong><span class="vc-meta">${esc(lifecycleLabels[item.lifecycle] || '状态未知')} · ${esc(stamp(item.time?.recordedAt))}</span><p>${esc(item.summary)}</p></li>`).join('')}</ol>`
        : '<p>暂无更早的修订。</p>';
    const editing = s.editing ? `<form class="vc-group" data-form="edit"><label class="vc-cell" for="vc-memory-draft"><span class="vc-grow">纠正记忆</span></label><textarea id="vc-memory-draft" name="summary" rows="5" required ${s.busy ? 'disabled' : ''}>${esc(s.draft)}</textarea><div class="vc-memory-actions">${tabBtn('cancel-edit', '取消编辑', { disabled: s.busy })}<button class="vc-btn vc-btn-fill" type="submit" ${s.busy || s.conflict || s.detailLoading || !canEdit(m) ? 'disabled' : ''}>${s.busy ? '保存中…' : '保存修订'}</button></div></form>` : '';
    const actions = s.editing ? '' : `<div class="vc-memory-actions vc-memory-detail-actions">${canEdit(m) ? tabBtn('edit', '纠正', { fill: true, disabled: s.busy || s.detailLoading }) : ''}${!['FORGETTING', 'FORGOTTEN'].includes(m.lifecycle) ? tabBtn('confirm-forget', '删除长期记忆', { danger: true, disabled: s.busy || s.detailLoading }) : ''}</div>`;
    return `<h1 class="vc-memory-title" tabindex="-1">${esc(m.summary)}</h1>
        <p class="vc-meta vc-memory-status">${memoryStatuses(m)}<span>修订 ${esc(m.version)}</span></p>
        <dl class="vc-group vc-memory-facts"><div class="vc-cell"><dt>发生日期</dt><dd>${esc(time.eventDate || '未知')}${time.eventTime ? ` ${esc(time.eventTime)}` : ''}${time.eventTimezone ? ` · ${esc(time.eventTimezone)}` : ''}</dd></div>
        <div class="vc-cell"><dt>记录时间</dt><dd>${esc(stamp(time.recordedAt))}</dd></div>
        <div class="vc-cell"><dt>作用范围</dt><dd>${esc(instance?.companionName || '当前角色')} · ${modeLabel(m.mode)} · 仅此角色实例</dd></div>
        <div class="vc-cell"><dt>召回资格</dt><dd>${m.recallEligible ? '具备资格，实际使用取决于会话与分支' : '当前不参与召回'}</dd></div>
        ${typeLabels[m.type] ? `<div class="vc-cell"><dt>类型</dt><dd>${typeLabels[m.type]}</dd></div>` : ''}</dl>
        ${m.sourceStatus === 'PENDING_VERIFICATION' ? '<p class="vc-memory-notice">来源待核验，暂不能作为已确认事实。</p>' : ''}
        ${m.sourceStatus === 'INVALID' ? '<p class="vc-memory-notice">来源已失效，不用于后续召回。</p>' : ''}
        ${cleanupMarkup(m.cleanup)}
        <h3 class="vc-group-title">来源</h3><div class="vc-group">${evidence}</div>
        <h3 class="vc-group-title">修订历史</h3><div class="vc-group">${history}</div>
        ${s.conflict ? '<div class="vc-memory-notice" role="alert">这条记忆已在另一处更新。你的输入已保留，请刷新详情后继续。</div>' : ''}
        ${s.detailError ? `<p role="alert">${esc(s.detailError)}</p>` : ''}${s.notice ? `<p role="status">${esc(s.notice)}</p>` : ''}
        ${editing}
        ${actions}
        <p class="vc-footnote">将停止召回这条记忆并清理相关派生内容，不会自动删除聊天原文或全部备份。</p>
        <dialog class="vc-memory-confirm" data-forget-dialog aria-labelledby="vc-memory-forget-title"><h2 id="vc-memory-forget-title">删除这条长期记忆？</h2><p>${FORGET_NOTICE}</p><p>将停止召回这条记忆并清理相关派生内容，不会自动删除聊天原文或全部备份。</p><div class="vc-memory-actions">${button('cancel-forget', '取消')}${button('forget', '删除长期记忆', false, 'danger')}</div></dialog>
        ${s.reauthAction ? `<div class="vc-group" data-reauth-dialog role="dialog" aria-labelledby="vc-memory-reauth-title"><h2 id="vc-memory-reauth-title">重新验证身份</h2><form data-form="reauth"><label>当前密码<input type="password" name="password" autocomplete="current-password" required ${s.busy ? 'disabled' : ''}></label>${s.detailError ? `<p role="alert">${esc(s.detailError)}</p>` : ''}<div class="vc-memory-actions">${tabBtn('cancel-reauth', '取消', { disabled: s.busy })}<button class="vc-btn vc-btn-fill" type="submit" ${s.busy ? 'disabled' : ''}>验证并继续</button></div></form></div>` : ''}`;
}

function cssEscape(value) {
    const text = String(value ?? '');
    if (globalThis.CSS?.escape) return CSS.escape(text);
    return text.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function captureFocus(root) {
    const active = document.activeElement;
    if (!active || !root.contains(active)) return null;
    return {
        id: active.id || '',
        action: active.dataset?.action || '',
        name: active.name || '',
        memoryId: active.dataset?.memoryId || '',
        status: active.dataset?.status || '',
        section: active.dataset?.section || '',
        mid: active.dataset?.mid || '',
        start: typeof active.selectionStart === 'number' ? active.selectionStart : null,
        end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
    };
}

function restoreFocus(root, saved) {
    if (!saved) return;
    let el = null;
    if (saved.id) el = root.querySelector(`#${cssEscape(saved.id)}`);
    else if (saved.memoryId) el = root.querySelector(`[data-memory-id="${cssEscape(saved.memoryId)}"]`);
    else if (saved.status) el = root.querySelector(`[data-status="${cssEscape(saved.status)}"]`);
    else if (saved.section) el = root.querySelector(`[data-section="${cssEscape(saved.section)}"]`);
    else if (saved.action && saved.mid) el = root.querySelector(`[data-action="${cssEscape(saved.action)}"][data-mid="${cssEscape(saved.mid)}"]`);
    else if (saved.action) el = root.querySelector(`[data-action="${cssEscape(saved.action)}"]`);
    else if (saved.name) el = root.querySelector(`[name="${cssEscape(saved.name)}"]`);
    if (!el || typeof el.focus !== 'function') return;
    el.focus();
    if (saved.start != null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(saved.start, saved.end); } catch { /* 日期框没有选区 */ }
    }
}

function forgettingNow(previous, lifecycle) {
    return previous && !['FORGETTING', 'FORGOTTEN'].includes(previous) && ['FORGETTING', 'FORGOTTEN'].includes(lifecycle);
}

export function mountMemoryTab(container, { getRelationshipId = () => '', onOpenMessage } = {}) {
    if (!vcUiEnabled()) return { active: false, refresh() {}, destroy() {} };
    if (!container || typeof container.append !== 'function') throw new Error('mountMemoryTab requires a container');
    ensureMemoryStyles();
    container.classList.add('vc-memory-tab', 'vc-desktop-memory');
    container.setAttribute('data-vc-page', 'memory');
    container.replaceChildren();
    const listScreen = document.createElement('div');
    listScreen.className = 'vc-screen';
    container.append(listScreen);
    const nav = createNav(container, { stacked: () => !desktopLayout() });
    const ac = new AbortController();
    const page = createMemoryPage({ onChange: (state) => paint(state) });
    let detailEl = null;
    let scrim = null;
    let desktop = desktopLayout();
    let stopped = false;
    let segmentBinding = null;
    let menuHandle = null;
    let datesOpen = false;
    const life = new Map();
    const pendingCollapse = new Set();
    const started = new Set();
    const gone = new Set();
    const signal = ac.signal;
    // UX-31–33 桌面分区状态；手机不读这些。
    let section = 'timeline';
    let inlineId = '';
    let incognito = false;
    let incognitoAsked = false;
    let font = readDiaryFont();
    let sourceEpoch = 0;
    const sources = new Map();
    const asked = new Set();
    const diary = createDiaryPage({ onChange: () => { if (!stopped) paint(page.state); } });
    const favorites = createFavoritesPage({ onChange: () => { if (!stopped) paint(page.state); } });

    function noteLife(state) {
        const seen = [];
        for (const item of state.items || []) seen.push(item);
        if (state.detail) seen.push(state.detail);
        for (const item of seen) {
            const id = idOf(item);
            if (forgettingNow(life.get(id), item.lifecycle)) pendingCollapse.add(id);
            if (!['FORGETTING', 'FORGOTTEN'].includes(item.lifecycle)) pendingCollapse.delete(id);
            life.set(id, item.lifecycle);
        }
    }

    function beginCollapse(id) {
        if (started.has(id) || gone.has(id) || page.state.view !== 'list') return;
        const row = listScreen.querySelector(`.vc-memory-row[data-memory-id="${cssEscape(id)}"]`);
        const item = row?.closest('li');
        if (!item) return;
        started.add(id);
        pendingCollapse.delete(id);
        item.classList.add('is-collapsing');
        item.dataset.collapseId = id;
        item.style.overflow = 'hidden';
        const height = item.offsetHeight;
        const motion = animate(item, [
            { height: `${height}px`, opacity: 1 },
            { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' },
        ], { duration: 420 });
        const finish = () => {
            started.delete(id);
            gone.add(id);
            item.remove();
        };
        motion.finished?.then(finish, finish);
    }

    function paint(state) {
        if (stopped || !state.open) return;
        noteLife(state);
        const saved = captureFocus(detailEl?.contains(document.activeElement) ? detailEl : container);
        datesOpen = listScreen.querySelector('.vc-memory-filters details')?.open || datesOpen;
        const parked = [...listScreen.querySelectorAll('li.is-collapsing')];
        for (const item of parked) item.remove();
        const scrollTop = listScreen.querySelector('.vc-scroll')?.scrollTop || 0;
        const visible = {
            ...state,
            items: (state.items || []).filter((item) => !gone.has(idOf(item)) && !started.has(idOf(item))),
        };
        const desk = desktopLayout();
        const inlineActive = desk && inlineId && !state.reauthAction && !state.conflict;
        if (!inlineActive) inlineId = '';
        const showDetail = state.view === 'detail' && !inlineActive;
        listScreen.innerHTML = `<div class="vc-scroll">${desk ? renderDesktopMemory(visible, desktopUi()) : renderMemoryTab(visible)}</div>`;
        if (desk) afterDesktopPaint(visible);
        if (datesOpen) {
            const details = listScreen.querySelector('.vc-memory-filters details');
            if (details) details.open = true;
        }
        const list = listScreen.querySelector('.vc-memory-list');
        for (const item of parked) {
            if (!item.isConnected) list?.append(item);
        }
        const nextScroll = listScreen.querySelector('.vc-scroll');
        if (nextScroll) nextScroll.scrollTop = scrollTop;
        const segment = listScreen.querySelector('[data-vc-memory-segment]');
        releaseSegment(segmentBinding);
        segmentBinding = null;
        if (segment) {
            segmentBinding = bindSegment(segment, {
                onChange(index) {
                    const status = MEMORY_SEGMENTS[index]?.[0] ?? '';
                    const select = listScreen.querySelector('select[name="status"]');
                    if (select) select.value = status;
                    page.setFilterDraft('status', status);
                    select?.form?.requestSubmit();
                },
            });
        }
        container.classList.toggle('is-detail', showDetail);
        if (showDetail) {
            const html = renderMemoryDetailTab(state);
            if (!detailEl?.isConnected) {
                detailEl = document.createElement('section');
                detailEl.className = 'vc-screen vc-memory-detail-screen';
                detailEl.setAttribute('aria-label', '记忆详情');
                detailEl.setAttribute('aria-busy', state.detailLoading ? 'true' : 'false');
                detailEl.innerHTML = html;
                nav.push(detailEl);
            } else {
                detailEl.setAttribute('aria-busy', state.detailLoading ? 'true' : 'false');
                detailEl.innerHTML = html;
            }
        } else if (detailEl) {
            nav.pop();
            detailEl = null;
            scrim?.remove(); scrim = null;
        }
        syncDetailLayout();
        if (state.view === 'list') {
            for (const id of [...pendingCollapse]) beginCollapse(id);
        }
        restoreFocus(detailEl?.classList.contains('vc-memory-editor') ? detailEl : container, saved);
    }

    const desktopUi = () => ({ section, inlineId, incognito, font, sources, diary: diary.state, favorites: favorites.state, now: new Date() });

    function fillSources() {
        for (const slot of listScreen.querySelectorAll('.vc-mem-source[data-mid]')) {
            const entry = sources.get(slot.dataset.mid);
            if (entry) { slot.textContent = entry.line; slot.hidden = false; }
        }
    }

    // 来源一句只是点缀：并发 3 条按需读取证据，读不到就不显示。
    async function loadSources(items) {
        const epoch = sourceEpoch;
        const todo = items.filter((item) => !asked.has(idOf(item)) && !['FORGETTING', 'FORGOTTEN'].includes(item.lifecycle));
        for (const item of todo) asked.add(idOf(item));
        let next = 0;
        const worker = async () => {
            while (next < todo.length && !stopped && epoch === sourceEpoch) {
                const item = todo[next++];
                try {
                    const source = pickSource(await api.fetchMemoryEvidence(idOf(item)));
                    if (source && epoch === sourceEpoch) sources.set(idOf(item), source);
                } catch { /* 读不到来源就不显示这一行 */ }
                if (!stopped && epoch === sourceEpoch) fillSources();
            }
        };
        await Promise.all([worker(), worker(), worker()]);
    }

    function afterDesktopPaint(state) {
        listScreen.querySelector('.vc-scroll')?.classList.add('vc-desktop-memory');
        const toggle = listScreen.querySelector('[data-vc-incognito]');
        if (toggle) {
            bindSwitch(toggle, {
                onChange(next) {
                    incognito = next;
                    api.setIncognitoPref(next).catch(() => {
                        incognito = !next;
                        toggle.setAttribute('aria-checked', String(!next));
                        showToast('没有完成，请重试。', { type: 'failure' });
                    });
                },
            });
        }
        if (!incognitoAsked) {
            incognitoAsked = true;
            api.getIncognitoPref().then((pref) => { if (!stopped) { incognito = pref?.defaultIncognito === true; paint(page.state); } }, () => {});
        }
        if (section === 'diary' && font === 'hand') ensureHandwriting();
        const day = listScreen.querySelector('.vc-diary-day[aria-pressed="true"]');
        const strip = day?.parentElement;
        if (strip) strip.scrollLeft = day.offsetLeft - strip.clientWidth / 2 + day.offsetWidth / 2;
        if (MEMORY_SECTIONS.some(([key]) => key === section) && !state.loading) {
            fillSources();
            void loadSources(section === 'pinned' ? state.items.filter((item) => item.pinnedAt) : state.items);
        }
    }

    const reloadAux = () => {
        if (section === 'diary') return diary.load(page.state.relationshipId);
        if (section === 'favorites') return favorites.load(page.state.relationshipId);
        return undefined;
    };
    function resetDesktopData() {
        sourceEpoch++; sources.clear(); asked.clear(); diary.reset(); favorites.reset();
    }
    async function drainPinned() {
        for (let i = 0; i < 10 && page.state.nextCursor && !stopped && section === 'pinned'; i++) await page.more();
    }
    async function enterSection(next) {
        if (page.state.busy || page.state.editing || next === section) return;
        section = next;
        gone.clear(); pendingCollapse.clear();
        paint(page.state);
        const relationshipId = page.state.relationshipId;
        if (next === 'diary') { await diary.load(relationshipId); return; }
        if (next === 'favorites') { await favorites.load(relationshipId); return; }
        const status = SECTION_STATUS[next];
        if ((page.state.filters.status || '') !== status) {
            await page.filter({ ...page.state.filters, status });
            if (next === 'pinned') await drainPinned();
        }
    }

    async function openMessage(detail) {
        let mesId = detail.mesId;
        try {
            if (typeof onOpenMessage === 'function') mesId = await onOpenMessage(detail);
            else globalThis.dispatchEvent(new CustomEvent(OPEN_MESSAGE_EVENT, { detail }));
        } catch { showToast('没有完成，请重试。', { type: 'failure' }); return; }
        if (!Number.isInteger(mesId)) return;
        // 会话切换与渲染是异步的：等目标消息出现后滚动并高亮。
        const chat = await import('./chat-view.js').catch(() => null);
        for (let i = 0; i < 12 && !stopped; i++) {
            if (chat?.highlightMessage?.(mesId)) return;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }

    async function togglePin(id) {
        const item = page.state.items.find((row) => idOf(row) === id);
        if (!item) return;
        try {
            const record = item.pinnedAt ? await api.unpinMemory(id) : await api.pinMemory(id);
            if (stopped) return;
            page.state.items = page.state.items.map((row) => (idOf(row) === id ? { ...row, ...record } : row));
            if (page.state.detail && idOf(page.state.detail) === id) page.state.detail = { ...page.state.detail, pinnedAt: record.pinnedAt };
            paint(page.state);
        } catch { showToast('没有完成，请重试。', { type: 'failure' }); }
    }

    async function startInline(id) {
        if (page.state.busy || page.state.editing) return;
        inlineId = id;
        await page.select(id);
        if (page.state.detail && idOf(page.state.detail) === id && canEdit(page.state.detail)) {
            page.edit();
            container.querySelector('#vc-memory-draft')?.focus();
        } else { inlineId = ''; page.back(); }
    }

    function cancelInline() {
        page.cancelEdit();
        inlineId = '';
        page.back();
    }

    async function saveInline() {
        const draft = page.state.draft.trim();
        if (!draft || page.state.busy) return;
        if (draft === page.state.detail?.summary) { cancelInline(); return; }
        await page.save();
        if (stopped || page.state.reauthAction || page.state.conflict) return; // 弹窗接管，草稿保留
        if (page.state.editing) { if (page.state.detailError) showToast(page.state.detailError, { type: 'failure' }); return; }
        inlineId = '';
        page.back();
    }

    async function forgetInline(id, opener) {
        if (page.state.busy || page.state.editing) return;
        const ok = await confirmAlert({ title: '删除这条长期记忆？', message: FORGET_NOTICE, action: '删除', opener });
        if (!ok || stopped) return;
        inlineId = id;
        await page.select(id);
        if (!page.state.detail) { inlineId = ''; page.back(); return; }
        await page.forget();
        if (stopped || page.state.reauthAction) return;
        inlineId = '';
        if (page.state.detailError) showToast(page.state.detailError, { type: 'failure' });
        page.back();
    }

    function syncDetailLayout() {
        if (!detailEl) return;
        const portal = desktopLayout();
        detailEl.classList.toggle('vc-memory-editor', portal);
        detailEl.classList.toggle('vc-memory-tab', portal);
        if (portal) {
            nav.syncLayout();
            detailEl.setAttribute('role', 'dialog');
            detailEl.setAttribute('aria-modal', 'true');
            if (!scrim) {
                scrim = document.createElement('div');
                scrim.className = 'vc-memory-editor-scrim';
                scrim.addEventListener('click', () => void closeDetail(), { signal });
                document.body.append(scrim);
            }
            document.body.append(detailEl);
        } else {
            scrim?.remove(); scrim = null;
            detailEl.removeAttribute('role');
            detailEl.removeAttribute('aria-modal');
            container.append(detailEl);
        }
    }

    async function closeDetail() {
        if (page.state.busy) return;
        if (page.state.editing) {
            const opener = detailEl?.contains(document.activeElement) ? document.activeElement
                : detailEl?.querySelector('textarea:not(:disabled)') || detailEl?.querySelector('button:not(:disabled)');
            if (page.state.draft !== page.state.detail?.summary && !await confirmDiscard({ opener })) return;
            page.cancelEdit();
        }
        page.back();
        container.querySelector('.vc-memory-row[aria-current="true"]')?.focus();
    }

    const owns = target => container.contains(target) || detailEl?.contains(target);
    globalThis.addEventListener('resize', () => {
        const next = desktopLayout();
        if (desktop === next) return;
        desktop = next;
        paint(page.state);
    }, { signal });
    document.addEventListener('keydown', event => {
        if (!desktopLayout() || !detailEl || document.querySelector('.vc-alert,.vc-menu,.vc-sheet')) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); void closeDetail(); }
        if (event.key === 'Tab') {
            const controls = [...detailEl.querySelectorAll('button,input,textarea,select,[tabindex]')]
                .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
            if (event.shiftKey && (document.activeElement === controls[0] || !controls.includes(document.activeElement))) { event.preventDefault(); controls.at(-1)?.focus(); }
            else if (!event.shiftKey && (document.activeElement === controls.at(-1) || !detailEl.contains(document.activeElement))) { event.preventDefault(); controls[0]?.focus(); }
        }
    }, { signal, capture: true });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !inlineId || !page.state.editing || page.state.busy || document.querySelector('.vc-alert,.vc-menu,.vc-sheet')) return;
        event.preventDefault(); event.stopImmediatePropagation(); cancelInline();
    }, { signal, capture: true });

    document.addEventListener('input', (event) => {
        if (!owns(event.target)) return;
        const name = event.target?.name;
        if (name === 'summary') page.setDraft(event.target.value);
        if (['q', 'status', 'eventDateFrom', 'eventDateTo'].includes(name)) page.setFilterDraft(name, event.target.value);
        if (['eventDateFrom', 'eventDateTo'].includes(name) && event.target.form?.elements?.eventDateTo) {
            event.target.form.elements.eventDateTo.setCustomValidity('');
        }
    }, { signal });
    document.addEventListener('change', (event) => {
        if (!owns(event.target)) return;
        if (event.target?.name === 'relationshipId') {
            gone.clear();
            void page.changeRelationship(event.target.value);
        }
        if (event.target?.name === 'status') {
            page.setFilterDraft('status', event.target.value);
            event.target.form?.requestSubmit();
        }
    }, { signal });
    document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !owns(form)) return;
        event.preventDefault();
        if (form.dataset.form === 'edit') void page.save();
        if (form.dataset.form === 'filters') {
            const data = Object.fromEntries(new FormData(form));
            const end = form.elements.eventDateTo;
            if (end) end.setCustomValidity(data.eventDateFrom && data.eventDateTo && data.eventDateFrom > data.eventDateTo ? '结束日期不能早于开始日期。' : '');
            if (form.reportValidity()) {
                gone.clear();
                void page.filter({ q: data.q || '', status: data.status || '', eventDateFrom: data.eventDateFrom || '', eventDateTo: data.eventDateTo || '' });
            }
        }
        if (form.dataset.form === 'dfilters') {
            const data = Object.fromEntries(new FormData(form));
            const end = form.elements.eventDateTo;
            if (end) end.setCustomValidity(data.eventDateFrom && data.eventDateTo && data.eventDateFrom > data.eventDateTo ? '结束日期不能早于开始日期。' : '');
            if (form.reportValidity()) {
                gone.clear();
                void page.filter({ q: data.q || '', status: SECTION_STATUS[section] ?? '', eventDateFrom: data.eventDateFrom || '', eventDateTo: data.eventDateTo || '' })
                    .then(() => (section === 'pinned' ? drainPinned() : undefined));
            }
        }
        if (form.dataset.form === 'reauth') {
            const password = form.elements.password.value;
            form.elements.password.value = '';
            void page.authenticate(password);
        }
    }, { signal });
    document.addEventListener('click', async (event) => {
        const target = event.target.closest('button');
        if (!target || !owns(target) || target.disabled) return;
        if (target.dataset.memoryId) {
            await page.select(target.dataset.memoryId);
            detailEl?.querySelector('.vc-memory-title')?.focus();
            if (!target.dataset.action) return;
        }
        const action = target.dataset.action;
        if (action === 'pick-instance') {
            menuHandle?.close();
            const relationships = page.state.relationships || [];
            menuHandle = popMenu(target, relationships.map((item) => ({
                label: relationshipLabel(item, relationships),
                check: String(item.relationshipId) === String(page.state.relationshipId),
                run: () => {
                    gone.clear();
                    resetDesktopData();
                    void page.changeRelationship(item.relationshipId).then(async () => {
                        await reloadAux();
                        if (section === 'pinned') await drainPinned();
                    });
                },
            })), { below: true });
        }
        if (action === 'section') { await enterSection(target.dataset.section); return; }
        if (action === 'pin') { await togglePin(target.dataset.mid); return; }
        if (action === 'edit-inline') { await startInline(target.dataset.mid); return; }
        if (action === 'save-inline') { await saveInline(); return; }
        if (action === 'cancel-inline') { cancelInline(); return; }
        if (action === 'forget-inline') { await forgetInline(target.dataset.mid, target); return; }
        if (action === 'open-source') {
            const entry = sources.get(target.dataset.mid);
            const item = page.state.items.find((row) => idOf(row) === target.dataset.mid);
            if (entry) await openMessage({ relationshipId: String(item?.relationshipId ?? page.state.relationshipId), chatIdentity: entry.chatIdentity, messageId: entry.messageId, mesId: entry.mesId });
            return;
        }
        if (action === 'diary-day') { diary.select(target.dataset.day); return; }
        if (action === 'diary-month') { await diary.shift(Number(target.dataset.delta)); return; }
        if (action === 'diary-retry') { await diary.load(); return; }
        if (action === 'diary-font') {
            menuHandle?.close();
            menuHandle = popMenu(target, DIARY_FONTS.map(([key, label]) => ({
                label,
                check: font === key,
                run: () => {
                    font = writeDiaryFont(key);
                    if (font === 'hand') ensureHandwriting();
                    paint(page.state);
                },
            })), { below: true });
            return;
        }
        if (action === 'fav-segment') { favorites.setSegment(target.dataset.segment); return; }
        if (action === 'fav-retry') { await favorites.load(); return; }
        if (action === 'fav-more') { await favorites.more(); return; }
        if (action === 'open-favorite') {
            const row = favorites.state.favorites.find((item) => item.favoriteId === target.dataset.favoriteId);
            if (row) await openMessage({ relationshipId: String(row.relationshipId), chatFile: row.chatFile,
                body: row.body, role: row.role, messageAt: row.messageAt });
            return;
        }
        if (action === 'remove-favorite' || action === 'cancel-reminder') {
            try {
                if (action === 'remove-favorite') await favorites.removeFavorite(target.dataset.favoriteId);
                else await favorites.cancelReminder(target.dataset.reminderId);
            } catch { showToast('没有完成，请重试。', { type: 'failure' }); }
            return;
        }
        if (action === 'back') {
            if (desktopLayout()) { await closeDetail(); return; }
            page.back();
            container.querySelector('.vc-memory-row[aria-current="true"]')?.focus();
        }
        if (action === 'more') await page.more();
        if (action === 'retry-list') {
            if (!page.state.relationships.length) await page.open(getRelationshipId());
            else await page.loadList();
        }
        if (action === 'clear-filters') await page.filter({ q: '', status: '', eventDateFrom: '', eventDateTo: '' });
        if (action === 'refresh-detail') await page.refreshDetail();
        if (action === 'edit') {
            page.edit();
            detailEl?.querySelector('#vc-memory-draft')?.focus();
            if (desktopLayout()) detailEl?.querySelector('[data-form="edit"]')?.scrollIntoView({ block: 'nearest' });
        }
        if (action === 'cancel-edit') page.cancelEdit();
        if (action === 'cancel-reauth') page.cancelReauth();
        if (action === 'confirm-forget') {
            const ok = await confirmAlert({
                title: '删除这条长期记忆？',
                message: FORGET_NOTICE,
                action: '删除',
                opener: target,
            });
            if (!ok || stopped) return;
            await page.forget();
            const removed = page.state.detail && ['FORGETTING', 'FORGOTTEN'].includes(page.state.detail.lifecycle);
            if (removed && !page.state.reauthAction) page.back();
        }
        if (action === 'cancel-forget') container.querySelector('[data-forget-dialog]')?.close();
        if (action === 'forget') {
            container.querySelector('[data-forget-dialog]')?.close();
            await page.forget();
            if (page.state.detail && ['FORGETTING', 'FORGOTTEN'].includes(page.state.detail.lifecycle) && !page.state.reauthAction) page.back();
        }
    }, { signal });

    void page.open(getRelationshipId()).then(() => {
        if (!stopped) container.querySelector('h1')?.focus();
    });

    return {
        active: true,
        async refresh() {
            if (stopped) return;
            gone.clear();
            pendingCollapse.clear();
            resetDesktopData();
            const preferred = page.state.relationshipId || getRelationshipId() || '';
            await page.open(preferred);
            if (SECTION_STATUS[section]) {
                await page.filter({ status: SECTION_STATUS[section] });
                if (section === 'pinned') await drainPinned();
            }
            await reloadAux();
        },
        destroy() {
            stopped = true;
            releaseSegment(segmentBinding);
            segmentBinding = null;
            menuHandle?.close();
            ac.abort();
            page.close();
            detailEl?.remove();
            scrim?.remove();
            detailEl = null;
            container.replaceChildren();
            container.classList.remove('vc-memory-tab', 'vc-desktop-memory', 'is-detail');
        },
    };
}
