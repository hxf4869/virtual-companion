// Native data-rights and account controls. The current password lives only in the
// reauth submit handler, then the field is cleared. It is never written to attributes or storage.
import {
    captureSessionContext, createDataExport, recoverDataExport, getDataExport, downloadDataExport, deleteOwnAccount,
    changePassword, listSessions, revokeSession, logoutCurrent, resetAuthenticator, reauth, fetchSession,
    listTrustedDevices, revokeTrustedDevice, listConsents, recordConsent,
    fetchVoiceUsage,
} from './api.js';
import { CONSENT_VERSION, ensureConsentStyles, effectiveConsents, consentStatusText, REQUIRED_CONSENTS } from './consent.js';
import {
    EXPORT_POLL_INTERVAL_MS,
    formatVoiceStorage,
    trustedDeviceGroupVisible,
    formatTrustedWhen,
    formatTrustedDeviceLine,
    executeSensitiveAction,
} from './consent-logic.js';
import {
    AUTH_RESET_COPY, BACKUP_COPY, EXPORT_PARTIAL_COPY, PASSWORD_CHANGED_COPY, RESTORE_LIMIT_COPY, SESSION_EMPTY_COPY,
    authenticatorStatusText, deletionProgressText, otherSessions, sessionRowText,
} from './account-logic.js';
import { confirmAlert } from './ui/alert.js';
import { iconSpriteUrl } from './ui/icons.js';
import { mountAccountContentsView } from './desktop/build/index.js';
import { registerAccountOpener, vcUiEnabled } from './drawers.js';

export {
    EXPORT_POLL_INTERVAL_MS,
    formatVoiceStorage,
    trustedDeviceGroupVisible,
    formatTrustedWhen,
    formatTrustedDeviceLine,
    executeSensitiveAction,
};

function ensureAccountStyles() {
    if (typeof document === 'undefined' || document.querySelector('link[data-vc-account]')) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./account.css', import.meta.url).href;
    style.setAttribute('data-vc-account', '');
    (document.head || document.documentElement).append(style);
}

export function mountDataRights() {
    ensureAccountStyles();
    ensureConsentStyles();
    const root = document.createElement('div');
    root.className = 'vcms-root vc-data-root';
    let opened = false, destroyed = false;
    document.body.append(root);
    let view, version = 0, timer, currentExport, downloadUrl, busy = false, deleted = false, opener = null, accountId = '', sessions = [], sessionsLoaded = false, trustedDevices = [], deviceConfirm = false, deleteDomains = [], pending = null, consentRequest = 0;
    const state = { vc: false, screen: 'home', authText: '验证器未启用', voiceStorage: '', consents: [], consentsLoaded: false, statuses: {}, downloadVisible: false, deleteFormHidden: false, deleteOpen: false, deleteChecked: false, reauthOpen: false, passwordReset: 0, reauthReset: 0, deleteReset: 0 };
    const find = selector => root.querySelector(selector);
    const current = epoch => epoch === version && opened;
    const errorText = error => error?.kind === 'unauthenticated' ? '请重新登录后重试。' : error?.kind === 'context-changed' ? '登录状态已变化，请重新加载页面。' : '操作尚未完成，请稍后重试。';
    function deviceRows() { return (Array.isArray(trustedDevices) ? trustedDevices : []).filter(item => /^[1-9][0-9]*$/.test(String(item?.id || ''))).map(item => { const line = formatTrustedDeviceLine(item); return { id: String(item.id), name: line.name, meta: `最近使用 ${line.lastUsed} · 到期 ${line.expires}` }; }); }
    function render() {
        if (destroyed) return;
        const consents = effectiveConsents(state.consents);
        const props = {
            open: opened, opener, onDismiss() { if (busy) return; if (state.reauthOpen) closeReauth(); else close(); },
            vc: state.vc, sprite: iconSpriteUrl(), screen: state.screen, title: accountTitle(state.screen), busy, deleted,
            authText: state.authText, authSummary: state.authText.includes('未启用') ? '未启用' : state.authText.includes('已启用') ? '已启用' : state.authText,
            voiceStorage: state.voiceStorage, sessionsLoading: !sessionsLoaded, sessions: (Array.isArray(sessions) ? sessions : []).map(sessionRowText), sessionCount: sessionsLoaded ? `${sessions.length} 个` : '', hasOtherSessions: otherSessions(sessions).length > 0,
            devices: deviceRows(), consents: state.consentsLoaded ? REQUIRED_CONSENTS.map(item => ({ type: item.type, icon: item.icon, label: item.label, meta: consentStatusText(consents.get(item.type)) })) : [],
            statuses: state.statuses, downloadVisible: state.downloadVisible, deleteFormHidden: state.deleteFormHidden, deleteOpen: state.deleteOpen, deleteChecked: state.deleteChecked, reauthOpen: state.reauthOpen,
            passwordReset: state.passwordReset, reauthReset: state.reauthReset, deleteReset: state.deleteReset,
            copies: { backup: BACKUP_COPY, restore: RESTORE_LIMIT_COPY, sessionEmpty: SESSION_EMPTY_COPY },
            onAction: (action, target) => { void onAction(action, target); }, onSubmit: (action, form, trigger) => { void onSubmit(action, form, trigger); }, onDeleteToggle: open => { state.deleteOpen = open; }, onDeleteCheck: checked => { state.deleteChecked = checked; render(); },
        };
        if (view)
            view.update(props);
        else
            view = mountAccountContentsView(root, props);
    }
    function setBusy(value) { busy = value; render(); }
    function clearSecrets() { state.passwordReset += 1; state.reauthReset += 1; }
    function placeFocus(target, guard) {
        const place = () => { if (guard && !guard())
            return; if (!target || typeof target.focus !== 'function')
            return; try {
            target.focus();
        }
        catch { /* 入口尚未可聚焦 */ } };
        place();
        queueMicrotask(place);
        if (typeof globalThis.requestAnimationFrame === 'function')
            globalThis.requestAnimationFrame(place);
    }
    function restoreOpener() {
        const target = opener;
        if (!target || typeof target.focus !== 'function')
            return;
        const host = typeof target.closest === 'function' ? target.closest('dialog') : null;
        if (host && host !== find('.vc-data-dialog') && host.open !== true && typeof host.showModal === 'function') {
            try {
                host.showModal();
            }
            catch { /* 上一模态尚在关闭 */ }
        }
        placeFocus(target, () => !host || host === find('.vc-data-dialog') || host.open === true);
    }
    function closeReauth(restore = true) {
        const trigger = pending?.trigger || null;
        pending = null;
        state.reauthReset += 1;
        state.statuses.reauth = '';
        state.reauthOpen = false;
        render();
        if (restore)
            placeFocus(trigger, () => opened && !state.reauthOpen);
    }
    function openReauth(action, trigger, extra = {}) {
        pending = { action, trigger, newPassword: extra.newPassword || '', consentType: extra.consentType || '' };
        state.statuses.reauth = '';
        state.reauthReset += 1;
        state.reauthOpen = true;
        render();
        placeFocus(find('[data-reauth-password]'), () => opened && state.reauthOpen);
    }
    function close() {
        if (busy || destroyed)
            return false;
        find('[data-vc-account-overlays] [data-vc-cancel]')?.click();
        version += 1;
        clearTimeout(timer);
        clearSecrets();
        pending = null;
        state.reauthOpen = false;
        state.statuses.reauth = '';
        currentExport = null;
        downloadUrl = null;
        state.downloadVisible = false;
        opened = false;
        render();
        if (deleted) {
            location.assign('/auth/');
            return true;
        }
        restoreOpener();
        return true;
    }
    function showExport(result, epoch) {
        if (!current(epoch))
            return;
        if (result.downloadUrl)
            downloadUrl = result.downloadUrl;
        currentExport = result.exportId;
        state.downloadVisible = result.status === 'READY' && Boolean(downloadUrl);
        if (result.status === 'PARTIAL')
            state.statuses.export = EXPORT_PARTIAL_COPY;
        else if (result.status === 'READY') {
            const expires = result.expiresAt ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(result.expiresAt)) : '';
            state.statuses.export = `副本已生成，下载链接仅可使用一次。${expires ? `有效至 ${expires}。` : ''}`;
        }
        else if (result.status === 'PENDING') {
            state.statuses.export = result.errorMessage === 'ST_UNAVAILABLE' ? '聊天存储暂不可用，恢复后会继续生成。你可以稍后取回最近副本。' : '副本生成中。关闭页面后任务会继续，你可以稍后取回最近副本。';
            clearTimeout(timer);
            timer = setTimeout(async () => { try {
                const next = await getDataExport(result.exportId);
                if (currentExport === result.exportId)
                    showExport(next, epoch);
            }
            catch (error) {
                if (current(epoch)) {
                    state.statuses.export = errorText(error);
                    render();
                }
            } }, 2000);
        }
        else
            state.statuses.export = result.errorMessage === 'ST_EXPORT_TOO_LARGE' ? '当前私有内容超过导出上限，未生成副本。请减少文件数量或大小后重试。' : '副本未完成或已失效，请重新生成。';
        render();
    }
    function paintDevices() { if (state.screen === 'devices' && deviceRows().length === 0)
        state.screen = 'home'; render(); }
    function watchDeletion(epoch) {
        clearTimeout(timer);
        state.statuses.delete = deletionProgressText({ pendingDomains: deleteDomains });
        state.deleteOpen = true;
        render();
        timer = setTimeout(async () => {
            if (!current(epoch))
                return;
            try {
                const session = await fetchSession();
                if (!current(epoch))
                    return;
                if (session?.deletionPending)
                    watchDeletion(epoch);
                else {
                    deleted = true;
                    state.statuses.delete = '在线数据已删除。离线备份按保留策略另行清理。';
                    render();
                }
            }
            catch {
                if (current(epoch))
                    watchDeletion(epoch);
            }
        }, 2000);
    }
    function applySensitiveResult(action, result, epoch) {
        if (!current(epoch))
            return;
        if (action === 'password')
            state.statuses.password = PASSWORD_CHANGED_COPY;
        else if (action === 'reset') {
            state.authText = '验证器未启用';
            state.statuses.auth = AUTH_RESET_COPY;
        }
        else if (action === 'export' || action === 'recover')
            showExport(result, epoch);
        else if (action === 'delete') {
            if (result?.ok === true && result?.status !== 'PENDING') {
                deleted = true;
                state.downloadVisible = false;
                state.statuses.delete = '在线数据已删除。离线备份按保留策略另行清理。';
            }
            else {
                deleteDomains = Array.isArray(result?.pendingDomains) ? result.pendingDomains : [];
                state.deleteFormHidden = true;
                watchDeletion(epoch);
            }
        }
    }
    async function paintConsentAccount() {
        const epoch = version, request = ++consentRequest;
        try {
            const rows = await listConsents();
            if (!current(epoch) || request !== consentRequest)
                return;
            state.consents = rows;
            state.consentsLoaded = true;
            state.statuses['consent-account'] = '';
            render();
        }
        catch (error) {
            if (current(epoch) && request === consentRequest) {
                state.statuses['consent-account'] = errorText(error);
                render();
            }
        }
    }
    async function loadAccount() {
        const epoch = version;
        try {
            const session = await captureSessionContext();
            if (!current(epoch))
                return;
            accountId = session.accountId;
            const [full, listed, trusted] = await Promise.all([fetchSession(), listSessions(), listTrustedDevices()]);
            if (!current(epoch))
                return;
            state.authText = authenticatorStatusText(full);
            sessions = Array.isArray(listed) ? listed : [];
            sessionsLoaded = true;
            trustedDevices = Array.isArray(trusted) ? trusted : [];
            paintDevices();
            await paintConsentAccount();
        }
        catch {
            if (current(epoch)) {
                state.statuses.session = '账户信息暂不可用';
                render();
            }
        }
    }
    function accountTitle(screen) { return { home: '账户与数据', password: '修改密码', auth: '验证器', sessions: '当前会话', devices: '已信任的设备', consent: '隐私与同意', export: '导出数据', delete: '删除账号及在线数据' }[screen] || '账户与数据'; }
    function setAccountScreen(screen) { state.screen = screen; if (screen === 'delete')
        state.deleteOpen = true; render(); if (screen === 'consent')
        void paintConsentAccount(); }
    async function onSubmit(action, form, trigger) {
        if (busy || deleted || !opened || !form.reportValidity())
            return;
        const button = trigger || form.querySelector('button[type=submit]');
        if (action === 'password') {
            const newPassword = form.elements.newPassword.value;
            state.passwordReset += 1;
            openReauth('password', button, { newPassword });
            return;
        }
        if (action === 'delete') {
            if (state.vc) {
                const epoch = version;
                state.deleteChecked = true;
                render();
                const ok = await confirmAlert({ title: '删除账号及在线数据', message: '在线聊天、角色、世界书、记忆、导出文件和私有备份将一并清除。离线备份另行清理。', action: '删除', root: find('[data-vc-account-overlays]'), opener: button });
                if (!current(epoch))
                    return;
                if (!ok || !opened) {
                    state.deleteChecked = false;
                    render();
                    return;
                }
            }
            openReauth('delete', button);
            return;
        }
        if (action !== 'reauth' || !pending)
            return;
        const password = form.querySelector('[data-reauth-password]').value;
        const { action: operation, newPassword, trigger: originalTrigger, consentType } = pending;
        state.reauthReset += 1;
        const epoch = version;
        state.statuses.reauth = '正在验证…';
        setBusy(true);
        let focusAfter = null;
        try {
            const result = await executeSensitiveAction({ action: operation, password, newPassword, accountId, consentType, deps: { reauth, changePassword, resetAuthenticator, createDataExport, recoverDataExport, deleteOwnAccount, recordConsent } });
            if (!current(epoch))
                return;
            pending = null;
            state.reauthOpen = false;
            state.statuses.reauth = '';
            applySensitiveResult(operation, result, epoch);
            if (operation === 'consent-revoke')
                await paintConsentAccount();
            focusAfter = state.deleteFormHidden ? '.vc-data-delete summary' : originalTrigger;
        }
        catch (error) {
            if (current(epoch) && operation === 'delete' && Array.isArray(error?.pendingDomains) && error.pendingDomains.length) {
                pending = null;
                state.reauthOpen = false;
                state.statuses.reauth = '';
                deleteDomains = error.pendingDomains;
                state.deleteFormHidden = true;
                watchDeletion(epoch);
                focusAfter = '.vc-data-delete summary';
            }
            else if (current(epoch) && state.reauthOpen) {
                state.statuses.reauth = errorText(error);
                focusAfter = '[data-reauth-password]';
            }
        }
        finally {
            state.reauthReset += 1;
            setBusy(false);
            if (focusAfter)
                placeFocus(typeof focusAfter === 'string' ? find(focusAfter) : focusAfter, () => current(epoch));
        }
    }
    async function onAction(action, target) {
        if (busy || !opened)
            return;
        if (action.endsWith('-page')) {
            setAccountScreen(action.slice(0, -5));
            return;
        }
        if (action === 'back') {
            if (state.screen && state.screen !== 'home')
                setAccountScreen('home');
            else
                close();
            return;
        }
        if (action === 'close') {
            close();
            return;
        }
        if (action === 'reauth-cancel') {
            closeReauth();
            return;
        }
        if (['reset', 'export', 'recover'].includes(action)) {
            if (action === 'reset' && !accountId)
                return;
            openReauth(action, target);
            return;
        }
        if (action === 'download') {
            if (!downloadUrl)
                return;
            const epoch = version;
            setBusy(true);
            try {
                const blob = await downloadDataExport(downloadUrl);
                if (!current(epoch))
                    return;
                const url = URL.createObjectURL(blob), link = document.createElement('a');
                link.href = url;
                link.download = 'virtual-companion-data.json';
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                downloadUrl = null;
                state.downloadVisible = false;
                state.statuses.export = '副本已下载；请妥善保存。';
            }
            catch (error) {
                if (current(epoch))
                    state.statuses.export = errorText(error);
            }
            finally {
                setBusy(false);
            }
            return;
        }
        if (action === 'revoke-others') {
            const epoch = version, ids = otherSessions(sessions).map(item => item.id);
            if (!ids.length)
                return;
            setBusy(true);
            try {
                for (const id of ids)
                    await revokeSession(id);
                if (!current(epoch))
                    return;
                sessions = sessions.filter(item => item.current === true);
                state.statuses.session = '其他会话已登出';
            }
            catch (error) {
                if (current(epoch))
                    state.statuses.session = errorText(error);
            }
            finally {
                setBusy(false);
            }
            return;
        }
        if (action === 'revoke-device') {
            if (deleted || deviceConfirm)
                return;
            const id = target.getAttribute('data-revoke-device') || '';
            if (!/^[1-9][0-9]*$/.test(id))
                return;
            deviceConfirm = true;
            try {
                const epoch = version;
                const ok = await confirmAlert({ title: '撤销此设备', message: '此设备下次登录需要验证码。', action: '撤销', root: find('[data-vc-account-overlays]'), opener: target });
                if (!ok || busy || !current(epoch))
                    return;
                setBusy(true);
                try {
                    await revokeTrustedDevice(id);
                    if (!current(epoch))
                        return;
                    trustedDevices = trustedDevices.filter(item => String(item?.id) !== id);
                    state.statuses.device = '';
                    paintDevices();
                }
                catch (error) {
                    if (current(epoch))
                        state.statuses.device = errorText(error);
                }
                finally {
                    setBusy(false);
                }
            }
            finally {
                deviceConfirm = false;
            }
            return;
        }
        if (action === 'consent-revoke') {
            if (deleted)
                return;
            const consentType = target.getAttribute('data-consent-revoke') || '';
            if (!REQUIRED_CONSENTS.some(item => item.type === consentType))
                return;
            const epoch = version;
            const ok = await confirmAlert({ title: '撤回这项同意', message: '撤回后，下次进入需要重新同意。', action: '撤回', root: find('[data-vc-account-overlays]'), opener: target });
            if (!ok || busy || !current(epoch))
                return;
            openReauth('consent-revoke', target, { consentType });
            return;
        }
        if (action === 'logout') {
            setBusy(true);
            try {
                await logoutCurrent();
                location.assign('/auth/');
            }
            catch (error) {
                state.statuses.session = errorText(error);
                setBusy(false);
            }
        }
    }
    render();
    const controller = {
        open(returnFocus = document.activeElement, screen = 'home') {
            if (busy || destroyed)
                return;
            opener = returnFocus || opener;
            version += 1;
            const epoch = version;
            state.vc = vcUiEnabled();
            state.screen = 'home';
            state.voiceStorage = '';
            state.statuses = {};
            state.deleteFormHidden = false;
            state.deleteReset += 1;
            state.deleteChecked = false;
            clearSecrets();
            pending = null;
            state.reauthOpen = false;
            sessions = [];
            sessionsLoaded = false;
            trustedDevices = [];
            accountId = '';
            opened = true;
            setAccountScreen(screen);
            if (state.vc)
                void fetchVoiceUsage().then(usage => { if (current(epoch)) {
                    state.voiceStorage = formatVoiceStorage(usage.storageBytes);
                    render();
                } }).catch(() => { if (current(epoch)) {
                    state.voiceStorage = '暂不可用';
                    render();
                } });
            void loadAccount();
        }, close,
        destroy() { if (destroyed) return; destroyed = true; opened = false; version += 1; clearTimeout(timer); pending = null; currentExport = null; downloadUrl = null; clearSecrets(); unregisterAccount(); view.unmount(); root.remove(); },
        showExportState(result) { showExport(result, version); },
        showDeletionProgress(progress) { deleteDomains = Array.isArray(progress?.pendingDomains) ? progress.pendingDomains : []; state.statuses.delete = deletionProgressText(progress); state.deleteOpen = true; render(); },
    };
    const unregisterAccount = registerAccountOpener(returnFocus => controller.open(returnFocus));
    return controller;
}
