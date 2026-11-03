// 桌面角色面板：原控制器保留服务/记忆语义，React 只渲染自有区域。
import { fetchRelationships, storyRequest } from '../api.js';
import { createMemoryPage, FORGET_NOTICE, requestOpenMemory } from '../memory-page.js';
import { recalledItems, safeAvatarUrl } from '../chat-view.js';
import { listFollowUps } from '../inbox-page.js';
import { mountChatSearch } from '../chat-search.js';
import { chatSnapshotFromContext } from '../conversations.js';
import { mountInstancePage } from '../instance-page.js';
import { openRelationshipVoiceSettings } from '../voice-settings.js';
import { confirmAlert } from '../ui/alert.js';
import { openSheet } from '../ui/sheet.js';
import { showToast } from '../ui/toast.js';
import { iconSpriteUrl } from '../ui/icons.js';
import { SPRING } from '../ui/motion.js';
import { reducedMotion } from './transition.js';
import { mountCharacterPanelView, recalledEditorContent } from './build/index.js';

export function mountCharacterPanel({ shell, getContext, aurora } = {}) {
    if (document.documentElement.dataset.vcLayout !== 'desktop') return null;
    const pane = shell.querySelector('.vc-shell-chat'), host = shell.querySelector('.vc-shell-extensions');
    const tools = pane.querySelector('.vc-capsule-tools');
    const panel = document.createElement('aside'); panel.className = 'vc-desk-character'; panel.id = 'vc-desktop-character-panel';
    panel.setAttribute('aria-label', '角色面板'); host.append(panel);
    let id = '', generation = 0, editRequest = 0, instancePage, dead = false, editor = null;
    const memories = createMemoryPage({ onChange: paintMemories });
    const p = { sprite: iconSpriteUrl(), name: '', avatar: '', displayName: '', mood: '', open: innerWidth >= 1600, memories: [], followups: [],
        events: {
            toggle: () => setOpen(panel.hidden), close: () => { setOpen(false); toggle.focus(); },
            voice: opener => { if (!dead) void openRelationshipVoiceSettings(id, { opener }); },
            memory: opener => { if (!dead) requestOpenMemory(opener); },
            settings: async opener => { if (dead) return; const scope = id; instancePage ||= mountInstancePage({ getContext }); await instancePage.open(opener); if (!dead && id === scope) instancePage.page.selectInstance(scope); },
            edit, forget,
        },
    };
    const view = mountCharacterPanelView(panel, tools, p), toggle = view.toggle;
    const memorySection = panel.querySelector('.vc-desk-character-section');
    const search = mountChatSearch({ pane, getContext, onOpenChange: on => shell.setChatSearchOpen(on) });
    const paint = () => { if (!dead) view.update(p); };
    function setOpen(open, animate = true) {
        if (dead) return;
        p.open = Boolean(open); panel.hidden = !open; shell.dataset.characterPanel = open ? 'open' : 'closed'; paint();
        if (open && animate) panel.animate(reducedMotion() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'none' }], { duration: reducedMotion() ? 150 : 380, easing: reducedMotion() ? 'ease' : SPRING });
    }
    function paintMemories() {
        if (dead) return;
        p.memories = recalledItems(memories.state.items, getContext().extensionPrompts?.vc_long_term_memory?.value).map(item => ({ id: String(item.memoryId), summary: item.summary }));
        paint();
    }
    function openMemory() {
        if (dead) return;
        setOpen(true);
        if (memorySection.hidden) return;
        const heading = memorySection.querySelector('h2'); heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true });
        panel.scrollTo({ top: Math.max(0, memorySection.offsetTop - 16), behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    const takeMemory = event => {
        if (!event.target.closest?.('.vc-shell-chat .vc-capsule > [data-memory]')) return;
        event.preventDefault(); event.stopPropagation(); openMemory();
    };
    shell.addEventListener('click', takeMemory, true);
    function syncCurrentRow() { if (!dead) shell.updateConversationSnapshot?.(chatSnapshotFromContext(getContext())); }
    const ctx = getContext(), messageEvents = ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED'].map(name => ctx.eventTypes?.[name]).filter(Boolean);
    for (const type of messageEvents) ctx.eventSource?.on(type, syncCurrentRow);
    function closeEditor() { const previous = editor; editor = null; previous?.sheet?.dismiss(); }
    async function edit(memoryId) {
        if (dead) return;
        const ticket = generation, request = ++editRequest, opener = document.activeElement;
        closeEditor();
        await memories.select(memoryId);
        if (dead || ticket !== generation || request !== editRequest || memories.state.selectedId !== memoryId) return;
        if (!memories.state.detail || memories.state.detailError) { showToast('没有完成，请重试。', { type: 'failure' }); return; }
        memories.edit(); if (!memories.state.editing) return;
        const entry = { sheet: null, props: null, alive: true };
        editor = entry;
        const active = () => !dead && editor === entry && entry.alive && generation === ticket;
        const dirty = () => entry.props.draft !== memories.state.detail?.summary;
        const paintEditor = () => { if (active()) entry.sheet?.setContent(recalledEditorContent(entry.props)); };
        entry.props = {
            draft: memories.state.draft, busy: false, dirty: false, error: '',
            change(value) { if (!active() || entry.props.busy) return; entry.props.draft = value; entry.props.dirty = dirty(); paintEditor(); },
            cancel() { if (active()) void entry.sheet.close(); },
            dispose() { entry.alive = false; if (editor === entry) editor = null; },
            async save() {
                if (!active() || entry.props.busy || !dirty() || !entry.props.draft.trim()) return;
                entry.props.busy = true; paintEditor(); memories.setDraft(entry.props.draft); await memories.save();
                if (!active()) return;
                entry.props.busy = false;
                if (memories.state.detailError || memories.state.conflict || memories.state.reauthAction) { entry.props.error = memories.state.detailError || '没有完成，请重试。'; paintEditor(); return; }
                entry.props.draft = memories.state.detail.summary; entry.props.dirty = false;
                await entry.sheet.close(); if (!dead && generation === ticket) showToast('已保存');
            },
        };
        entry.sheet = openSheet({ title: '纠正记忆', content: recalledEditorContent(entry.props), opener, owner: panel, isDirty: dirty, canClose: () => !entry.props.busy,
            onDone: () => { entry.alive = false; if (editor === entry) editor = null; memories.cancelEdit(); if (!dead && generation === ticket) queueMicrotask(() => memorySection.querySelector(`[data-memory-id="${CSS.escape(memoryId)}"] button`)?.focus()); } });
        entry.sheet.setHeader({ done: { hidden: true } });
    }
    async function forget(memoryId) {
        if (dead) return;
        const ticket = generation;
        if (!await confirmAlert({ title: '删除这条记忆？', message: FORGET_NOTICE, action: '删除', opener: document.activeElement, owner: panel })) return;
        if (dead || generation !== ticket) return;
        await memories.select(memoryId);
        if (dead || generation !== ticket || memories.state.selectedId !== memoryId) return;
        await memories.forget();
        if (!dead && generation === ticket && (memories.state.detailError || memories.state.reauthAction)) showToast('没有完成，请重试。', { type: 'failure' });
    }
    async function refresh() {
        if (dead) return;
        const ticket = ++generation, ctx = getContext();
        closeEditor(); memories.close();
        id = String(ctx.chatMetadata?.vc_binding?.relationshipId || '');
        p.memories = []; p.followups = []; p.displayName = p.mood = '';
        if (!id) { p.name = p.avatar = ''; paint(); return; }
        const card = ctx.characters?.[ctx.characterId]; p.name = card?.name || ctx.name2 || ''; p.avatar = safeAvatarUrl(card?.avatar); paint();
        const [relationships, state, follows] = await Promise.allSettled([fetchRelationships(), storyRequest('GET', `/api/v1/relationships/${id}/companion-state`), listFollowUps(id), memories.open(id)]);
        if (dead || generation !== ticket) return;
        p.displayName = relationships.status === 'fulfilled' ? relationships.value.find(row => String(row.relationshipId) === id)?.displayName || '' : '';
        p.mood = state.status === 'fulfilled' ? state.value?.mood?.vibe || '' : '';
        p.followups = follows.status === 'fulfilled' ? follows.value.filter(row => row.status !== 'CANCELLED').map(row => ({ id: String(row.followUpId), body: row.body, time: [row.eventDate, row.eventTime].filter(Boolean).join(' ') })) : [];
        paint();
        const tint = getComputedStyle(document.body).getPropertyValue('--vc-tint').trim(); if (p.avatar && tint) aurora?.setTint(tint);
    }
    const esc = event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !panel.hidden && panel.getClientRects().length && !document.querySelector('.vc-sheet,.vc-alert,.vc-menu')) { event.preventDefault(); setOpen(false); toggle.focus(); }
    };
    const resize = () => { if (innerWidth < 744) setOpen(false, false); };
    window.addEventListener('keydown', esc); window.addEventListener('resize', resize);
    setOpen(p.open, false); void refresh();
    return { panel, toggle, search, refresh, setOpen, openMemory, destroy() { if (dead) return; dead = true; generation++; closeEditor(); instancePage?.destroy(); memories.close(); search?.destroy(); shell.removeEventListener('click', takeMemory, true); for (const type of messageEvents) ctx.eventSource?.removeListener(type, syncCurrentRow); window.removeEventListener('keydown', esc); window.removeEventListener('resize', resize); view.unmount(); panel.remove(); } };
}
