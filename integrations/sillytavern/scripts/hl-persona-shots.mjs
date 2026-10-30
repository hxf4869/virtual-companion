// 人设、引导、陪伴风格与主动模式的浅色/深色、手机/桌面截图。不进默认场景集。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '../extension');
const OUT = path.resolve(HERE, '../dev-managed/artifacts/hl-persona');
const VIEWPORTS = [
    { name: '390', width: 390, height: 844 },
    { name: '1440', width: 1440, height: 900 },
];
const THEMES = ['light', 'dark'];
const PAGES = ['onboarding', 'style', 'persona', 'proactive'];

function startServer() {
    const root = path.resolve(EXT);
    const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.svg': 'image/svg+xml',
    };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (url.pathname === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
        }
        const rel = decodeURIComponent(url.pathname);
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

export async function shootHlPersona() {
    fs.mkdirSync(OUT, { recursive: true });
    const server = await startServer();
    const browser = await launch();
    const files = [];
    try {
        const port = server.address().port;
        const base = `http://127.0.0.1:${port}`;
        const context = await browser.newContext({
            viewport: VIEWPORTS[0],
            reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const consoleLines = [];
        page.on('pageerror', (error) => consoleLines.push(error.message.slice(0, 180)));
        for (const theme of THEMES) {
            for (const viewport of VIEWPORTS) {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                for (const name of PAGES) {
                    const before = consoleLines.length;
                    await page.goto(`${base}/vc-model-settings/harness/hl-persona.html?page=${name}&theme=${theme}`, { waitUntil: 'domcontentloaded' });
                    await page.waitForSelector('body[data-vc-ready="1"]');
                    const reason = await page.locator('body').getAttribute('data-vc-error');
                    if (reason) throw new Error(`${name} ${theme} ${viewport.name} ${reason}`);
                    if (name === 'style') {
                        await page.waitForFunction(() => {
                            const el = document.querySelector('.vc-sheet');
                            if (!el) return false;
                            const transform = getComputedStyle(el).transform;
                            if (transform === 'none') return true;
                            const match = transform.match(/matrix\(([^)]+)\)/);
                            if (!match) return false;
                            const parts = match[1].split(',').map((item) => Number(item.trim()));
                            return Math.abs(parts[5] || 0) < 2;
                        });
                    }
                    if (consoleLines.length > before) throw new Error(`${name} 控制台错误 ${consoleLines.slice(before).join(' | ')}`);
                    const file = path.join(OUT, `hl-persona-${viewport.name}-${theme}-${name}.png`);
                    await page.screenshot({ path: file });
                    files.push(file);
                }
            }
        }
        return files;
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const files = await shootHlPersona();
    console.log(files.join('\n'));
}
