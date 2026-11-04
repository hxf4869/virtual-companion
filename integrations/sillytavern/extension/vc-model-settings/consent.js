// 五项必要同意。授予不要求密码；撤回要先重新验证，并在请求里带上当前密码。
import {
    captureSessionContext, listConsents, logoutCurrent, reauth, recordConsent,
} from './api.js';
import { iconSpriteUrl } from './ui/icons.js';
import { mountConsentGateView } from './desktop/build/index.js';
import {
    CONSENT_VERSION,
    CONSENT_ERROR_COPY,
    REQUIRED_CONSENTS,
    effectiveConsents,
    consentOutstanding,
    formatConsentWhen,
    consentStatusText,
    submitConsentGrants,
    revokeConsent,
} from './consent-logic.js';

export {
    CONSENT_VERSION,
    CONSENT_ERROR_COPY,
    REQUIRED_CONSENTS,
    effectiveConsents,
    consentOutstanding,
    formatConsentWhen,
    consentStatusText,
    submitConsentGrants,
    revokeConsent,
};

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
