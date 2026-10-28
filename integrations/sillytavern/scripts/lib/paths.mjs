// 路径约定（V2-W03-S1）。所有脚本只通过本模块定位目录，不写死个人机器路径。
// 可覆盖项（环境变量）：
//   VC_ST_DEV_DIR   本切片专用开发运行目录（默认 integrations/sillytavern/dev，gitignored）
//   VC_ST_PORT      ST 监听端口（默认 8742，仅 127.0.0.1）
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

export const DEV = path.resolve(process.env.VC_ST_DEV_DIR || path.join(INTEG, 'dev'));
export const DATA_ROOT = path.join(DEV, 'data');
export const USER_DIR = path.join(DATA_ROOT, 'default-user');
export const EXT_DIR = path.join(USER_DIR, 'extensions');
export const RUN_DIR = path.join(DEV, 'run');
export const CONFIG_PATH = path.join(DEV, 'config.yaml');
export const DERIVED_MANIFEST = path.join(DEV, 'derived-manifest.json');
export const VENDOR_CACHE = path.join(DEV, 'vendor-cache');
export const ARTIFACTS = path.join(DEV, 'artifacts');

export const ST_PORT = Number(process.env.VC_ST_PORT || 8742);
export const MOCK_PORT = Number(process.env.VC_ST_MOCK_PORT || 8743);
export const ST_URL = `http://127.0.0.1:${ST_PORT}`;
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

export const VC_AEAD = path.join(REPO_ROOT, 'infra', 'db', 'backup', 'vc_aead.py');
