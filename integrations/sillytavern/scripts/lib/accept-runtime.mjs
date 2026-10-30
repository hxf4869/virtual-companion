// 受管场景与入口共用的运行时。端口和 Owner 在调用时读取，避免模块加载顺序拆开同一轮的值。
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const INTEG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function ownerAccountId() {
    if (!process.env.VC_W03_OWNER_ACCOUNT_ID) process.env.VC_W03_OWNER_ACCOUNT_ID = String(Date.now());
    return process.env.VC_W03_OWNER_ACCOUNT_ID;
}

export class LifecycleError extends Error {}

export const log = {
    ok: (message) => console.log(`[accept] ✓ ${message}`),
    info: (message) => console.log(`[accept] · ${message}`),
    warn: (message) => console.log(`[accept] ! ${message}`),
    fail: (message) => console.error(`[accept] ✗ ${message}`),
};

export const rt = {
    get ST_PORT() { return Number(process.env.VC_W03_ST_PORT || 8752); },
    get FIXTURE_PORT() { return Number(process.env.VC_W03_FIXTURE_PORT || 8753); },
    get GO_PORT() { return Number(process.env.VC_W03_GO_PORT || 8095); },
    get ST_BASE() { return `http://127.0.0.1:${this.ST_PORT}`; },
    get GO_BASE() { return `http://127.0.0.1:${this.GO_PORT}`; },
    get FIXTURE_BASE() { return `http://127.0.0.1:${this.FIXTURE_PORT}`; },
    get DEV_MANAGED() { return path.resolve(process.env.VC_W03_DEV_DIR || path.join(INTEG, 'dev-managed')); },
    get SCRIPTS() { return path.join(INTEG, 'scripts'); },
    get OWNER_ACCOUNT_ID() { return ownerAccountId(); },
    get PG_CONTAINER() { return process.env.VC_W03_PG_CONTAINER || 'vc-w03-managed-pg'; },
};

export function psql(sql) {
    const result = spawnSync('docker', [
        'exec', '-i', rt.PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'vc', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
    ], { encoding: 'buffer', input: Buffer.from(sql, 'utf8') });
    if (result.stderr?.length) process.stderr.write(result.stderr);
    if (result.error) throw new LifecycleError(`psql 无法执行：${result.error.message}`);
    if (result.status !== 0) throw new LifecycleError(`psql 失败（exit=${result.status}）`);
    return result.stdout?.toString('utf8') ?? '';
}

export const fixtureHttp = {
    async captures(opts = {}) {
        const query = new URLSearchParams();
        if (opts.since) query.set('since', String(opts.since));
        if (opts.protocol) query.set('protocol', opts.protocol);
        if (opts.endpointSuffix) query.set('endpoint', opts.endpointSuffix);
        const response = await fetch(`${rt.FIXTURE_BASE}/__captures?${query}`);
        const body = await response.json();
        return body.captures;
    },
    async count(opts = {}) {
        return (await this.captures(opts)).length;
    },
    async clear() {
        await fetch(`${rt.FIXTURE_BASE}/__captures/clear`, { method: 'POST' });
    },
    async setOverride(model, directive) {
        await fetch(`${rt.FIXTURE_BASE}/__ctl`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ overrides: { [model]: directive } }),
        });
    },
};
