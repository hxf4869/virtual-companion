// 五项必要同意。授予不要求密码；撤回要先重新验证，并在请求里带上当前密码。
import {
    captureSessionContext, listConsents, logoutCurrent, reauth, recordConsent,
} from './api.js';
import { iconSpriteUrl } from './ui/icons.js';
import { mountConsentGateView } from './desktop/build/index.js';

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

export async function submitConsentGrants({ record, version = CONSENT_VERSION } = {}) {
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

export async function revokeConsent({ type, password, reauth: verify, record, version = CONSENT_VERSION } = {}) {
    await verify(password);
    return record({
        consentType: type,
        version,
        granted: false,
        currentPassword: password,
    });
}

export function ensureConsentStyles(doc = globalThis.document) {
    if (!doc?.querySelector || doc.querySelector('[data-vc-consent]')) return;
    const style = doc.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./consent.css', import.meta.url).href;
    style.setAttribute('data-vc-consent', '');
    (doc.head || doc.documentElement).append(style);
}

function onboardingOpen(doc) {
    try { return Boolean(doc.querySelector('dialog[open] .onboarding')); } catch { return false; }
}

function nativeQuery(doc) {
    try {
        return /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(doc.querySelector));
    } catch {
        return false;
    }
}

async function waitOutOnboarding(doc) {
    if (!nativeQuery(doc)) return;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        let ready = false;
        try {
            const mod = await import('/script.js');
            ready = Boolean(mod.settingsReady);
        } catch {
            return;
        }
        if (ready && !onboardingOpen(doc)) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

export async function mountConsentGate(options = {}) {
    const doc = options.document || globalThis.document;
    if (!doc?.body || !doc.createElement) return null;
    const existing = doc.querySelector('#vc-consent');
    if (existing) return existing;
    if (options.ready) await options.ready;
    else await waitOutOnboarding(doc);
    const list = options.listConsents || listConsents;
    let records = null;
    try {
        records = await list();
    } catch {
        records = null;
    }
    if (Array.isArray(records) && consentOutstanding(records).length === 0) return null;

    ensureConsentStyles(doc);
    const record = options.recordConsent || recordConsent;
    const verify = options.reauth || reauth;
    const capture = options.captureSession || captureSessionContext;
    const leave = options.logout || logoutCurrent;
    const assign = options.assign || (url => globalThis.location?.assign?.(url));
    let dialog, busy = false, closed = false, error = records == null ? CONSENT_ERROR_COPY : '', reauthOpen = false, reauthError = '', reset = 0;
    const props = () => ({ host: doc.body, sprite: iconSpriteUrl(), items: REQUIRED_CONSENTS, open: !closed, busy, error, reauthOpen, reauthError, reset,
        onAccept: () => void accept(), onLogout: () => { void (async () => { try { await leave(); } catch { /* 退出失败也离开 */ } assign('/auth/'); })(); },
        onVerify: form => void checkPassword(form), onCancelReauth() { if(busy)return;reset++;reauthError='';reauthOpen=false;render(); },
    });
    const view = mountConsentGateView(props());
    dialog = await view.ready;
    function render() { if (!closed) view.update(props()); }
    function finish() { closed = true; reset++; view.update(props()); view.unmount(); }
    async function accept() {
        if (busy || closed) return;
        busy = true; error = ''; render();
        try {
            await capture();
            if (closed || !dialog.isConnected) return;
            const result = await submitConsentGrants({ record });
            if (closed || !dialog.isConnected) return;
            if (result.reauth) { reauthError='';reset++;reauthOpen=true;render();dialog.querySelector('[data-consent-reauth-password]')?.focus();return; }
            if (!result.ok) { error=CONSENT_ERROR_COPY;return; }
            finish();
        } catch { if (dialog.isConnected) error=CONSENT_ERROR_COPY; }
        finally { busy=false;render(); }
    }
    async function checkPassword(form) {
        if (busy || closed) return;
        const input = form.querySelector('[data-consent-reauth-password]');
        const password = input.value; input.value = ''; reset++;
        if (!password) { reauthError=CONSENT_ERROR_COPY;render();return; }
        busy=true;render();
        try {
            await verify(password);
            if (closed || !dialog.isConnected) return;
            reauthOpen=false;busy=false;render();await accept();
        } catch { busy=false;if(dialog.isConnected){reauthError=CONSENT_ERROR_COPY;render();} }
    }
    return dialog;
}
