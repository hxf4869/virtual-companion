// F4a 记忆与陪伴新界面。默认不进入场景集，只在 --filter fe4a-ui 时运行。
// 桩数据只在页面内，不连接受管栈，不记录凭据或对话正文。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinVcUi } from './vc-ui-pin.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '../extension');
const OUT = path.resolve(HERE, '../dev-managed/artifacts/fe4a');
const VIEWPORTS = [
    { name: '390', width: 390, height: 844 },
    { name: '1440', width: 1440, height: 900 },
];
const THEMES = ['light', 'dark'];

function startServer() {
    const root = path.resolve(EXT);
    const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.svg': 'image/svg+xml',
    };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (url.pathname === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
        }
        let rel = decodeURIComponent(url.pathname);
        if (rel.includes('\0') || !rel.startsWith('/vc-model-settings/')) {
            res.writeHead(404);
            res.end();
            return;
        }
        const file = path.resolve(root, rel.slice(1));
        if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function launch() {
    const { chromium } = await import('playwright-core');
    if (process.env.VC_W03_CHROMIUM_PATH) {
        return chromium.launch({ headless: true, executablePath: process.env.VC_W03_CHROMIUM_PATH });
    }
    try {
        return await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
        return chromium.launch({ headless: true });
    }
}

export async function sceneFe4aUi(ctx = {}) {
    fs.mkdirSync(OUT, { recursive: true });
    const server = await startServer();
    const browser = await launch();
    const shots = [];
    try {
        const port = server.address().port;
        const base = `http://127.0.0.1:${port}`;
        const context = await browser.newContext({ viewport: VIEWPORTS[0] });
        await pinVcUi(context, 'on');
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const consoleLines = [];
        page.on('pageerror', (error) => consoleLines.push(error.message.slice(0, 180)));
        page.on('console', (msg) => { if (msg.type() === 'error') consoleLines.push(msg.text().slice(0, 180)); });
        const fail = async (error) => {
            try {
                const file = path.join(OUT, 'failure.png');
                await page.screenshot({ path: file });
                shots.push(file);
            } catch { /* 截图失败不掩盖原错误 */ }
            const reason = await page.locator('body').getAttribute('data-vc-error').catch(() => '');
            throw new Error(`${error.message}${reason ? ` page=${reason}` : ''}${consoleLines.length ? ` console=${consoleLines.slice(-3).join(' | ')}` : ''}`);
        };
        const shot = async (name) => {
            const file = path.join(OUT, name);
            await page.screenshot({ path: file });
            shots.push(file);
            ctx.screenshots?.push(file);
            if (ctx.artifactsDir) {
                const copy = path.join(ctx.artifactsDir, 'fe4a', name);
                fs.mkdirSync(path.dirname(copy), { recursive: true });
                fs.copyFileSync(file, copy);
                ctx.screenshots?.push(copy);
            }
        };
        const open = async (which, scene, theme) => {
            const before = consoleLines.length;
            await page.goto(`${base}/vc-model-settings/harness/fe4a.html?page=${which}&shot=${scene}&theme=${theme}`, { waitUntil: 'domcontentloaded' });
            try {
                await page.waitForSelector('[data-vc-ready="1"]');
            } catch (error) {
                await fail(error);
            }
            const link = which === 'inbox' ? 'link[data-vc-inbox]' : 'link[data-vc-memory-css]';
            await page.waitForFunction((sel) => Boolean(document.querySelector(sel)?.sheet), link);
            await page.waitForFunction((value) => document.documentElement.dataset.vcTheme === value, theme);
            if (consoleLines.length > before) throw new Error(`控制台错误 ${consoleLines.slice(before).join(' | ')}`);
        };
        const settled = async (selector) => {
            await page.waitForFunction((sel) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                const transform = getComputedStyle(el).transform;
                return transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
            }, selector);
        };
        const assertClean = async (label) => {
            const found = await page.evaluate(() => {
                const values = [...document.querySelectorAll('input, textarea')].map((el) => el.value || '');
                const surface = `${document.body.innerText}\n${values.join('\n')}`;
                return ['super-secret-value', '手机已收到', 'PRIVATE_', 'GM_ONLY_', 'otpauth'].filter((item) => surface.includes(item));
            });
            if (found.length) throw new Error(`${label} 写出了凭据或未提供的能力`);
            const secrets = await page.evaluate(() => [...document.querySelectorAll('input[type="password"]')].some((el) => el.value));
            if (secrets) throw new Error(`${label} 的密码框有值`);
        };
        const assertLayout = async (width) => {
            const problems = await page.evaluate((viewportWidth) => {
                const issues = [];
                const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
                if (doc > 1) issues.push(`文档横向溢出 ${doc}px`);
                if (viewportWidth > 480) return issues;
                const small = [];
                for (const el of document.querySelectorAll('button, input, textarea, select')) {
                    if (el.closest('.vc-clip') || el.classList.contains('vc-clip')) continue;
                    if (el.classList.contains('vc-switch') || el.closest('.vc-segment')) continue;
                    if (el.closest('[hidden]') || el.closest('details:not([open])')) continue;
                    const style = getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden') continue;
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 2 || rect.height < 2) continue;
                    if (rect.width < 44 || rect.height < 44) {
                        const name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 12);
                        small.push(`${el.tagName}.${String(el.className).slice(0, 40)} ${Math.round(rect.width)}x${Math.round(rect.height)} ${name}`);
                    }
                }
                if (small.length) issues.push(`触控目标小于 44px：${small.slice(0, 8).join('；')}`);
                return issues;
            }, width);
            if (problems.length) throw new Error(problems.join(' | '));
        };
        try {
            for (const viewport of VIEWPORTS) {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                for (const theme of THEMES) {
                    const suffix = `${viewport.name}-${theme}`;
                    await open('memory', 'ready', theme);
                    await shot(`memory-list-${suffix}.png`);
                    await assertLayout(viewport.width);
                    await assertClean(`memory-list-${suffix}`);
                    await page.locator('#vc-memory-instance').click();
                    await page.waitForSelector('.vc-menu');
                    await shot(`memory-menu-${suffix}.png`);
                    await page.locator('.vc-menu [aria-checked="true"]').click();
                    await page.waitForSelector('.vc-menu', { state: 'detached' });
                    await page.locator('.vc-memory-row').first().waitFor();
                    await page.locator('input[name="q"]').fill('散步');
                    await page.locator('input[name="q"]').press('Enter');
                    await page.waitForFunction(() => document.body.innerText.includes('喜欢傍晚沿湖散步') && !document.body.innerText.includes('待核验的合成记忆'));
                    await shot(`memory-search-${suffix}.png`);
                    await page.locator('input[name="q"]').fill('');
                    await page.locator('input[name="q"]').press('Enter');
                    await page.waitForFunction(() => document.body.innerText.includes('待核验的合成记忆'));
                    await page.locator('[data-status="PENDING_VERIFICATION"]').click();
                    await page.waitForFunction(() => document.body.innerText.includes('待核验的合成记忆') && !document.body.innerText.includes('喜欢傍晚沿湖散步'));
                    await shot(`memory-filter-${suffix}.png`);
                    await page.locator('[data-status=""]').click();
                    await page.locator('.vc-memory-row[data-memory-id="101"]').click();
                    await settled('.vc-memory-detail-screen');
                    await page.waitForFunction(() => document.body.innerText.includes('来源') && document.body.innerText.includes('修订历史'));
                    await shot(`memory-detail-${suffix}.png`);
                    await assertLayout(viewport.width);
                    await page.locator('[data-action="edit"]').click();
                    await page.locator('#vc-memory-draft').fill('改为早上散步');
                    await shot(`memory-edit-${suffix}.png`);
                    await page.locator('form[data-form="edit"] button[type="submit"]').click();
                    await page.waitForFunction(() => document.body.innerText.includes('输入已保留'));
                    await shot(`memory-conflict-${suffix}.png`);
                    await page.locator('[data-action="cancel-edit"]').click();
                    await page.locator('[data-action="confirm-forget"]').click();
                    await page.waitForSelector('[data-vc-ok]');
                    await shot(`memory-delete-${suffix}.png`);
                    await page.locator('[data-vc-ok]').click();
                    await page.waitForSelector('.vc-memory-detail-screen', { state: 'detached' });
                    await page.waitForFunction(() => !document.body.innerText.includes('喜欢傍晚沿湖散步') && document.body.innerText.includes('待核验的合成记忆'));
                    await shot(`memory-deleted-${suffix}.png`);
                    await assertClean(`memory-deleted-${suffix}`);

                    for (const [scene, name] of [
                        ['unbound', 'memory-unbound'],
                        ['empty', 'memory-empty'],
                        ['loading', 'memory-loading'],
                        ['error', 'memory-error'],
                        ['offline', 'memory-offline'],
                    ]) {
                        await open('memory', scene, theme);
                        await shot(`${name}-${suffix}.png`);
                        await assertLayout(viewport.width);
                    }
                    await open('memory', 'long', theme);
                    await shot(`memory-long-${suffix}.png`);
                    await page.locator('.vc-memory-row').first().click();
                    await settled('.vc-memory-detail-screen');
                    await shot(`memory-long-detail-${suffix}.png`);
                    await open('memory', 'source-error', theme);
                    await page.locator('.vc-memory-row').first().click();
                    await settled('.vc-memory-detail-screen');
                    await page.waitForFunction(() => document.body.innerText.includes('来源加载失败，请刷新详情。'));
                    await shot(`memory-source-error-${suffix}.png`);

                    await open('inbox', 'ready', theme);
                    await shot(`inbox-list-${suffix}.png`);
                    await assertLayout(viewport.width);
                    await assertClean(`inbox-list-${suffix}`);
                    await page.locator('[data-filter="pending"]').click();
                    await page.waitForFunction(() => document.body.innerText.includes('尚未写入') && !document.body.innerText.includes('链接已失效'));
                    await shot(`inbox-filter-${suffix}.png`);
                    await page.locator('[data-filter="all"]').click();
                    await page.locator('[data-action="open-follow"]').click();
                    await page.waitForSelector('.vc-menu [role="menuitem"]');
                    await page.locator('.vc-menu [role="menuitem"]').click();
                    await page.waitForSelector('[data-vc-ok]');
                    await page.waitForFunction(() => document.body.innerText.includes('取消后不会再对外发送。'));
                    await shot(`inbox-cancel-${suffix}.png`);
                    await page.locator('[data-vc-ok]').click();
                    await page.waitForFunction(() => window.__fe4a.cancels >= 1 && document.body.innerText.includes('已取消'));
                    await shot(`inbox-cancelled-${suffix}.png`);
                    await page.locator('[data-action="open-channel"][data-channel="EMAIL"]').click();
                    await settled('section.vc-screen[aria-label="渠道"]');
                    await page.waitForSelector('[aria-label="凭据"]');
                    await shot(`inbox-channel-${suffix}.png`);
                    await assertClean(`inbox-channel-${suffix}`);
                    await assertLayout(viewport.width);
                    await page.locator('[data-action="pop-channel"]').click();
                    await page.waitForSelector('section.vc-screen[aria-label="渠道"]', { state: 'detached' });
                    await page.locator('[data-action="open-channel"][data-channel="FEISHU"]').click();
                    await settled('section.vc-screen[aria-label="渠道"]');
                    await page.waitForFunction(() => document.body.innerText.includes('群成员可见'));
                    await shot(`inbox-feishu-${suffix}.png`);
                    await page.locator('[data-action="pop-channel"]').click();
                    await page.waitForSelector('section.vc-screen[aria-label="渠道"]', { state: 'detached' });
                    await page.locator('[data-field="quietHoursStart"]').fill('23:00');
                    await page.locator('[data-action="save-policy"]').click();
                    await page.waitForFunction(() => window.__fe4a.policyPuts >= 1
                        && document.querySelector('[data-field="quietHoursStart"]')?.value === '23:00'
                        && !document.querySelector('[data-action="save-policy"]')?.disabled);
                    await shot(`inbox-quiet-${suffix}.png`);
                    await assertClean(`inbox-quiet-${suffix}`);

                    for (const [scene, name] of [
                        ['empty', 'inbox-empty'],
                        ['loading', 'inbox-loading'],
                        ['error', 'inbox-error'],
                        ['offline', 'inbox-offline'],
                        ['long', 'inbox-long'],
                    ]) {
                        await open('inbox', scene, theme);
                        await shot(`${name}-${suffix}.png`);
                        await assertLayout(viewport.width);
                        await assertClean(`${name}-${suffix}`);
                    }
                }
            }
            if (consoleLines.length) throw new Error(`控制台错误 ${consoleLines.slice(-3).join(' | ')}`);
        } catch (error) {
            await fail(error);
        }
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
    return shots;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    sceneFe4aUi({ screenshots: [] }).then((shots) => {
        console.log(`fe4a-ui PASS ${shots.length}`);
    }).catch((error) => {
        console.error(error?.stack || error?.message || error);
        process.exit(1);
    });
}
