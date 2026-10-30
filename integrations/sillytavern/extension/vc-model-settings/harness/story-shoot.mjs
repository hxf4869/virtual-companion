// W15-3 剧情页截图与手机交互验收。不改 harness.html / server.mjs。打开页面前把 vc-ui 写成 off。
// 运行：node story-shoot.mjs [--port 9563] [--out <dir>]
import { chromium } from 'playwright-core';
import { pinVcUi } from '../../../scripts/vc-ui-pin.mjs';
import { mkdirSync } from 'node:fs';

const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 9563);
const OUT = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : '/private/tmp/claude-501/-Users-hxf-projects-virtual-companion/67c91cf9-5973-42e2-bbc0-514b65af332e/scratchpad/w15-shots/w15-3';
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });

const STATES = ['unstarted', 'playing', 'rejected', 'missing', 'generating', 'evidence', 'ended', 'rewind', 'conflict'];
const failures = [];
const shots = [];
const extraHosts = new Set();
const apiHits = [];

function fail(message) {
    failures.push(message);
    console.error(`FAIL ${message}`);
}

async function launch() {
    try {
        return await chromium.launch({ channel: 'chrome' });
    } catch {
        return chromium.launch();
    }
}

async function measure(page) {
    return page.evaluate(() => {
        const doc = document.documentElement;
        const offenders = [];
        for (const el of document.querySelectorAll('body *')) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 && rect.height < 1) continue;
            if (rect.right > window.innerWidth + 1 || rect.left < -1) {
                offenders.push(`${el.tagName}.${String(el.className).slice(0, 48)} ${Math.round(rect.left)}..${Math.round(rect.right)}`);
                if (offenders.length >= 8) break;
            }
        }
        const small = [];
        for (const el of document.querySelectorAll('.vc-story-root button, .vc-story-root input, .vc-story-root textarea')) {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden') continue;
            if (rect.width < 43.5 || rect.height < 43.5) {
                const name = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 32);
                small.push(`${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
            }
        }
        return {
            docOverflow: doc.scrollWidth > doc.clientWidth + 1,
            offenders,
            small,
            secrets: /PRIVATE_|GM_ONLY_|sk-test|sk-/.test(document.body.innerText),
            storage: [...Array(localStorage.length)].map((_, i) => localStorage.key(i)).filter((key) => key !== 'vc-ui').length,
            vcUi: (() => { try { return localStorage.getItem('vc-ui'); } catch { return null; } })(),
        };
    });
}

async function openScenario(page, scenario) {
    await page.goto(`${BASE}/vc-model-settings/harness/story-harness.html?scenario=${scenario}&autostart=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((name) => window.__ready === name, scenario, { timeout: 8000 });
    await page.waitForSelector('link[data-vc-story]', { state: 'attached' });
    await page.waitForFunction(() => {
        const button = document.querySelector('.vc-story-root .vcms-btn');
        return button && Number.parseFloat(getComputedStyle(button).minHeight) >= 44;
    });
    if (scenario === 'rewind') {
        await page.click('[data-action="ask-rewind"][data-version="0"]');
        await page.waitForSelector('.vc-story-rewind-dialog[open]');
    }
    if (scenario === 'missing') await page.waitForSelector('[data-config="missing"]');
}

const browser = await launch();
try {
    for (const width of [1440, 390, 360]) {
        for (const scenario of STATES) {
            const context = await browser.newContext({ viewport: { width, height: 900 } });
            await pinVcUi(context, 'off');
            const page = await context.newPage();
            page.on('request', (req) => {
                const url = new URL(req.url());
                if (url.host !== `127.0.0.1:${PORT}`) extraHosts.add(req.url());
                if (url.pathname.startsWith('/api/')) apiHits.push(req.url());
            });
            await openScenario(page, scenario);
            if (scenario === 'ended') await page.locator('.vc-story-ending').scrollIntoViewIfNeeded();
            const name = `${width}-${scenario}`;
            await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: scenario !== 'rewind' });
            shots.push(`${OUT}/${name}.png`);
            const layout = await measure(page);
            if (layout.docOverflow || layout.offenders.length) fail(`${name} 横向溢出 ${JSON.stringify(layout.offenders)}`);
            if (layout.small.length) fail(`${name} 触控目标不足 44px ${layout.small.join('; ')}`);
            if (layout.secrets) fail(`${name} 页面出现私密或凭据文本`);
            if (layout.storage !== 0 || layout.vcUi !== 'off') fail(`${name} localStorage 有预期外的写入`);
            await context.close();
        }
    }

    for (const [scenario, field, text] of [
        ['playing', '[data-field="say"]', '周澈，怀表昨晚在哪'],
        ['ended', '[data-field="summary"]', '我们在雨夜旅馆问过借用记录，决定先保存这段共同经历。'],
        ['rewind', '.vc-story-rewind-dialog', ''],
    ]) {
        const context = await browser.newContext({ viewport: { width: 390, height: 450 } });
        await pinVcUi(context, 'off');
        const page = await context.newPage();
        page.on('request', (req) => {
            const url = new URL(req.url());
            if (url.host !== `127.0.0.1:${PORT}`) extraHosts.add(req.url());
            if (url.pathname.startsWith('/api/')) apiHits.push(req.url());
        });
        await openScenario(page, scenario);
        if (field.startsWith('[data-field')) {
            await page.locator(field).scrollIntoViewIfNeeded();
            await page.fill(field, text);
        }
        const name = scenario === 'playing' ? '390x450-say' : scenario === 'ended' ? '390x450-epilogue' : '390x450-rewind';
        await page.screenshot({ path: `${OUT}/${name}.png` });
        shots.push(`${OUT}/${name}.png`);
        const layout = await measure(page);
        if (layout.docOverflow || layout.offenders.length) fail(`${name} 横向溢出 ${JSON.stringify(layout.offenders)}`);
        if (layout.small.length) fail(`${name} 触控目标不足 44px ${layout.small.join('; ')}`);
        if (layout.secrets || layout.storage !== 0 || layout.vcUi !== 'off') fail(`${name} 出现私密文本或预期外的 localStorage`);
        await context.close();
    }

    {
        const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
        await pinVcUi(context, 'off');
        const page = await context.newPage();
        page.on('request', (req) => {
            const url = new URL(req.url());
            if (url.host !== `127.0.0.1:${PORT}`) extraHosts.add(req.url());
            if (url.pathname.startsWith('/api/')) apiHits.push(req.url());
        });
        await openScenario(page, 'playing');
        const openerFocused = await page.evaluate(() => document.activeElement?.id === 'open-story' || document.querySelector('.vc-story-dialog')?.contains(document.activeElement));
        if (!openerFocused) fail('打开剧情页后焦点不在对话框内');
        await page.goto(`${BASE}/vc-model-settings/harness/story-harness.html?scenario=rewind&autostart=1`);
        await page.waitForFunction(() => window.__ready === 'rewind');
        await page.click('[data-action="ask-rewind"][data-version="0"]');
        await page.waitForSelector('.vc-story-rewind-dialog[open]');
        const titleFocused = await page.evaluate(() => document.activeElement?.id === 'vc-story-rewind-title');
        if (!titleFocused) fail('回档弹层打开后焦点不在标题');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.vc-story-rewind-dialog', { state: 'detached' });
        const back = await page.evaluate(() => {
            const el = document.activeElement;
            return el?.dataset?.action === 'ask-rewind' && el.dataset.version === '0' && document.querySelector('.vc-story-dialog')?.open === true;
        });
        if (!back) fail('Escape 关闭回档弹层后焦点没有回到打开它的按钮，或把剧情页一起关了');
        const rewindPosts = await page.evaluate(() => window.__fetches.some((call) => call.url.endsWith('/rewind')));
        if (rewindPosts) fail('Escape 关闭回档弹层时发出了回档请求');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.vc-story-dialog')?.open);
        const restored = await page.evaluate(() => document.activeElement?.id === 'open-story');
        if (!restored) fail('Escape 关闭剧情页后焦点没有回到打开它的按钮');
        await context.close();
    }
} finally {
    await browser.close();
}

if (extraHosts.size) fail(`有网络外呼 ${[...extraHosts].join(', ')}`);
if (apiHits.length) fail(`静态服务器收到 API 请求 ${apiHits.join(', ')}`);

console.log(JSON.stringify({ shots: shots.length, failures }, null, 2));
if (failures.length) process.exit(1);
