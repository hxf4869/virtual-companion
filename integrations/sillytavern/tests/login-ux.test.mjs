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
