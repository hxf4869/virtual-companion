import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { init, parse } from 'es-module-lexer';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ST_ROOT = path.resolve(__dirname, '..');
const DESKTOP_SRC_ROOT = path.join(ST_ROOT, 'desktop-ui', 'src');
const EXTENSION_ROOT = path.join(ST_ROOT, 'extension', 'vc-model-settings');

/**
 * Plan §2 扩展模块白名单（相对于 extension/vc-model-settings/）。
 * 电脑端 desktop-ui/src/**（bridge/ 除外）只允许直接或传递 import 下列模块。
 */
const EXACT_WHITELIST = new Set([
    // Plan §2 显式列出的扩展模块
    'settings-documents.js',
    'desktop/tavern-defaults.js',
    'desktop/tavern-fields.js',
    'desktop/themes/index.js',
    'desktop/tavern-controller.js',
    'api.js',
    'inbox-client.js',
    'account-logic.js',
    'model-logic.js',
    'conversations.js',
    'instance-queries.js',
    'companion-prompt.js',
    'companion-tools.js',
    'user-expressions.js',
    'prompt-history.js',
    'reply-pipeline.js',
    'reply-planner.js',
    'story-action.js',
    'story-context.js',
    'story-projection.js',
    'projection-save.js',
    'ui/icons.js',
    'ui/tint.js',
    // api.js 直接复用的内部依赖（本次核对确认保留）；注意该模块不是纯函数集合（含显式 DOM 通知函数 noteCompanionBound），本任务不改其行为
    'instance-binding.js',
    // Plan §1 表中全部 *-logic.js
    'chat-logic.js',
    'voice-logic.js',
    'stickers-logic.js',
    'f2-logic.js',
    'instance-logic.js',
    'memory-logic.js',
    'inbox-logic.js',
    'story-logic.js',
    'consent-logic.js',
    'theme-logic.js',
    'status-logic.js',
    'projection-logic.js',
    'memory-injection-logic.js',
    // Plan §2 desktop/standalone/** 允许集合
    'desktop/standalone/client.js',
    'desktop/standalone/business.js',
    'desktop/standalone/personas.js',
    'desktop/standalone/input-markdown.js',
    'desktop/standalone/runtime.js',
    'desktop/standalone/session.js',
]);

function toPosix(filePath) {
    return filePath.split(path.sep).join('/');
}

export function isWhitelistedExtensionModule(relPath) {
    const normalized = toPosix(relPath).replace(/^\/+/, '');
    if (EXACT_WHITELIST.has(normalized)) return true;
    if (normalized.startsWith('desktop/standalone/engine/')) return true;
    if (normalized.startsWith('desktop/standalone/cards/')) return true;
    return false;
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.css'];
const EXTENSION_RUNTIME_PREFIXES = [
    '/scripts/vc-runtime/',
    '/scripts/extensions/third-party/vc-model-settings/',
];

function resolveLocalSpecifier(fromFile, specifier, extensionRoot = EXTENSION_ROOT) {
    if (!specifier) return null;
    if (specifier === '/scripts/vc-runtime/source-identity.js') {
        return resolveFileCandidate(path.join(ST_ROOT, 'server-plugin', 'virtual-companion', 'lib', 'source-identity.js'));
    }
    for (const prefix of EXTENSION_RUNTIME_PREFIXES) {
        if (specifier.startsWith(prefix)) {
            const subPath = specifier.slice(prefix.length);
            return resolveFileCandidate(path.join(extensionRoot, subPath));
        }
    }
    if (!specifier.startsWith('.')) {
        return null;
    }
    const baseTarget = path.resolve(path.dirname(fromFile), specifier);
    return resolveFileCandidate(baseTarget);
}

function resolveFileCandidate(baseTarget) {
    if (fs.existsSync(baseTarget) && fs.statSync(baseTarget).isFile()) {
        return baseTarget;
    }
    for (const ext of RESOLVE_EXTENSIONS) {
        const withExt = `${baseTarget}${ext}`;
        if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
            return withExt;
        }
    }
    if (/\.[cm]?js$/.test(baseTarget)) {
        const stem = baseTarget.replace(/\.[cm]?js$/, '');
        for (const ext of ['.ts', '.tsx']) {
            if (fs.existsSync(`${stem}${ext}`) && fs.statSync(`${stem}${ext}`).isFile()) {
                return `${stem}${ext}`;
            }
        }
    }
    if (fs.existsSync(baseTarget) && fs.statSync(baseTarget).isDirectory()) {
        for (const ext of RESOLVE_EXTENSIONS) {
            const indexFile = path.join(baseTarget, `index${ext}`);
            if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
                return indexFile;
            }
        }
    }
    return baseTarget;
}

async function extractSpecifiers(filePath) {
    await (typeof init === 'function' ? init() : init);
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.css') return [];
    const source = fs.readFileSync(filePath, 'utf8');
    const specifiers = new Set();

    // TypeScript preProcessFile 捕获全部 import / export from / type import / dynamic import 字面量
    const preProcessed = ts.preProcessFile(source, true, true);
    for (const imported of preProcessed.importedFiles) {
        if (imported?.fileName) specifiers.add(imported.fileName);
    }

    // 转译为已编译 JSX 的普通 ESM JS 后交由 es-module-lexer 精确词法分析
    const transpiled = ext === '.ts' || ext === '.tsx'
        ? ts.transpileModule(source, {
            fileName: filePath,
            compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ESNext,
                jsx: ts.JsxEmit.ReactJSX,
                verbatimModuleSyntax: true,
            },
        }).outputText
        : source;

    const [imports] = parse(transpiled, filePath);
    for (const item of imports) {
        const spec = item.specifier ?? item.n;
        if (spec) {
            specifiers.add(spec);
        }
    }
    return [...specifiers];
}

/**
 * 递归分析入口模块的可达 import 图（默认根为 desktop-ui/src/app/main.tsx 真实应用入口，
 * 包含经本地中间模块与扩展内部模块的传递依赖）。
 */
export async function analyzeDesktopImportBoundary({
    entryFiles,
    desktopSrcRoot = DESKTOP_SRC_ROOT,
    extensionRoot = EXTENSION_ROOT,
} = {}) {
    const roots = entryFiles ?? [path.join(desktopSrcRoot, 'app', 'main.tsx')];
    const visited = new Set();
    const reachableExtensionModules = new Set();
    const violations = [];

    async function walk(currentFile, chain) {
        const normalizedCurrent = path.resolve(currentFile);
        if (!fs.existsSync(normalizedCurrent)) {
            violations.push({
                type: 'missing-module',
                target: normalizedCurrent,
                chain: [...chain, normalizedCurrent],
            });
            return;
        }
        if (visited.has(normalizedCurrent)) return;
        visited.add(normalizedCurrent);

        const specifiers = await extractSpecifiers(normalizedCurrent);
        for (const specifier of specifiers) {
            const resolved = resolveLocalSpecifier(normalizedCurrent, specifier, extensionRoot);
            if (!resolved) continue;

            const nextChain = [...chain, resolved];
            if (!fs.existsSync(resolved)) {
                violations.push({
                    type: 'unresolved-import',
                    specifier,
                    target: resolved,
                    chain: nextChain,
                });
                continue;
            }

            const relToDesktop = toPosix(path.relative(desktopSrcRoot, resolved));
            if (relToDesktop === 'bridge' || relToDesktop.startsWith('bridge/')) {
                violations.push({
                    type: 'forbidden-bridge-import',
                    specifier,
                    target: relToDesktop,
                    chain: nextChain,
                });
                continue;
            }

            const relToExtension = toPosix(path.relative(extensionRoot, resolved));
            const insideExtension = !relToExtension.startsWith('..') && !path.isAbsolute(relToExtension);
            if (insideExtension) {
                reachableExtensionModules.add(relToExtension);
                if (!isWhitelistedExtensionModule(relToExtension)) {
                    violations.push({
                        type: 'non-whitelisted-extension-module',
                        specifier,
                        target: relToExtension,
                        chain: nextChain,
                    });
                    continue;
                }
            }

            await walk(resolved, nextChain);
        }
    }

    for (const entry of roots) {
        const resolvedEntry = path.resolve(entry);
        const relToDesktop = toPosix(path.relative(desktopSrcRoot, resolvedEntry));
        if (relToDesktop === 'bridge' || relToDesktop.startsWith('bridge/')) {
            continue;
        }
        await walk(resolvedEntry, [resolvedEntry]);
    }

    return {
        visited: [...visited],
        reachableExtensionModules: [...reachableExtensionModules].sort(),
        violations,
    };
}

test('desktop-ui 应用真实可达 import 图（排除 bridge/）全部落在第 2 节白名单内', async () => {
    const mainEntry = path.join(DESKTOP_SRC_ROOT, 'app', 'main.tsx');
    const t2AdditionalRoots = [
        path.join(DESKTOP_SRC_ROOT, 'app', 'providers.tsx'),
        path.join(DESKTOP_SRC_ROOT, 'data', 'client.ts'),
        path.join(DESKTOP_SRC_ROOT, 'data', 'queryKeys.ts'),
    ];
    for (const file of [mainEntry, ...t2AdditionalRoots]) {
        assert.equal(fs.existsSync(file), true, `缺少应用模块: ${path.relative(ST_ROOT, file)}`);
    }

    // 1. 默认根：真实应用入口 app/main.tsx
    const defaultResult = await analyzeDesktopImportBoundary();
    assert.deepEqual(defaultResult.violations, []);
    assert.ok(defaultResult.visited.includes(mainEntry));

    // 2. 加上 T2 暂未接入 main.tsx 的 Provider / 数据客户端额外根
    const result = await analyzeDesktopImportBoundary({
        entryFiles: [mainEntry, ...t2AdditionalRoots],
    });
    assert.deepEqual(result.violations, []);
    assert.ok(
        result.reachableExtensionModules.includes('desktop/standalone/client.js'),
        'data/client.ts 应复用 desktop/standalone/client.js',
    );
    assert.ok(
        result.reachableExtensionModules.includes('api.js'),
        'data/client.ts 应复用 extension/vc-model-settings/api.js',
    );
});

test('f2-logic.js 与 projection-logic.js 纯函数拆分后无违规依赖且原模块保持同等导出', async () => {
    const f2LogicPath = path.join(EXTENSION_ROOT, 'f2-logic.js');
    const projectionLogicPath = path.join(EXTENSION_ROOT, 'projection-logic.js');
    assert.equal(fs.existsSync(f2LogicPath), true, '缺少 f2-logic.js');
    assert.equal(fs.existsSync(projectionLogicPath), true, '缺少 projection-logic.js');

    const logicBoundary = await analyzeDesktopImportBoundary({
        entryFiles: [f2LogicPath, projectionLogicPath],
    });
    assert.deepEqual(logicBoundary.violations, []);

    const f2Logic = await import('../extension/vc-model-settings/f2-logic.js');
    const f2Client = await import('../extension/vc-model-settings/f2-client.js');
    const requiredF2Names = [
        'F2ConflictError',
        'characterChatPath',
        'groupChatPath',
        'createF2Client',
        'extractUnsavedUserInput',
        'mergeInput',
        'createSourceGuard',
    ];
    for (const name of requiredF2Names) {
        assert.equal(typeof f2Logic[name], 'function', `f2-logic.js 应导出 ${name}`);
        assert.equal(f2Client[name], f2Logic[name], `f2-client.js 应 re-export f2-logic.js 的 ${name}`);
    }

    const projectionLogic = await import('../extension/vc-model-settings/projection-logic.js');
    const projection = await import('../extension/vc-model-settings/projection.js');
    const requiredProjectionNames = [
        'MARKER_SCHEME',
        'FOREGROUND_PURPOSE',
        'buildBindingMarker',
        'parseBindingMarker',
        'sameMarkerIdentity',
        'buildScope',
        'characterKeyOf',
        'chatKeyOf',
        'isToolContinuation',
        'advanceRunState',
        'resetRunState',
        'NATIVE_REASONING_EFFORTS',
        'reasoningEffortWritePlan',
        'ineligibleReasonLabel',
        'resolveForegroundProjection',
        'settingsMarkerFor',
        'diffProjection',
        'DRIFT_FIELD_LABELS',
        'driftSummary',
        'rewriteGenerateData',
        'restoreManagedReasoningEffort',
        'BANNER_TEST_NOTE',
        'bannerModel',
    ];
    for (const name of requiredProjectionNames) {
        assert.ok(name in projectionLogic, `projection-logic.js 应导出 ${name}`);
        assert.equal(projection[name], projectionLogic[name], `projection.js 应 re-export projection-logic.js 的 ${name}`);
    }
});

test('边界检查能识别直接违规、经本地中间模块的传递违规与 bridge 引用，且排除 bridge 自身构建入口', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-boundary-test-'));
    try {
        const fakeSrc = path.join(tmpDir, 'desktop-ui', 'src');
        const fakeExt = path.join(tmpDir, 'extension', 'vc-model-settings');
        fs.mkdirSync(path.join(fakeSrc, 'app'), { recursive: true });
        fs.mkdirSync(path.join(fakeSrc, 'data'), { recursive: true });
        fs.mkdirSync(path.join(fakeSrc, 'bridge'), { recursive: true });
        fs.mkdirSync(path.join(fakeExt, 'ui'), { recursive: true });

        fs.writeFileSync(path.join(fakeExt, 'api.js'), 'export const ok = true;\n');
        fs.writeFileSync(path.join(fakeExt, 'f2-client.js'), 'export const legacy = true;\n');
        fs.writeFileSync(path.join(fakeExt, 'ui', 'sheet.js'), 'export function openSheet() {}\n');

        // bridge/ 自身即使引用旧模块，作为排除目录不应被当作应用入口报错
        const bridgeEntry = path.join(fakeSrc, 'bridge', 'index.tsx');
        fs.writeFileSync(
            bridgeEntry,
            "import { openSheet } from '../../../extension/vc-model-settings/ui/sheet.js';\nexport { openSheet };\n",
        );

        // 1. 直接违规：app/direct.tsx -> extension/vc-model-settings/f2-client.js
        const directEntry = path.join(fakeSrc, 'app', 'direct.tsx');
        fs.writeFileSync(
            directEntry,
            "import { legacy } from '../../../extension/vc-model-settings/f2-client.js';\nexport function DirectView() { return <div>{String(legacy)}</div>; }\n",
        );

        // 2. 经本地中间模块的传递违规：app/main.tsx -> data/mid1.ts -> data/mid2.ts -> extension/vc-model-settings/ui/sheet.js
        fs.writeFileSync(
            path.join(fakeSrc, 'data', 'mid2.ts'),
            "import { openSheet } from '../../../extension/vc-model-settings/ui/sheet.js';\nexport const s = openSheet;\n",
        );
        fs.writeFileSync(
            path.join(fakeSrc, 'data', 'mid1.ts'),
            "export { s } from './mid2';\n",
        );
        const mainEntry = path.join(fakeSrc, 'app', 'main.tsx');
        fs.writeFileSync(
            mainEntry,
            "import { ok } from '../../../extension/vc-model-settings/api.js';\nimport { s } from '../data/mid1';\nexport const b = [ok, s];\n",
        );

        // 3. 非 bridge 模块引用 bridge/ 违规
        const useBridgeEntry = path.join(fakeSrc, 'app', 'useBridge.tsx');
        fs.writeFileSync(
            useBridgeEntry,
            "import { openSheet } from '../bridge/index';\nexport const c = openSheet;\n",
        );

        const report = await analyzeDesktopImportBoundary({
            entryFiles: [mainEntry, directEntry, useBridgeEntry, bridgeEntry],
            desktopSrcRoot: fakeSrc,
            extensionRoot: fakeExt,
        });

        const targets = report.violations.map((v) => `${v.type}:${v.target}`).sort();
        assert.deepEqual(targets, [
            'forbidden-bridge-import:bridge/index.tsx',
            'non-whitelisted-extension-module:f2-client.js',
            'non-whitelisted-extension-module:ui/sheet.js',
        ]);
        const transitiveViolation = report.violations.find((v) => v.target === 'ui/sheet.js');
        assert.equal(transitiveViolation.chain.length, 4, '应完整记录 main -> mid1 -> mid2 -> ui/sheet.js 传递链');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('/scripts/extensions/third-party/vc-model-settings/ 前缀与 /scripts/vc-runtime/ 一致纳入白名单与传递违规检查，且不扩大到其它第三方扩展', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-boundary-runtime-prefix-'));
    try {
        const fakeSrc = path.join(tmpDir, 'desktop-ui', 'src');
        const fakeExt = path.join(tmpDir, 'extension', 'vc-model-settings');
        fs.mkdirSync(path.join(fakeSrc, 'app'), { recursive: true });
        fs.mkdirSync(path.join(fakeSrc, 'data'), { recursive: true });
        fs.mkdirSync(path.join(fakeSrc, 'bridge'), { recursive: true });
        fs.mkdirSync(path.join(fakeExt, 'ui'), { recursive: true });

        fs.writeFileSync(path.join(fakeExt, 'api.js'), 'export const ok = true;\n');
        // 白名单模块内部经 /scripts/extensions/third-party/vc-model-settings/ 传递引入非白名单模块
        fs.writeFileSync(
            path.join(fakeExt, 'inbox-client.js'),
            "import { openSheet } from '/scripts/extensions/third-party/vc-model-settings/ui/sheet.js';\nexport const badTransitive = openSheet;\n",
        );
        fs.writeFileSync(path.join(fakeExt, 'f2-client.js'), 'export const legacy = true;\n');
        fs.writeFileSync(path.join(fakeExt, 'ui', 'sheet.js'), 'export function openSheet() {}\n');

        // bridge/ 入口通过静态路径引用旧模块，仍应被排除
        const bridgeEntry = path.join(fakeSrc, 'bridge', 'index.tsx');
        fs.writeFileSync(
            bridgeEntry,
            "import { openSheet } from '/scripts/extensions/third-party/vc-model-settings/ui/sheet.js';\nexport { openSheet };\n",
        );

        // 1. 合法白名单引用 + 其它第三方扩展静态路径（不应被当成 vc-model-settings 解析报错）
        const cleanEntry = path.join(fakeSrc, 'app', 'clean.tsx');
        fs.writeFileSync(
            cleanEntry,
            [
                "import { ok as okRuntime } from '/scripts/vc-runtime/api.js';",
                "import { ok as okThirdParty } from '/scripts/extensions/third-party/vc-model-settings/api.js';",
                "import '/scripts/extensions/third-party/other-extension/index.js';",
                'export const clean = [okRuntime, okThirdParty];',
            ].join('\n'),
        );

        const cleanReport = await analyzeDesktopImportBoundary({
            entryFiles: [cleanEntry, bridgeEntry],
            desktopSrcRoot: fakeSrc,
            extensionRoot: fakeExt,
        });
        assert.deepEqual(cleanReport.violations, []);
        assert.deepEqual(cleanReport.reachableExtensionModules, ['api.js']);

        // 2. 直接违规与传递违规（含本地中间模块与扩展内传递）
        const directThirdPartyViolation = path.join(fakeSrc, 'app', 'directThirdParty.tsx');
        fs.writeFileSync(
            directThirdPartyViolation,
            "import { legacy } from '/scripts/extensions/third-party/vc-model-settings/f2-client.js';\nexport const d = legacy;\n",
        );

        fs.writeFileSync(
            path.join(fakeSrc, 'data', 'hop.ts'),
            "export { badTransitive } from '/scripts/extensions/third-party/vc-model-settings/inbox-client.js';\n",
        );
        const transitiveThirdPartyViolation = path.join(fakeSrc, 'app', 'transitiveThirdParty.tsx');
        fs.writeFileSync(
            transitiveThirdPartyViolation,
            "import { badTransitive } from '../data/hop';\nexport const t = badTransitive;\n",
        );

        const violationReport = await analyzeDesktopImportBoundary({
            entryFiles: [directThirdPartyViolation, transitiveThirdPartyViolation, bridgeEntry],
            desktopSrcRoot: fakeSrc,
            extensionRoot: fakeExt,
        });

        const targets = violationReport.violations.map((v) => `${v.type}:${v.target}`).sort();
        assert.deepEqual(targets, [
            'non-whitelisted-extension-module:f2-client.js',
            'non-whitelisted-extension-module:ui/sheet.js',
        ]);
        const sheetViolation = violationReport.violations.find((v) => v.target === 'ui/sheet.js');
        assert.equal(
            sheetViolation.chain.length,
            4,
            '应完整记录 transitiveThirdParty.tsx -> data/hop.ts -> inbox-client.js -> ui/sheet.js 传递链',
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
