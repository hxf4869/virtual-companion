// W15-2 主动陪伴页截图与布局断言。桩服务只在 127.0.0.1。
// 运行：node harness/inbox-shoot.mjs [--port 9465] [--out <dir>]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 9465);
const OUT = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : '/private/tmp/claude-501/-Users-hxf-projects-virtual-companion/67c91cf9-5973-42e2-bbc0-514b65af332e/scratchpad/w15-shots/w15-2';
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });

const BANNED = ['super-secret-value', 'hooks.example.test', 'sign-secret-value', 'PRIVATE_', 'GM_ONLY_', 'lease-secret', 'corr-secret', 'smtp-secret', '手机已收到', '诊断日志', '测试通知', '强制覆盖'];

function startServer() {
    const script = fileURLToPath(new URL('./inbox-server.mjs', import.meta.url));
    const child = spawn(process.execPath, [script, '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`harness 未启动\n${buf}`)), 8000);
        child.stdout.on('data', (chunk) => {
            buf += chunk;
            if (buf.includes('listening')) {
                clearTimeout(timer);
                resolve(child);
            }
        });
        child.stderr.on('data', (chunk) => { buf += chunk; });
        child.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`harness 退出 ${code}\n${buf}`));
        });
    });
}

async function launch() {
    try {
        return await chromium.launch({ channel: 'chrome' });
    } catch {
        return chromium.launch();
    }
}

const extraHosts = new Set();
const consoleErrors = [];
const shots = [];

async function newPage(browser, width, height) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on('console', (msg) => {
        if (msg.type() === 'error' && !/status of (409|403)/.test(msg.text())) consoleErrors.push(msg.text());
    });
    page.on('request', (req) => {
        const host = new URL(req.url()).host;
        if (host !== `127.0.0.1:${PORT}`) extraHosts.add(req.url());
    });
    return page;
}

async function openInbox(page, scenario) {
    await page.goto(`${BASE}/?scenario=${scenario}`);
    await page.click('#open-inbox');
    await page.waitForSelector('dialog h1', { timeout: 8000 });
    await page.waitForSelector('.vc-inbox-section', { timeout: 8000 });
}

async function assertLayout(page, name) {
    const report = await page.evaluate((banned) => {
        const dialog = document.querySelector('dialog');
        const box = dialog.getBoundingClientRect();
        const small = [...dialog.querySelectorAll('button, input, select')].filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width < 44 || rect.height < 44;
        }).map((el) => ({
            action: el.dataset.action || el.dataset.field || el.tagName,
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
        }));
        const roots = [document.documentElement, document.body, dialog, ...dialog.querySelectorAll('.vc-inbox-page, .vc-inbox-section, .vc-inbox-card, .vc-inbox-channel, .vc-inbox-grid')];
        const overflow = roots.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => ({
            cls: String(el.className || el.tagName), sw: el.scrollWidth, cw: el.clientWidth,
        }));
        const wide = [...dialog.querySelectorAll('*')].filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.right > box.right + 1;
        }).slice(0, 8).map((el) => el.className || el.tagName);
        const stored = [...Array(localStorage.length)].map((_, i) => localStorage.key(i)).join('\n');
        const text = `${document.body.innerText}\n${document.body.innerHTML}\n${stored}`;
        return { small, overflow, wide, banned: banned.filter((item) => text.includes(item)), storage: localStorage.length };
    }, BANNED);
    if (report.small.length || report.overflow.length || report.wide.length || report.banned.length || report.storage !== 0) {
        throw new Error(`${name} 布局或泄密断言失败 ${JSON.stringify(report)}`);
    }
    console.log(`PASS layout ${name}`);
}

async function shot(page, name) {
    await assertLayout(page, name);
    await page.evaluate(() => {
        const dialog = document.querySelector('dialog');
        dialog.style.position = 'absolute';
        dialog.style.inset = 'auto';
        dialog.style.top = '0';
        dialog.style.height = 'auto';
        dialog.style.maxHeight = 'none';
        dialog.style.overflow = 'visible';
    });
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    shots.push(name);
    console.log(`SHOT ${name}`);
}

const server = await startServer();
const browser = await launch();
try {
    {
        const page = await newPage(browser, 1440, 900);
        await openInbox(page, 'sample');
        await shot(page, 'desktop-1440-sample');
        await page.close();
    }
    {
        const page = await newPage(browser, 1440, 900);
        await openInbox(page, 'empty');
        await shot(page, 'desktop-1440-empty');
        await page.close();
    }
    {
        const page = await newPage(browser, 1440, 900);
        await openInbox(page, 'conflict');
        await page.fill('[data-field="quietHoursStart"]', '21:00');
        await page.click('[data-action="save-policy"]');
        await page.waitForSelector('.vc-inbox-layer', { timeout: 8000 });
        await assertLayout(page, 'desktop-1440-conflict');
        await page.screenshot({ path: `${OUT}/desktop-1440-conflict.png` });
        shots.push('desktop-1440-conflict');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.vc-inbox-layer') && document.activeElement?.dataset?.action === 'save-policy');
        const kept = await page.locator('[data-field="quietHoursStart"]').inputValue();
        if (kept !== '21:00') throw new Error(`冲突关闭后草稿丢失：${kept}`);
        console.log('PASS focus-conflict-escape');
        await page.close();
    }
    {
        const page = await newPage(browser, 390, 844);
        await openInbox(page, 'sample');
        await shot(page, 'mobile-390-sample');
        await page.close();
    }
    {
        const page = await newPage(browser, 390, 844);
        await openInbox(page, 'sample');
        await page.click('[data-action="ask-cancel"][data-follow-up-id="41"]');
        await page.waitForSelector('.vc-inbox-layer');
        await assertLayout(page, 'mobile-390-cancel');
        await page.screenshot({ path: `${OUT}/mobile-390-cancel.png` });
        shots.push('mobile-390-cancel');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.vc-inbox-layer')
            && document.activeElement?.dataset?.action === 'ask-cancel'
            && document.activeElement?.dataset?.followUpId === '41');
        console.log('PASS focus-cancel-escape');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.activeElement?.id === 'open-inbox' && !document.querySelector('dialog')?.open);
        console.log('PASS focus-page-escape');
        await page.close();
    }
    {
        const page = await newPage(browser, 360, 780);
        await openInbox(page, 'sample');
        await shot(page, 'mobile-360-sample');
        await page.close();
    }
    {
        const page = await newPage(browser, 390, 450);
        await openInbox(page, 'sample');
        const field = page.locator('[data-field="quietHoursStart"]');
        await field.scrollIntoViewIfNeeded();
        await field.focus();
        await assertLayout(page, 'mobile-390x450-input');
        const box = await field.boundingBox();
        if (!box || box.y < 0 || box.y + box.height > 450 || box.x < 0 || box.x + box.width > 390) {
            throw new Error(`短视口输入不在画面内 ${JSON.stringify(box)}`);
        }
        await page.screenshot({ path: `${OUT}/mobile-390x450-input.png` });
        shots.push('mobile-390x450-input');
        console.log('PASS short-viewport-input');
        await page.close();
    }
    {
        const page = await newPage(browser, 390, 844);
        await openInbox(page, 'reauth');
        await page.click('[data-action="save-policy"]');
        await page.waitForSelector('.vc-inbox-layer');
        await assertLayout(page, 'mobile-390-reauth');
        await page.screenshot({ path: `${OUT}/mobile-390-reauth.png` });
        shots.push('mobile-390-reauth');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.vc-inbox-layer') && document.activeElement?.dataset?.action === 'save-policy');
        console.log('PASS focus-reauth-escape');
        await page.close();
    }
    console.log(`screenshots → ${OUT}`);
    for (const name of shots) console.log(`  - ${name}.png`);
    if (extraHosts.size) {
        console.error(`FAIL external ${[...extraHosts].join('\n')}`);
        process.exitCode = 1;
    } else console.log('PASS no-external-network');
    if (consoleErrors.length) {
        console.error(`FAIL console ${consoleErrors.join('\n')}`);
        process.exitCode = 1;
    } else console.log('PASS no-console-errors');
} finally {
    await browser.close();
    server.kill();
}
