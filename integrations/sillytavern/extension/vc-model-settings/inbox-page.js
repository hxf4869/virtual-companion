import { listFollowUps, markInboxRead } from './inbox-client.js';
export { listFollowUps, markInboxRead } from './inbox-client.js';
// UI-P04 主动陪伴 / 通知。跟进、静默、角色开关、inbox 与邮箱 / 飞书状态。
// 凭据只在本次输入里存在，不回显、不写 localStorage。渠道接受不写成手机已收到。
import { confirmAlert, confirmDiscard } from './ui/alert.js';
import { showToast } from './ui/toast.js';
import { mountInboxListView, mountInboxChannelView, mountInboxContentsView, inboxConflictContent, mountInboxReauthView } from './desktop/build/index.js';
import { popMenu } from './ui/menu.js';
import { createNav } from './ui/nav.js';
import { desktopLayout } from './desktop/presentation.js';
import { openSheet } from './ui/sheet.js';
import { readVcUiFlag } from './ui/theme.js';
import { createVoiceBubble } from './voice.js';
import {
    FOLLOW,
    FILTERS,
    PROACTIVE_MODES,
    PROACTIVE_LABELS,
    quietZoneValue,
    getProactivePolicy,
    putProactivePolicy,
    cancelFollowUp,
    listInbox,
    listChannels,
    putChannel,
    listDeliveries,
    readProactivePolicy,
    inboxPolicyDirty,
    proactivePolicyPayload,
    validatePolicy,
    createInboxPage,
    inboxViewProps,
    hasInboxDrafts,
} from './inbox-logic.js';

export {
    FOLLOW,
    FILTERS,
    PROACTIVE_MODES,
    PROACTIVE_LABELS,
    quietZoneValue,
    getProactivePolicy,
    putProactivePolicy,
    cancelFollowUp,
    listInbox,
    listChannels,
    putChannel,
    listDeliveries,
    readProactivePolicy,
    inboxPolicyDirty,
    proactivePolicyPayload,
    validatePolicy,
    createInboxPage,
    inboxViewProps,
    hasInboxDrafts,
} from './inbox-logic.js';

export function mountInboxVoices(root,state) {
    for (const slot of root.querySelectorAll('[data-vc-inbox-voice]')) {
        const item=state.inbox.find((row)=>row.eventId===slot.getAttribute('data-vc-inbox-voice'));
        if (item?.voice) slot.replaceChildren(createVoiceBubble({text:item.body,voice:item.voice}));
    }
}

function inboxVoice(state, id) {
    const item = state.inbox.find(row => row.eventId === id);
    return item?.voice ? createVoiceBubble({ text: item.body, voice: item.voice }) : null;
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
