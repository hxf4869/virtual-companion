// 本切片专用 ST config.yaml：输出 JSON（合法 YAML，ST 用 yaml.parse 读取），只显式声明与安全/锁定/数据目录有关的键；
// ST 首次启动用 lodash defaultsDeep 从 default/config.yaml 补齐其余键并以 yaml.stringify 重写（src/config-init.js）。
// 运行期回读统一复用 ST 锁定的 yaml 依赖（upstream/SillyTavern/node_modules/yaml，package-lock 固定），不自制解析器。
// 受管（managed）差异只经 enableServerPlugins 显式参数化：装载 server plugin；enableUserAccounts=true
// （Go 唯一身份在 ST app 级中间件核验并绑定到配置的本地 handle，不用 Authelia/Authentik 或客户端身份头），
// 并显式禁用 SSO 头自动登录；原生（S1）保持 enableUserAccounts=false。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { ST_DIR } from './paths.mjs';

export function buildConfigObject({ dataRoot, port, enableServerPlugins = false }) {
    const cfg = {
        dataRoot,
        listen: false,
        port,
        protocol: { ipv4: true, ipv6: false },
        browserLaunch: { enabled: false },
        whitelistMode: true,
        enableForwardedWhitelist: true,
        whitelist: ['127.0.0.1', '::1'],
        whitelistDockerHosts: false,
        basicAuthMode: false,
        enableCorsProxy: false,
        enableUserAccounts: enableServerPlugins,
        disableCsrfProtection: false,
        securityOverride: false,
        allowKeysExposure: false,
        hostWhitelist: { enabled: false, scan: true, hosts: [] },
        enableServerPlugins,
        enableServerPluginsAutoUpdate: false,
        extensions: { enabled: true, autoUpdate: false, models: { autoDownload: false } },
        enableDownloadableTokenizers: false,
        backups: { allowFullDataBackup: true, chat: { enabled: true, checkIntegrity: true } },
        logging: { enableAccessLog: true, minLogLevel: 1 },
        heartbeatInterval: 0,
    };
    if (!enableServerPlugins) return cfg;
    // 受管显式禁用 SSO 头自动登录（键名对齐 default/config.yaml 的 sso 段）；trustedProxies=[] 即不信任任何转发头来源
    return { ...cfg, sso: { autheliaAuth: false, authentikAuth: false, trustedProxies: [] } };
}

/** 原生（S1）安全不变量：start / status / 测试据此判断配置没有被削弱。 */
export const CONFIG_INVARIANTS = {
    listen: false,
    whitelistMode: true,
    basicAuthMode: false,
    enableCorsProxy: false,
    enableUserAccounts: false,
    disableCsrfProtection: false,
    securityOverride: false,
    allowKeysExposure: false,
    enableServerPlugins: false,
    enableServerPluginsAutoUpdate: false,
    'extensions.autoUpdate': false,
    'extensions.models.autoDownload': false,
    'browserLaunch.enabled': false,
    'backups.chat.enabled': true,
};

/** 受管（managed）不变量：在原生全部保护（CSRF、loopback、keys、自动更新等）之上覆盖 enableServerPlugins=true
 *  与 enableUserAccounts=true（Go 唯一身份经 ST 账户登录绑定本地 handle），并断言两种 SSO 头自动登录均禁用。 */
export const MANAGED_CONFIG_INVARIANTS = {
    ...CONFIG_INVARIANTS,
    enableServerPlugins: true,
    enableUserAccounts: true,
    'sso.autheliaAuth': false,
    'sso.authentikAuth': false,
};

/** JSON 文本即合法 YAML 1.2 文档。 */
export function renderConfig(opts) {
    return JSON.stringify(buildConfigObject(opts), null, 2) + '\n';
}

export function getPath(obj, dotted) {
    return dotted.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/** 返回违反不变量的列表（空数组 = 合规）；invariants 可传受管不变量表（受管差异显式参数化）。 */
export function checkInvariants(cfg, invariants = CONFIG_INVARIANTS) {
    const bad = [];
    for (const [k, want] of Object.entries(invariants)) {
        const got = getPath(cfg, k);
        if (got !== want) bad.push(`${k}=${JSON.stringify(got)}（要求 ${JSON.stringify(want)}）`);
    }
    const wl = cfg.whitelist;
    if (!Array.isArray(wl) || wl.length === 0 || wl.some((ip) => !['127.0.0.1', '::1'].includes(ip))) bad.push(`whitelist=${JSON.stringify(wl)}（只允许 loopback）`);
    return bad;
}

/** 用 ST 锁定的 yaml 依赖解析配置文件（JSON 或 ST 重写后的 YAML 均可）。 */
export async function loadConfig(file) {
    const yamlPkg = path.join(ST_DIR, 'node_modules', 'yaml');
    if (!fs.existsSync(yamlPkg)) throw new Error(`缺少 ST 锁定依赖 yaml（${yamlPkg}）；先运行 bootstrap`);
    const pkg = JSON.parse(fs.readFileSync(path.join(yamlPkg, 'package.json'), 'utf8'));
    const entry = pkg.exports?.['.']?.import ?? pkg.exports?.['.']?.default ?? pkg.module ?? pkg.main;
    const mod = await import(pathToFileURL(path.join(yamlPkg, typeof entry === 'string' ? entry : entry.default)).href);
    const yaml = mod.default ?? mod;
    return yaml.parse(fs.readFileSync(file, 'utf8'));
}
