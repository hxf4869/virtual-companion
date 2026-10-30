// 路径约定（V2-W03-S1；V2-W03 受管装配扩展）。所有脚本只通过本模块定位目录，不写死个人机器路径。
// 可覆盖项（环境变量）：
//   VC_ST_DEV_DIR   开发运行目录（原生默认 integrations/sillytavern/dev，受管默认 integrations/sillytavern/dev-managed，均 gitignored）
//   VC_ST_PORT      ST 监听端口（原生默认 8742，受管默认 8752，仅 127.0.0.1）
//   VC_ST_MOCK_PORT 本地固定 provider 端口（默认 8743，仅 127.0.0.1）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INTEG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = path.resolve(INTEG, '..', '..');
export const UPSTREAM = path.join(INTEG, 'upstream');
export const ST_DIR = path.join(UPSTREAM, 'SillyTavern');
export const HELPER_DIR = path.join(UPSTREAM, 'JS-Slash-Runner');
export const EJS_DIR = path.join(UPSTREAM, 'ST-Prompt-Template');
export const MVU_DIR = path.join(UPSTREAM, 'MagVarUpdate');

export const UPSTREAM_LOCK = path.join(INTEG, 'upstream.lock.json');
export const VENDOR_LOCK = path.join(INTEG, 'vendor.lock.json');
export const PATCH_SPEC = path.join(INTEG, 'patches', 'helper-selfhost-runtime-assets.json');
export const MVU_PATCH_SPEC = path.join(INTEG, 'patches', 'mvu-current-message-lifecycle.json');

export const DEV = path.resolve(process.env.VC_ST_DEV_DIR || path.join(INTEG, 'dev'));
export const DATA_ROOT = path.join(DEV, 'data');
export const USER_DIR = path.join(DATA_ROOT, 'default-user');
export const EXT_DIR = path.join(USER_DIR, 'extensions');
export const RUN_DIR = path.join(DEV, 'run');
export const CONFIG_PATH = path.join(DEV, 'config.yaml');
export const DERIVED_MANIFEST = path.join(DEV, 'derived-manifest.json');
export const VENDOR_CACHE = path.resolve(process.env.VC_ST_VENDOR_CACHE || path.join(DEV, 'vendor-cache'));
export const ARTIFACTS = path.join(DEV, 'artifacts');

export const ST_PORT = Number(process.env.VC_ST_PORT || 8742);
export const MOCK_PORT = Number(process.env.VC_ST_MOCK_PORT || 8743);
export const ST_URL = `http://127.0.0.1:${ST_PORT}`;
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

// ---------- 受管（managed）运行装配：独立于原生 dev/，dataRoot 与运行副本都在 dev-managed/ 下 ----------
export const MANAGED_DEV = path.resolve(process.env.VC_ST_DEV_DIR || path.join(INTEG, 'dev-managed'));
export const MANAGED_DATA_ROOT = path.join(MANAGED_DEV, 'data');
export const MANAGED_USER_DIR = path.join(MANAGED_DATA_ROOT, 'default-user');
export const MANAGED_EXT_DIR = path.join(MANAGED_USER_DIR, 'extensions');
export const MANAGED_RUN_DIR = path.join(MANAGED_DEV, 'run');
export const MANAGED_CONFIG_PATH = path.join(MANAGED_DEV, 'config.yaml');
export const MANAGED_MANIFEST = path.join(MANAGED_DEV, 'derived-manifest.json');
/** ST 受管运行副本：源码树复制品 + node_modules 符号链接 + 核心补丁产物，可整体重建。 */
export const MANAGED_ST_RUN = path.join(MANAGED_DEV, 'st-run');
export const MANAGED_ST_PORT = Number(process.env.VC_ST_PORT || 8752);
export const MANAGED_ST_URL = `http://127.0.0.1:${MANAGED_ST_PORT}`;

/** 受管核心桥补丁规格（作用于运行副本，upstream/ 原始检出一律不改）。 */
export const CORE_PATCH_SPECS = [
    path.join(INTEG, 'patches', 'st-host-auth.json'),
    path.join(INTEG, 'patches', 'st-go-login-client.json'),
    path.join(INTEG, 'patches', 'st-client-f2.json'),
    path.join(INTEG, 'patches', 'st-f2-chats.json'),
    path.join(INTEG, 'patches', 'st-f2-characters.json'),
    path.join(INTEG, 'patches', 'st-f2-groups.json'),
    path.join(INTEG, 'patches', 'st-f2-data-maid.json'),
    path.join(INTEG, 'patches', 'st-f2-group-client.json'),
    path.join(INTEG, 'patches', 'st-f2-bookmarks-client.json'),
    path.join(INTEG, 'patches', 'st-f2-data-maid-client.json'),
    path.join(INTEG, 'patches', 'st-f2-extensions.json'),
    path.join(INTEG, 'patches', 'st-chat-completions-vc-bridge.json'),
    path.join(INTEG, 'patches', 'st-text-completions-vc-guard.json'),
    path.join(INTEG, 'patches', 'st-kobold-vc-guard.json'),
    path.join(INTEG, 'patches', 'st-koboldhorde-vc-guard.json'),
    path.join(INTEG, 'patches', 'st-novel-vc-guard.json'),
    path.join(INTEG, 'patches', 'st-memory-status-client.json'),
    path.join(INTEG, 'patches', 'st-util-stream-error-log.json'),
    path.join(INTEG, 'patches', 'st-fetch-wasm-realpath.json'),
];

/** 受管部署源：本仓库自有的 server plugin 与用户扩展（扩展部署必须排除 harness/）。 */
export const SERVER_PLUGIN_SRC = path.join(INTEG, 'server-plugin', 'virtual-companion');
export const EXTENSION_SRC = path.join(INTEG, 'extension', 'vc-model-settings');

export const VC_AEAD = path.join(REPO_ROOT, 'infra', 'db', 'backup', 'vc_aead.py');

// W08: independent MemoryCore service; source copies and persistent data never overlap.
export const MEMORYCORE_DIR = path.join(UPSTREAM, 'TencentDB-Agent-Memory');
export const MEMORYCORE_SERVICE_SRC = path.join(INTEG, 'memorycore-service');
export const MEMORYCORE_PATCH_INDEX = path.join(INTEG, 'patches/memorycore/index.json');
export const MANAGED_MEMORYCORE_RUN = path.join(MANAGED_DEV, 'memorycore-run');
export const MANAGED_MEMORYCORE_DATA = path.join(MANAGED_DEV, 'memorycore-data');
export const MEMORYCORE_PORT = Number(process.env.VC_MEMORYCORE_PORT || 8754);
