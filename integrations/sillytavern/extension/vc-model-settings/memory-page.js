// UI-P03：沿用扩展深色 tokens；桌面阅读分栏，手机列表/详情独立呈现。
// Go 为唯一数据入口。发生时间使用 time，不从记录时间推算；关闭/切换会废弃迟到响应。
import * as api from './api.js';

export const FORGET_NOTICE = '聊天原文仍保留，可能继续用于当前对话。';
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
                const relationships = await api.fetchRelationships();
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
      <div class="vc-memory-results" aria-busy="${s.loading}">${s.listError ? `<p role="alert">${esc(s.listError)}</p>${button('retry-list', '重试')}` : ''}${!s.relationships.length && !s.loading && !s.listError ? '<p class="vc-memory-empty">还没有角色实例，请先在聊天中绑定角色。</p>' : !s.items.length && !s.loading && !s.listError ? '<p class="vc-memory-empty" role="status">没有找到记忆。试试其他关键词或筛选条件。</p>' : ''}
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
    return { open() { if (dialog.open) return; opener = document.activeElement; dialog.showModal(); void page.open(getRelationshipId()); dialog.querySelector('h1')?.focus(); }, close };
}
