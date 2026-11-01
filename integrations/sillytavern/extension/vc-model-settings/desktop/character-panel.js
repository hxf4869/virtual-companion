// 桌面角色面板。数据、纠正与删除继续使用现有前端控制器；不接管宿主聊天。
import { fetchRelationships, storyRequest } from '../api.js';
import { createMemoryPage, FORGET_NOTICE, requestOpenMemory } from '../memory-page.js';
import { recalledItems, safeAvatarUrl } from '../chat-view.js';
import { listFollowUps } from '../inbox-page.js';
import { mountChatSearch } from '../chat-search.js';
import { chatSnapshotFromContext, desktopConversationTime, instanceTail } from '../conversations.js';
import { mountInstancePage } from '../instance-page.js';
import { openRelationshipVoiceSettings } from '../voice-settings.js';
import { confirmAlert } from '../ui/alert.js';
import { openSheet } from '../ui/sheet.js';
import { showToast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { SPRING } from '../ui/motion.js';
import { reducedMotion } from './transition.js';

function node(tag, className, text) {
    const el = document.createElement(tag); el.className = className;
    if (text != null) el.textContent = text;
    return el;
}
function action(label, glyph, run, size = 20) {
    const button = node('button', 'vc-circle'); button.type = 'button';
    button.setAttribute('aria-label', label); button.innerHTML = icon(glyph, { size });
    button.addEventListener('click', run); return button;
}
export function mountCharacterPanel({ shell, getContext, aurora } = {}) {
    if (document.documentElement.dataset.vcLayout !== 'desktop') return null;
    const pane = shell.querySelector('.vc-shell-chat'), host = shell.querySelector('.vc-shell-body');
    const toggle = action('角色面板', 'user-round', () => setOpen(panel.hidden));
    toggle.classList.add('vc-desk-character-toggle');
    pane.querySelector('.vc-capsule').prepend(toggle);
    const search = mountChatSearch({ pane, getContext });
    const panel = node('aside', 'vc-desk-character'); panel.id = 'vc-desktop-character-panel';
    panel.setAttribute('aria-label', '角色面板'); toggle.setAttribute('aria-controls', panel.id);
    const close = action('关闭角色面板', 'x', () => { setOpen(false); toggle.focus(); });
    close.classList.add('vc-desk-character-close');
    const identity = node('div', 'vc-desk-character-identity');
    const shortcuts = node('div', 'vc-desk-character-actions');
    const memorySection = node('section', 'vc-desk-character-section');
    const followSection = node('section', 'vc-desk-character-section');
    panel.append(close, identity, shortcuts, memorySection, followSection); host.append(panel);
    let id = '', generation = 0, instancePage, dead = false;
    const memories = createMemoryPage({ onChange: paintMemories });
    function setOpen(open, animate = true) {
        panel.hidden = !open; shell.dataset.characterPanel = open ? 'open' : 'closed';
        toggle.setAttribute('aria-expanded', String(open));
        if (open && animate) panel.animate(reducedMotion() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'none' }], { duration: reducedMotion() ? 150 : 380, easing: reducedMotion() ? 'ease' : SPRING });
    }
    function paintMemories() {
        const ctx = getContext(), block = ctx.extensionPrompts?.vc_long_term_memory?.value;
        const rows = recalledItems(memories.state.items, block);
        memorySection.replaceChildren(); memorySection.hidden = !rows.length;
        if (!rows.length) return;
        memorySection.append(node('h2', '', '本次想起'));
        for (const item of rows) {
            const row = node('article', 'vc-desk-recalled'); row.dataset.memoryId = String(item.memoryId);
            row.append(node('p', '', item.summary));
            const actions = node('div', 'vc-desk-recalled-actions');
            for (const [label, run] of [['纠正', () => edit(item)], ['删除', () => forget(item)]]) {
                const button = node('button', 'vc-btn vc-btn-text', label); button.type = 'button';
                if (label === '删除') button.classList.add('is-danger');
                button.addEventListener('click', run); actions.append(button);
            }
            row.append(actions); memorySection.append(row);
        }
    }
    // P1-5：桌面「记忆」不再开旧右栏，改为打开角色面板并滚到「本次想起」。外壳的点击监听在冒泡阶段，这里在捕获阶段先接管。
    function openMemory() {
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
    // P2-2：会话行时间改为 今天 HH:mm / 昨天 / 周X / M/D；当前会话的预览与时间随最新消息刷新（外壳只在切换会话时重绘列表）。
    function paintRows() {
        const now = new Date();
        for (const time of shell.querySelectorAll('.vc-convo .vc-convo-time[data-time]')) {
            const label = desktopConversationTime(time.dataset.time, now);
            if (label && time.textContent !== label) time.textContent = label;
        }
        for (const row of shell.querySelectorAll('.vc-convo')) {
            const inst = row.querySelector('.vc-convo-inst'), tail = inst && instanceTail(row.querySelector('.vc-convo-name')?.textContent, inst.textContent);
            if (tail && tail !== inst.textContent) inst.textContent = tail;
        }
    }
    function syncCurrentRow() {
        const snap = chatSnapshotFromContext(getContext());
        const row = snap?.preview && shell.querySelector(`.vc-convo[data-relationship-id="${CSS.escape(snap.relationshipId)}"]`);
        if (!row) return;
        row.querySelector('.vc-convo-preview').textContent = snap.preview;
        if (!desktopConversationTime(snap.time)) return;
        let time = row.querySelector('.vc-convo-time');
        if (!time) { time = node('span', 'vc-convo-time vc-num'); row.querySelector('.vc-convo-top').append(time); }
        time.dataset.time = String(Date.parse(snap.time) || snap.time); paintRows();
    }
    const rowObserver = new MutationObserver(paintRows);
    const rowList = shell.querySelector('[data-convo-list]');
    if (rowList) rowObserver.observe(rowList, { childList: true });
    const ctx = getContext(), messageEvents = ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED']
        .map(name => ctx.eventTypes?.[name]).filter(Boolean);
    for (const type of messageEvents) ctx.eventSource?.on(type, syncCurrentRow);
    paintRows();
    async function edit(item) {
        const opener = document.activeElement;
        await memories.select(String(item.memoryId));
        if (!memories.state.detail || memories.state.detailError) { showToast('没有完成，请重试。', { type: 'failure' }); return; }
        memories.edit(); if (!memories.state.editing) return;
        const form = node('form', 'vc-desk-memory-editor');
        const label = node('label', '', '纠正记忆'); label.htmlFor = 'vc-desk-recall-draft';
        const input = node('textarea', ''); input.id = label.htmlFor; input.value = memories.state.draft;
        const error = node('p', 'vc-desk-error'); error.setAttribute('role', 'alert');
        const footer = node('div', 'vc-desk-editor-actions');
        const cancel = node('button', 'vc-btn vc-btn-gray', '取消'); cancel.type = 'button';
        const save = node('button', 'vc-btn vc-btn-fill', '保存'); save.type = 'submit'; save.disabled = true;
        const dirty = () => input.value !== memories.state.detail?.summary;
        input.addEventListener('input', () => { save.disabled = !dirty() || !input.value.trim(); });
        footer.append(cancel, save); form.append(label, input, error, footer);
        const sheet = openSheet({ title: '纠正记忆', body: form, opener, isDirty: dirty, canClose: () => !memories.state.busy, onDone: () => {
            memories.cancelEdit();
            queueMicrotask(() => memorySection.querySelector(`[data-memory-id="${CSS.escape(String(item.memoryId))}"] button`)?.focus());
        } });
        sheet.done.hidden = true;
        cancel.addEventListener('click', () => void sheet.close());
        form.addEventListener('submit', async event => {
            event.preventDefault(); if (save.disabled) return;
            save.style.width = `${save.getBoundingClientRect().width}px`; save.disabled = input.disabled = cancel.disabled = true; save.textContent = '保存中…';
            memories.setDraft(input.value); await memories.save();
            if (memories.state.detailError || memories.state.conflict || memories.state.reauthAction) {
                error.textContent = memories.state.detailError || '没有完成，请重试。'; save.textContent = '保存'; save.disabled = input.disabled = cancel.disabled = false; return;
            }
            input.value = memories.state.detail.summary; await sheet.close(); showToast('已保存');
        }); input.focus();
    }
    async function forget(item) {
        if (!await confirmAlert({ title: '删除这条记忆？', message: FORGET_NOTICE, action: '删除', opener: document.activeElement })) return;
        await memories.select(String(item.memoryId));
        await memories.forget();
        if (memories.state.detailError || memories.state.reauthAction) showToast('没有完成，请重试。', { type: 'failure' });
    }
    async function refresh() {
        const ticket = ++generation, ctx = getContext();
        id = String(ctx.chatMetadata?.vc_binding?.relationshipId || '');
        if (!id) { identity.replaceChildren(); shortcuts.replaceChildren(); memorySection.hidden = followSection.hidden = true; return; }
        const card = ctx.characters?.[ctx.characterId], name = card?.name || ctx.name2 || '';
        const avatar = node('span', 'vc-desk-character-avatar', name.slice(0, 1));
        const src = safeAvatarUrl(card?.avatar);
        if (src) { const image = node('img', ''); image.src = src; image.alt = ''; avatar.replaceChildren(image); }
        identity.replaceChildren(avatar, node('h1', '', name));
        shortcuts.replaceChildren(); memorySection.hidden = followSection.hidden = true;
        const voice = action('声音', 'volume-2', () => void openRelationshipVoiceSettings(id, { opener: voice }), 24);
        const memory = action('记忆', 'brain', () => requestOpenMemory(memory), 24);
        const settings = action('设置', 'settings', async () => {
            instancePage ||= mountInstancePage({ getContext });
            await instancePage.open(settings); instancePage.page.selectInstance(id);
        }, 24);
        for (const button of [voice, memory, settings]) {
            const wrap = node('div', ''); wrap.append(button, node('span', '', button.getAttribute('aria-label'))); shortcuts.append(wrap);
        }
        // 缺少任一数据时只省略对应区块，不用模拟值补齐。
        const [relationships, state, follows] = await Promise.allSettled([
            fetchRelationships(), storyRequest('GET', `/api/v1/relationships/${id}/companion-state`), listFollowUps(id), memories.open(id),
        ]);
        if (dead || generation !== ticket) return;
        const relationship = relationships.status === 'fulfilled' ? relationships.value.find(row => String(row.relationshipId) === id) : null;
        if (relationship?.displayName) identity.append(node('p', 'vc-meta', relationship.displayName));
        if (state.status === 'fulfilled' && state.value?.mood?.vibe) identity.append(node('p', 'vc-desk-character-mood', state.value.mood.vibe));
        if (follows.status === 'fulfilled' && follows.value.length) {
            followSection.replaceChildren(node('h2', '', '跟进'));
            for (const item of follows.value.filter(row => row.status !== 'CANCELLED')) {
                const row = node('article', 'vc-desk-recalled');
                row.append(node('p', '', item.body), node('time', 'vc-meta', [item.eventDate, item.eventTime].filter(Boolean).join(' '))); followSection.append(row);
            }
            followSection.hidden = followSection.children.length < 2;
        }
        paintRows();
        for (const row of shell.querySelectorAll('.vc-convo[data-relationship-id]')) {
            row.setAttribute('data-vc-light', '');
            row.setAttribute('aria-current', String(row.dataset.relationshipId === id));
        }
        const tint = getComputedStyle(document.body).getPropertyValue('--vc-tint').trim(); if (src && tint) aurora?.setTint(tint);
    }
    const esc = event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !panel.hidden && panel.getClientRects().length && !document.querySelector('.vc-sheet,.vc-alert,.vc-menu')) {
            event.preventDefault(); setOpen(false); toggle.focus();
        }
    };
    const resize = () => { if (innerWidth < 744) setOpen(false, false); };
    window.addEventListener('keydown', esc); window.addEventListener('resize', resize);
    setOpen(innerWidth >= 1600, false); void refresh();
    return { panel, toggle, search, refresh, setOpen, openMemory, destroy() { dead = true; generation++; memories.close(); search?.destroy(); shell.removeEventListener('click', takeMemory, true); rowObserver.disconnect(); for (const type of messageEvents) ctx.eventSource?.removeListener(type, syncCurrentRow); window.removeEventListener('keydown', esc); window.removeEventListener('resize', resize); panel.remove(); toggle.remove(); } };
}
