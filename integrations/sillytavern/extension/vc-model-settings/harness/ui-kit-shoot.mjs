// 组件展示页截图：390×844 与 1440×900，浅色与深色各一张。
// 运行：node harness/ui-kit-shoot.mjs
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const root = extensionRoot.endsWith(sep) ? extensionRoot : `${extensionRoot}${sep}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = fileURLToPath(new URL(`../../../dev-managed/artifacts/ui-kit-${stamp}/`, import.meta.url));
mkdirSync(outDir, { recursive: true });

const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
};

function startServer() {
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.pathname === '/favicon.ico') {
                res.writeHead(204);
                res.end();
                return;
            }
            const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            const file = normalize(join(root, rel));
            if (file !== root.slice(0, -1) && !file.startsWith(root)) {
                res.writeHead(403);
                res.end();
                return;
            }
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
            res.end(body);
        } catch {
            res.writeHead(404);
            res.end();
        }
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function launch() {
    try {
        return await chromium.launch({ channel: 'chrome' });
    } catch {
        return chromium.launch();
    }
}

const shots = [
    { width: 390, height: 844, theme: 'light' },
    { width: 390, height: 844, theme: 'dark' },
    { width: 1440, height: 900, theme: 'light' },
    { width: 1440, height: 900, theme: 'dark' },
];

const server = await startServer();
const port = server.address().port;
const browser = await launch();
const written = [];
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    for (const shot of shots) {
        await page.setViewportSize({ width: shot.width, height: shot.height });
        await page.emulateMedia({ colorScheme: shot.theme });
        await page.goto(`http://127.0.0.1:${port}/harness/ui-kit.html`, { waitUntil: 'load' });
        await page.waitForSelector('body[data-vc-kit="ready"]', { timeout: 8000 });
        const label = shot.theme === 'light' ? '浅色' : '深色';
        await page.getByRole('radio', { name: label }).click();
        await page.waitForFunction((theme) => document.documentElement.getAttribute('data-vc-theme') === theme, shot.theme);
        await page.evaluate(async () => {
            const pending = () => document.getAnimations().filter((anim) => {
                const timing = anim.effect?.getComputedTiming?.();
                if (!timing || timing.iterations === Infinity) return false;
                return anim.playState === 'running' || anim.playState === 'pending';
            });
            for (let i = 0; i < 30; i += 1) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                const anims = pending();
                if (!anims.length) return;
                await Promise.all(anims.map((anim) => anim.finished.catch(() => {})));
            }
        });
        const file = join(outDir, `${shot.width}x${shot.height}-${shot.theme}.png`);
        await page.screenshot({ path: file, fullPage: true });
        written.push(file);
    }
    if (errors.length) throw new Error(errors.join('\n'));
} finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
}
for (const file of written) console.log(file);
