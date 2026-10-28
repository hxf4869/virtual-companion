#!/usr/bin/env node
// V2-W03-S1 status：只读汇报运行与保护状态（进程、端口、/version、dataRoot 权限、配置不变量、ST 依赖树、补丁/vendor 完整性）。
import fs from 'node:fs';
import path from 'node:path';
import { DEV, DATA_ROOT, USER_DIR, RUN_DIR, CONFIG_PATH, ST_URL, MOCK_PORT } from './lib/paths.mjs';
import { isPidAlive, looseEntries } from './lib/util.mjs';
import { loadConfig, checkInvariants } from './lib/config.mjs';
import { verifyStDependencyTree, verifyVendorTree, verifyPatchedDist, verifyNativeRuntime } from './lib/verify.mjs';

const out = { dev_dir: DEV, bootstrap_ok: fs.existsSync(path.join(DEV, 'bootstrap-ok')) };
const mode = (p) => { try { return (fs.statSync(p).mode & 0o777).toString(8).padStart(4, '0'); } catch { return null; } };

for (const name of ['st', 'mock']) {
    const f = path.join(RUN_DIR, `${name}.pid`);
    const pid = fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8').trim()) : null;
    out[name] = { pid, alive: pid ? isPidAlive(pid) : false };
}
try { const r = await fetch(`${ST_URL}/version`); out.st.version = r.ok ? await r.json() : { http: r.status }; } catch (e) { out.st.version = { error: String(e.cause?.code || e.message) }; }
try { const r = await fetch(`http://127.0.0.1:${MOCK_PORT}/__health`); out.mock.health = r.ok ? await r.json() : { http: r.status }; } catch (e) { out.mock.health = { error: String(e.cause?.code || e.message) }; }

if (fs.existsSync(DATA_ROOT)) {
    const le = looseEntries(DATA_ROOT, 10);
    out.permissions = {
        dev: mode(DEV), data_root: mode(DATA_ROOT), user_dir: mode(USER_DIR), config: mode(CONFIG_PATH),
        settings_json: mode(path.join(USER_DIR, 'settings.json')), secrets_json: mode(path.join(USER_DIR, 'secrets.json')), cookie_secret: mode(path.join(DATA_ROOT, 'cookie-secret.txt')),
        tree_entries: le.total, loose_entries: le.loose,
    };
}
if (fs.existsSync(CONFIG_PATH)) {
    try { const cfg = await loadConfig(CONFIG_PATH); out.config = { data_root_matches: cfg.dataRoot === DATA_ROOT, invariant_violations: checkInvariants(cfg) }; } catch (e) { out.config = { error: e.message }; }
}
try { out.st_dependency_tree = verifyStDependencyTree(); } catch (e) { out.st_dependency_tree = { error: e.message }; }
out.helper_patch = verifyPatchedDist();
out.vendor = verifyVendorTree();
out.native_runtime = verifyNativeRuntime();
console.log(JSON.stringify(out, null, 2));
