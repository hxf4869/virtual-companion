// 唯一可见登录入口。秘密只留在当前页面内存，pagehide 时清空。
const $ = (id) => document.getElementById(id);
const PLATFORMS = [
    [/iPhone/i, 'iPhone'], [/iPad/i, 'iPad'], [/Android/i, 'Android'], [/CrOS/i, 'Chromebook'],
    [/Macintosh|Mac OS X/i, 'Mac'], [/Windows/i, 'Windows'], [/Linux/i, 'Linux'],
];

export function deviceNameFromUA(userAgent) {
    const ua = String(userAgent || '');
    const platform = PLATFORMS.find(([pattern]) => pattern.test(ua))?.[1] || '';
    let browser = '';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
    else if (/CriOS\//i.test(ua)) browser = 'Chrome';
    else if (/FxiOS\/|Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Safari\//i.test(ua)) browser = 'Safari';
    const name = platform && browser ? `${platform} · ${browser}` : (platform || browser || '当前设备');
    return Array.from(name).slice(0, 120).join('');
}

export function trustFields(checked, userAgent) {
    if (checked !== true) return { trustDevice: false };
    return { trustDevice: true, deviceName: deviceNameFromUA(userAgent) };
}

export function normalizeTotpCode(value) {
    return String(value ?? '').replace(/\D/g, '').slice(0, 6);
}

export function shouldAutoSubmitTotp(value, recovery) {
    return recovery !== true && normalizeTotpCode(value).length === 6;
}

export function rawManualKey(secret) {
    return String(secret ?? '').replace(/\s+/g, '').toUpperCase();
}

export function groupManualKey(secret) {
    return (rawManualKey(secret).match(/.{1,4}/g) || []).join(' ');
}

export function recoveryFinishEnabled(saved) {
    return saved === true;
}

let challenge = null;
let identity = null;
let useRecovery = false;
let recoveryCodes = [];
let recoverySaved = false;
let manualKey = '';
let busy = false;
let flow = 0;
let copyTimer = 0;

function message(text = '') {
    for (const el of document.querySelectorAll('.field-error')) {
        el.textContent = text;
        el.hidden = !text;
    }
}

function syncFinish() {
    const button = $('finish-login');
    if (button) button.disabled = busy || !recoveryFinishEnabled(recoverySaved);
}

function show(step, title) {
    for (const id of ['login-form', 'verify-step', 'password-step', 'recovery-step']) $(id).hidden = id !== step;
    $('auth-title').textContent = title;
    message();
}

function clearSetup() {
    manualKey = '';
    const secret = $('setup-secret');
    const qr = $('setup-qr');
    const link = $('add-authenticator');
    if (secret) secret.textContent = '';
    if (qr) qr.removeAttribute('src');
    if (link) link.removeAttribute('href');
    $('setup-qr-frame')?.classList.remove('is-open');
    const toggle = $('show-qr');
    if (toggle) {
        toggle.textContent = '二维码';
        toggle.setAttribute('aria-expanded', 'false');
    }
    const block = $('setup-block');
    if (block) block.hidden = true;
    $('verify-step')?.classList.remove('is-setup');
}

function clearSecrets() {
    if ($('password')) $('password').value = '';
    if ($('code')) $('code').value = '';
    for (const id of ['current-password', 'new-password', 'confirm-password']) {
        const input = $(id);
        if (input) input.value = '';
    }
    clearSetup();
    recoveryCodes = [];
    recoverySaved = false;
    $('recovery-codes')?.replaceChildren();
    clearTimeout(copyTimer);
    for (const [id, label] of [['copy-secret', '复制'], ['copy-recovery', '复制全部']]) {
        const button = $(id);
        if (button && button.textContent === '已复制') button.textContent = label;
    }
    syncFinish();
}

function presentSetup(setup) {
    manualKey = rawManualKey(setup?.manualKey || '');
    $('setup-secret').textContent = groupManualKey(manualKey);
    const qr = typeof setup?.qrCodeDataUrl === 'string' ? setup.qrCodeDataUrl : '';
    if (qr.startsWith('data:image/')) $('setup-qr').src = qr;
    else $('setup-qr').removeAttribute('src');
    const uri = typeof setup?.provisioningUri === 'string' ? setup.provisioningUri : '';
    if (uri.startsWith('otpauth:')) $('add-authenticator').href = uri;
    else $('add-authenticator').removeAttribute('href');
    $('setup-block').hidden = false;
    $('verify-step').classList.add('is-setup');
}

function showRecovery(codes) {
    recoveryCodes = codes.slice();
    recoverySaved = false;
    const list = $('recovery-codes');
    list.replaceChildren();
    for (const code of recoveryCodes) {
        const item = document.createElement('li');
        item.textContent = code;
        list.append(item);
    }
    show('recovery-step', '保存恢复码');
    syncFinish();
}

async function request(method, suffix, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (identity) {
        headers['X-VC-Expected-Account-ID'] = identity.accountId;
        headers['X-VC-Expected-Session-ID'] = identity.sessionId;
        const csrf = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('vc_csrf='));
        if (csrf) headers['X-CSRF-Token'] = csrf.slice('vc_csrf='.length);
    }
    const response = await fetch(`/auth/api/${suffix}`, {
        method, headers, credentials: 'same-origin',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('登录服务暂不可用'); }
    if (!response.ok) {
        const text = response.status === 429 ? '尝试过于频繁，请稍后重试' : response.status >= 500 ? '登录服务暂不可用，请稍后重试'
            : data.code === 'ACCOUNT_CONTEXT_CHANGED' ? '登录状态已变化，请返回登录' : '账号、密码或验证码不正确，请重新检查';
        throw new Error(text);
    }
    return data;
}

function visiblePrimary() {
    const step = document.querySelector('.step:not([hidden])');
    if (!step) return null;
    return [...step.querySelectorAll('.primary')].find((el) => !el.hidden && getComputedStyle(el).display !== 'none') || null;
}

async function run(action, { focusCode = false } = {}) {
    if (busy) return;
    busy = true;
    message();
    $('code')?.removeAttribute('aria-invalid');
    const panel = document.querySelector('.auth-panel');
    panel?.classList.add('is-busy');
    visiblePrimary()?.setAttribute('aria-busy', 'true');
    document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    let failed = false;
    try {
        await action();
    } catch (error) {
        failed = true;
        message(error.message || '操作未完成，请重试');
        if (focusCode && $('code')) {
            $('code').value = '';
            $('code').setAttribute('aria-invalid', 'true');
        }
    } finally {
        busy = false;
        panel?.classList.remove('is-busy');
        document.querySelectorAll('.primary').forEach((el) => el.removeAttribute('aria-busy'));
        document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
        syncFinish();
        if (failed && focusCode && $('verify-step') && !$('verify-step').hidden) $('code').focus();
    }
}

async function enter() {
    if (identity.deletionPending) {
        show('login-form', '账号删除处理中');
        clearSecrets();
        message('聊天已暂停，尚未完成的数据清理会在服务恢复后继续。');
        return;
    }
    if (identity.passwordMustChange) {
        show('password-step', '修改密码');
        $('current-password').focus();
        return;
    }
    if (!identity.authenticatorEnabled) {
        show('login-form', '登录');
        message('请重新登录并完成验证器设置');
        return;
    }
    const response = await fetch('/auth/access', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status >= 500 ? '聊天服务暂不可用，请稍后重试' : '此账号尚未绑定可用的聊天空间');
    clearSecrets();
    location.replace('/');
}

async function advance(data) {
    if (data.nextStep === 'ACTIVE') {
        identity = data;
        challenge = null;
        $('password').value = '';
        $('code').value = '';
        clearSetup();
        if (Array.isArray(data.recoveryCodes) && data.recoveryCodes.length) {
            showRecovery(data.recoveryCodes);
            return;
        }
        await enter();
        return;
    }
    if (!['TOTP_REQUIRED', 'AUTHENTICATOR_SETUP_REQUIRED'].includes(data.nextStep)) throw new Error('此账号暂不可登录');
    challenge = data;
    useRecovery = false;
    const setup = data.nextStep === 'AUTHENTICATOR_SETUP_REQUIRED';
    show('verify-step', setup ? '设置验证器' : '身份验证');
    $('password').value = '';
    $('code').value = '';
    $('code').inputMode = 'numeric';
    $('code').setAttribute('autocomplete', 'one-time-code');
    $('code-label').textContent = '验证码';
    $('trust-device').checked = false;
    $('use-recovery').hidden = setup;
    $('use-recovery').textContent = '使用恢复码';
    $('verify-step').classList.remove('is-recovery');
    if (setup) presentSetup(await request('POST', `challenges/${data.challengeId}/authenticator-setup`, {}));
    else clearSetup();
    $('code').focus();
}

async function writeClipboard(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* 退回一次性文本域，随即移除 */ }
    try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.append(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    } catch {
        return false;
    }
}

function flashCopied(button, label) {
    button.textContent = '已复制';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
        if (button.isConnected && button.textContent === '已复制') button.textContent = label;
    }, 1600);
}

function markRecoverySaved() {
    recoverySaved = true;
    syncFinish();
}

function boot() {
    if (typeof document === 'undefined' || !document.getElementById('login-form')) return;
    $('login-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const account = $('account').value.trim();
        const password = $('password').value;
        run(async () => {
            flow += 1;
            identity = null;
            challenge = null;
            useRecovery = false;
            await advance(await request('POST', 'login', { account, password }));
        });
    });
    $('verify-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const code = useRecovery ? $('code').value.trim() : normalizeTotpCode($('code').value);
        const trust = trustFields($('trust-device').checked, navigator.userAgent);
        run(async () => {
            if (!challenge) throw new Error('验证已失效，请返回登录');
            const action = challenge.nextStep === 'AUTHENTICATOR_SETUP_REQUIRED' ? 'authenticator-confirm' : useRecovery ? 'recovery-code' : 'totp';
            await advance(await request('POST', `challenges/${challenge.challengeId}/${action}`, { code, ...trust }));
        }, { focusCode: true });
    });
    $('code').addEventListener('input', () => {
        const input = $('code');
        input.removeAttribute('aria-invalid');
        if (useRecovery) return;
        const next = normalizeTotpCode(input.value);
        if (input.value !== next) input.value = next;
        if (!busy && shouldAutoSubmitTotp(next, false)) $('verify-form').requestSubmit();
    });
    $('use-recovery').addEventListener('click', () => {
        useRecovery = !useRecovery;
        $('code').value = '';
        $('code').inputMode = useRecovery ? 'text' : 'numeric';
        $('code').setAttribute('autocomplete', useRecovery ? 'off' : 'one-time-code');
        $('code-label').textContent = useRecovery ? '恢复码' : '验证码';
        $('use-recovery').textContent = useRecovery ? '使用验证码' : '使用恢复码';
        $('verify-step').classList.toggle('is-recovery', useRecovery);
        $('code').focus();
    });
    $('back-login').addEventListener('click', () => {
        flow += 1;
        challenge = null;
        useRecovery = false;
        clearSecrets();
        show('login-form', '登录');
    });
    $('show-qr').addEventListener('click', () => {
        const open = $('setup-qr-frame').classList.toggle('is-open');
        $('show-qr').setAttribute('aria-expanded', open ? 'true' : 'false');
        $('show-qr').textContent = open ? '收起' : '二维码';
    });
    $('copy-secret').addEventListener('click', async () => {
        if (!manualKey || !await writeClipboard(manualKey)) return;
        flashCopied($('copy-secret'), '复制');
    });
    $('copy-recovery').addEventListener('click', async () => {
        if (!recoveryCodes.length || !await writeClipboard(`${recoveryCodes.join('\n')}\n`)) return;
        markRecoverySaved();
        flashCopied($('copy-recovery'), '复制全部');
    });
    $('download-recovery').addEventListener('click', () => {
        if (!recoveryCodes.length) return;
        const blob = new Blob([`${recoveryCodes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'recovery-codes.txt';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        markRecoverySaved();
    });
    $('finish-login').addEventListener('click', () => {
        if (!recoveryFinishEnabled(recoverySaved)) return;
        run(async () => {
            recoveryCodes = [];
            $('recovery-codes').replaceChildren();
            await enter();
        });
    });
    $('password-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const currentPassword = $('current-password').value;
        const newPassword = $('new-password').value;
        const confirmPassword = $('confirm-password').value;
        run(async () => {
            if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致');
            await request('POST', 'password', { currentPassword, newPassword });
            identity = null;
            clearSecrets();
            show('login-form', '登录');
            message('密码已修改，请重新登录');
        });
    });
    window.addEventListener('pagehide', clearSecrets);
    fetch('/auth/api/session', { credentials: 'same-origin' }).then(async (response) => {
        if (response.ok && !busy && flow === 0) {
            await run(async () => {
                const data = await response.json();
                if (flow === 0) await advance(data);
            });
        }
    }).catch(() => message('登录服务暂不可用，请稍后重试'));
}

boot();
