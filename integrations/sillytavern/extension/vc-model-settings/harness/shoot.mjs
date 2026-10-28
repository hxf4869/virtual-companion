// V2-W03-S3 · 截图与操作验收脚本（playwright-core）。
// 运行：node harness/shoot.mjs [--port 8873] [--out /tmp/vc-w03-s3-ui]
// 覆盖：桌面 1440（示例 / 空态 / 绑定 / 高级展开）、手机 390 与 360 长表单、
// 冲突横幅（scenario=conflict 保存触发 409）、保存零外呼（断言无桥外请求之外的网络）。
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8873);
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '/tmp/vc-w03-s3-ui';
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });

async function launch() {
    try {
        return await chromium.launch({ channel: 'chrome' });
    } catch {
        return chromium.launch();
    }
}

const extraHosts = new Set();
const consoleErrors = [];

async function newPage(browser, { width, height }) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    page.on('console', (msg) => {
        if (msg.type() === 'error' && !msg.text().includes('status of 409')) {
            consoleErrors.push(`[${page.url()}] ${msg.text()}`);
        }
    });
    page.on('request', (req) => {
        const host = new URL(req.url()).host;
        if (host !== `127.0.0.1:${PORT}`) extraHosts.add(req.url());
    });
    return page;
}

async function openPanel(page, scenario) {
    await page.goto(`${BASE}/?scenario=${scenario}&autostart=1`);
    await page.waitForSelector('.vcms-overlay:not([hidden])', { timeout: 8000 });
    await page.waitForSelector('.vcms-provider-card, .vcms-empty-providers, .vcms-stateblock', { timeout: 8000 });
}

const browser = await launch();
const results = [];

async function shot(name, page, { fullPage = false } = {}) {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
    results.push(name);
}

// ---- 桌面 1440 ----
{
    const page = await newPage(browser, { width: 1440, height: 900 });
    await openPanel(page, 'sample');
    await shot('desktop-1440-sample', page);
    await page.click('.vcms-tab[data-tab="bindings"]');
    await page.waitForSelector('.vcms-bindings-table');
    await shot('desktop-1440-bindings', page);
    await page.click('.vcms-tab[data-tab="provider"]');
    await page.click('.vcms-advanced summary');
    await page.waitForSelector('.vcms-capgrid');
    await shot('desktop-1440-advanced', page);
    // 第二个供应商（停用 + 缺密钥）
    await page.click('.vcms-provider-card[data-id="backup-anthropic"]');
    await page.waitForTimeout(150);
    await shot('desktop-1440-disabled-nokey', page);
    await page.close();
}
{
    const page = await newPage(browser, { width: 1440, height: 900 });
    await openPanel(page, 'empty');
    await shot('desktop-1440-empty', page);
    // 新建供应商：未填 Key 启用 → 就近校验
    await page.click('[data-action="new-provider"]');
    await page.waitForSelector('#vcms-f-display');
    await page.fill('#vcms-f-display', '新服务商');
    await page.fill('#vcms-f-id', 'new-vendor');
    await page.fill('#vcms-f-base', 'https://api.newvendor.example');
    await page.click('[data-action="toggle-provider-state"]');
    await page.waitForTimeout(120);
    await shot('desktop-1440-new-enabled-nokey-error', page);
    await page.close();
}

// ---- 手机 390 长表单 ----
{
    const page = await newPage(browser, { width: 390, height: 844 });
    await openPanel(page, 'sample');
    await shot('mobile-390-sample', page, { fullPage: true });
    // 参数错误态：把最大输出改成超过 80%
    await page.fill('#vcms-m-max', '120000');
    await page.waitForTimeout(150);
    await shot('mobile-390-validation-error', page, { fullPage: true });
    await page.close();
}
// ---- 手机 360 空态 ----
{
    const page = await newPage(browser, { width: 360, height: 780 });
    await openPanel(page, 'empty');
    await shot('mobile-360-empty', page, { fullPage: true });
    await page.close();
}

// ---- 冲突横幅（scenario=conflict：修改后保存 → 409 → 保留草稿）----
{
    const page = await newPage(browser, { width: 390, height: 844 });
    await openPanel(page, 'conflict');
    await page.fill('#vcms-f-display', '主中转服务（改）');
    await page.click('#vcms-save-footer');
    await page.waitForSelector('.vcms-conflict', { timeout: 8000 });
    await shot('mobile-390-conflict-banner', page);
    // 查看最新 → 暂存横幅
    await page.click('[data-action="conflict-view-latest"]');
    await page.waitForSelector('[data-action="restore-stash"]', { timeout: 8000 });
    await shot('mobile-390-conflict-latest', page);
    await page.close();
}

// ---- 保存成功路径（sample：改名保存 → toast + revision 提升；零外呼）----
{
    const page = await newPage(browser, { width: 1440, height: 900 });
    await openPanel(page, 'sample');
    await page.fill('#vcms-f-display', '主中转服务（已改名）');
    await page.click('#vcms-save');
    await page.waitForSelector('.vcms-toast-success', { timeout: 8000 });
    await shot('desktop-1440-saved', page);
    await page.close();
}

// ---- 绑定冲突对比面板（先把后台改版本，再在页面保存同一用途）----
{
    const page = await newPage(browser, { width: 1440, height: 900 });
    await openPanel(page, 'sample');
    await page.click('.vcms-tab[data-tab="bindings"]');
    await page.reload();
    await page.waitForSelector('.vcms-overlay:not([hidden])', { timeout: 8000 });
    await page.click('.vcms-tab[data-tab="bindings"]');
    await page.waitForSelector('.vcms-bindings-table');
    // 页面已按 revision=2 读入后，再在后台把 NPC_DIALOGUE 改一次（版本 3），制造版本差
    await page.evaluate(async () => {
        const csrf = document.cookie.match(/vc_csrf=([^;]+)/)?.[1] ?? '';
        await fetch('/api/plugins/virtual-companion/go/api/v1/admin/model-purposes/NPC_DIALOGUE', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'st-harness-token', 'X-VC-CSRF-Token': csrf, 'X-Vc-Harness-Scenario': 'sample' },
            body: JSON.stringify({ providerId: 'main-relay', profileKey: 'long-context', state: 'ENABLED', expectedRevision: 2 }),
        });
    });
    await page.selectOption('select[data-bind="binding.NPC_DIALOGUE"]', 'main-relay::daily-chat');
    await page.click('[data-action="save-bindings"]');
    await page.waitForSelector('.vcms-callout-warn', { timeout: 8000 });
    await page.click('[data-action="bindings-view-latest"]');
    await page.waitForSelector('.vcms-conflict-compare', { timeout: 8000 });
    await shot('desktop-1440-bindings-conflict-compare', page);
    await page.close();
}

await browser.close();
console.log(`screenshots → ${OUT}`);
for (const name of results) console.log(`  - ${name}.png`);
if (extraHosts.size) {
    console.error('FAIL: 发出了 harness 之外的网络请求:');
    for (const u of extraHosts) console.error('  ' + u);
    process.exit(1);
}
if (consoleErrors.length) {
    console.error('console errors:');
    for (const e of consoleErrors) console.error('  ' + e);
    process.exitCode = 1;
} else {
    console.log('zero external requests; no console errors');
}
