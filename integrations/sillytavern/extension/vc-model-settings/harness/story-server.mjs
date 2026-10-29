// W15-3 剧情页截图用的静态服务器。只提供扩展文件，/api 一律拒绝，避免验收打到真实桥。
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = dirname(dirname(HERE));
const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 9563);
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
        res.writeHead(599, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('story harness does not serve API');
        return;
    }
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '').replace(/^(\.\.(\/|\\|$))+/, '');
    const path = join(STATIC_ROOT, relative);
    if (!path.startsWith(STATIC_ROOT) || !existsSync(path) || !statSync(path).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(path).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`story-harness http://127.0.0.1:${PORT}/vc-model-settings/harness/story-harness.html`);
});
