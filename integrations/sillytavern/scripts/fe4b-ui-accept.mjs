// F4b 角色与剧情新界面。不进默认场景集。只开本机静态页，不启 Go / ST / 模型。
// 运行：node accept-managed.mjs --filter fe4b-ui
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createShotBudget, keepSceneShot } from './lib/scene-shots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INTEG = join(HERE, '..');
const STATIC_ROOT = join(INTEG, 'extension');
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};

function startServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (url.pathname.startsWith('/api/')) {
            res.writeHead(599, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('fe4b harness does not serve API');
            return;
        }
        const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '').replace(/^(\.\.(\/|\\|$))+/, '');
        const file = join(STATIC_ROOT, relative);
        if (!file.startsWith(STATIC_ROOT) || !existsSync(file) || !statSync(file).isFile()) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('not found');
            return;
        }
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function layoutOf(page) {
    return page.evaluate(() => {
        const inScroller = (el) => {
            for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
                const overflow = getComputedStyle(node).overflowX;
                if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') return true;
            }
            return false;
        };
        const offenders = [];
        for (const el of document.querySelectorAll('body *')) {
            if (inScroller(el)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 && rect.height < 1) continue;
            if (rect.right > window.innerWidth + 1 || rect.left < -1) {
                offenders.push(`${el.tagName}.${String(el.className).slice(0, 40)} ${Math.round(rect.left)}..${Math.round(rect.right)}`);
                if (offenders.length >= 6) break;
            }
        }
        const small = [];
        const min = 43.5;
        for (const el of document.querySelectorAll('.vc-characters button, .vc-story-tab button, .vc-story-tab textarea, .vc-characters input')) {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden') continue;
            const textButton = el.classList.contains('vc-btn-text');
            if ((!textButton && rect.width < min) || rect.height < min) {
                const name = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 24);
                small.push(`${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
            }
        }
        return {
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            offenders,
            small,
            secrets: /PRIVATE_|GM_ONLY_|sk-/.test(document.body.innerText),
        };
    });
}

export async function sceneFe4bUi(ctx = {}) {
    const dev = process.env.VC_W03_DEV_DIR || join(INTEG, 'dev-managed');
    const out = join(dev, 'artifacts', 'fe4b');
    mkdirSync(out, { recursive: true, mode: 0o700 });
    const cardPath = join(out, 'import-card.json');
    writeFileSync(cardPath, JSON.stringify({ name: '导入的角色', description: '公开简介' }));
    const shots = [];
    const failures = [];
    const fail = (message) => failures.push(message);
    const server = await startServer();
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const launchOpts = { headless: true };
    if (process.env.VC_W03_CHROMIUM_PATH) launchOpts.executablePath = process.env.VC_W03_CHROMIUM_PATH;
    const browser = await chromium.launch(launchOpts);
    let prefix = '390-light';

    async function settle(page) {
        await page.waitForFunction(() => {
            const running = document.getAnimations().filter((anim) => {
                if (anim.playState !== 'running') return false;
                const iterations = anim.effect?.getTiming?.().iterations;
                if (iterations === Infinity) return false;
                const target = anim.effect?.target;
                if (target?.closest?.('.vc-evi, .vc-letterbox')) return false;
                return true;
            });
            if (running.length) return false;
            const icons = [...document.querySelectorAll('.vc-icon')].filter((svg) => {
                const rect = svg.getBoundingClientRect();
                return rect.width > 1 && rect.height > 1;
            });
            return icons.every((svg) => {
                const use = svg.querySelector('use');
                const href = use?.getAttribute('href') || '';
                if (href.includes('.svg#')) return false;
                try {
                    const box = svg.getBBox();
                    return box.width > 2 && box.height > 2;
                } catch {
                    return false;
                }
            });
        }, null, { timeout: 8000 });
    }

    const shotBudget = createShotBudget();
    async function shot(page, name, options = {}) {
        if (options.settle !== false) await settle(page);
        const file = join(out, `${prefix}-${name}.png`);
        if (keepSceneShot(shotBudget, file)) {
            await page.screenshot({ path: file });
            shots.push(file);
            if (ctx.artifactsDir && ctx.artifactsDir !== out) {
                const mirror = join(ctx.artifactsDir, 'fe4b', `${prefix}-${name}.png`);
                mkdirSync(dirname(mirror), { recursive: true, mode: 0o700 });
                copyFileSync(file, mirror);
                ctx.screenshots?.push(mirror);
            } else {
                ctx.screenshots?.push(file);
            }
        }
        const layout = await layoutOf(page);
        if (layout.overflow || layout.offenders.length) fail(`${prefix}-${name} 横向溢出 ${JSON.stringify(layout.offenders)}`);
        if (layout.small.length) fail(`${prefix}-${name} 触控目标不足 44px ${layout.small.join('; ')}`);
        if (layout.secrets) fail(`${prefix}-${name} 页面出现私密标记`);
    }

    async function open(page, scenario, theme) {
        await page.goto(`${base}/vc-model-settings/harness/fe4b.html?scenario=${encodeURIComponent(scenario)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction((name) => window.__ready === name, scenario, { timeout: 8000 });
        await page.waitForFunction((value) => document.documentElement.getAttribute('data-vc-theme') === value && document.body.classList.contains('vc-ui'), theme);
    }

    async function reachStage(page) {
        await page.click('[data-action="start"]');
        await page.waitForSelector('.vc-letterbox', { timeout: 8000 });
        await page.waitForSelector('.vc-letterbox', { state: 'detached', timeout: 12000 });
        await page.waitForSelector('.vc-story[data-state="playing"]', { timeout: 8000 });
    }

    async function actLin(page) {
        await page.click('[data-actor="lin"]');
        await page.waitForSelector('[data-step="a1"]:not([hidden])');
        await page.click('[data-step="a1"]');
    }

    async function assertClear(page, label) {
        const result = await page.evaluate(() => {
            const dock = document.querySelector('.vc-dock');
            const scroll = document.querySelector('.vc-story-tab .vc-scroll');
            if (!dock || !scroll) return { ok: false, reason: 'missing' };
            scroll.scrollTop = scroll.scrollHeight;
            const dockTop = dock.getBoundingClientRect().top;
            const covered = [];
            let lowest = 0;
            for (const el of scroll.querySelectorAll('.vc-narr li, .vc-narr p, .vc-evi, .vc-story-ending, .vc-cell')) {
                const box = el.getBoundingClientRect();
                if (box.width < 1 || box.height < 1) continue;
                lowest = Math.max(lowest, box.bottom);
                if (box.bottom > dockTop + 1) {
                    covered.push((el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24));
                    if (covered.length >= 4) break;
                }
            }
            return { ok: covered.length === 0, dockTop: Math.round(dockTop), lowest: Math.round(lowest), covered, width: window.innerWidth };
        });
        if (!result.ok) fail(`${label} 输入区挡住内容 ${JSON.stringify(result)}`);
    }

    async function roles(page, theme) {
        await open(page, 'roles', theme);
        await page.waitForSelector('.vc-role[data-ref="card-1"]');
        await shot(page, 'roles');
        await page.locator('.vc-characters input[type="file"]').setInputFiles(cardPath);
        await page.waitForFunction(() => window.__imported === '导入的角色');
        await page.waitForSelector('text=导入的角色');
        await shot(page, 'roles-imported');
        await page.locator('.vc-role[data-ref="card-1"]').click();
        await page.waitForSelector('.vc-poster');
        await shot(page, 'roles-detail');
        await page.click('[data-action="select-instance"][data-id="12"]');
        await page.waitForFunction(() => window.__opened && window.__opened.relationshipId === '12' && window.__opened.characterRef === 'card-1');
        await page.locator('[name="displayName"]').evaluate((el) => {
            el.value = '改过的名字';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.click('[data-action="back"]');
        await page.waitForSelector('.vc-alert [data-action="keep-editing"]');
        await shot(page, 'roles-unsaved');
        await page.click('[data-action="keep-editing"]');
        await page.waitForSelector('.vc-alert', { state: 'detached' });
        if (await page.locator('.vc-poster').count() !== 1) fail(`${prefix} 取消放弃后应留在详情`);
        await page.click('[data-action="edit-card"]');
        await page.waitForFunction(() => window.__host === 1);

        await open(page, 'roles-empty', theme);
        await page.waitForSelector('text=还没有角色卡模板');
        await shot(page, 'roles-empty');
        await open(page, 'roles-loading', theme);
        await page.waitForSelector('.vc-characters .vc-skeleton');
        await shot(page, 'roles-loading');
        await open(page, 'roles-error', theme);
        await page.waitForSelector('[data-action="retry"]');
        await page.waitForSelector('text=加载失败，请重试。');
        await shot(page, 'roles-error');
        await open(page, 'roles-long', theme);
        await page.waitForSelector('.vc-role');
        await shot(page, 'roles-long');
        await page.locator('.vc-role').click();
        await page.waitForSelector('.vc-poster');
        await page.locator('.vc-characters .vc-screen').last().locator('.vc-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await shot(page, 'roles-long-detail');
    }

    async function story(page, theme) {
        await open(page, 'story', theme);
        await page.waitForSelector('[data-action="start"]');
        await page.waitForSelector('text=雨夜旅馆：失踪的怀表');
        await shot(page, 'story-gate');
        await page.click('[data-action="start"]');
        await page.waitForSelector('.vc-letterbox[data-pose="hold"]', { timeout: 8000 });
        const pose = await page.evaluate(() => {
            const top = document.querySelector('.vc-letterbox .is-top');
            const card = document.querySelector('.vc-letterbox-card');
            if (!top || !card) return null;
            return {
                transform: getComputedStyle(top).transform,
                spacing: parseFloat(getComputedStyle(card).letterSpacing),
                opacity: parseFloat(getComputedStyle(card).opacity),
            };
        });
        const closed = pose && (pose.transform === 'none' || pose.transform === 'matrix(1, 0, 0, 1, 0, 0)');
        if (!closed || pose.spacing < 2 || pose.opacity < 0.8) fail(`${prefix} 黑幕未在合拢且片名展开时截到 ${JSON.stringify(pose)}`);
        await shot(page, 'story-letterbox', { settle: false });
        await page.waitForSelector('.vc-letterbox', { state: 'detached', timeout: 12000 });
        await page.waitForSelector('.vc-story[data-state="playing"]');
        await shot(page, 'story-stage');
        await page.click('[data-actor="lin"]');
        await page.waitForSelector('[data-actor="lin"].is-on[aria-pressed="true"]');
        await shot(page, 'story-npc');
        await assertClear(page, `${prefix} 390`);
        const savedViewport = page.viewportSize();
        const savedPrefix = prefix;
        await page.setViewportSize({ width: 360, height: savedViewport?.height || 844 });
        prefix = `360-${theme}`;
        await assertClear(page, prefix);
        await shot(page, 'story-dock');
        prefix = savedPrefix;
        await page.setViewportSize(savedViewport || { width: 390, height: 844 });
        const before = await page.locator('.vc-story').getAttribute('data-world-version');
        await page.click('[data-step="a1"]');
        await page.waitForSelector('.vc-story-sync', { timeout: 8000 });
        await shot(page, 'story-sync');
        await page.waitForSelector('.vc-evi-new', { timeout: 8000 });
        await shot(page, 'story-evidence');
        const after = await page.locator('.vc-story').getAttribute('data-world-version');
        if (after === before) fail(`${prefix} 行动后世界版本没有前进`);
        await page.click('[aria-label="回档"]');
        await page.waitForSelector('#vc-story-rewind-title');
        await shot(page, 'story-rewind');
        await page.click('[data-action="cancel-rewind"]');
        await page.waitForSelector('.vc-alert', { state: 'detached' });
        const stayed = await page.locator('.vc-story').getAttribute('data-world-version');
        if (stayed !== after) fail(`${prefix} 取消回档后版本变了 ${after} -> ${stayed}`);

        await open(page, 'story-generating', theme);
        await reachStage(page);
        await actLin(page);
        await page.waitForSelector('.vc-story[data-state="generating"]');
        const stop = page.locator('[data-action="stop"]');
        if (await stop.count() !== 1 || await stop.isEnabled()) fail(`${prefix} 生成中停止键应存在且不可用`);
        await shot(page, 'story-generating');

        await open(page, 'story-rejected', theme);
        await reachStage(page);
        await actLin(page);
        await page.waitForSelector('.vc-story[data-state="rejected"]');
        await shot(page, 'story-rejected');

        await open(page, 'story-conflict', theme);
        await reachStage(page);
        await actLin(page);
        await page.waitForSelector('.vc-story[data-state="conflict"]');
        await shot(page, 'story-conflict');

        await open(page, 'story-ended', theme);
        await reachStage(page);
        await actLin(page);
        await page.waitForSelector('.vc-story[data-state="ended"]');
        await page.waitForSelector('text=结局');
        await shot(page, 'story-ended');

        await open(page, 'story-missing', theme);
        await page.waitForSelector('[data-config="missing"]');
        await page.click('[data-action="configure"]');
        await page.waitForFunction(() => window.__configured === 1);
        await shot(page, 'story-missing');

        await open(page, 'story-offline', theme);
        await page.click('[data-action="start"]');
        await page.waitForSelector('text=开局未完成，请重试。', { timeout: 12000 });
        await page.waitForSelector('.vc-letterbox', { state: 'detached', timeout: 12000 });
        await shot(page, 'story-offline');

        await open(page, 'story-loading', theme);
        await page.waitForSelector('.vc-story-tab .vc-skeleton');
        await shot(page, 'story-loading');

        await open(page, 'story-long', theme);
        await reachStage(page);
        await page.click('[data-actor="lin"]');
        await page.waitForSelector('[data-step="a1"]:not([hidden])');
        await assertClear(page, `${prefix} 长文`);
        await shot(page, 'story-long');
    }

    try {
        for (const viewport of [{ name: '390', width: 390, height: 844 }, { name: '1440', width: 1440, height: 900 }]) {
            for (const theme of ['light', 'dark']) {
                prefix = `${viewport.name}-${theme}`;
                const context = await browser.newContext({
                    viewport: { width: viewport.width, height: viewport.height },
                    colorScheme: theme,
                });
                await context.addInitScript((value) => {
                    localStorage.setItem('vc-ui', 'on');
                    localStorage.setItem('vc-theme', value);
                }, theme);
                const page = await context.newPage();
                try {
                    await roles(page, theme);
                } catch (error) {
                    fail(`${prefix} 角色 ${error.message}`);
                    try { await shot(page, 'roles-failed'); } catch { /* 截图失败不掩盖原错误 */ }
                }
                try {
                    await story(page, theme);
                } catch (error) {
                    fail(`${prefix} 剧情 ${error.message}`);
                    try { await shot(page, 'story-failed'); } catch { /* 截图失败不掩盖原错误 */ }
                }
                await context.close();
            }
        }
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
    if (failures.length) throw new Error(failures.join('\n'));
    return { shots: shots.length, out };
}

export const fe4bUiScene = {
    id: 'fe4b-ui',
    title: 'F4b 角色与剧情新界面：网格、详情、开局转场与回档取消',
    needs: ['browser'],
    default: false,
    run: sceneFe4bUi,
};
export const scenes = [fe4bUiScene];
