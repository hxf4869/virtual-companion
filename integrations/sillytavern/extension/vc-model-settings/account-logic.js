export const BACKUP_COPY = '备份状态独立，策略在 W16';
export const EXPORT_PARTIAL_COPY = '部分完成';
export const PASSWORD_CHANGED_COPY = '密码已修改，请重新登录。';
export const AUTH_RESET_COPY = '验证器已重置。下次登录需要重新绑定。';

export function authenticatorStatusText(session) {
    return session?.authenticatorEnabled === true ? '验证器已启用' : '验证器未启用';
}

export function deletionProgressText(progress = {}) {
    const domains = Array.isArray(progress?.pendingDomains)
        ? progress.pendingDomains.filter((item) => typeof item === 'string' && item.length > 0)
        : [];
    const pending = domains.length ? `尚未完成：${domains.join('、')}。` : '尚未确认清理的数据会在服务恢复后继续处理。';
    return `账号删除未完成，聊天已暂停。${pending}`;
}

export function otherSessions(sessions) {
    if (!Array.isArray(sessions)) return [];
    return sessions.filter((item) => item && item.current !== true && typeof item.id === 'string' && /^[1-9][0-9]*$/.test(item.id));
}

export function sessionLabel(session) {
    return session?.current === true ? '当前会话' : '其他会话';
}
