// W15-4a 模型 / 账户截图用静态服务。不转发 /api。
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = dirname(dirname(HERE));
const PORT = Number(process.env.VC_W15_HARNESS_PORT || 9364);
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api')) {
        res.writeHead(599, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'w15-4a harness does not serve api' }));
        return;
    }
    const path = url.pathname === '/' ? '/vc-model-settings/harness/w15-4a.html' : url.pathname;
    if (path.includes('..')) {
        res.writeHead(400);
        res.end();
        return;
    }
    const file = join(STATIC_ROOT, path.replace(/^\/+/, ''));
    if (!file.startsWith(STATIC_ROOT) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`w15-4a harness http://127.0.0.1:${PORT}/`);
});
