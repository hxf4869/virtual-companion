#!/usr/bin/env node
// V2-W05 受管状态：只读汇报受管实例（进程/端口、登录入口 /auth/ 健康与账号映射配置与否、Go 桥接环境、
// 核心补丁与部署完整性、受管配置不变量、ST 依赖树、dataRoot 权限）。只输出 JSON，不打印任何密钥或账号映射值。
import fs from 'node:fs';
import path from 'node:path';
import {
    MANAGED_DEV, MANAGED_DATA_ROOT, MANAGED_USER_DIR, MANAGED_RUN_DIR, MANAGED_CONFIG_PATH,
    MANAGED_ST_RUN, MANAGED_ST_PORT, MANAGED_ST_URL,
} from './lib/paths.mjs';
import { isPidAlive, looseEntries } from './lib/util.mjs';
import { loadConfig, checkInvariants, MANAGED_CONFIG_INVARIANTS } from './lib/config.mjs';
import { verifyStDependencyTree, verifyNativeRuntime } from './lib/verify.mjs';
import { verifyCorePatches, verifyManagedDeployment, requireManagedGoEnv } from './lib/managed.mjs';

const out = { mode: 'managed', managed_dev: MANAGED_DEV, assemble_ok: fs.existsSync(path.join(MANAGED_DEV, 'assemble-ok')) };
const mode = (p) => { try { return (fs.statSync(p).mode & 0o777).toString(8).padStart(4, '0'); } catch { return null; } };

const pidFile = path.join(MANAGED_RUN_DIR, 'st.pid');
const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8').trim()) : null;
out.st = { pid, alive: pid ? isPidAlive(pid) : false, port: MANAGED_ST_PORT };
// 登录入口健康只读 /auth/（/version 已受登录保护，未认证 401 不算不健康）
try {
    const r = await fetch(`${MANAGED_ST_URL}/auth/`);
    const ct = r.headers.get('content-type') || '';
    out.st.auth = { ready: r.ok && ct.includes('text/html'), http: r.status, content_type: ct.split(';')[0] || null };
} catch (e) { out.st.auth = { ready: false, error: String(e.cause?.code || e.message) }; }

// Go 桥接环境只汇报配置与否与问题（问题为静态说明），不输出任何值；账号映射只报 configured 布尔
const goEnv = requireManagedGoEnv();
out.go_env = { ok: goEnv.ok, base_url: goEnv.baseUrl || null, token_configured: Boolean(process.env.VC_ST_PLUGIN_SERVICE_TOKEN), timeout_ms_configured: Boolean(process.env.VC_ST_GO_TIMEOUT_MS), mapping_configured: Boolean(goEnv.accountHandles), problems: goEnv.problems };

out.st_run = { path: MANAGED_ST_RUN, node_modules_symlink: (() => { try { return fs.readlinkSync(path.join(MANAGED_ST_RUN, 'node_modules')); } catch { return null; } })() };
out.core_patches = verifyCorePatches({});
out.deployment = verifyManagedDeployment({});
out.native_runtime = verifyNativeRuntime(MANAGED_USER_DIR);

if (fs.existsSync(MANAGED_CONFIG_PATH)) {
    try {
        const cfg = await loadConfig(MANAGED_CONFIG_PATH);
        out.config = { data_root_matches: cfg.dataRoot === MANAGED_DATA_ROOT, invariant_violations: checkInvariants(cfg, MANAGED_CONFIG_INVARIANTS) };
    } catch (e) { out.config = { error: e.message }; }
}
try { out.st_dependency_tree = verifyStDependencyTree(); } catch (e) { out.st_dependency_tree = { error: e.message }; }

if (fs.existsSync(MANAGED_DATA_ROOT)) {
    const le = looseEntries(MANAGED_DATA_ROOT, 10);
    out.permissions = {
        managed_dev: mode(MANAGED_DEV), data_root: mode(MANAGED_DATA_ROOT), user_dir: mode(MANAGED_USER_DIR), config: mode(MANAGED_CONFIG_PATH),
        settings_json: mode(path.join(MANAGED_USER_DIR, 'settings.json')), secrets_json: mode(path.join(MANAGED_USER_DIR, 'secrets.json')),
        tree_entries: le.total, loose_entries: le.loose,
    };
}
console.log(JSON.stringify(out, null, 2));
