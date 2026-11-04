// 固定输出目录，每次覆盖；仅将真实 bundle 所含第三方许可随资源自托管。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const INTEGRATION = fileURLToPath(new URL('../', import.meta.url));
const BRIDGE_OUTPUT = path.join(INTEGRATION, 'extension/vc-model-settings/desktop/build');
const APP_OUTPUT = path.join(INTEGRATION, 'server-plugin/virtual-companion/desktop/app');

export async function buildDesktop() {
    const checked = spawnSync(process.execPath, [path.join(INTEGRATION, 'node_modules/typescript/bin/tsc'), '--project', path.join(INTEGRATION, 'desktop-ui/tsconfig.json')], { stdio: 'inherit' });
    if (checked.error) throw checked.error;
    if (checked.status !== 0) throw new Error('桌面 TypeScript 检查失败，停止构建');
    const results = [];
    for (const target of ['bridge', 'app']) {
        process.env.VC_DESKTOP_TARGET = target;
        results.push(await build({ configFile: path.join(INTEGRATION, 'desktop-ui/vite.config.mjs') }));
    }
    const packages = new Set();
    const ejsUpstreamDir = path.join(INTEGRATION, 'upstream/ST-Prompt-Template');
    let hasEjsRuntime = false;
    let hasFaker = false;
    for (const result of results) {
        for (const bundle of Array.isArray(result) ? result : [result]) for (const chunk of bundle.output) {
            if (chunk.type !== 'chunk') continue;
            for (const id of Object.keys(chunk.modules)) {
                const clean = id.replace(/^\0/, '').split('?')[0];
                if (clean.startsWith(`${ejsUpstreamDir}${path.sep}`)) {
                    packages.add(ejsUpstreamDir);
                    hasEjsRuntime = true;
                    if (clean.endsWith(`${path.sep}libs${path.sep}faker.mjs`)) {
                        hasFaker = true;
                    }
                    continue;
                }
                if (!clean.startsWith(path.join(INTEGRATION, 'node_modules/'))) continue;
                let directory = path.dirname(clean);
                while (directory.includes(`${path.sep}node_modules${path.sep}`)) {
                    const pkgPath = path.join(directory, 'package.json');
                    if (fs.existsSync(pkgPath) && JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name) {
                        packages.add(directory);
                        break;
                    }
                    directory = path.dirname(directory);
                }
            }
        }
    }
    const notices = [...packages].sort().map(directory => {
        const info = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
        const license = fs.readdirSync(directory).find(name => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name));
        if (!license) throw new Error(`缺少 bundle 依赖许可：${info.name}`);
        return `${info.name}@${info.version}\n\n${fs.readFileSync(path.join(directory, license), 'utf8')}`;
    });
    if (hasEjsRuntime) {
        notices.push(
            [
                hasFaker
                    ? '@faker-js/faker@9.7.0 & unenv buffer (bundled in ST-Prompt-Template/libs/faker.mjs, MIT License)'
                    : null,
                'ST-Prompt-Template packaged dependencies (ejs Apache-2.0, acorn MIT, jsonrepair ISC, syntax-error MIT, xxhash-wasm MIT, zod MIT)',
            ]
                .filter(Boolean)
                .join('\n\n'),
        );
    }
    notices.push(fs.readFileSync(path.join(INTEGRATION, 'desktop-ui/THIRD_PARTY_LICENSES.txt'), 'utf8'));
    const content = `${notices.join('\n\n---\n\n')}\n`;
    for (const dir of [BRIDGE_OUTPUT, APP_OUTPUT]) {
        fs.writeFileSync(path.join(dir, 'THIRD_PARTY_NOTICES.txt'), content);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildDesktop();
