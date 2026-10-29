// Native data-rights and account controls. Credentials stay in the form until submit, then are cleared.
import {
    captureSessionContext, createDataExport, recoverDataExport, getDataExport, downloadDataExport, deleteOwnAccount,
    changePassword, listSessions, revokeSession, logoutCurrent, resetAuthenticator, reauth, fetchSession,
} from './api.js';
import {
    AUTH_RESET_COPY, BACKUP_COPY, EXPORT_PARTIAL_COPY, PASSWORD_CHANGED_COPY, RESTORE_LIMIT_COPY,
    authenticatorStatusText, deletionProgressText, otherSessions, sessionLabel,
} from './account-logic.js';

export function mountDataRights() {
    const root = document.createElement('div'); root.className = 'vcms-root vc-data-root';
    root.innerHTML = `<dialog class="vc-data-dialog" aria-labelledby="vc-data-title">
      <header class="vcms-header"><h1 id="vc-data-title" class="vcms-title" tabindex="-1">数据与账户</h1><button class="vcms-btn vcms-btn-ghost" type="button" data-close>返回聊天</button></header>
      <main class="vc-data-body">
        <section class="vc-account" aria-label="账户">
          <h2>账户</h2>
          <p data-auth>验证器未启用</p>
          <form data-password>
            <label>当前密码<input type="password" name="currentPassword" autocomplete="current-password" required maxlength="1024"></label>
            <label>新密码<input type="password" name="newPassword" autocomplete="new-password" required maxlength="1024"></label>
            <button class="vcms-btn vcms-btn-primary" type="submit">修改密码</button>
          </form>
          <div class="vc-data-status" role="status" aria-live="polite" data-password-status></div>
          <form data-reset>
            <label>当前密码<input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label>
            <button class="vcms-btn" type="submit">重置验证器</button>
          </form>
          <div class="vc-data-status" role="status" aria-live="polite" data-auth-status></div>
          <div data-sessions></div>
          <div class="vc-data-actions"><button class="vcms-btn" type="button" data-revoke-others>登出其他会话</button><button class="vcms-btn" type="button" data-logout>登出</button></div>
          <div class="vc-data-status" role="status" aria-live="polite" data-session-status></div>
        </section>
        <form data-export><h2>导出数据</h2><p>包含当前聊天、角色、世界书、记忆和来源；密钥与历史备份不进入副本。</p>
          <label>当前密码<input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label>
          <div class="vc-data-actions"><button class="vcms-btn vcms-btn-primary" type="submit">生成副本</button><button class="vcms-btn vcms-btn-ghost" type="button" data-recover>取回最近副本</button></div>
        </form>
        <div class="vc-data-status" role="status" aria-live="polite" data-export-status></div>
        <button class="vcms-btn vcms-btn-primary" type="button" data-download hidden>下载副本</button>
        <section class="vc-data-delete"><details><summary>删除账号及在线数据</summary>
          <form data-delete><p>在线聊天、角色、世界书、记忆、导出文件和私有备份将一并清除。离线备份另行清理。</p>
            <label>当前密码<input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label>
            <label class="vc-data-confirm"><input type="checkbox" required>我确认删除当前账号及其在线私有数据</label>
            <button class="vcms-btn vcms-btn-danger" type="submit">删除账号及在线数据</button>
          </form>
          <div class="vc-data-status" role="status" aria-live="polite" data-delete-status></div>
        </details></section>
        <p class="vc-data-scope">${BACKUP_COPY}</p>
        <p class="vc-data-scope" data-restore-limit>${RESTORE_LIMIT_COPY}</p>
        <p class="vc-data-scope">删除长期记忆会保留聊天原文，原文仍可能用于当前对话；删除聊天不影响其他独立分支。</p>
      </main></dialog>`;
    document.body.append(root);
    const dialog = root.querySelector('dialog'), exportForm = root.querySelector('[data-export]'), deleteForm = root.querySelector('[data-delete]');
    const exportStatus = root.querySelector('[data-export-status]'), deleteStatus = root.querySelector('[data-delete-status]'), download = root.querySelector('[data-download]');
    const passwordForm = root.querySelector('[data-password]'), resetForm = root.querySelector('[data-reset]');
    const authLine = root.querySelector('[data-auth]'), authStatus = root.querySelector('[data-auth-status]');
    const passwordStatus = root.querySelector('[data-password-status]'), sessionStatus = root.querySelector('[data-session-status]');
    const sessionList = root.querySelector('[data-sessions]');
    let version = 0, timer, currentExport, downloadUrl, busy = false, deleted = false, opener = null, accountId = '', sessions = [], deleteDomains = [];
    const clearSecrets = () => root.querySelectorAll('input[type=password]').forEach((input) => { input.value = ''; });
    const setBusy = (value) => { busy = value; root.querySelectorAll('form input, form button, [data-download], [data-revoke-others], [data-logout]').forEach((control) => { control.disabled = value || deleted; }); };
    const errorText = (error) => error?.kind === 'unauthenticated' ? '请重新登录后重试。' : error?.kind === 'context-changed' ? '登录状态已变化，请重新加载页面。' : '操作尚未完成，请稍后重试。';
    function restoreOpener() {
        const target = opener;
        if (!target || typeof target.focus !== 'function') return;
        const host = typeof target.closest === 'function' ? target.closest('dialog') : null;
        if (host && host !== dialog && host.open !== true && typeof host.showModal === 'function') {
            try { host.showModal(); } catch { /* 上一个模态还在关闭 */ }
        }
        const place = () => {
            if (host && host !== dialog && host.open !== true) return;
            try { target.focus(); } catch { /* 入口尚未可聚焦 */ }
        };
        place();
        queueMicrotask(place);
        requestAnimationFrame(place);
    }
    function close() {
        version++; clearTimeout(timer); clearSecrets(); currentExport = null; downloadUrl = null; download.hidden = true;
        if (deleted) { location.assign('/auth/'); return; }
        dialog.close();
        restoreOpener();
    }
    function revealDeletion() {
        const details = typeof deleteStatus.closest === 'function' ? deleteStatus.closest('details') : null;
        if (details) details.open = true;
    }
    root.querySelector('[data-close]').addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
    function showExport(result, epoch) {
        if (!dialog.open || epoch !== version) return;
        if (result.downloadUrl) downloadUrl = result.downloadUrl;
        currentExport = result.exportId;
        download.hidden = result.status !== 'READY' || !downloadUrl;
        if (result.status === 'PARTIAL') {
            exportStatus.textContent = EXPORT_PARTIAL_COPY;
        } else if (result.status === 'READY') {
            const expires = result.expiresAt ? new Intl.DateTimeFormat('zh-CN', { dateStyle:'short', timeStyle:'short' }).format(new Date(result.expiresAt)) : '';
            exportStatus.textContent = `副本已生成，下载链接仅可使用一次。${expires ? `有效至 ${expires}。` : ''}`;
        } else if (result.status === 'PENDING') {
            exportStatus.textContent = result.errorMessage === 'ST_UNAVAILABLE' ? '聊天存储暂不可用，恢复后会继续生成。你可以稍后取回最近副本。' : '副本生成中。关闭页面后任务会继续，你可以稍后取回最近副本。';
            clearTimeout(timer);
            timer = setTimeout(async () => {
                try { const next = await getDataExport(result.exportId); if (currentExport === result.exportId) showExport(next, epoch); }
                catch (error) { if (epoch === version && dialog.open) exportStatus.textContent = errorText(error); }
            }, 2000);
        } else { exportStatus.textContent = result.errorMessage === 'ST_EXPORT_TOO_LARGE' ? '当前私有内容超过导出上限，未生成副本。请减少文件数量或大小后重试。' : '副本未完成或已失效，请重新生成。'; }
    }
    function paintSessions() {
        sessionList.textContent = '';
        for (const item of Array.isArray(sessions) ? sessions : []) {
            const row = document.createElement('p');
            row.textContent = sessionLabel(item);
            sessionList.append(row);
        }
        const others = otherSessions(sessions);
        const revoke = root.querySelector('[data-revoke-others]');
        if (revoke) revoke.disabled = busy || deleted || others.length === 0;
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
                else { deleted = true; root.querySelector('[data-close]').textContent = '返回登录'; deleteStatus.textContent = '在线数据已删除。离线备份按保留策略另行清理。'; }
            } catch {
                if (dialog.open && epoch === version) watchDeletion(epoch);
            }
        }, 2000);
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
            paintSessions();
        } catch {
            if (epoch === version && dialog.open) sessionStatus.textContent = '账户信息暂不可用';
        }
    }
    async function exportAction(recover) {
        if (busy || !exportForm.reportValidity()) return;
        const epoch = version, password = exportForm.elements.password.value;
        setBusy(true); exportStatus.textContent = recover ? '正在取回…' : '正在提交…';
        try { showExport(await (recover ? recoverDataExport(password) : createDataExport(password)), epoch); }
        catch (error) { if (epoch === version && dialog.open) exportStatus.textContent = errorText(error); }
        finally { clearSecrets(); setBusy(false); }
    }
    exportForm.addEventListener('submit', (event) => { event.preventDefault(); void exportAction(false); });
    root.querySelector('[data-recover]').addEventListener('click', () => { void exportAction(true); });
    download.addEventListener('click', async () => {
        if (busy || !downloadUrl) return;
        const epoch = version; setBusy(true);
        try {
            const blob = await downloadDataExport(downloadUrl);
            if (epoch !== version || !dialog.open) return;
            const url = URL.createObjectURL(blob), link = document.createElement('a');
            link.href = url; link.download = 'virtual-companion-data.json'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            downloadUrl = null; download.hidden = true; exportStatus.textContent = '副本已下载；请妥善保存。';
        } catch (error) { if (epoch === version && dialog.open) exportStatus.textContent = errorText(error); }
        finally { setBusy(false); }
    });
    passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy || !passwordForm.reportValidity()) return;
        const epoch = version;
        const currentPassword = passwordForm.elements.currentPassword.value;
        const newPassword = passwordForm.elements.newPassword.value;
        clearSecrets();
        setBusy(true);
        try {
            await changePassword(currentPassword, newPassword);
            if (epoch === version && dialog.open) passwordStatus.textContent = PASSWORD_CHANGED_COPY;
        } catch (error) {
            if (epoch === version && dialog.open) passwordStatus.textContent = errorText(error);
        } finally { clearSecrets(); setBusy(false); }
    });
    resetForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy || !resetForm.reportValidity() || !accountId) return;
        const epoch = version;
        const password = resetForm.elements.password.value;
        clearSecrets();
        setBusy(true);
        try {
            await reauth(password);
            await resetAuthenticator(accountId);
            if (epoch === version && dialog.open) {
                authLine.textContent = '验证器未启用';
                authStatus.textContent = AUTH_RESET_COPY;
            }
        } catch (error) {
            if (epoch === version && dialog.open) authStatus.textContent = errorText(error);
        } finally { clearSecrets(); setBusy(false); }
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
    deleteForm.addEventListener('submit', async (event) => {
        event.preventDefault(); if (busy || !deleteForm.reportValidity()) return;
        const epoch = version, password = deleteForm.elements.password.value;
        clearTimeout(timer); setBusy(true); deleteStatus.textContent = '正在提交删除…';
        try {
            const result = await deleteOwnAccount(password);
            if (epoch !== version || !dialog.open) return;
            if (result.ok === true && result.status !== 'PENDING') {
                deleted = true; root.querySelector('[data-close]').textContent = '返回登录'; download.hidden = true;
                deleteStatus.textContent = '在线数据已删除。离线备份按保留策略另行清理。';
            } else {
                deleteDomains = Array.isArray(result.pendingDomains) ? result.pendingDomains : [];
                deleteForm.hidden = true;
                watchDeletion(epoch);
            }
            clearSecrets();
        } catch (error) {
            if (epoch === version && dialog.open) {
                if (Array.isArray(error.pendingDomains) && error.pendingDomains.length) {
                    deleteDomains = error.pendingDomains;
                    deleteForm.hidden = true;
                    watchDeletion(epoch);
                } else deleteStatus.textContent = errorText(error);
            }
        }
        finally { clearSecrets(); setBusy(false); }
    });
    return {
        open(returnFocus = document.activeElement) {
            opener = returnFocus || opener;
            version++; exportStatus.textContent = ''; deleteStatus.textContent = ''; passwordStatus.textContent = ''; authStatus.textContent = ''; sessionStatus.textContent = '';
            deleteForm.hidden = false; deleteForm.reset(); clearSecrets();
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
}
