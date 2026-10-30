// 五项必要同意。授予不要求密码；撤回要先重新验证，并在请求里带上当前密码。
import {
    captureSessionContext, listConsents, logoutCurrent, reauth, recordConsent,
} from './api.js';
import { icon } from './ui/icons.js';

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

function esc(value) {
    return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

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

export function renderConsentSheet() {
    const items = REQUIRED_CONSENTS.map((item) => `<div class="vc-consent-item">
      <button type="button" class="vc-cell" data-consent-toggle="${item.type}" aria-expanded="false">
        ${icon(item.icon, { size: 22 })}
        <span class="vc-grow">${esc(item.label)}</span>
        <span class="vc-consent-chevron">${icon('chevron-right', { size: 18 })}</span>
      </button>
      <p class="vc-consent-copy" hidden>${esc(item.body)}</p>
    </div>`).join('');
    return `<div class="vc-consent-scroll">
      <h1 id="vc-consent-title" class="vc-large-title" tabindex="-1">开始之前</h1>
      <div class="vc-group">${items}</div>
      <p class="vc-consent-error" data-consent-error role="alert" hidden></p>
    </div>
    <div class="vc-consent-bar">
      <button type="button" class="vc-btn vc-btn-fill" data-consent-accept>同意并继续</button>
      <button type="button" class="vc-btn vc-btn-text" data-consent-logout>退出登录</button>
    </div>
    <form data-consent-reauth hidden>
      <h2>重新验证身份</h2>
      <label>当前密码<input type="password" autocomplete="current-password" data-consent-reauth-password></label>
      <p class="vc-consent-error" data-consent-reauth-status role="alert" hidden></p>
      <button type="submit" class="vc-btn vc-btn-fill">验证并继续</button>
      <button type="button" class="vc-btn vc-btn-text" data-consent-reauth-cancel>取消</button>
    </form>`;
}

export function renderConsentAccount(records) {
    const map = effectiveConsents(records);
    const rows = REQUIRED_CONSENTS.map((item) => {
        const row = map.get(item.type);
        return `<div class="vc-consent-account-row" data-consent-type="${item.type}">
          ${icon(item.icon, { size: 22 })}
          <span class="vc-grow"><span class="vc-consent-name">${esc(item.label)}</span><span class="vc-consent-meta">${esc(consentStatusText(row))}</span></span>
          <button type="button" class="vc-btn vc-btn-text is-danger" data-consent-revoke="${item.type}">撤回</button>
        </div>`;
    }).join('');
    return `<div class="vc-consent-account">${rows}</div>`;
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

function showError(errorEl) {
    errorEl.textContent = CONSENT_ERROR_COPY;
    errorEl.removeAttribute('hidden');
}

export async function mountConsentGate(options = {}) {
    const doc = options.document || globalThis.document;
    if (!doc?.body || !doc.createElement) return null;
    const existing = doc.querySelector('#vc-consent');
    if (existing) return existing;
    await waitOutOnboarding(doc);
    const list = options.listConsents || listConsents;
    let records = null;
    try {
        records = await list();
    } catch {
        records = null;
    }
    if (Array.isArray(records) && consentOutstanding(records).length === 0) return null;

    ensureConsentStyles(doc);
    const dialog = doc.createElement('dialog');
    dialog.id = 'vc-consent';
    dialog.className = 'vc-consent';
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'vc-consent-title');
    dialog.innerHTML = renderConsentSheet();
    doc.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.open = true;
    // showModal 会把焦点交给第一行并画出焦点环；初始焦点放在标题上。
    dialog.querySelector('#vc-consent-title')?.focus?.({ preventScroll: true });

    const record = options.recordConsent || recordConsent;
    const verify = options.reauth || reauth;
    const capture = options.captureSession || captureSessionContext;
    const leave = options.logout || logoutCurrent;
    const assign = options.assign || ((url) => globalThis.location?.assign?.(url));
    const errorEl = dialog.querySelector('[data-consent-error]');
    const acceptBtn = dialog.querySelector('[data-consent-accept]');
    const reauthForm = dialog.querySelector('[data-consent-reauth]');
    const reauthInput = dialog.querySelector('[data-consent-reauth-password]');
    const reauthStatus = dialog.querySelector('[data-consent-reauth-status]');
    let busy = false;

    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
    });
    for (const button of dialog.querySelectorAll('[data-consent-toggle]')) {
        button.addEventListener('click', () => {
            const copy = button.parentNode?.querySelector?.('.vc-consent-copy');
            if (!copy) return;
            const open = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', open ? 'false' : 'true');
            if (open) {
                copy.setAttribute('hidden', '');
                button.parentNode.classList?.remove?.('is-open');
            } else {
                copy.removeAttribute('hidden');
                button.parentNode.classList?.add?.('is-open');
            }
        });
    }

    async function accept() {
        if (busy) return;
        busy = true;
        acceptBtn.disabled = true;
        errorEl.textContent = '';
        errorEl.setAttribute('hidden', '');
        try {
            await capture();
            const result = await submitConsentGrants({ record });
            if (!dialog.isConnected) return;
            if (result.reauth) {
                reauthStatus.textContent = '';
                reauthStatus.setAttribute('hidden', '');
                reauthInput.value = '';
                reauthForm.removeAttribute('hidden');
                reauthInput.focus?.();
                return;
            }
            if (!result.ok) {
                showError(errorEl);
                return;
            }
            dialog.close?.();
            dialog.open = false;
            dialog.remove();
        } catch {
            if (dialog.isConnected) showError(errorEl);
        } finally {
            busy = false;
            if (dialog.isConnected) acceptBtn.disabled = false;
        }
    }

    acceptBtn.addEventListener('click', () => { void accept(); });
    dialog.querySelector('[data-consent-logout]').addEventListener('click', () => {
        void (async () => {
            try { await leave(); } catch { /* 退出请求失败也离开当前页 */ }
            assign('/auth/');
        })();
    });
    reauthForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (busy) return;
        const password = reauthInput.value;
        reauthInput.value = '';
        if (!password) {
            showError(reauthStatus);
            return;
        }
        void (async () => {
            busy = true;
            try {
                await verify(password);
                if (!dialog.isConnected) return;
                reauthForm.setAttribute('hidden', '');
                busy = false;
                await accept();
            } catch {
                busy = false;
                if (dialog.isConnected) showError(reauthStatus);
            }
        })();
    });
    dialog.querySelector('[data-consent-reauth-cancel]')?.addEventListener('click', () => {
        if (busy) return;
        reauthInput.value = '';
        reauthStatus.textContent = '';
        reauthStatus.setAttribute('hidden', '');
        reauthForm.setAttribute('hidden', '');
    });
    if (records == null) showError(errorEl);
    return dialog;
}
