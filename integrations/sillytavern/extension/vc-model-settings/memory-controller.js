// 聊天与记忆页共享的既有状态和打开事件，不加载页面视图。
import * as api from './api.js';

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
    const registered = typeof open === 'function' ? open : null;
    memoryOpener = registered;
    return () => { if (memoryOpener === registered) memoryOpener = null; };
}

export function requestOpenMemory(opener) {
    const detail = { opener };
    globalThis.dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail }));
    if (globalThis.document?.body?.classList?.contains('vc-ui') === true) return detail;
    if (typeof memoryOpener === 'function') memoryOpener(opener);
    return detail;
}
export const idOf = item => String(item.memoryId);
export const canEdit = item => item?.lifecycle === 'ACTIVE';
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
    let epoch = 0, listRun = 0, detailRun = 0, timer, dead = false;
    const emit = () => { if (!dead) onChange(state); };
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
        if (dead || !state.open || state.busy) return;
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
            if (dead || state.busy) return;
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
        destroy() { dead = true; controller.close(); },
        loadList, more: () => loadList(true), select,
        async changeRelationship(id) { if (dead || state.busy) return; clearDetail(); state.relationshipId = String(id); await loadList(); },
        async filter(filters) { if (dead || state.busy) return; clearDetail(); state.filters = filters; state.filterDraft = { ...filters }; await loadList(); },
        back() { if (state.busy || state.editing) return; state.view = 'list'; emit(); },
        edit() { if (!canEdit(state.detail) || state.busy) return; state.editing = true; state.draft = state.detail.summary; state.notice = ''; emit(); },
        setDraft(value) { if (dead || state.busy) return; state.draft = value; emit(); },
        setFilterDraft(name, value) { if (dead || state.busy) return; state.filterDraft[name] = value; emit(); },
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

