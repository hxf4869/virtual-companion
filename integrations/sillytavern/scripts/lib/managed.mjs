// 受管（managed）运行装配共享实现（V2-W03 运行装配 owner）：
//   - buildRunCopy：把 upstream/SillyTavern 源码树构建为最小可重放运行副本（st-run），应用两个核心桥补丁；
//   - deployManagedAssets：部署 server plugin（→ st-run/plugins/）与用户扩展（→ dataRoot extensions/，排除 harness/）；
//   - verifyCorePatches / verifyManagedDeployment / requireManagedGoEnv：assemble 落位、start 预检与 status 汇报共用同一校验。
// 原则：upstream/ 原始检出一律不改（补丁只写运行副本，输入/输出 SHA 硬校验）；派生目录整体重建，重跑逐字节一致。
import fs from 'node:fs';
import path from 'node:path';
import { sha256File, readJson, mkdirp, run, copyTree } from './util.mjs';
import { applySpecToFile, validateSpec } from './patcher.mjs';
import {
    INTEG, ST_DIR, UPSTREAM_LOCK, CORE_PATCH_SPECS, SERVER_PLUGIN_SRC, EXTENSION_SRC,
    MANAGED_DEV, MANAGED_ST_RUN, MANAGED_EXT_DIR,
} from './paths.mjs';
import { parseAccountHandles } from '../../server-plugin/virtual-companion/lib/host-auth.js';

/** 运行副本对 ST 源码树的顶层排除项：.git / node_modules（符号链接复用）/ data / backups / colab。 */
export const RUN_COPY_SKIP = ['.git', 'node_modules', 'data', 'backups', 'colab'];

/** 受管目录防线：受管 dataRoot 与运行副本绝不写进原生 S1 的默认 dev/ 目录（两者共用 VC_ST_DEV_DIR 覆盖时最危险的误用）。 */
export function assertManagedDevIsolated(managedDev = MANAGED_DEV) {
    const nativeDefault = path.join(INTEG, 'dev');
    if (path.resolve(managedDev) === nativeDefault) {
        throw new Error(`受管运行目录不能是原生 dev/（${nativeDefault}）：VC_ST_DEV_DIR 覆盖值指向了原生目录，会破坏 S1 原生链路数据`);
    }
}

/** 校验 ST upstream：HEAD 等于 upstream.lock.json 锁定 commit 且工作树干净（assemble 与 start 预检共用）。返回锁定 commit。 */
export function verifyStUpstreamClean({ stDir = ST_DIR, lock = readJson(UPSTREAM_LOCK) } = {}) {
    const c = lock.components.find((x) => x.id === 'sillytavern');
    if (!c) throw new Error('upstream.lock.json 缺 sillytavern 组件');
    const head = run('git', ['-C', stDir, 'rev-parse', 'HEAD']).trim();
    if (head !== c.commit) throw new Error(`upstream/sillytavern HEAD ${head} != 锁定 ${c.commit}`);
    const dirty = run('git', ['-C', stDir, 'status', '--porcelain']).trim();
    if (dirty) throw new Error(`upstream/sillytavern 工作树不干净：\n${dirty.slice(0, 400)}`);
    return c.commit;
}

/**
 * 构建 ST 受管运行副本：整体重建 runDir —— 复制源码树（顶层排除 RUN_COPY_SKIP）、
 * node_modules 用符号链接指向 upstream 树（bootstrap 已按锁定 package-lock 重建并校验）、
 * 对副本应用核心补丁（applySpecToFile：输入取 upstream 原文件并校验 expected_input_sha256，
 * 输出必须等于 expected_output_sha256，不匹配即抛错，不产出半成品）。
 * @returns 补丁结果列表 [{ id, spec, target, input_sha256, output_sha256, replacements }]
 */
export function buildRunCopy({ stDir = ST_DIR, runDir = MANAGED_ST_RUN, specs = CORE_PATCH_SPECS } = {}) {
    if (!Array.isArray(specs) || specs.length === 0) throw new Error('核心补丁规格列表为空');
    for (const specFile of specs) {
        const errors = validateSpec(readJson(specFile));
        if (errors.length) throw new Error(`补丁规格 ${path.basename(specFile)} 无效：${errors.join('；')}`);
    }
    fs.rmSync(runDir, { recursive: true, force: true });
    mkdirp(runDir, 0o700);
    // 顶层过滤复制（只排除 ST 根部的运行期/依赖目录，深层同名目录不受影响；upstream 树顶层无符号链接）
    for (const ent of fs.readdirSync(stDir, { withFileTypes: true })) {
        if (RUN_COPY_SKIP.includes(ent.name)) continue;
        const s = path.join(stDir, ent.name);
        const d = path.join(runDir, ent.name);
        if (ent.isDirectory()) copyTree(s, d);
        else if (ent.isFile()) { fs.copyFileSync(s, d); fs.chmodSync(d, 0o600); }
    }
    const nmSrc = path.join(stDir, 'node_modules');
    if (!fs.existsSync(nmSrc)) throw new Error(`缺少 ${nmSrc}：先运行 node scripts/bootstrap.mjs 按锁定 package-lock 重建依赖树`);
    fs.symlinkSync(nmSrc, path.join(runDir, 'node_modules'), 'dir');
    // 核心补丁：输入 = upstream 原文件（SHA 硬校验），输出 = 副本内同路径文件（SHA 硬校验）
    const patches = [];
    for (const specFile of specs) {
        const spec = readJson(specFile);
        const r = applySpecToFile(path.join(stDir, spec.target), path.join(runDir, spec.target), spec);
        patches.push({ id: spec.id, spec: path.basename(specFile), target: spec.target, input_sha256: r.inputSha256, output_sha256: r.outputSha256, replacements: r.report });
    }
    return patches;
}

/** 统计目录树内文件数（不含符号链接目标内容）。 */
function countFiles(root) {
    let n = 0;
    const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) walk(p);
            else if (ent.isFile()) n += 1;
        }
    };
    walk(root);
    return n;
}

/**
 * 部署受管资产（可重放派生物，整体重建）：
 *   server-plugin/virtual-companion → <runDir>/plugins/virtual-companion/（ST serverDirectory/plugins 装载点）；
 *   extension/vc-model-settings → <extDir>/vc-model-settings/（dataRoot 用户扩展目录，排除 harness/ 开发验收用具）。
 * @returns { plugin: { source, target, files }, extension: { source, target, excluded, files } }
 */
export function deployManagedAssets({ pluginSrc = SERVER_PLUGIN_SRC, extensionSrc = EXTENSION_SRC, runDir = MANAGED_ST_RUN, extDir = MANAGED_EXT_DIR } = {}) {
    const pluginDst = path.join(runDir, 'plugins', 'virtual-companion');
    fs.rmSync(pluginDst, { recursive: true, force: true });
    copyTree(pluginSrc, pluginDst, { skip: ['.git'] });
    const extDst = path.join(extDir, 'vc-model-settings');
    fs.rmSync(extDst, { recursive: true, force: true });
    copyTree(extensionSrc, extDst, { skip: ['.git', 'harness'] });
    // Native F2 is mandatory for every mapped profile, even without a user extension.
    const runtime = path.join(runDir, 'public/scripts/vc-runtime');
    mkdirp(runtime, 0o700);
    for (const name of ['f2-client.js', 'instance-binding.js']) {
        fs.copyFileSync(path.join(extensionSrc, name), path.join(runtime, name));
        fs.chmodSync(path.join(runtime, name), 0o600);
    }
    fs.copyFileSync(path.join(pluginSrc, 'lib/source-identity.js'), path.join(runtime, 'source-identity.js'));
    fs.chmodSync(path.join(runtime, 'source-identity.js'), 0o600);
    if (fs.existsSync(path.join(extDst, 'harness'))) throw new Error('harness/ 不应被部署进生产扩展目录');
    return {
        plugin: { source: pluginSrc, target: pluginDst, files: countFiles(pluginDst) },
        extension: { source: extensionSrc, target: extDst, excluded: ['harness'], files: countFiles(extDst) },
    };
}

/** 对比源目录与已部署目录的逐文件 SHA256（源为准，跳过 skip 列表中的顶层/任意层目录名）。返回差异描述列表。 */
function treeDiff(src, dst, skip) {
    const diffs = [];
    const walk = (s, d, rel) => {
        if (!fs.existsSync(d)) { diffs.push(`部署缺目录 ${rel}`); return; }
        for (const ent of fs.readdirSync(s, { withFileTypes: true })) {
            if (skip.includes(ent.name)) continue;
            const sp = path.join(s, ent.name);
            const dp = path.join(d, ent.name);
            const r = rel ? `${rel}/${ent.name}` : ent.name;
            if (ent.isDirectory()) walk(sp, dp, r);
            else if (ent.isFile()) {
                if (!fs.existsSync(dp)) diffs.push(`部署缺文件 ${r}`);
                else if (sha256File(sp) !== sha256File(dp)) diffs.push(`部署内容漂移 ${r}`);
            }
        }
    };
    walk(src, dst, '');
    return diffs;
}

/**
 * 核心补丁落位校验（start 预检 / status 汇报共用）：
 * upstream 原文件 SHA == expected_input_sha256（上游未漂移），运行副本文件 SHA == expected_output_sha256（补丁产物未被改动）。
 */
export function verifyCorePatches({ stDir = ST_DIR, runDir = MANAGED_ST_RUN, specs = CORE_PATCH_SPECS } = {}) {
    const problems = []; const patches = [];
    for (const specFile of specs) {
        const spec = readJson(specFile);
        const srcFile = path.join(stDir, spec.target);
        const dstFile = path.join(runDir, spec.target);
        const inSha = fs.existsSync(srcFile) ? sha256File(srcFile) : null;
        const outSha = fs.existsSync(dstFile) ? sha256File(dstFile) : null;
        if (inSha !== spec.expected_input_sha256) problems.push(`${spec.id}：upstream 输入 SHA 不匹配（实际 ${inSha ?? '文件不存在'}，规格 ${spec.expected_input_sha256}）`);
        if (outSha !== spec.expected_output_sha256) problems.push(`${spec.id}：运行副本输出 SHA 不匹配（实际 ${outSha ?? '文件不存在'}，规格 ${spec.expected_output_sha256}）`);
        patches.push({ id: spec.id, target: spec.target, input_ok: inSha === spec.expected_input_sha256, output_ok: outSha === spec.expected_output_sha256 });
    }
    return { ok: problems.length === 0, problems, patches };
}

/** 插件/扩展部署校验：关键文件在位、harness 未被部署、与仓库源逐文件一致（源为准）。 */
export function verifyManagedDeployment({ pluginSrc = SERVER_PLUGIN_SRC, extensionSrc = EXTENSION_SRC, runDir = MANAGED_ST_RUN, extDir = MANAGED_EXT_DIR } = {}) {
    const problems = [];
    const pluginDst = path.join(runDir, 'plugins', 'virtual-companion');
    const extDst = path.join(extDir, 'vc-model-settings');
    if (!fs.existsSync(path.join(pluginDst, 'index.js'))) problems.push(`server plugin 未部署：缺 ${path.relative(MANAGED_DEV, pluginDst)}/index.js`);
    if (!fs.existsSync(path.join(extDst, 'manifest.json'))) problems.push(`用户扩展未部署：缺 ${path.relative(MANAGED_DEV, extDst)}/manifest.json`);
    if (fs.existsSync(path.join(extDst, 'harness'))) problems.push('harness/ 被部署进生产扩展目录');
    problems.push(...treeDiff(pluginSrc, pluginDst, ['.git']).map((d) => `plugin ${d}`));
    problems.push(...treeDiff(extensionSrc, extDst, ['.git', 'harness']).map((d) => `extension ${d}`));
    for (const name of ['f2-client.js', 'instance-binding.js']) {
        const deployed = path.join(runDir, 'public/scripts/vc-runtime', name);
        if (!fs.existsSync(deployed) || sha256File(deployed) !== sha256File(path.join(extensionSrc, name))) problems.push(`native F2 部署缺失或漂移：${name}`);
    }
    const sourceRuntime = path.join(runDir, 'public/scripts/vc-runtime/source-identity.js');
    if (!fs.existsSync(sourceRuntime) || sha256File(sourceRuntime) !== sha256File(path.join(pluginSrc, 'lib/source-identity.js'))) problems.push('native 来源身份模块部署缺失或漂移');
    return { ok: problems.length === 0, problems };
}

/**
 * Go 桥接环境预检（start-managed 硬门槛）：VC_ST_GO_BASE_URL 与 VC_ST_PLUGIN_SERVICE_TOKEN（>=32 字节）
 * 必须存在且非空——受管宿主策略（补丁 reason：插件装载即受管，无标记显式拒绝），绝不静默降级回 ST 本地密钥。
 * VC_ST_ACCOUNT_HANDLES 必须解析为非空的 Go 账号→ST handle 映射（复用插件 host-auth 的 parseAccountHandles：
 * 账号为正整数 ID、handle 仅字母数字_- 且互不重复）；错误只给静态说明，绝不回显映射或密钥原始内容。
 */
export function requireManagedGoEnv(env = process.env) {
    const problems = [];
    const baseUrl = String(env.VC_ST_GO_BASE_URL || '').trim();
    const token = String(env.VC_ST_PLUGIN_SERVICE_TOKEN || '');
    if (!baseUrl) problems.push('VC_ST_GO_BASE_URL 缺失或为空（受管模式不回退 ST 本地密钥，硬失败）');
    if (!token) problems.push('VC_ST_PLUGIN_SERVICE_TOKEN 缺失或为空（受管模式不回退 ST 本地密钥，硬失败）');
    else if (Buffer.byteLength(token, 'utf8') < 32) problems.push(`VC_ST_PLUGIN_SERVICE_TOKEN 长度 ${Buffer.byteLength(token, 'utf8')} 字节 < 32`);
    let accountHandles;
    const rawHandles = String(env.VC_ST_ACCOUNT_HANDLES || '').trim();
    if (!rawHandles) problems.push('VC_ST_ACCOUNT_HANDLES 缺失或为空（Go 账号→ST handle 映射，受管登录必需）');
    else {
        try {
            accountHandles = parseAccountHandles(rawHandles);
            if (Object.keys(accountHandles).length === 0) {
                accountHandles = undefined;
                problems.push('VC_ST_ACCOUNT_HANDLES 是空映射（至少需要一条 Go 账号→ST handle 绑定）');
            }
        } catch {
            problems.push('VC_ST_ACCOUNT_HANDLES 无效（须为 Go 账号 ID→ST handle 的 JSON 对象：账号为正整数 ID，handle 仅字母数字与 _- 且互不重复；不回显原始内容）');
        }
    }
    return { ok: problems.length === 0, problems, baseUrl, accountHandles };
}
