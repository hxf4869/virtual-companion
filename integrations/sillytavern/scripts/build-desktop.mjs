// 固定输出目录，每次覆盖；仅将真实 bundle 所含第三方许可随资源自托管。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { init, parse } from 'es-module-lexer';
import { build } from 'vite';
import { generateDesktopSource } from './lib/desktop-source.mjs';

await init();

const INTEGRATION = fileURLToPath(new URL('../', import.meta.url));
const BRIDGE_OUTPUT = path.join(INTEGRATION, 'extension/vc-model-settings/desktop/build');
const APP_OUTPUT = path.join(INTEGRATION, 'server-plugin/virtual-companion/desktop/app');
const MOBILE_OUTPUT = path.join(INTEGRATION, 'server-plugin/virtual-companion/mobile/app');

export const MOBILE_JS_GZIP_BUDGET = 300_000;
export const MOBILE_CSS_GZIP_BUDGET = 60_000;

function resolveMobileAssetPath(mobileAppDir, fromFile, rawHref) {
    const clean = String(rawHref || '').split(/[?#]/)[0];
    if (!clean) return null;
    if (clean.startsWith('/m/')) {
        return path.resolve(mobileAppDir, clean.slice('/m/'.length));
    }
    if (clean.startsWith('./') || clean.startsWith('../')) {
        return path.resolve(path.dirname(fromFile), clean);
    }
    if (!clean.startsWith('/') && !/^[a-z]+:/i.test(clean)) {
        return path.resolve(path.dirname(fromFile), clean);
    }
    return null;
}

export function verifyMobileBundleBudget(
    mobileAppDir = MOBILE_OUTPUT,
    {
        jsGzipBudget = MOBILE_JS_GZIP_BUDGET,
        cssGzipBudget = MOBILE_CSS_GZIP_BUDGET,
    } = {},
) {
    const rootDir = path.resolve(mobileAppDir);
    const indexHtmlPath = path.join(rootDir, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
        throw new Error(`缺少手机入口产物: ${indexHtmlPath}`);
    }
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    const jsQueue = [];
    const jsVisited = new Set();
    const cssVisited = new Set();

    for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
        const resolved = resolveMobileAssetPath(rootDir, indexHtmlPath, match[1]);
        if (resolved) jsQueue.push(resolved);
    }
    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
        const tag = match[0];
        const relMatch = tag.match(/\brel=["']([^"']+)["']/i);
        const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
        if (!relMatch || !hrefMatch) continue;
        const rel = relMatch[1].toLowerCase();
        const resolved = resolveMobileAssetPath(rootDir, indexHtmlPath, hrefMatch[1]);
        if (!resolved) continue;
        if (rel === 'modulepreload') {
            jsQueue.push(resolved);
        } else if (rel === 'stylesheet') {
            cssVisited.add(resolved);
        }
    }

    if (jsQueue.length === 0) {
        throw new Error(`手机入口 index.html 未包含可执行 JS 入口: ${indexHtmlPath}`);
    }

    while (jsQueue.length > 0) {
        const current = jsQueue.shift();
        if (jsVisited.has(current)) continue;
        if (!current.startsWith(rootDir + path.sep) || !fs.existsSync(current)) {
            throw new Error(`手机入口静态依赖缺失或越界: ${current}`);
        }
        const baseName = path.basename(current);
        if (/^runtime(?:-[A-Za-z0-9_-]+)?\.js$/.test(baseName)) {
            throw new Error(`手机首屏静态依赖图不得提前加载 standalone runtime.js (${baseName})`);
        }
        jsVisited.add(current);
        const code = fs.readFileSync(current, 'utf8');
        const [imports] = parse(code, current);
        for (const item of imports) {
            if (item.type !== 'static') continue;
            const specifier = item.specifier || '';
            if (
                specifier.includes('/desktop/standalone/runtime.js') ||
                /(?:^|\/)runtime(?:-[A-Za-z0-9_-]+)?\.js$/.test(specifier)
            ) {
                throw new Error(`手机首屏静态依赖图不得静态导入 standalone runtime.js (${specifier})`);
            }
            const nextFile = resolveMobileAssetPath(rootDir, current, specifier);
            if (nextFile && !jsVisited.has(nextFile)) {
                jsQueue.push(nextFile);
            }
        }
    }

    let jsGzipBytes = 0;
    for (const file of jsVisited) {
        jsGzipBytes += zlib.gzipSync(fs.readFileSync(file)).byteLength;
    }

    let cssGzipBytes = 0;
    for (const file of cssVisited) {
        if (!file.startsWith(rootDir + path.sep) || !fs.existsSync(file)) {
            throw new Error(`手机入口样式资源缺失或越界: ${file}`);
        }
        cssGzipBytes += zlib.gzipSync(fs.readFileSync(file)).byteLength;
    }

    if (jsGzipBytes > jsGzipBudget) {
        throw new Error(`手机首屏 JS gzip 体积 ${jsGzipBytes} bytes 超出预算 ${jsGzipBudget} bytes`);
    }
    if (cssGzipBytes > cssGzipBudget) {
        throw new Error(`手机首屏 CSS gzip 体积 ${cssGzipBytes} bytes 超出预算 ${cssGzipBudget} bytes`);
    }

    return {
        jsFiles: [...jsVisited].map(f => path.relative(rootDir, f).split(path.sep).join('/')),
        cssFiles: [...cssVisited].map(f => path.relative(rootDir, f).split(path.sep).join('/')),
        jsGzipBytes,
        cssGzipBytes,
    };
}

export async function buildDesktop() {
    const sourceNotices = await generateDesktopSource();
    const checked = spawnSync(process.execPath, [path.join(INTEGRATION, 'node_modules/typescript/bin/tsc'), '--project', path.join(INTEGRATION, 'desktop-ui/tsconfig.json')], { stdio: 'inherit' });
    if (checked.error) throw checked.error;
    if (checked.status !== 0) throw new Error('桌面 TypeScript 检查失败，停止构建');
    const results = [];
    for (const target of ['bridge', 'app', 'mobile']) {
        process.env.VC_DESKTOP_TARGET = target;
        results.push(await build({ configFile: path.join(INTEGRATION, 'desktop-ui/vite.config.mjs') }));
    }
    const mobileHtml = path.join(MOBILE_OUTPUT, 'mobile.html');
    if (fs.existsSync(mobileHtml)) {
        fs.renameSync(mobileHtml, path.join(MOBILE_OUTPUT, 'index.html'));
    }
    const packages = new Set();
    for (const result of results) {
        for (const bundle of Array.isArray(result) ? result : [result]) for (const chunk of bundle.output) {
            if (chunk.type !== 'chunk') continue;
            for (const id of Object.keys(chunk.modules)) {
                const clean = id.replace(/^\0/, '').split('?')[0];
                if (!clean.startsWith(path.join(INTEGRATION, 'node_modules/'))) continue;
                let directory = path.dirname(clean);
                while (directory.includes(`${path.sep}node_modules${path.sep}`)) {
                    const parent = path.dirname(directory);
                    const isPackageRoot =
                        path.basename(parent) === 'node_modules' ||
                        (path.basename(parent).startsWith('@') && path.basename(path.dirname(parent)) === 'node_modules');
                    const pkgPath = path.join(directory, 'package.json');
                    if (isPackageRoot && fs.existsSync(pkgPath) && JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name) {
                        packages.add(directory);
                        break;
                    }
                    directory = parent;
                }
            }
        }
    }
    const notices = [...packages].sort().map(directory => {
        const info = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
        const license = fs.readdirSync(directory).find(name => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name));
        let licensePath = license ? path.join(directory, license) : null;
        if (!licensePath && info.name?.startsWith('@ionic/') && info.license === 'MIT') {
            const ionicCoreLicense = path.join(path.dirname(directory), 'core', 'LICENSE');
            if (fs.existsSync(ionicCoreLicense)) {
                licensePath = ionicCoreLicense;
            }
        }
        if (!licensePath) throw new Error(`缺少 bundle 依赖许可：${info.name}`);
        return `${info.name}@${info.version}\n\n${fs.readFileSync(licensePath, 'utf8')}`;
    });
    notices.push(sourceNotices.trimEnd());
    notices.push(fs.readFileSync(path.join(INTEGRATION, 'desktop-ui/THIRD_PARTY_LICENSES.txt'), 'utf8'));
    const content = `${notices.join('\n\n---\n\n')}\n`;
    for (const dir of [BRIDGE_OUTPUT, APP_OUTPUT, MOBILE_OUTPUT]) {
        fs.writeFileSync(path.join(dir, 'THIRD_PARTY_NOTICES.txt'), content);
    }
    verifyMobileBundleBudget(MOBILE_OUTPUT);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv[2] === '--check-mobile-budget') {
        verifyMobileBundleBudget(process.argv[3] ? path.resolve(process.argv[3]) : MOBILE_OUTPUT);
    } else {
        await buildDesktop();
    }
}
