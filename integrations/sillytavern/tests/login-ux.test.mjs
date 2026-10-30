import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const authHtmlUrl = new URL('../server-plugin/virtual-companion/auth/index.html', import.meta.url);
const authCssUrl = new URL('../server-plugin/virtual-companion/auth/style.css', import.meta.url);
const authJsUrl = new URL('../server-plugin/virtual-companion/auth/index.js', import.meta.url);
const macChrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const iphoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const iphoneChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1';

test('登录页声明明暗、信任开关默认关闭、验证码与恢复码门控', async () => {
    const html = await readFile(authHtmlUrl, 'utf8');
    assert.match(html, /<meta name="color-scheme" content="light dark">/);
    assert.match(html, /id="trust-device"/);
    assert.equal(/id="trust-device"[^>]*\schecked(?:[\s>=]|$)/.test(html), false);
    assert.match(html, /id="code"[^>]*inputmode="numeric"/);
    assert.match(html, /id="code"[^>]*autocomplete="one-time-code"/);
    assert.match(html, /id="finish-login"[^>]*disabled/);
    assert.match(html, /id="copy-recovery"/);
    assert.match(html, /id="download-recovery"/);
    assert.match(html, /id="add-authenticator"/);
    assert.equal(html.includes('在验证器中添加此密钥'), false);
    const css = await readFile(authCssUrl, 'utf8');
    assert.match(css, /prefers-color-scheme:\s*dark/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /--vc-accent:\s*#0071e3/);
    assert.match(css, /--vc-step:\s*200ms/);
    const js = await readFile(authJsUrl, 'utf8');
    assert.match(js, /trustFields\(/);
    assert.match(js, /normalizeTotpCode\(/);
    assert.match(js, /groupManualKey\(/);
});

test('trustDevice 默认 false，勾选后为 true 并带不超过 120 字的设备名', async () => {
    const { trustFields, deviceNameFromUA } = await import('../server-plugin/virtual-companion/auth/index.js');
    assert.deepEqual(trustFields(false, macChrome), { trustDevice: false });
    assert.deepEqual(trustFields(undefined, macChrome), { trustDevice: false });
    assert.deepEqual(trustFields(true, macChrome), { trustDevice: true, deviceName: 'Mac · Chrome' });
    assert.equal(deviceNameFromUA(iphoneSafari), 'iPhone · Safari');
    assert.equal(deviceNameFromUA(iphoneChrome), 'iPhone · Chrome');
    assert.equal(deviceNameFromUA(macChrome), 'Mac · Chrome');
    assert.equal([...deviceNameFromUA(`${macChrome}${'x'.repeat(400)}`)].length <= 120, true);
    assert.equal(deviceNameFromUA(''), '当前设备');
});

test('验证码只保留数字，满 6 位自动提交，恢复码不自动提交', async () => {
    const { normalizeTotpCode, shouldAutoSubmitTotp } = await import('../server-plugin/virtual-companion/auth/index.js');
    assert.equal(normalizeTotpCode('12a3 45-67'), '123456');
    assert.equal(normalizeTotpCode('123456789'), '123456');
    assert.equal(shouldAutoSubmitTotp('12a3 45-67', false), true);
    assert.equal(shouldAutoSubmitTotp('12345', false), false);
    assert.equal(shouldAutoSubmitTotp('123456', true), false);
    assert.equal(shouldAutoSubmitTotp('AB12', true), false);
});

test('验证码未满 6 位不能点验证，恢复码模式可以，当前格跟着位数走', async () => {
    const { verifySubmitEnabled, otpActiveIndex } = await import('../server-plugin/virtual-companion/auth/index.js');
    assert.equal(verifySubmitEnabled('', false), false);
    assert.equal(verifySubmitEnabled('12345', false), false);
    assert.equal(verifySubmitEnabled('12a3456', false), true);
    assert.equal(verifySubmitEnabled('123456', false), true);
    assert.equal(verifySubmitEnabled('', true), true);
    assert.equal(verifySubmitEnabled('1', true), true);
    assert.equal(otpActiveIndex(''), 0);
    assert.equal(otpActiveIndex('12a'), 2);
    assert.equal(otpActiveIndex('123456'), -1);
});

test('登录页视觉规格：版式、分组、验证码格、主按钮与令牌', async () => {
    const html = await readFile(authHtmlUrl, 'utf8');
    const css = await readFile(authCssUrl, 'utf8');
    const js = await readFile(authJsUrl, 'utf8');
    const accept = await readFile(new URL('../scripts/w05-accept.mjs', import.meta.url), 'utf8');

    assert.match(css, /--vc-canvas:\s*#f5f5f7/);
    assert.match(css, /--vc-group:\s*#ffffff/);
    assert.match(css, /--vc-ink-3:\s*#aeaeb2/);
    assert.match(css, /--vc-separator:\s*rgba\(60,\s*60,\s*67,\s*\.16\)/);
    assert.match(css, /--vc-glass-shadow:\s*rgba\(0,\s*0,\s*0,\s*\.10\)/);
    assert.match(css, /--vc-fs-large:\s*34px/);
    assert.match(css, /--vc-fs-body:\s*17px/);
    assert.match(css, /--vc-fs-subhead:\s*15px/);
    assert.match(css, /--vc-fs-footnote:\s*13px/);
    assert.match(css, /--vc-fs-otp:\s*28px/);
    assert.match(css, /--vc-radius-sm:\s*12px/);
    assert.match(css, /--vc-radius-md:\s*16px/);
    assert.match(css, /--vc-radius-lg:\s*20px/);
    assert.match(css, /--vc-radius-otp:\s*10px/);
    assert.match(css, /--vc-space-lg:\s*20px/);
    assert.match(css, /--vc-card:\s*400px/);
    assert.match(css, /--vc-mark:\s*56px/);
    assert.match(css, /--vc-otp-w:\s*48px/);
    assert.match(css, /--vc-otp-h:\s*56px/);
    assert.match(css, /--vc-btn:\s*50px/);
    assert.match(css, /--vc-shake:\s*200ms/);
    assert.match(css, /--vc-shadow:\s*0 8px 28px var\(--vc-glass-shadow\)/);
    assert.equal(css.includes('--vc-btn-desktop'), false);
    const dark = css.slice(css.indexOf('prefers-color-scheme: dark'));
    assert.match(dark, /--vc-canvas:\s*#000000/);
    assert.match(dark, /--vc-group:\s*#1c1c1e/);
    assert.match(dark, /--vc-ink-3:\s*#636366/);
    assert.match(dark, /--vc-accent-text:\s*#2997ff/);
    assert.match(dark, /--vc-danger:\s*#ff6961/);
    assert.match(dark, /--vc-separator:\s*rgba\(84,\s*84,\s*88,\s*\.55\)/);
    assert.match(dark, /--vc-glass-shadow:\s*rgba\(0,\s*0,\s*0,\s*\.5\)/);

    assert.match(css, /calc\(10vh \+ env\(safe-area-inset-top/);
    assert.match(css, /padding:[^;]*var\(--vc-space-lg\)/);
    assert.match(css, /\.thumb\s*\{[^}]*position:\s*fixed/);
    assert.match(css, /min-width:\s*744px[\s\S]*\.auth-panel\s*\{[^}]*var\(--vc-card\)/);
    assert.match(css, /min-width:\s*744px[\s\S]*border-radius:\s*var\(--vc-radius-lg\)/);
    assert.match(css, /min-width:\s*744px[\s\S]*\.thumb\s*\{[^}]*position:\s*static/);
    assert.match(css, /\.primary\s*\{[^}]*height:\s*var\(--vc-btn\)/);
    assert.match(css, /\.primary\s*\{[^}]*border-radius:\s*var\(--vc-radius-pill\)/);
    // DESIGN：页面与分组平面无阴影，按钮都是胶囊。
    assert.doesNotMatch(css, /\.auth-panel\s*\{[^}]*box-shadow/);
    assert.match(css, /\.primary\s*\{[^}]*font-size:\s*var\(--vc-fs-body\)/);
    assert.match(css, /\.primary\s*\{[^}]*font-weight:\s*600/);
    assert.match(css, /\.primary\[aria-busy="true"\]\s*\{\s*opacity:\s*1/);
    assert.match(css, /0\.5px solid var\(--vc-separator\)/);
    assert.match(css, /\.switch\s*\{[^}]*justify-content:\s*space-between/);
    assert.match(css, /\.text-row\s*\{[^}]*justify-content:\s*space-between/);
    assert.match(css, /\.text\s*\{[^}]*font-size:\s*var\(--vc-fs-subhead\)/);
    assert.match(css, /\.text\s*\{[^}]*min-height:\s*var\(--vc-touch\)/);
    assert.match(css, /#setup-secret\s*\{[^}]*white-space:\s*nowrap/);
    assert.match(css, /#setup-secret\s*\{[^}]*font-size:\s*var\(--vc-fs-subhead\)/);
    assert.match(css, /\.otp-cell\s*\{[^}]*width:\s*var\(--vc-otp-w\)/);
    assert.match(css, /\.otp-cell\s*\{[^}]*height:\s*var\(--vc-otp-h\)/);
    assert.match(css, /\.otp-cell\s*\{[^}]*border-radius:\s*var\(--vc-radius-otp\)/);
    assert.match(css, /\.otp-cell\s*\{[^}]*font-size:\s*var\(--vc-fs-otp\)/);
    assert.match(css, /\.otp-cell\.is-current\s*\{[^}]*var\(--vc-accent\)/);
    assert.match(css, /\.field-error\s*\{[^}]*font-size:\s*var\(--vc-fs-footnote\)/);
    assert.match(css, /\.field-error\s*\{[^}]*color:\s*var\(--vc-danger\)/);
    assert.match(css, /@keyframes auth-shake/);
    assert.match(css, /\.otp\.is-invalid \.otp-cells\s*\{[^}]*auth-shake var\(--vc-shake\)/);
    assert.match(css, /grid-template-columns:\s*1fr;/);
    assert.match(css, /\.recovery-grid li \{[^}]*white-space: nowrap/);
    assert.match(css, /\.primary:disabled,[^{]*\{[^}]*background: var\(--vc-fill-2\)/);
    assert.match(css, /\.qr-frame\s*\{[^}]*border-radius:\s*var\(--vc-radius-md\)/);
    assert.match(css, /\.qr-frame\s*\{[^}]*background:\s*var\(--vc-qr-paper\)/);
    assert.match(css, /\.auth-panel:has\(#login-form:not\(\[hidden\]\)\) \.auth-mark\s*\{[^}]*display:\s*flex/);
    assert.match(css, /#verify-step\.is-recovery \.otp-cells\s*\{[^}]*display:\s*none/);
    assert.equal(/#verify-step\.is-setup #verify-submit\s*\{\s*display:\s*none/.test(css), false);
    const reduced = css.slice(css.lastIndexOf('prefers-reduced-motion'));
    assert.match(reduced, /\.otp\.is-invalid \.otp-cells\s*\{[^}]*animation:\s*none/);

    assert.match(html, /class="auth-mark"/);
    assert.match(html, /class="auth-mark"[\s\S]*M19 14c1\.49-1\.46/);
    assert.match(html, /aria-label="用户名"/);
    assert.match(html, /placeholder="用户名"/);
    assert.match(html, /aria-label="密码"/);
    assert.match(html, /placeholder="密码"/);
    assert.match(html, /aria-label="当前密码"/);
    assert.match(html, /placeholder="当前密码"/);
    assert.match(html, /aria-label="新密码"/);
    assert.match(html, /aria-label="确认新密码"/);
    assert.equal(/<label[^>]*for="account"/.test(html), false);
    assert.equal((html.match(/class="otp-cell"/g) || []).length, 6);
    assert.match(html, /id="verify-submit"[^>]*disabled/);
    assert.match(html, /id="copy-secret"[^>]*>[\s\S]*class="icon icon-copy"/);
    assert.match(html, /id="copy-secret"[^>]*>[\s\S]*class="icon icon-check"/);
    assert.match(html, /id="copy-secret"[^>]*>[\s\S]*class="copy-label sr-only">复制</);
    assert.match(html, /id="copy-recovery"[^>]*>[\s\S]*class="icon icon-copy"/);
    assert.match(html, /id="download-recovery"[^>]*>[\s\S]*class="icon icon-download"/);
    assert.match(html, /id="download-recovery"[^>]*>[\s\S]*下载</);
    assert.equal(html.includes('下载 .txt'), false);
    assert.match(html, /class="group-card"/);
    assert.match(html, /信任此设备 90 天/);
    assert.match(html, /添加到验证器/);

    assert.match(js, /verifySubmitEnabled\(/);
    assert.match(js, /otpActiveIndex\(/);
    assert.match(js, /1500/);
    assert.match(js, /\.copy-label/);
    assert.match(js, /classList\.(add|toggle)\('is-copied'\)/);

    assert.match(accept, /const LOGIN_POLISH_STEPS = \['login', 'totp', 'setup', 'recovery-mode', 'recovery-codes', 'password'\]/);
    assert.match(accept, /login-polish/);
    assert.match(accept, /\$\{name\}-\$\{slot\}-\$\{scheme\}\.png/);
});

test('恢复码进入按钮在保存前关闭，手动密钥按 4 位分组', async () => {
    const { recoveryFinishEnabled, groupManualKey, rawManualKey } = await import('../server-plugin/virtual-companion/auth/index.js');
    assert.equal(recoveryFinishEnabled(false), false);
    assert.equal(recoveryFinishEnabled(true), true);
    assert.equal(groupManualKey('abcd efgh 1234'), 'ABCD EFGH 1234');
    assert.equal(groupManualKey('abcdefgh'), 'ABCD EFGH');
    assert.equal(rawManualKey('abcd efgh'), 'ABCDEFGH');
});

test('账户页信任设备分组默认隐藏，空列表不显示', async () => {
    const { renderAccountShell, trustedDeviceGroupVisible, formatTrustedDeviceLine } = await import('../extension/vc-model-settings/data-rights.js');
    const html = renderAccountShell();
    assert.match(html, /aria-label="已信任的设备"/);
    assert.match(html, /data-trusted-devices hidden/);
    assert.equal(trustedDeviceGroupVisible([]), false);
    assert.equal(trustedDeviceGroupVisible(null), false);
    assert.equal(trustedDeviceGroupVisible([{ id: '4', displayName: 'Mac · Chrome' }]), true);
    const iso = '2026-10-30T05:00:00Z';
    const expected = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
    const line = formatTrustedDeviceLine({ displayName: 'Mac · Chrome', lastUsedAt: iso, expiresAt: iso });
    assert.equal(line.name, 'Mac · Chrome');
    assert.equal(line.lastUsed, expected);
    assert.equal(line.expires, expected);
});

test('trusted-devices 走现有桥请求', async () => {
    const seen = [];
    const previous = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        seen.push({ url: String(url), method: init.method ?? 'GET' });
        const path = String(url);
        const body = path.endsWith('/api/v1/auth/session')
            ? { accountId: '7', sessionId: '8' }
            : [];
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(body),
            headers: { get: () => null },
        };
    };
    try {
        const { captureSessionContext, listTrustedDevices, revokeTrustedDevice } = await import('../extension/vc-model-settings/api.js');
        await captureSessionContext();
        await listTrustedDevices();
        await revokeTrustedDevice('12');
    } finally {
        globalThis.fetch = previous;
    }
    assert.equal(seen.some((call) => call.method === 'GET' && call.url.endsWith('/api/v1/auth/trusted-devices')), true);
    assert.equal(seen.some((call) => call.method === 'DELETE' && call.url.endsWith('/api/v1/auth/trusted-devices/12')), true);
});
