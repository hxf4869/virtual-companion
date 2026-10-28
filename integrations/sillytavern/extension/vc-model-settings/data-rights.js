// Native data-rights controls; credentials and one-time links stay in this page.
import { createDataExport, recoverDataExport, getDataExport, downloadDataExport, deleteOwnAccount } from './api.js';
export function mountDataRights() {
    const root = document.createElement('div'); root.className = 'vcms-root vc-data-root';
    root.innerHTML = `<dialog class="vc-data-dialog" aria-labelledby="vc-data-title">
      <header class="vcms-header"><h1 id="vc-data-title" class="vcms-title" tabindex="-1">数据副本与删除</h1><button class="vcms-btn vcms-btn-ghost" type="button" data-close>返回聊天</button></header>
      <main class="vc-data-body">
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
        <p class="vc-data-scope">删除长期记忆会保留聊天原文，原文仍可能用于当前对话；删除聊天不影响其他独立分支。</p>
      </main></dialog>`;
    document.body.append(root);
    const dialog = root.querySelector('dialog'), exportForm = root.querySelector('[data-export]'), deleteForm = root.querySelector('[data-delete]');
    const exportStatus = root.querySelector('[data-export-status]'), deleteStatus = root.querySelector('[data-delete-status]'), download = root.querySelector('[data-download]');
    let version = 0, timer, currentExport, downloadUrl, busy = false, deleted = false;
    const clearSecrets = () => root.querySelectorAll('input[type=password]').forEach((input) => { input.value = ''; });
    const setBusy = (value) => { busy = value; root.querySelectorAll('form input, form button, [data-download]').forEach((control) => { control.disabled = value || deleted; }); };
    const errorText = (error) => error?.kind === 'unauthenticated' ? '请重新登录后重试。' : error?.kind === 'context-changed' ? '登录状态已变化，请重新加载页面。' : '操作尚未完成，请稍后重试。';
    function close() { version++; clearTimeout(timer); clearSecrets(); currentExport = null; downloadUrl = null; download.hidden = true; if (deleted) { location.assign('/auth/'); return; } dialog.close(); }
    root.querySelector('[data-close]').addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
    function showExport(result, epoch) {
        if (!dialog.open || epoch !== version) return;
        if (result.downloadUrl) downloadUrl = result.downloadUrl;
        currentExport = result.exportId;
        download.hidden = result.status !== 'READY' || !downloadUrl;
        if (result.status === 'READY') {
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
    deleteForm.addEventListener('submit', async (event) => {
        event.preventDefault(); if (busy || !deleteForm.reportValidity()) return;
        const epoch = version, password = deleteForm.elements.password.value;
        clearTimeout(timer); setBusy(true); deleteStatus.textContent = '正在提交删除…';
        try {
            const result = await deleteOwnAccount(password);
            if (epoch !== version || !dialog.open) return;
            if (result.ok === true) { deleted = true; root.querySelector('[data-close]').textContent = '返回登录'; download.hidden = true; deleteStatus.textContent = '在线数据已删除。离线备份按保留策略另行清理。'; }
            else { deleteStatus.textContent = '账号删除处理中，聊天已暂停。尚未确认清理的数据会在服务恢复后继续处理。'; }
            clearSecrets(); deleteForm.hidden = true;
        } catch (error) { if (epoch === version && dialog.open) deleteStatus.textContent = errorText(error); }
        finally { clearSecrets(); setBusy(false); }
    });
    return { open() { version++; exportStatus.textContent = ''; deleteStatus.textContent = ''; deleteForm.hidden = false; deleteForm.reset(); if (!dialog.open) dialog.showModal(); root.querySelector('h1').focus(); }, close };
}
