// W15-4a 浏览器截图与交互断言。用法：node harness/w15-4a-shoot.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.VC_W15_HARNESS_PORT || 9364);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.VC_W15_SHOTS
    || '/private/tmp/claude-501/-Users-hxf-projects-virtual-companion/67c91cf9-5973-42e2-bbc0-514b65af332e/scratchpad/w15-shots/w15-4a';
const scenarios = ['nav', 'more', 'model-budget', 'model-noprice', 'model-savebar', 'account', 'account-partial', 'account-pending', 'account-delete'];
const expects = {
    nav: ['聊天', '角色', '记忆', '主动陪伴', '剧情', '模型', '账户'],
    more: ['记忆', '主动陪伴', '剧情', '账户', '返回'],
    'model-budget': ['当月可用额度不足，测试与发送暂不可用。设置仍可保存。', '未配置单价：照常发送，费用记为未知'],
    'model-noprice': ['未配置单价：照常发送，费用记为未知'],
    'model-savebar': ['保存配置', '未配置单价：照常发送，费用记为未知'],
    account: ['修改密码', '重置验证器', '登出其他会话', '验证器已启用', '当前会话', '其他会话', '备份状态独立，策略在 W16', '删除前的离线快照不能恢复为可用环境；恢复须先应用最新删除状态，具体策略在 W16。'],
    'account-partial': ['部分完成', '备份状态独立，策略在 W16', '删除前的离线快照不能恢复为可用环境；恢复须先应用最新删除状态，具体策略在 W16。'],
    'account-pending': ['副本生成中。关闭页面后任务会继续，你可以稍后取回最近副本。', '删除前的离线快照不能恢复为可用环境；恢复须先应用最新删除状态，具体策略在 W16。'],
    'account-delete': ['账号删除未完成，聊天已暂停。', 'ST、MEMORYCORE', '删除前的离线快照不能恢复为可用环境；恢复须先应用最新删除状态，具体策略在 W16。'],
};
const absent = ['手机已收到', 'ADMIN', 'otpauth', '9007199254740993', 'vc_csrf', 'owner@example.test'];
const viewports = [
    { name: '1440', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
    { name: '360', width: 360, height: 780 },
];

mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [join(HERE, 'w15-4a-server.mjs')], {
    env: { ...process.env, VC_W15_HARNESS_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });
await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`harness server did not listen\n${serverLog}`)), 8000);
    const onData = () => {
        if (serverLog.includes('w15-4a harness')) {
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
            const navLabels = document.querySelector('#vc-chat-nav')?.textContent || '';
            const expectedSource = scenarioName === 'nav' ? `${text}\n${navLabels}` : text;
            for (const piece of expected) {
                if (!expectedSource.includes(piece)) problems.push(`缺少文案 ${piece}`);
            }
            if (scenarioName === 'model-noprice' && text.includes('当月可用额度不足')) problems.push('无单价状态不应显示预算不足');
            for (const piece of forbidden) {
                if (text.includes(piece) || html.includes(piece)) problems.push(`出现了不应展示的内容 ${piece}`);
            }
            const stored = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join('\n');
            if (stored && forbidden.some((piece) => stored.includes(piece))) problems.push('localStorage 含不应写入的内容');
            const selectors = viewportWidth <= 480
                ? ['#vc-chat-nav button', '#vc-chat-more button', '.vc-data-dialog button', '.vc-data-dialog input:not([type="checkbox"])', '.vcms-overlay button', '.vcms-overlay input:not([type="checkbox"]):not([type="radio"])', '.vcms-overlay select', '#send_textarea', '#send_but']
                : ['#vc-chat-nav button', '#vc-chat-more button'];
            const small = [];
            for (const sel of selectors) {
                for (const el of document.querySelectorAll(sel)) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 1 || rect.height < 1 || el.hidden) continue;
                    if (rect.width < 44 || rect.height < 44) small.push(`${sel} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
                }
            }
            if (small.length) problems.push(`触控目标小于 44px：${small.slice(0, 8).join('；')}`);
            if (scenarioName === 'model-budget') {
                const discover = document.querySelector('[data-action="discover"]');
                const check = document.querySelector('[data-action="check-connection"]');
                const save = document.querySelector('#vcms-save');
                const send = document.querySelector('#send_but');
                if (!discover?.disabled || !check?.disabled) problems.push('预算不足时测试入口仍可用');
                if (save?.disabled) problems.push('预算不足时保存被禁用');
                if (!send?.disabled) problems.push('预算不足时发送仍可用');
            }
            if (scenarioName === 'model-noprice' || scenarioName === 'model-savebar') {
                if (document.querySelector('#vcms-save')?.disabled) problems.push('无单价时保存被禁用');
            }
            if (scenarioName === 'model-savebar') {
                const footer = document.querySelector('#vcms-save-footer');
                const rect = footer?.getBoundingClientRect();
                if (!rect || rect.bottom > window.innerHeight + 1 || rect.top < 0 || rect.height < 44) {
                    problems.push('保存栏不在短视口内');
                }
            }
            if (viewportWidth <= 480 && scenarioName === 'nav') {
                for (const name of ['memory', 'inbox', 'story', 'account']) {
                    const button = document.querySelector(`#vc-chat-nav button[data-nav="${name}"]`);
                    if (button && getComputedStyle(button).display !== 'none') problems.push(`底栏仍显示 ${name}`);
                }
            }
            if (viewportWidth > 900 && scenarioName === 'nav') {
                const more = document.querySelector('#vc-chat-nav button[data-nav="more"]');
                if (more && getComputedStyle(more).display !== 'none') problems.push('桌面仍显示更多');
            }
            return problems;
        }, { expected: expects[scenario], forbidden: absent, scenarioName: scenario, viewportWidth: width });
    }
    for (const viewport of viewports) {
        for (const scenario of scenarios) {
            if (scenario === 'more' && viewport.width > 900) continue;
            if (scenario === 'model-savebar' && viewport.width > 900) continue;
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
        const opened = await open(390, 450, 'model-savebar');
        try {
            await opened.page.screenshot({ path: join(OUT, '390x450-model-savebar.png') });
            shots.push('390x450-model-savebar.png');
            const problems = await inspect(opened.page, 'model-savebar', 390);
            if (opened.leaks.length) problems.push(`网络外呼 ${opened.leaks.join(' ')}`);
            if (problems.length) failures.push(`390x450-model-savebar: ${problems.join(' | ')}`);
        } finally {
            await opened.context.close();
        }
    }
    {
        const opened = await open(390, 844, 'nav');
        const page = opened.page;
        try {
            const more = page.locator('#vc-chat-nav button[data-nav="more"]');
            await more.focus();
            await more.click();
            await page.locator('#vc-chat-more[open]').waitFor();
            await page.keyboard.press('Escape');
            const moreBack = await page.evaluate(() => ({
                open: document.querySelector('#vc-chat-more')?.open === true,
                focused: document.activeElement?.getAttribute('data-nav') || '',
            }));
            if (moreBack.open || moreBack.focused !== 'more') failures.push(`more-escape: ${JSON.stringify(moreBack)}`);
            await more.click();
            await page.locator('#vc-chat-more button', { hasText: '账户' }).click();
            await page.locator('.vc-data-dialog[open]').waitFor();
            await page.keyboard.press('Escape');
            try {
                await page.waitForFunction(() => {
                    const open = document.querySelector('.vc-data-dialog')?.open === true;
                    const moreOpen = document.querySelector('#vc-chat-more')?.open === true;
                    const focused = document.activeElement?.textContent?.trim() || '';
                    return !open && moreOpen && focused === '账户';
                }, null, { timeout: 2000 });
            } catch {
                const accountBack = await page.evaluate(() => ({
                    open: document.querySelector('.vc-data-dialog')?.open === true,
                    moreOpen: document.querySelector('#vc-chat-more')?.open === true,
                    focused: document.activeElement?.textContent?.trim() || '',
                }));
                failures.push(`account-escape: ${JSON.stringify(accountBack)}`);
            }
            await page.keyboard.press('Escape');
            await page.locator('#vc-chat-more[open]').waitFor({ state: 'hidden' });
            await page.locator('#vc-chat-nav button[data-nav="models"]').click();
            await page.waitForSelector('#vcms-f-display');
            await page.keyboard.press('Escape');
            const modelBack = await page.evaluate(() => ({
                hidden: document.querySelector('.vcms-overlay')?.hidden !== false,
                focused: document.activeElement?.getAttribute('data-nav') || '',
            }));
            if (!modelBack.hidden || modelBack.focused !== 'models') failures.push(`model-escape: ${JSON.stringify(modelBack)}`);
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
console.log(`w15-4a shots ${shots.length}`);
console.log(shots.join('\n'));
