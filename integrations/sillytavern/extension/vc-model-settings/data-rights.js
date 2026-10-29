// Native data-rights and account controls. The current password lives only in the
// reauth submit handler, then the field is cleared. It is never written to attributes or storage.
import {
    captureSessionContext, createDataExport, recoverDataExport, getDataExport, downloadDataExport, deleteOwnAccount,
    changePassword, listSessions, revokeSession, logoutCurrent, resetAuthenticator, reauth, fetchSession,
} from './api.js';
import {
    AUTH_RESET_COPY, BACKUP_COPY, EXPORT_PARTIAL_COPY, PASSWORD_CHANGED_COPY, RESTORE_LIMIT_COPY, SESSION_EMPTY_COPY,
    authenticatorStatusText, deletionProgressText, otherSessions, sessionRowText,
} from './account-logic.js';
import { confirmAlert } from './ui/alert.js';
import { icon } from './ui/icons.js';
import { registerAccountOpener, vcUiEnabled } from './drawers.js';

function ensureAccountStyles() {
    if (typeof document === 'undefined' || document.querySelector('link[data-vc-account]')) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./account.css', import.meta.url).href;
    style.setAttribute('data-vc-account', '');
    (document.head || document.documentElement).append(style);
}

/** 五个分区卡片。当前密码只出现在文末的重新验证层。 */
export function renderAccountShell() {
    return `<dialog class="vc-data-dialog" aria-labelledby="vc-data-title">
      <header class="vcms-header"><h1 id="vc-data-title" class="vcms-title" tabindex="-1">数据与账户</h1><button class="vcms-btn vcms-btn-ghost" type="button" data-close>返回聊天</button></header>
      <main class="vc-data-body">
        <div class="vc-account-cards">
          <div class="vc-account-security">
            <section class="vc-account-card" aria-label="修改密码">
              <h2>修改密码</h2>
              <form data-password>
                <label>新密码<input type="password" name="newPassword" autocomplete="new-password" required maxlength="1024"></label>
                <button class="vcms-btn vcms-btn-primary" type="submit">修改密码</button>
              </form>
              <div class="vc-data-status" role="status" aria-live="polite" data-password-status></div>
            </section>
            <section class="vc-account-card" aria-label="验证器">
              <h2>验证器</h2>
              <p data-auth>验证器未启用</p>
              <button class="vcms-btn" type="button" data-reset>重置验证器</button>
              <div class="vc-data-status" role="status" aria-live="polite" data-auth-status></div>
            </section>
          </div>
          <section class="vc-account-card" aria-label="当前会话">
            <h2>当前会话</h2>
            <div data-sessions></div>
            <div class="vc-data-actions"><button class="vcms-btn" type="button" data-revoke-others>登出其他会话</button><button class="vcms-btn" type="button" data-logout>登出</button></div>
            <div class="vc-data-status" role="status" aria-live="polite" data-session-status></div>
          </section>
          <section class="vc-account-card" aria-label="导出数据">
            <h2>导出数据</h2>
            <p>包含当前聊天、角色、世界书、记忆和来源；密钥与历史备份不进入副本。</p>
            <div class="vc-data-actions"><button class="vcms-btn vcms-btn-primary" type="button" data-export>生成副本</button><button class="vcms-btn vcms-btn-ghost" type="button" data-recover>取回最近副本</button></div>
            <div class="vc-data-status" role="status" aria-live="polite" data-export-status></div>
            <button class="vcms-btn vcms-btn-primary" type="button" data-download hidden>下载副本</button>
          </section>
          <section class="vc-account-card vc-data-delete" aria-label="删除账号及在线数据">
            <details>
              <summary>删除账号及在线数据</summary>
              <form data-delete>
                <p>在线聊天、角色、世界书、记忆、导出文件和私有备份将一并清除。离线备份另行清理。</p>
                <label class="vc-data-confirm"><input type="checkbox" required>我确认删除当前账号及其在线私有数据</label>
                <button class="vcms-btn vcms-btn-danger" type="submit">删除账号及在线数据</button>
              </form>
              <div class="vc-data-status" role="status" aria-live="polite" data-delete-status></div>
            </details>
          </section>
        </div>
        <p class="vc-data-scope">${BACKUP_COPY}</p>
        <p class="vc-data-scope" data-restore-limit>${RESTORE_LIMIT_COPY}</p>
        <p class="vc-data-scope">删除长期记忆会保留聊天原文，原文仍可能用于当前对话；删除聊天不影响其他独立分支。</p>
      </main>
      <div class="vc-account-reauth" role="dialog" aria-modal="true" aria-label="重新验证身份" hidden>
        <form data-reauth>
          <p>需要重新验证身份。</p>
          <label>当前密码<input type="password" autocomplete="current-password" required maxlength="1024" data-reauth-password></label>
          <div class="vc-data-status" role="status" aria-live="polite" data-reauth-status></div>
          <div class="vc-data-actions"><button class="vcms-btn vcms-btn-primary" type="submit">验证并继续</button><button class="vcms-btn vcms-btn-ghost" type="button" data-reauth-cancel>取消</button></div>
        </form>
      </div>
    </dialog>`;
}

/** 敏感操作一律先 reauth。当前密码只传给 reauth，以及仍要求 currentPassword 的原接口。 */
export async function executeSensitiveAction({ action, password, newPassword, accountId, deps }) {
    await deps.reauth(password);
    if (action === 'password') return deps.changePassword(password, newPassword);
    if (action === 'reset') return deps.resetAuthenticator(accountId);
    if (action === 'export') return deps.createDataExport(password);
    if (action === 'recover') return deps.recoverDataExport(password);
    if (action === 'delete') return deps.deleteOwnAccount(password);
    throw new Error('未知账户操作');
}

export function mountDataRights() {
    ensureAccountStyles();
    const root = document.createElement('div');
    root.className = 'vcms-root vc-data-root';
    root.innerHTML = renderAccountShell();
    document.body.append(root);
    const dialog = root.querySelector('dialog');
    const deleteForm = root.querySelector('[data-delete]');
    const exportStatus = root.querySelector('[data-export-status]');
    const deleteStatus = root.querySelector('[data-delete-status]');
    const download = root.querySelector('[data-download]');
    const passwordForm = root.querySelector('[data-password]');
    const authLine = root.querySelector('[data-auth]');
    const authStatus = root.querySelector('[data-auth-status]');
    const passwordStatus = root.querySelector('[data-password-status]');
    const sessionStatus = root.querySelector('[data-session-status]');
    const sessionList = root.querySelector('[data-sessions]');
    const reauthLayer = root.querySelector('.vc-account-reauth');
    const reauthForm = root.querySelector('[data-reauth]');
    const reauthInput = root.querySelector('[data-reauth-password]');
    const reauthStatus = root.querySelector('[data-reauth-status]');
    let version = 0;
    let timer;
    let currentExport;
    let downloadUrl;
    let busy = false;
    let deleted = false;
    let opener = null;
    let accountId = '';
    let sessions = [];
    let sessionsLoaded = false;
    let deleteDomains = [];
    let pending = null;
    const clearSecrets = () => root.querySelectorAll('input[type=password]').forEach((input) => { input.value = ''; });
    const setBusy = (value) => {
        busy = value;
        root.querySelectorAll('form input, form button, [data-download], [data-revoke-others], [data-logout], [data-reset], [data-export], [data-recover]').forEach((control) => {
            control.disabled = value || deleted;
        });
        const revoke = root.querySelector('[data-revoke-others]');
        if (revoke && !value && !deleted) revoke.disabled = otherSessions(sessions).length === 0;
    };
    const errorText = (error) => error?.kind === 'unauthenticated' ? '请重新登录后重试。' : error?.kind === 'context-changed' ? '登录状态已变化，请重新加载页面。' : '操作尚未完成，请稍后重试。';
    function placeFocus(target, guard) {
        const place = () => {
            if (guard && !guard()) return;
            if (!target || typeof target.focus !== 'function') return;
            try { target.focus(); } catch { /* 入口尚未可聚焦 */ }
        };
        place();
        queueMicrotask(place);
        requestAnimationFrame(place);
    }
    function restoreOpener() {
        const target = opener;
        if (!target || typeof target.focus !== 'function') return;
        const host = typeof target.closest === 'function' ? target.closest('dialog') : null;
        if (host && host !== dialog && host.open !== true && typeof host.showModal === 'function') {
            try { host.showModal(); } catch { /* 上一个模态还在关闭 */ }
        }
        placeFocus(target, () => !host || host === dialog || host.open === true);
    }
    function closeReauth(restore = true) {
        const trigger = pending?.trigger || null;
        pending = null;
        reauthInput.value = '';
        reauthStatus.textContent = '';
        reauthLayer.hidden = true;
        if (restore) placeFocus(trigger, () => reauthLayer.hidden);
    }
    function openReauth(action, trigger, extra = {}) {
        pending = { action, trigger, newPassword: extra.newPassword || '' };
        reauthStatus.textContent = '';
        reauthInput.value = '';
        reauthLayer.hidden = false;
        placeFocus(reauthInput, () => !reauthLayer.hidden);
    }
    function close() {
        version += 1;
        clearTimeout(timer);
        clearSecrets();
        pending = null;
        reauthLayer.hidden = true;
        reauthStatus.textContent = '';
        currentExport = null;
        downloadUrl = null;
        download.hidden = true;
        if (deleted) { location.assign('/auth/'); return; }
        dialog.close();
        restoreOpener();
    }
    function revealDeletion() {
        const details = typeof deleteStatus.closest === 'function' ? deleteStatus.closest('details') : null;
        if (details) details.open = true;
    }
    root.querySelector('[data-close]').addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if (busy) return;
        if (!reauthLayer.hidden) { closeReauth(true); return; }
        close();
    });
    root.querySelector('[data-reauth-cancel]').addEventListener('click', () => {
        if (busy) return;
        closeReauth(true);
    });
    function showExport(result, epoch) {
        if (!dialog.open || epoch !== version) return;
        if (result.downloadUrl) downloadUrl = result.downloadUrl;
        currentExport = result.exportId;
        download.hidden = result.status !== 'READY' || !downloadUrl;
        if (result.status === 'PARTIAL') {
            exportStatus.textContent = EXPORT_PARTIAL_COPY;
        } else if (result.status === 'READY') {
            const expires = result.expiresAt ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(result.expiresAt)) : '';
            exportStatus.textContent = `副本已生成，下载链接仅可使用一次。${expires ? `有效至 ${expires}。` : ''}`;
        } else if (result.status === 'PENDING') {
            exportStatus.textContent = result.errorMessage === 'ST_UNAVAILABLE' ? '聊天存储暂不可用，恢复后会继续生成。你可以稍后取回最近副本。' : '副本生成中。关闭页面后任务会继续，你可以稍后取回最近副本。';
            clearTimeout(timer);
            timer = setTimeout(async () => {
                try {
                    const next = await getDataExport(result.exportId);
                    if (currentExport === result.exportId) showExport(next, epoch);
                } catch (error) {
                    if (epoch === version && dialog.open) exportStatus.textContent = errorText(error);
                }
            }, 2000);
        } else {
            exportStatus.textContent = result.errorMessage === 'ST_EXPORT_TOO_LARGE' ? '当前私有内容超过导出上限，未生成副本。请减少文件数量或大小后重试。' : '副本未完成或已失效，请重新生成。';
        }
    }
    function paintSessions() {
        sessionList.textContent = '';
        const items = Array.isArray(sessions) ? sessions : [];
        if (vcUiEnabled() && !sessionsLoaded) {
            const pending = document.createElement('div');
            pending.className = 'vc-skeleton-row';
            pending.setAttribute('aria-busy', 'true');
            sessionList.append(pending);
        } else if (sessionsLoaded && items.length === 0) {
            const empty = document.createElement('p');
            empty.className = vcUiEnabled() ? 'vc-account-empty vc-empty' : 'vc-account-empty';
            empty.textContent = SESSION_EMPTY_COPY;
            sessionList.append(empty);
        } else {
            for (const item of items) {
                const row = document.createElement('p');
                row.className = 'vc-account-session';
                row.textContent = sessionRowText(item);
                sessionList.append(row);
            }
        }
        const revoke = root.querySelector('[data-revoke-others]');
        if (revoke) revoke.disabled = busy || deleted || otherSessions(sessions).length === 0;
        syncAccountHome();
    }
    function watchDeletion(epoch) {
        clearTimeout(timer);
        deleteStatus.textContent = deletionProgressText({ pendingDomains: deleteDomains });
        revealDeletion();
        timer = setTimeout(async () => {
            if (!dialog.open || epoch !== version) return;
            try {
                const session = await fetchSession();
                if (!dialog.open || epoch !== version) return;
                if (session?.deletionPending) watchDeletion(epoch);
                else {
                    deleted = true;
                    root.querySelector('[data-close]').textContent = '返回登录';
                    deleteStatus.textContent = '在线数据已删除。离线备份按保留策略另行清理。';
                }
            } catch {
                if (dialog.open && epoch === version) watchDeletion(epoch);
            }
        }, 2000);
    }
    function applySensitiveResult(action, result, epoch) {
        if (epoch !== version || !dialog.open) return;
        if (action === 'password') passwordStatus.textContent = PASSWORD_CHANGED_COPY;
        else if (action === 'reset') {
            authLine.textContent = '验证器未启用';
            authStatus.textContent = AUTH_RESET_COPY;
            syncAccountHome();
        } else if (action === 'export' || action === 'recover') showExport(result, epoch);
        else if (action === 'delete') {
            if (result?.ok === true && result?.status !== 'PENDING') {
                deleted = true;
                root.querySelector('[data-close]').textContent = '返回登录';
                download.hidden = true;
                deleteStatus.textContent = '在线数据已删除。离线备份按保留策略另行清理。';
            } else {
                deleteDomains = Array.isArray(result?.pendingDomains) ? result.pendingDomains : [];
                deleteForm.hidden = true;
                watchDeletion(epoch);
            }
        }
    }
    async function loadAccount() {
        const epoch = version;
        try {
            const session = await captureSessionContext();
            accountId = session.accountId;
            const [full, listed] = await Promise.all([fetchSession(), listSessions()]);
            if (epoch !== version || !dialog.open) return;
            authLine.textContent = authenticatorStatusText(full);
            sessions = Array.isArray(listed) ? listed : [];
            sessionsLoaded = true;
            paintSessions();
            syncAccountHome();
        } catch {
            if (epoch === version && dialog.open) sessionStatus.textContent = '账户信息暂不可用';
        }
    }
    passwordForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (busy || !passwordForm.reportValidity()) return;
        const newPassword = passwordForm.elements.newPassword.value;
        passwordForm.elements.newPassword.value = '';
        openReauth('password', event.submitter || passwordForm.querySelector('button[type=submit]'), { newPassword });
    });
    root.querySelector('[data-reset]').addEventListener('click', () => {
        if (busy || !accountId) return;
        openReauth('reset', root.querySelector('[data-reset]'));
    });
    root.querySelector('[data-export]').addEventListener('click', () => {
        if (busy) return;
        openReauth('export', root.querySelector('[data-export]'));
    });
    root.querySelector('[data-recover]').addEventListener('click', () => {
        if (busy) return;
        openReauth('recover', root.querySelector('[data-recover]'));
    });
    deleteForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        const trigger = event.submitter || deleteForm.querySelector('button[type=submit]');
        if (vcUiEnabled()) {
            const box = deleteForm.querySelector('input[type="checkbox"]');
            if (box) box.checked = true;
            const ok = await confirmAlert({
                title: '删除账号及在线数据',
                message: '在线聊天、角色、世界书、记忆、导出文件和私有备份将一并清除。离线备份另行清理。',
                action: '删除',
                root: dialog,
                opener: trigger,
            });
            if (!ok) {
                if (box) box.checked = false;
                return;
            }
        } else if (!deleteForm.reportValidity()) return;
        openReauth('delete', trigger);
    });
    reauthForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy || !pending || !reauthForm.reportValidity()) return;
        const password = reauthInput.value;
        const action = pending.action;
        const newPassword = pending.newPassword;
        const trigger = pending.trigger;
        reauthInput.value = '';
        const epoch = version;
        setBusy(true);
        reauthStatus.textContent = '正在验证…';
        let focusAfter = null;
        try {
            const result = await executeSensitiveAction({
                action,
                password,
                newPassword,
                accountId,
                deps: { reauth, changePassword, resetAuthenticator, createDataExport, recoverDataExport, deleteOwnAccount },
            });
            if (epoch !== version || !dialog.open) return;
            pending = null;
            reauthLayer.hidden = true;
            reauthStatus.textContent = '';
            applySensitiveResult(action, result, epoch);
            focusAfter = deleteForm.hidden ? root.querySelector('.vc-data-delete summary') : trigger;
        } catch (error) {
            if (epoch === version && dialog.open && action === 'delete' && Array.isArray(error?.pendingDomains) && error.pendingDomains.length) {
                pending = null;
                reauthLayer.hidden = true;
                reauthStatus.textContent = '';
                deleteDomains = error.pendingDomains;
                deleteForm.hidden = true;
                watchDeletion(epoch);
                focusAfter = root.querySelector('.vc-data-delete summary');
            } else if (epoch === version && dialog.open && !reauthLayer.hidden) {
                reauthStatus.textContent = errorText(error);
                focusAfter = reauthInput;
            }
        } finally {
            reauthInput.value = '';
            setBusy(false);
            if (focusAfter) placeFocus(focusAfter, () => epoch === version);
        }
    });
    download.addEventListener('click', async () => {
        if (busy || !downloadUrl) return;
        const epoch = version;
        setBusy(true);
        try {
            const blob = await downloadDataExport(downloadUrl);
            if (epoch !== version || !dialog.open) return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'virtual-companion-data.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            downloadUrl = null;
            download.hidden = true;
            exportStatus.textContent = '副本已下载；请妥善保存。';
        } catch (error) {
            if (epoch === version && dialog.open) exportStatus.textContent = errorText(error);
        } finally { setBusy(false); }
    });
    root.querySelector('[data-revoke-others]').addEventListener('click', async () => {
        if (busy) return;
        const epoch = version;
        const ids = otherSessions(sessions).map((item) => item.id);
        if (!ids.length) return;
        setBusy(true);
        try {
            for (const id of ids) await revokeSession(id);
            if (epoch !== version || !dialog.open) return;
            sessions = sessions.filter((item) => item.current === true);
            paintSessions();
            sessionStatus.textContent = '其他会话已登出';
        } catch (error) {
            if (epoch === version && dialog.open) sessionStatus.textContent = errorText(error);
        } finally { setBusy(false); }
    });
    root.querySelector('[data-logout]').addEventListener('click', async () => {
        if (busy) return;
        setBusy(true);
        try { await logoutCurrent(); location.assign('/auth/'); }
        catch (error) { sessionStatus.textContent = errorText(error); setBusy(false); }
    });
    function accountTitle(screen) {
        return {
            home: '账户与数据',
            password: '修改密码',
            auth: '验证器',
            sessions: '当前会话',
            export: '导出数据',
            delete: '删除账号及在线数据',
        }[screen] || '账户与数据';
    }
    function setAccountScreen(screen) {
        dialog.setAttribute('data-vc-screen', screen);
        const titleEl = dialog.querySelector('[data-vc-account-nav] .vc-nav-title');
        if (titleEl) titleEl.textContent = accountTitle(screen);
        const backLabel = dialog.querySelector('[data-vc-account-back] span');
        if (backLabel) backLabel.textContent = screen === 'home' ? '设置' : '';
        const backBtn = dialog.querySelector('[data-vc-account-back]');
        if (backBtn) backBtn.setAttribute('aria-label', screen === 'home' ? '返回设置' : '返回账户与数据');
        const details = dialog.querySelector('.vc-data-delete details');
        if (details && screen === 'delete') details.open = true;
    }
    function syncAccountHome() {
        const auth = dialog.querySelector('[data-vc-auth-summary]');
        if (auth) {
            const text = authLine.textContent || '';
            auth.textContent = text.includes('未启用') ? '未启用' : (text.includes('已启用') ? '已启用' : text);
        }
        const count = dialog.querySelector('[data-vc-session-count]');
        if (count) count.textContent = sessionsLoaded ? `${sessions.length} 个` : '';
    }
    function applyAccountButtons() {
        const pairs = [
            ['[data-password] button[type="submit"]', ['vc-btn', 'vc-btn-fill']],
            ['[data-reset]', ['vc-btn', 'vc-btn-text']],
            ['[data-revoke-others]', ['vc-btn', 'vc-btn-text']],
            ['[data-logout]', ['vc-btn', 'vc-btn-text']],
            ['[data-export]', ['vc-btn', 'vc-btn-fill']],
            ['[data-recover]', ['vc-btn', 'vc-btn-text']],
            ['[data-download]', ['vc-btn', 'vc-btn-fill']],
            ['[data-delete] button[type="submit"]', ['vc-btn', 'vc-btn-danger']],
            ['[data-reauth] button[type="submit"]', ['vc-btn', 'vc-btn-fill']],
            ['[data-reauth-cancel]', ['vc-btn', 'vc-btn-text']],
        ];
        for (const [selector, classes] of pairs) {
            const el = dialog.querySelector(selector);
            if (!el) continue;
            for (const name of classes) el.classList.add(name);
        }
    }
    function ensureAccountHome() {
        if (dialog.querySelector('[data-vc-account-home]')) return;
        const home = document.createElement('div');
        home.setAttribute('data-vc-account-home', '');
        const chevron = icon('chevron-right', { size: 18 });
        home.innerHTML = `<div class="vc-group">
            <button type="button" class="vc-cell" data-vc-account-go="password"><span class="vc-grow">修改密码</span>${chevron}</button>
            <button type="button" class="vc-cell" data-vc-account-go="auth"><span class="vc-grow">验证器</span><span class="vc-value" data-vc-auth-summary>未启用</span>${chevron}</button>
            <button type="button" class="vc-cell" data-vc-account-go="sessions"><span class="vc-grow">当前会话</span><span class="vc-value" data-vc-session-count></span>${chevron}</button>
            <button type="button" class="vc-cell" data-vc-account-go="export"><span class="vc-grow">导出数据</span>${chevron}</button>
        </div>
        <div class="vc-group">
            <button type="button" class="vc-cell is-danger" data-vc-account-go="delete"><span class="vc-grow">删除账号及在线数据</span>${chevron}</button>
        </div>`;
        const body = dialog.querySelector('.vc-data-body');
        if (body && typeof body.prepend === 'function') body.prepend(home);
        else if (body && typeof body.insertBefore === 'function' && body.firstChild) body.insertBefore(home, body.firstChild);
        else dialog.append(home);
        home.addEventListener('click', (event) => {
            const go = event.target?.closest?.('[data-vc-account-go]');
            if (!go || busy) return;
            setAccountScreen(go.getAttribute('data-vc-account-go'));
        });
        applyAccountButtons();
    }
    function ensureVcChrome() {
        if (!vcUiEnabled()) return;
        if (!dialog.querySelector('[data-vc-account-nav]')) {
            const nav = document.createElement('div');
            nav.className = 'vc-navbar';
            nav.setAttribute('data-vc-account-nav', '');
            nav.style.setProperty('--vc-nav-p', '1');
            nav.innerHTML = `<button type="button" class="vc-btn vc-btn-text" data-vc-account-back aria-label="返回设置">${icon('chevron-left', { size: 22 })}<span>设置</span></button><div class="vc-nav-title">账户与数据</div><div class="vc-nav-spacer"></div>`;
            if (typeof dialog.prepend === 'function') dialog.prepend(nav);
            else if (typeof dialog.insertBefore === 'function' && dialog.firstChild) dialog.insertBefore(nav, dialog.firstChild);
            else dialog.append(nav);
            nav.querySelector('[data-vc-account-back]')?.addEventListener('click', () => {
                if (busy) return;
                const screen = dialog.getAttribute('data-vc-screen');
                if (screen && screen !== 'home') {
                    setAccountScreen('home');
                    return;
                }
                close();
            });
        }
        ensureAccountHome();
        const box = deleteForm.querySelector('input[type="checkbox"]');
        if (box) box.required = false;
        setAccountScreen('home');
        syncAccountHome();
    }
    const controller = {
        open(returnFocus = document.activeElement) {
            opener = returnFocus || opener;
            ensureVcChrome();
            version += 1;
            exportStatus.textContent = '';
            deleteStatus.textContent = '';
            passwordStatus.textContent = '';
            authStatus.textContent = '';
            sessionStatus.textContent = '';
            reauthStatus.textContent = '';
            deleteForm.hidden = false;
            deleteForm.reset();
            clearSecrets();
            pending = null;
            reauthLayer.hidden = true;
            sessions = [];
            sessionsLoaded = false;
            accountId = '';
            paintSessions();
            if (!dialog.open) dialog.showModal();
            root.querySelector('h1').focus();
            void loadAccount();
        },
        close,
        showExportState(result) { showExport(result, version); },
        showDeletionProgress(progress) {
            deleteDomains = Array.isArray(progress?.pendingDomains) ? progress.pendingDomains : [];
            deleteStatus.textContent = deletionProgressText(progress);
            revealDeletion();
        },
    };
    registerAccountOpener((returnFocus) => controller.open(returnFocus));
    return controller;
}
