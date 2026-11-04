// 隐私同意、数据权利与敏感操作纯函数（无 DOM 依赖）。
export const CONSENT_VERSION = '2026-10-30';
export const CONSENT_ERROR_COPY = '没有完成，请重试。';

export const REQUIRED_CONSENTS = [
    {
        type: 'SERVICE_TERMS',
        label: '服务条款',
        icon: 'file-text',
        body: '使用聊天、记忆和账号功能前需要同意服务条款。当前没有另行发布的条款文档。',
    },
    {
        type: 'PRIVACY_POLICY',
        label: '隐私政策',
        icon: 'shield',
        body: '账号、聊天和记忆保存在这台服务上。当前没有另行发布的隐私政策文档。',
    },
    {
        type: 'AI_CONTENT_NOTICE',
        label: 'AI 生成内容说明',
        icon: 'sparkles',
        body: '助手的回复由模型生成，不是真人发出的消息。',
    },
    {
        type: 'THIRD_PARTY_MODEL_PROCESSING',
        label: '第三方模型处理',
        icon: 'cpu',
        body: '聊天正文、账号信息和记忆片段会交给已配置的模型处理。撤回后，还没发出的对外处理会停下来。',
    },
    {
        type: 'SENSITIVE_DATA_PROCESSING',
        label: '敏感个人信息处理',
        icon: 'lock',
        body: '对话里可能有敏感个人信息，处理它们需要单独同意。没有这项同意时，对外模型处理和记忆提取会被拒绝。',
    },
];

function stamp(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

export function effectiveConsents(records) {
    const map = new Map();
    if (!Array.isArray(records)) return map;
    for (const row of records) {
        if (!row || typeof row.consentType !== 'string') continue;
        const prev = map.get(row.consentType);
        if (!prev || stamp(row.grantedAt) >= stamp(prev.grantedAt)) map.set(row.consentType, row);
    }
    return map;
}

export function consentOutstanding(records) {
    if (!Array.isArray(records)) return REQUIRED_CONSENTS.map((item) => item.type);
    const map = effectiveConsents(records);
    return REQUIRED_CONSENTS.filter((item) => map.get(item.type)?.granted !== true).map((item) => item.type);
}

export function formatConsentWhen(value) {
    if (typeof value !== 'string' || value.length === 0) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function consentStatusText(row) {
    if (row?.granted === true) {
        const when = formatConsentWhen(row.grantedAt);
        return when ? `已同意 ${when}` : '已同意';
    }
    const when = formatConsentWhen(row?.revokedAt);
    return when ? `未同意 ${when}` : '未同意';
}

export async function submitConsentGrants({ record = async (_body) => ({}), version = CONSENT_VERSION } = {}) {
    try {
        for (const item of REQUIRED_CONSENTS) {
            await record({ consentType: item.type, version, granted: true });
        }
        return { ok: true };
    } catch (error) {
        if (error?.kind === 'forbidden') return { ok: false, reauth: true, error };
        return { ok: false, error, errorCopy: CONSENT_ERROR_COPY };
    }
}

export async function revokeConsent({
    type = '',
    password = '',
    reauth: verify = async (_pw) => ({}),
    record = async (_body) => ({}),
    version = CONSENT_VERSION,
} = {}) {
    await verify(password);
    return record({
        consentType: type,
        version,
        granted: false,
        currentPassword: password,
    });
}

export const EXPORT_POLL_INTERVAL_MS = 2000;

export function formatVoiceStorage(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) return '暂不可用';
    if (size < 1024) return `${Math.round(size)} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function trustedDeviceGroupVisible(devices) {
    return Array.isArray(devices) && devices.length > 0;
}

export function formatTrustedWhen(value) {
    if (typeof value !== 'string' || value.length === 0) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function formatTrustedDeviceLine(device) {
    const name = typeof device?.displayName === 'string' ? device.displayName.trim() : '';
    return {
        name: name || '当前设备',
        lastUsed: formatTrustedWhen(device?.lastUsedAt),
        expires: formatTrustedWhen(device?.expiresAt),
    };
}

/** 敏感操作一律先 reauth。当前密码只传给 reauth，以及仍要求 currentPassword 的原接口。 */
export async function executeSensitiveAction({ action, password, newPassword, accountId, consentType, deps }) {
    await deps.reauth(password);
    if (action === 'password') return deps.changePassword(password, newPassword);
    if (action === 'reset') return deps.resetAuthenticator(accountId);
    if (action === 'export') return deps.createDataExport(password);
    if (action === 'recover') return deps.recoverDataExport(password);
    if (action === 'delete') return deps.deleteOwnAccount(password);
    if (action === 'consent-revoke') {
        return deps.recordConsent({
            consentType,
            version: CONSENT_VERSION,
            granted: false,
            currentPassword: password,
        });
    }
    throw new Error('未知账户操作');
}
