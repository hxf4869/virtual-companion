// Local mirror only. No model downloads, text capture or published engine port.
import http from 'node:http';
import { createVoiceFixtureHandler } from './managed-voice-fixture.mjs';
const handle = createVoiceFixtureHandler();
const server = http.createServer(async (req, res) => {
    try {
        if (req.url === '/healthz') { res.writeHead(200); res.end('ok'); return; }
        // Managed fixture controls are deliberately unavailable in the local mirror.
        if (req.url.startsWith('/__voice/')) { res.writeHead(404); res.end(); return; }
        if (!await handle(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end(); }
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
});
server.listen(8757, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
