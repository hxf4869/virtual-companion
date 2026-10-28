// 唯一可见登录入口；复用 Go 密码/TOTP/恢复码/改密契约，秘密只留在当前页面内存。
const $ = (id) => document.getElementById(id);
let challenge = null;
let identity = null;
let useRecovery = false;
let recoveryCodes = [];
let busy = false;
let flow = 0;
function message(text = '') { $('auth-error').textContent = text; $('auth-error').hidden = !text; }
function show(step, title) {
    for (const id of ['login-form', 'verify-step', 'password-step', 'recovery-step']) $(id).hidden = id !== step;
    $('auth-title').textContent = title;
    message();
}
function clearSecrets() {
    $('password').value = ''; $('code').value = '';
    $('setup-secret').textContent = ''; $('setup-secret').hidden = true; $('setup-info').hidden = true;
    $('recovery-codes').textContent = ''; recoveryCodes = [];
    for (const id of ['current-password', 'new-password', 'confirm-password']) $(id).value = '';
}
async function request(method, suffix, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (identity) {
        headers['X-VC-Expected-Account-ID'] = identity.accountId;
        headers['X-VC-Expected-Session-ID'] = identity.sessionId;
        const csrf = document.cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith('vc_csrf='));
        if (csrf) headers['X-CSRF-Token'] = csrf.slice('vc_csrf='.length);
    }
    const response = await fetch(`/auth/api/${suffix}`, { method, headers, credentials: 'same-origin',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let data;
    try { data = await response.json(); } catch { throw new Error('登录服务暂不可用'); }
    if (!response.ok) {
        const text = response.status === 429 ? '尝试过于频繁，请稍后重试' : response.status >= 500 ? '登录服务暂不可用，请稍后重试'
            : data.code === 'ACCOUNT_CONTEXT_CHANGED' ? '登录状态已变化，请返回登录' : '账号、密码或验证码不正确，请重新检查';
        throw new Error(text);
    }
    return data;
}
async function run(action) {
    if (busy) return;
    busy = true; message();
    document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try { await action(); } catch (error) { message(error.message || '操作未完成，请重试'); }
    finally { busy = false; document.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
}
async function enter() {
    if (identity.deletionPending) { show('login-form', '账号删除处理中'); clearSecrets(); message('聊天已暂停，尚未完成的数据清理会在服务恢复后继续。'); return; }
    if (identity.passwordMustChange) { show('password-step', '修改密码'); $('current-password').focus(); return; }
    if (!identity.authenticatorEnabled) { show('login-form', '登录'); message('请重新登录并完成验证器设置'); return; }
    const response = await fetch('/auth/access', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status >= 500 ? '聊天服务暂不可用，请稍后重试' : '此账号尚未绑定可用的聊天空间');
    clearSecrets(); location.replace('/');
}
async function advance(data) {
    if (data.nextStep === 'ACTIVE') {
        identity = data; challenge = null;
        $('password').value = ''; $('code').value = ''; $('setup-secret').textContent = '';
        if (Array.isArray(data.recoveryCodes) && data.recoveryCodes.length) {
            recoveryCodes = data.recoveryCodes;
            show('recovery-step', '保存恢复码'); $('recovery-codes').textContent = recoveryCodes.join('\n'); return;
        }
        await enter(); return;
    }
    if (!['TOTP_REQUIRED', 'AUTHENTICATOR_SETUP_REQUIRED'].includes(data.nextStep)) throw new Error('此账号暂不可登录');
    challenge = data; useRecovery = false;
    show('verify-step', data.nextStep === 'AUTHENTICATOR_SETUP_REQUIRED' ? '设置验证器' : '身份验证');
    $('password').value = ''; $('code').value = ''; $('code-label').textContent = '验证码';
    $('code').inputMode = 'numeric'; $('use-recovery').hidden = data.nextStep === 'AUTHENTICATOR_SETUP_REQUIRED';
    $('use-recovery').textContent = '使用恢复码';
    if (data.nextStep === 'AUTHENTICATOR_SETUP_REQUIRED') {
        const setup = await request('POST', `challenges/${data.challengeId}/authenticator-setup`, {});
        $('setup-secret').textContent = setup.manualKey; $('setup-secret').hidden = false; $('setup-info').hidden = false;
    }
    $('code').focus();
}
$('login-form').addEventListener('submit', (event) => {
    event.preventDefault(); run(async () => { flow++; identity = null; await advance(await request('POST', 'login', { account: $('account').value.trim(), password: $('password').value })); });
});
$('verify-form').addEventListener('submit', (event) => {
    event.preventDefault(); run(async () => {
        if (!challenge) throw new Error('验证已失效，请返回登录');
        const action = challenge.nextStep === 'AUTHENTICATOR_SETUP_REQUIRED' ? 'authenticator-confirm' : useRecovery ? 'recovery-code' : 'totp';
        await advance(await request('POST', `challenges/${challenge.challengeId}/${action}`, { code: $('code').value.trim(), trustDevice: false }));
    });
});
$('use-recovery').addEventListener('click', () => {
    useRecovery = !useRecovery; $('code').value = ''; $('code').inputMode = useRecovery ? 'text' : 'numeric';
    $('code-label').textContent = useRecovery ? '恢复码' : '验证码';
    $('use-recovery').textContent = useRecovery ? '使用验证码' : '使用恢复码'; $('code').focus();
});
$('back-login').addEventListener('click', () => { flow++; challenge = null; clearSecrets(); show('login-form', '登录'); });
$('finish-login').addEventListener('click', () => run(async () => { $('recovery-codes').textContent = ''; recoveryCodes = []; await enter(); }));
$('password-form').addEventListener('submit', (event) => {
    event.preventDefault(); run(async () => {
        if ($('new-password').value !== $('confirm-password').value) throw new Error('两次输入的新密码不一致');
        await request('POST', 'password', { currentPassword: $('current-password').value, newPassword: $('new-password').value });
        identity = null; clearSecrets(); show('login-form', '登录'); message('密码已修改，请重新登录');
    });
});
window.addEventListener('pagehide', clearSecrets);
// 已登录时只恢复本人当前会话；未登录是正常初始状态，不展示错误。
fetch('/auth/api/session', { credentials: 'same-origin' }).then(async (response) => {
    if (response.ok && !busy && flow === 0) await run(async () => { const data = await response.json(); if (flow === 0) await advance(data); });
}).catch(() => message('登录服务暂不可用，请稍后重试'));
