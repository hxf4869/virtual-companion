import fs from 'node:fs';
import path from 'node:path';
import { createMemoryCoreServer, requireServiceToken } from './http.mjs';
import { openFoundationEngine } from './engine.mjs';

process.umask(0o077);
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
try {
    const dataRoot = arg('--dataRoot');
    const port = Number(arg('--port'));
    if (!process.argv.includes('--dataRoot') || !path.isAbsolute(dataRoot || '') ||
        !process.argv.includes('--port') || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MEMORYCORE_CONFIG');
    const token = requireServiceToken(process.env.VC_MEMORYCORE_SERVICE_TOKEN);
    const build = JSON.parse(fs.readFileSync(new URL('./build.json', import.meta.url), 'utf8'));
    const engine = await openFoundationEngine(dataRoot);
    const server = createMemoryCoreServer({ token, engine, commit: build.commit });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.on('error', () => { process.stderr.write('MEMORYCORE_LISTEN_FAILED\n'); process.exit(1); });
    server.listen(port, '127.0.0.1', () => process.stdout.write('MEMORYCORE_FOUNDATION_READY\n'));
    const close = () => { server.close(() => process.exit(0)); server.closeAllConnections(); };
    process.on('SIGTERM', close); process.on('SIGINT', close);
} catch {
    // Upstream exceptions may contain paths/content: only a fixed code leaves this process.
    process.stderr.write('MEMORYCORE_START_FAILED\n'); process.exitCode = 1;
}
