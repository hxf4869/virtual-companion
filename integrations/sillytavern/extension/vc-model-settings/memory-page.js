// UI-P03：沿用扩展深色 tokens；桌面阅读分栏，手机列表/详情独立呈现。
// Go 为唯一数据入口。发生时间使用 time，不从记录时间推算；关闭/切换会废弃迟到响应。
import * as api from './api.js';
import { confirmAlert, confirmDiscard } from './ui/alert.js';
import { desktopLayout } from './desktop/presentation.js';
import { iconSpriteUrl } from './ui/icons.js';
import { mountMemoryListView, mountMemoryLayerView, mountMemoryContentsView } from './desktop/build/index.js';
import { popMenu } from './ui/menu.js';
import { animate } from './ui/motion.js';
import { createNav } from './ui/nav.js';
import { readVcUiFlag } from './ui/theme.js';
import { showToast } from './ui/toast.js';
import { createDiaryPage, DIARY_FONTS, ensureHandwriting, readDiaryFont, monthDays, monthLabel, diaryDayTitle, writeDiaryFont } from './diary-page.js';
import { createFavoritesPage, GLYPHS, monthDay, reminderWhen } from './favorites-page.js';

import { FORGET_NOTICE, MEMORY_EMPTY_DIALOG, MEMORY_EMPTY_TAB, OPEN_MEMORY_EVENT, OPEN_MESSAGE_EVENT, bindOpenMemory, requestOpenMemory, createMemoryPage, idOf, canEdit } from './memory-controller.js';
export { FORGET_NOTICE, MEMORY_EMPTY_DIALOG, MEMORY_EMPTY_TAB, OPEN_MEMORY_EVENT, OPEN_MESSAGE_EVENT, bindOpenMemory, requestOpenMemory, createMemoryPage } from './memory-controller.js';

const lifecycleLabels = { ACTIVE: '生效中', SUPERSEDED: '已被替代', FORGETTING: '清理中', FORGOTTEN: '已遗忘' };
const sourceLabels = { VALID: '来源已核验', PENDING_VERIFICATION: '来源待核验', INVALID: '来源已失效' };
const typeLabels = { FACT: '事实', PREFERENCE: '偏好', EVENT: '经历', GOAL: '目标', COMMITMENT: '承诺', SUMMARY: '摘要' };

function stamp(value, zone) {
    if (!value) return '未记录';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone || undefined }).format(date); }
    catch { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
}
export function mountMemoryPage({ getRelationshipId = () => '' } = {}) {
    const root = document.createElement('div'); root.className = 'vcms-root vc-memory-root';
    const dialog = document.createElement('dialog'); dialog.className = 'vc-memory-dialog'; dialog.setAttribute('aria-label', '记忆');
    root.append(dialog); document.body.append(root);
    let opener, view = null, dead = false, confirmForget = false;
    const page = createMemoryPage({ onChange: render });
    function render(state = page.state) {
        if (dead || !state.open) return;
        const props = memoryViewProps(state, {}, { action, confirmForget, draft: value => page.setDraft(value), filter, submit });
        if (view) view.update(props); else view = mountMemoryContentsView(dialog, props);
    }
    function filter(name, value) {
        if (dead || page.state.busy) return;
        if (name === 'relationshipId') { void page.changeRelationship(value); return; }
        page.setFilterDraft(name, value);
        if (name === 'status') submit('filters', dialog.querySelector('[data-form="filters"]'));
    }
    function submit(kind, form) {
        if (dead || page.state.busy) return;
        if (kind === 'edit') void page.save();
        if (kind === 'filters') {
            const data = Object.fromEntries(new FormData(form)), end = form.elements.eventDateTo;
            end.setCustomValidity(data.eventDateFrom && data.eventDateTo && data.eventDateFrom > data.eventDateTo ? '结束日期不能早于开始日期。' : '');
            if (form.reportValidity()) void page.filter({ q: data.q || '', status: data.status || '', eventDateFrom: data.eventDateFrom || '', eventDateTo: data.eventDateTo || '' });
        }
        if (kind === 'reauth') { const password = form.elements.password.value; form.elements.password.value = ''; void page.authenticate(password); }
    }
    function close() {
        if (dead || page.state.busy) return;
        if (page.state.editing && page.state.draft !== page.state.detail?.summary && !globalThis.confirm('放弃尚未保存的纠正？')) return;
        page.close(); confirmForget = false; view?.unmount(); view = null; dialog.close(); opener?.focus();
    }
    async function action(action, target) {
        if (dead || target.disabled) return;
        if (action === 'select') { await page.select(target.dataset.memoryId); if (!dead) dialog.querySelector('.vc-memory-detail h2')?.focus(); return; }
        if (action === 'close') close();
        if (action === 'back') { page.back(); dialog.querySelector('.vc-memory-row[aria-current="true"]')?.focus(); }
        if (action === 'more') await page.more();
        if (action === 'retry-list') { if (!page.state.relationships.length) await page.open(getRelationshipId()); else await page.loadList(); }
        if (action === 'refresh-detail') await page.refreshDetail();
        if (action === 'edit') { page.edit(); dialog.querySelector('textarea')?.focus(); }
        if (action === 'cancel-edit') page.cancelEdit();
        if (action === 'confirm-forget') { confirmForget = true; render(); }
        if (action === 'cancel-forget') { confirmForget = false; render(); }
        if (action === 'forget') { confirmForget = false; render(); await page.forget(); }
        if (action === 'cancel-reauth') page.cancelReauth();
    }
    dialog.addEventListener('cancel', event => { if (event.target === dialog) { event.preventDefault(); close(); } });
    const controller = {
        open(returnFocusTarget = document.activeElement) {
            if (dead || dialog.open) return;
            opener = returnFocusTarget; dialog.showModal();
            const ready = page.open(getRelationshipId()); dialog.querySelector('h1')?.focus(); return ready;
        }, close,
        destroy() { if (dead) return; dead = true; release(); page.destroy(); view?.unmount(); view = null; dialog.close(); root.remove(); },
    };
    const release = bindOpenMemory(target => controller.open(target));
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

function dateFilterLabel(draft) {
    const from = draft?.eventDateFrom || '';
    const to = draft?.eventDateTo || '';
    if (from && to) return `${from} – ${to}`;
    if (from || to) return [from, to].filter(Boolean).join(' – ');
    return '全部';
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

export function memoryViewProps(state, ui = {}, events = {}) {
    const sprite = iconSpriteUrl(), action = events.action;
    return {
        state, ui, sprite, glyphs: GLYPHS, desktop: false, forgetNotice: FORGET_NOTICE, emptyDialog: MEMORY_EMPTY_DIALOG,
        labels: { lifecycle: lifecycleLabels, source: sourceLabels, type: typeLabels }, sections: MEMORY_SECTIONS, segments: MEMORY_SEGMENTS, statusOptions: STATUS_OPTIONS,
        format: { stamp, relationship: relationshipLabel, mode: modeLabel, day: dayLabel, dates: dateFilterLabel, lifeTone: toneForLifecycle, sourceTone: toneForSource, group: groupTimeline, clock: clockOf, moment: memoryMoment },
        diary: ui.diary ? { state: ui.diary, font: ui.font, sprite, action, days: monthDays, monthLabel, title: diaryDayTitle } : undefined,
        favorites: ui.favorites ? { state: ui.favorites, names: Object.fromEntries((state.relationships || []).map(item => [String(item.relationshipId), item.companionName || ''])), now: ui.now || new Date(), sprite, action, segment: events.favoriteSegment, monthDay, when: reminderWhen } : undefined,
        ...events,
    };
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
    let listView;
    const detailViews = new Map();
    const removeDetail = el => { detailViews.get(el)?.view.unmount(); detailViews.delete(el); };
    const nav = createNav(container, { stacked: () => !desktopLayout(), onRemove: removeDetail });
    const ac = new AbortController();
    const page = createMemoryPage({ onChange: (state) => paint(state) });
    let detailEl = null;
    let desktop = desktopLayout();
    let stopped = false;
    let menuHandle = null;
    const life = new Map();
    const pendingCollapse = new Set();
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

    const collapsed = id => { if (stopped) return; pendingCollapse.delete(id); gone.add(id); paint(page.state); };
    const events = {
        action: onAction, draft: value => { if (!stopped) page.setDraft(value); }, filter: changeFilter, submit,
        status: value => { if (stopped || page.state.busy || page.state.editing) return; page.setFilterDraft('status', value); submit('filters', listScreen.querySelector('[data-form="filters"]')); },
        incognito: next => { if (stopped) return; incognito = next; paint(page.state); api.setIncognitoPref(next).catch(() => { if (!stopped) { incognito = !next; paint(page.state); showToast('没有完成，请重试。', { type: 'failure' }); } }); },
        favoriteSegment: next => { if (!stopped) favorites.setSegment(next); },
    };
    function paint(state) {
        if (stopped || !state.open) return;
        noteLife(state);
        const visible = { ...state, items: state.items.filter(item => !gone.has(idOf(item))) };
        const desk = desktopLayout(), inlineActive = desk && inlineId && !state.reauthAction && !state.conflict;
        if (!inlineActive) inlineId = '';
        const showDetail = state.view === 'detail' && !inlineActive;
        const props = memoryViewProps(visible, desktopUi(), { ...events, desktop: desk,
            collapse: { ids: state.view === 'list' ? pendingCollapse : new Set(), done: collapsed, animate },
        });
        if (listView) listView.update(props); else listView = mountMemoryListView(listScreen, props);
        if (desk) afterDesktopPaint(visible);
        container.classList.toggle('is-detail', Boolean(showDetail));
        if (showDetail) {
            if (!detailEl) {
                detailEl = document.createElement('section'); detailEl.className = 'vc-screen vc-memory-detail-screen'; detailEl.setAttribute('aria-label', '记忆详情');
                const detailProps = { ...props, active: true, host: document.body, close: () => void closeDetail() };
                nav.push(detailEl, { prepare: el => detailViews.set(el, { view: mountMemoryLayerView(el, detailProps), props: detailProps }) });
            } else {
                const entry = detailViews.get(detailEl); entry.props = { ...entry.props, ...props }; entry.view.update(entry.props);
            }
            detailEl.setAttribute('aria-busy', String(Boolean(state.detailLoading)));
        } else if (detailEl) {
            const entry = detailViews.get(detailEl); entry.props = { ...entry.props, active: false }; entry.view.update(entry.props);
            nav.pop(); detailEl = null;
        }
        syncDetailLayout();
    }

    const desktopUi = () => ({ section, inlineId, incognito, font, sources, diary: diary.state, favorites: favorites.state, now: new Date() });

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
                if (!stopped && epoch === sourceEpoch) paint(page.state);
            }
        };
        await Promise.all([worker(), worker(), worker()]);
    }

    function afterDesktopPaint(state) {
        if (!incognitoAsked) {
            incognitoAsked = true;
            api.getIncognitoPref().then(pref => { if (!stopped) { incognito = pref?.defaultIncognito === true; paint(page.state); } }, () => {});
        }
        if (section === 'diary' && font === 'hand') ensureHandwriting();
        if (MEMORY_SECTIONS.some(([key]) => key === section) && !state.loading) void loadSources(section === 'pinned' ? state.items.filter(item => item.pinnedAt) : state.items);
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
        detailEl.classList.toggle('vc-memory-editor', portal); detailEl.classList.toggle('vc-memory-tab', portal);
        if (portal) nav.syncLayout();
        const host = portal ? document.body : container;
        if (detailEl.parentElement !== host) {
            const focused = detailEl.contains(document.activeElement) ? document.activeElement : null;
            host.append(detailEl);
            focused?.focus({ preventScroll: true });
        }
    }

    async function closeDetail() {
        if (stopped || !detailEl || page.state.busy) return;
        if (page.state.editing) {
            const opener = detailEl?.contains(document.activeElement) ? document.activeElement
                : detailEl?.querySelector('textarea:not(:disabled)') || detailEl?.querySelector('button:not(:disabled)');
            if (page.state.draft !== page.state.detail?.summary && !await confirmDiscard({ opener })) return;
            page.cancelEdit();
        }
        page.back();
        container.querySelector('.vc-memory-row[aria-current="true"]')?.focus();
    }

    globalThis.addEventListener('resize', () => {
        const next = desktopLayout(); if (desktop === next || stopped) return;
        desktop = next; paint(page.state);
    }, { signal });
    function changeFilter(name, value) {
        if (stopped || page.state.busy) return;
        if (name === 'relationshipId') { gone.clear(); resetDesktopData(); void page.changeRelationship(value); return; }
        page.setFilterDraft(name, value);
    }
    function submit(kind, form) {
        if (stopped || page.state.busy) return;
        if (kind === 'edit') void page.save();
        if (kind === 'filters' || kind === 'dfilters') {
            const data = Object.fromEntries(new FormData(form)), end = form.elements.eventDateTo;
            end.setCustomValidity(data.eventDateFrom && data.eventDateTo && data.eventDateFrom > data.eventDateTo ? '结束日期不能早于开始日期。' : '');
            if (form.reportValidity()) {
                gone.clear();
                void page.filter({ q: data.q || '', status: kind === 'dfilters' ? SECTION_STATUS[section] ?? '' : data.status || '', eventDateFrom: data.eventDateFrom || '', eventDateTo: data.eventDateTo || '' }).then(() => section === 'pinned' ? drainPinned() : undefined);
            }
        }
        if (kind === 'reauth') { const password = form.elements.password.value; form.elements.password.value = ''; void page.authenticate(password); }
    }
    async function onAction(action, target) {
        if (stopped || target.disabled || target.closest('.vc-memory-detail-screen')?.inert) return;
        if (target.dataset.memoryId) {
            await page.select(target.dataset.memoryId);
            detailEl?.querySelector('.vc-memory-title')?.focus();
            if (!target.dataset.action) return;
        }
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
    }

    void page.open(getRelationshipId()).then(() => {
        if (!stopped) container.querySelector('h1')?.focus();
    });

    return {
        active: true,
        async refresh() {
            if (stopped || page.state.busy || page.state.editing || page.state.reauthAction) return;
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
            if (stopped) return;
            stopped = true;
            menuHandle?.close();
            ac.abort();
            page.destroy(); diary.reset(); favorites.reset();
            listView?.unmount(); listView = null;
            for (const el of detailViews.keys()) { removeDetail(el); el.remove(); }
            detailEl = null;
            container.replaceChildren();
            container.classList.remove('vc-memory-tab', 'vc-desktop-memory', 'is-detail');
        },
    };
}
