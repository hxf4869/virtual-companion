// W15-4c 浏览器截图与交互断言。用法：node harness/w15-4c-shoot.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.VC_W15_HARNESS_PORT || 9365);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.VC_W15_SHOTS
    || '/private/tmp/claude-501/-Users-hxf-projects-virtual-companion/67c91cf9-5973-42e2-bbc0-514b65af332e/scratchpad/w15-shots/w15-4c';
const scenarios = [
    'account', 'account-empty', 'account-reauth', 'account-partial', 'account-delete',
    'model-ledger-active', 'model-ledger-missing', 'model-ledger-currency', 'model-resave',
];
const expects = {
    account: ['修改密码', '重置验证器', '登出其他会话', '验证器已启用', '当前会话', '其他会话', '备份状态独立，策略在 W16'],
    'account-empty': ['没有进行中的会话', '登出其他会话', '备份状态独立，策略在 W16'],
    'account-reauth': ['需要重新验证身份。', '当前密码', '验证并继续', '重置验证器'],
    'account-partial': ['部分完成', '备份状态独立，策略在 W16'],
    'account-delete': ['账号删除未完成，聊天已暂停。', 'ST、MEMORYCORE'],
    'model-ledger-active': ['美元价', '计价样本'],
    'model-ledger-missing': ['未配置单价，无法发送', '空价'],
    'model-ledger-currency': ['仅美元计价可用于发送', '人民币价'],
    'model-resave': ['空价', '计价样本'],
};
const absent = ['手机已收到', 'ADMIN', 'otpauth', '9007199254740993', 'vc_csrf', 'revoke-all'];
const viewports = [
    { name: '1440', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
    { name: '360', width: 360, height: 780 },
];

mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [join(HERE, 'w15-4c-server.mjs')], {
    env: { ...process.env, VC_W15_HARNESS_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });
await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`harness server did not listen\n${serverLog}`)), 8000);
    const onData = () => {
        if (serverLog.includes('w15-4c harness')) {
            clearTimeout(timer);
            resolve();
        }
    };
    server.stdout.on('data', onData);
    server.on('exit', (code) => reject(new Error(`harness server exited ${code}\n${serverLog}`)));
});

const failures = [];
const shots = [];
let browser;
try {
    try {
        browser = await chromium.launch({ channel: 'chrome' });
    } catch {
        browser = await chromium.launch();
    }
    async function open(width, height, scenario) {
        const leaks = [];
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        page.on('request', (req) => {
            const url = req.url();
            if (url.startsWith('data:') || url.startsWith('blob:')) return;
            const parsed = new URL(url);
            if (parsed.hostname !== '127.0.0.1' || parsed.port !== String(PORT)) leaks.push(url);
            if (parsed.pathname.startsWith('/api')) leaks.push(url);
        });
        await page.goto(`${BASE}/?scenario=${scenario}`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__vcW15Ready === true);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        return { page, context, leaks };
    }
    async function inspect(page, scenario, width) {
        return page.evaluate(({ expected, forbidden, scenarioName, viewportWidth }) => {
            const problems = [];
            const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
            if (overflow > 1) problems.push(`横向溢出 ${overflow}px`);
            const text = document.body.innerText;
            const html = document.body.innerHTML;
            for (const piece of expected) {
                if (!text.includes(piece)) problems.push(`缺少文案 ${piece}`);
            }
            if (scenarioName === 'account' && document.querySelector('.vc-data-body')?.innerText.includes('当前密码')) {
                problems.push('账户主区域重复了当前密码');
            }
            if (scenarioName === 'account') {
                const rows = document.querySelector('[data-sessions]')?.innerText || '';
                if (!rows.includes('当前会话 ·')) problems.push('当前会话没有时间');
            }
            if (scenarioName === 'model-ledger-active' && (text.includes('未配置单价，无法发送') || text.includes('仅美元计价可用于发送'))) {
                problems.push('有效美元价不应额外提示');
            }
            if (scenarioName === 'model-ledger-missing' && text.includes('仅美元计价可用于发送')) problems.push('空价显示了币种提示');
            if (scenarioName === 'model-ledger-currency' && text.includes('未配置单价，无法发送')) problems.push('非美元价显示成未配置单价');
            if (scenarioName === 'model-resave') {
                if (text.includes('未配置单价，无法发送') || text.includes('仅美元计价可用于发送')) problems.push('保存后仍显示发送限制');
                if ((window.__vcProviderGets || 0) < 2) problems.push('保存后没有重新拉取列表');
                if (window.__vcPutHasLedger !== false) problems.push('保存请求写回了 ledgerPrice');
            }
            if (scenarioName === 'account-reauth') {
                const input = document.querySelector('[data-reauth-password]');
                const rect = input?.getBoundingClientRect();
                if (!input || input.value || input.hasAttribute('value') || input.getAttribute('name')) problems.push('重新验证密码进了值或属性');
                if (document.activeElement !== input) problems.push('重新验证没有聚焦密码');
                if (!rect || rect.top < 0 || rect.bottom > window.innerHeight + 1) problems.push('重新验证输入不在视口内');
                if ((text.match(/当前密码/g) || []).length !== 1) problems.push('当前密码出现次数不是 1');
            }
            for (const piece of forbidden) {
                if (text.includes(piece) || html.includes(piece)) problems.push(`出现了不应展示的内容 ${piece}`);
            }
            const stored = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join('\n');
            if (stored && forbidden.some((piece) => stored.includes(piece))) problems.push('localStorage 含不应写入的内容');
            if (viewportWidth <= 480) {
                const selectors = [
                    '#open-account', '#open-models',
                    '.vc-data-dialog button', '.vc-data-dialog input:not([type="checkbox"])',
                    '.vcms-overlay button', '.vcms-overlay input:not([type="checkbox"]):not([type="radio"])', '.vcms-overlay select',
                ];
                const small = [];
                for (const sel of selectors) {
                    for (const el of document.querySelectorAll(sel)) {
                        const style = getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || el.hidden || el.closest('[hidden]')) continue;
                        const rect = el.getBoundingClientRect();
                        if (rect.width < 1 || rect.height < 1) continue;
                        if (rect.width < 44 || rect.height < 44) small.push(`${sel} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
                    }
                }
                if (small.length) problems.push(`触控目标小于 44px：${small.slice(0, 8).join('；')}`);
            }
            return problems;
        }, { expected: expects[scenario], forbidden: absent, scenarioName: scenario, viewportWidth: width });
    }
    for (const viewport of viewports) {
        for (const scenario of scenarios) {
            const name = `${viewport.name}-${scenario}`;
            console.log(name);
            const opened = await open(viewport.width, viewport.height, scenario);
            try {
                await opened.page.screenshot({ path: join(OUT, `${name}.png`) });
                shots.push(`${name}.png`);
                const problems = await inspect(opened.page, scenario, viewport.width);
                if (opened.leaks.length) problems.push(`网络外呼 ${opened.leaks.join(' ')}`);
                if (problems.length) failures.push(`${name}: ${problems.join(' | ')}`);
            } finally {
                await opened.context.close();
            }
        }
    }
    {
        const opened = await open(390, 450, 'account-reauth');
        try {
            await opened.page.screenshot({ path: join(OUT, '390x450-account-reauth.png') });
            shots.push('390x450-account-reauth.png');
            const problems = await inspect(opened.page, 'account-reauth', 390);
            if (opened.leaks.length) problems.push(`网络外呼 ${opened.leaks.join(' ')}`);
            if (problems.length) failures.push(`390x450-account-reauth: ${problems.join(' | ')}`);
        } finally {
            await opened.context.close();
        }
    }
    {
        const opened = await open(390, 844, 'account');
        const page = opened.page;
        try {
            await page.locator('[data-reset]').click();
            await page.locator('.vc-account-reauth:not([hidden])').waitFor();
            await page.locator('[data-reauth-password]').fill('layer-check');
            await page.keyboard.press('Escape');
            try {
                await page.waitForFunction(() => {
                    const hidden = document.querySelector('.vc-account-reauth')?.hidden === true;
                    const open = document.querySelector('.vc-data-dialog')?.open === true;
                    const focused = (document.activeElement?.textContent || '').includes('重置验证器');
                    const value = document.querySelector('[data-reauth-password]')?.value || '';
                    const stored = Object.keys(localStorage).map((key) => localStorage.getItem(key) || '').join('\n');
                    return hidden && open && focused && value === '' && !document.body.innerHTML.includes('layer-check') && !stored.includes('layer-check');
                }, null, { timeout: 2000 });
            } catch {
                const back = await page.evaluate(() => ({
                    hidden: document.querySelector('.vc-account-reauth')?.hidden === true,
                    open: document.querySelector('.vc-data-dialog')?.open === true,
                    focused: document.activeElement?.textContent?.trim() || '',
                    value: document.querySelector('[data-reauth-password]')?.value || '',
                }));
                failures.push(`reauth-escape: ${JSON.stringify(back)}`);
            }
            await page.keyboard.press('Escape');
            try {
                await page.waitForFunction(() => document.querySelector('.vc-data-dialog')?.open !== true && document.activeElement?.id === 'open-account', null, { timeout: 2000 });
            } catch {
                const back = await page.evaluate(() => ({
                    open: document.querySelector('.vc-data-dialog')?.open === true,
                    focused: document.activeElement?.id || document.activeElement?.textContent?.trim() || '',
                }));
                failures.push(`account-escape: ${JSON.stringify(back)}`);
            }
            if (opened.leaks.length) failures.push(`account-escape 网络外呼 ${opened.leaks.join(' ')}`);
        } finally {
            await opened.context.close();
        }
    }
    {
        const opened = await open(390, 844, 'model-ledger-active');
        const page = opened.page;
        try {
            await page.keyboard.press('Escape');
            try {
                await page.waitForFunction(() => document.querySelector('.vcms-overlay')?.hidden !== false && document.activeElement?.id === 'open-models', null, { timeout: 2000 });
            } catch {
                const back = await page.evaluate(() => ({
                    hidden: document.querySelector('.vcms-overlay')?.hidden !== false,
                    focused: document.activeElement?.id || '',
                }));
                failures.push(`model-escape: ${JSON.stringify(back)}`);
            }
        } finally {
            await opened.context.close();
        }
    }
} finally {
    if (browser) await browser.close();
    server.kill();
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log(`w15-4c shots ${shots.length}`);
console.log(shots.join('\n'));
