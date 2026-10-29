// W15-1 浏览器截图与交互断言。用法：node harness/w15-chat-shoot.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.VC_W15_HARNESS_PORT || 9362);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.VC_W15_SHOTS
    || '/private/tmp/claude-501/-Users-hxf-projects-virtual-companion/67c91cf9-5973-42e2-bbc0-514b65af332e/scratchpad/w15-shots/w15-1';
const scenarios = [
    'empty', 'model-pending', 'model-disabled', 'model-missing-key', 'offline', 'inbox', 'conflict',
    'instance-first', 'instance-import-failed', 'instance-list', 'instance-unsaved',
];
const expects = {
    empty: ['这段会话还没有消息。', '模型待配置'],
    'model-pending': ['前台聊天绑定尚未就绪', '模型待配置'],
    'model-disabled': ['绑定的模型配置已停用', '模型待配置'],
    'model-missing-key': ['未配置密钥', '模型待配置'],
    offline: ['聊天通道已断开'],
    inbox: ['2 条消息待写入会话', '查看'],
    conflict: ['这段对话已在另一处更新。你的输入已保留，请加载最新内容后继续。', '查看最新', '保留草稿'],
    'instance-first': ['还没有陪伴实例', '创建实例', '角色卡模板'],
    'instance-import-failed': ['文件不是受支持的角色卡格式'],
    'instance-list': ['澄夏·日常', '澄夏·旅行', '陪伴实例'],
    'instance-unsaved': ['当前存在未保存更改，切换实例前请先保存。'],
};
const viewports = [
    { name: '1440', width: 1440, height: 900 },
    { name: '390', width: 390, height: 844 },
    { name: '360', width: 360, height: 780 },
];

mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [join(HERE, 'w15-chat-server.mjs')], {
    env: { ...process.env, VC_W15_HARNESS_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });
await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`harness server did not listen\n${serverLog}`)), 8000);
    server.stdout.on('data', () => {
        if (serverLog.includes('w15-chat harness')) {
            clearTimeout(timer);
            resolve();
        }
    });
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
        await page.waitForFunction(() => [...document.querySelectorAll('link')].some((node) => node.hasAttribute('data-vc-chat-shell') && node.sheet));
        if (scenario.startsWith('instance')) {
            await page.waitForFunction(() => [...document.querySelectorAll('link')].some((node) => node.hasAttribute('data-vc-instance') && node.sheet));
        }
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        return { page, context, leaks };
    }
    async function inspect(page, scenario) {
        return page.evaluate((expected) => {
            const problems = [];
            const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
            if (overflow > 1) problems.push(`横向溢出 ${overflow}px`);
            const text = document.body.innerText;
            for (const piece of expected) {
                if (!text.includes(piece)) problems.push(`缺少文案 ${piece}`);
            }
            for (const piece of ['手机已收到', '强制覆盖', 'SECRET_BODY_SHOULD_NOT_RENDER', 'SECOND_SECRET_BODY', 'DRAFT_MARKER_91', 'SECRET_FILE']) {
                if (text.includes(piece) || document.body.innerHTML.includes(piece)) problems.push(`出现了不应展示的内容 ${piece}`);
            }
            const status = `${document.querySelector('#vc-chat-status')?.innerText || ''}\n${document.querySelector('#vc-chat-empty')?.innerText || ''}`;
            if (status.includes('前台模型绑定')) problems.push('聊天状态区重复了投影横幅');
            if (document.querySelector('#vc-f2-conflict textarea')) problems.push('冲突面板包含 textarea');
            const selectors = [
                '#vc-chat-nav button', '#vc-chat-status button', '#vc-f2-conflict button',
                '.vc-instance-page button', '.vc-instance-page input', '.vc-instance-unsaved button',
                '#vc_foreground_banner .vcfg-banner-btn', '#send_textarea',
            ];
            const small = [];
            for (const sel of selectors) {
                for (const el of document.querySelectorAll(sel)) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 1 || rect.height < 1) continue;
                    if (rect.width < 44 || rect.height < 44) {
                        small.push(`${sel} ${el.textContent.trim().slice(0, 16)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
                    }
                }
            }
            if (small.length) problems.push(`触控目标小于 44px：${small.join('；')}`);
            return problems;
        }, expects[scenario]);
    }
    for (const viewport of viewports) {
        for (const scenario of scenarios) {
            const name = `${viewport.name}-${scenario}`;
            console.log(name);
            const opened = await open(viewport.width, viewport.height, scenario);
            try {
                await opened.page.screenshot({ path: join(OUT, `${name}.png`) });
                shots.push(`${name}.png`);
                const problems = await inspect(opened.page, scenario);
                if (opened.leaks.length) problems.push(`网络外呼 ${opened.leaks.join(' ')}`);
                if (problems.length) failures.push(`${name}: ${problems.join(' | ')}`);
            } finally {
                await opened.context.close();
            }
        }
    }
    for (const item of [
        { scenario: 'conflict', width: 390, height: 450, name: '390x450-conflict' },
        { scenario: 'instance-first', width: 390, height: 450, name: '390x450-instance-first' },
    ]) {
        const opened = await open(item.width, item.height, item.scenario);
        try {
            await opened.page.screenshot({ path: join(OUT, `${item.name}.png`) });
            shots.push(`${item.name}.png`);
            const problems = await inspect(opened.page, item.scenario);
            if (opened.leaks.length) problems.push(`网络外呼 ${opened.leaks.join(' ')}`);
            if (problems.length) failures.push(`${item.name}: ${problems.join(' | ')}`);
        } finally {
            await opened.context.close();
        }
    }

    {
        const opened = await open(390, 844, 'conflict');
        try {
            await opened.page.keyboard.press('Escape');
            const state = await opened.page.evaluate(() => ({
                open: document.querySelector('#vc-f2-conflict')?.open ?? false,
                active: document.activeElement?.id || '',
                marker: document.body.innerHTML.includes('DRAFT_MARKER_91'),
                value: document.querySelector('#send_textarea')?.value || '',
            }));
            if (state.open || state.active !== 'send_textarea' || state.marker || !state.value.includes('DRAFT_MARKER_91')) {
                failures.push(`conflict Escape ${JSON.stringify(state)}`);
            }
            if (opened.leaks.length) failures.push(`conflict Escape 网络外呼 ${opened.leaks.join(' ')}`);
        } finally {
            await opened.context.close();
        }
    }
    async function prepareConflict(opened) {
        await opened.context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
        await opened.page.evaluate(() => {
            window.__vcStay = 1;
            window.__vcStorageWrites = 0;
            for (const store of [localStorage, sessionStorage]) {
                const original = store.setItem.bind(store);
                store.setItem = function (...args) {
                    window.__vcStorageWrites += 1;
                    return original(...args);
                };
            }
            const box = document.querySelector('#send_textarea');
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, '正在输入');
        });
    }
    {
        const opened = await open(390, 844, 'conflict');
        try {
            await prepareConflict(opened);
            await opened.page.click('#vc-f2-conflict [data-action="view-latest"]');
            await opened.page.waitForFunction(() => {
                const value = document.querySelector('#send_textarea')?.value || '';
                return window.__vcStay === 1
                    && (window.__vcW15Reloads?.() || 0) === 1
                    && document.querySelector('#vc-f2-conflict')?.open === false
                    && value.includes('正在输入')
                    && value.includes('DRAFT_MARKER_91')
                    && value.indexOf('正在输入') < value.indexOf('DRAFT_MARKER_91');
            });
            const state = await opened.page.evaluate(() => ({
                stay: window.__vcStay,
                reloads: window.__vcW15Reloads?.() || 0,
                storage: window.__vcStorageWrites,
                value: document.querySelector('#send_textarea').value,
                html: document.body.innerHTML.includes('DRAFT_MARKER_91') || document.body.innerHTML.includes('secret-token'),
                active: document.activeElement?.id || '',
                recall: document.querySelector('#vc-f2-recall')?.hidden === false,
            }));
            if (state.stay !== 1 || state.reloads !== 1 || state.storage !== 0 || state.html || state.active !== 'send_textarea' || !state.recall
                || !state.value.startsWith('正在输入') || !state.value.includes('DRAFT_MARKER_91') || state.value.includes('secret-token')) {
                failures.push(`conflict 查看最新 ${JSON.stringify(state)}`);
            }
            if (opened.leaks.length) failures.push(`conflict 查看最新 网络外呼 ${opened.leaks.join(' ')}`);
        } finally {
            await opened.context.close();
        }
    }
    {
        const opened = await open(390, 844, 'conflict');
        try {
            await prepareConflict(opened);
            await opened.page.click('#vc-f2-conflict [data-action="keep-draft"]');
            await opened.page.waitForFunction(() => {
                const value = document.querySelector('#send_textarea')?.value || '';
                return document.querySelector('#vc-f2-conflict')?.open === false
                    && value.includes('正在输入')
                    && value.includes('DRAFT_MARKER_91');
            });
            await opened.page.click('#vc-f2-recall');
            const state = await opened.page.evaluate(async () => {
                let copied = '';
                try { copied = await navigator.clipboard.readText(); } catch { copied = ''; }
                return {
                    stay: window.__vcStay,
                    reloads: window.__vcW15Reloads?.() || 0,
                    storage: window.__vcStorageWrites,
                    value: document.querySelector('#send_textarea').value,
                    html: document.body.innerHTML.includes('secret-token'),
                    copied,
                    recall: document.querySelector('#vc-f2-recall')?.hidden === false,
                };
            });
            if (state.stay !== 1 || state.reloads !== 0 || state.storage !== 0 || state.html || !state.recall
                || state.value !== '正在输入\nDRAFT_MARKER_91' || !state.copied.includes('DRAFT_MARKER_91') || state.copied.includes('secret-token')) {
                failures.push(`conflict 保留草稿 ${JSON.stringify(state)}`);
            }
            if (opened.leaks.length) failures.push(`conflict 保留草稿 网络外呼 ${opened.leaks.join(' ')}`);
        } finally {
            await opened.context.close();
        }
    }
    {
        const opened = await open(390, 844, 'instance-list');
        try {
            await opened.page.keyboard.press('Escape');
            const state = await opened.page.evaluate(() => ({
                open: document.querySelector('.vc-instance-dialog')?.open ?? false,
                active: document.activeElement?.textContent || '',
            }));
            if (state.open || !state.active.includes('角色')) failures.push(`instance Escape ${JSON.stringify(state)}`);
        } finally {
            await opened.context.close();
        }
    }
    {
        const opened = await open(360, 780, 'instance-unsaved');
        try {
            await opened.page.click('[data-action="select-instance"][data-id="12"]');
            await opened.page.waitForSelector('.vc-instance-unsaved[open]');
            await opened.page.keyboard.press('Escape');
            const state = await opened.page.evaluate(() => ({
                unsaved: document.querySelector('.vc-instance-unsaved')?.open ?? false,
                activeId: document.activeElement?.getAttribute?.('data-id') || '',
                draft: document.querySelector('[name="displayName"]')?.value || '',
                pageOpen: document.querySelector('.vc-instance-dialog')?.open ?? false,
            }));
            if (state.unsaved || state.activeId !== '12' || state.draft !== '澄夏·日常改' || !state.pageOpen) {
                failures.push(`unsaved Escape ${JSON.stringify(state)}`);
            }
        } finally {
            await opened.context.close();
        }
    }
} finally {
    await browser?.close();
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
}

console.log(JSON.stringify({ shots, failures }, null, 2));
if (failures.length) process.exit(1);
