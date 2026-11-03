// 固定输出目录，每次覆盖；仅将真实 bundle 所含第三方许可随资源自托管。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

const INTEGRATION = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT = path.join(INTEGRATION, 'extension/vc-model-settings/desktop/build');

export async function buildDesktop() {
    const checked = spawnSync(process.execPath, [path.join(INTEGRATION, 'node_modules/typescript/bin/tsc'), '--project', path.join(INTEGRATION, 'desktop-ui/tsconfig.json')], { stdio: 'inherit' });
    if (checked.error) throw checked.error;
    if (checked.status !== 0) throw new Error('桌面 TypeScript 检查失败，停止构建');
    const result = await build({ configFile: path.join(INTEGRATION, 'desktop-ui/vite.config.mjs') });
    const packages = new Set();
    for (const bundle of Array.isArray(result) ? result : [result]) for (const chunk of bundle.output) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules)) {
            if (!id.startsWith(path.join(INTEGRATION, 'node_modules/'))) continue;
            let directory = path.dirname(id.split('?')[0]);
            while (directory.includes(`${path.sep}node_modules${path.sep}`)) {
                if (fs.existsSync(path.join(directory, 'package.json'))) { packages.add(directory); break; }
                directory = path.dirname(directory);
            }
        }
    }
    const notices = [...packages].sort().map(directory => {
        const info = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
        const license = fs.readdirSync(directory).find(name => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name));
        if (!license) throw new Error(`缺少 bundle 依赖许可：${info.name}`);
        return `${info.name}@${info.version}\n\n${fs.readFileSync(path.join(directory, license), 'utf8')}`;
    });
    notices.push(fs.readFileSync(path.join(INTEGRATION, 'desktop-ui/THIRD_PARTY_LICENSES.txt'), 'utf8'));
    fs.writeFileSync(path.join(OUTPUT, 'THIRD_PARTY_NOTICES.txt'), `${notices.join('\n\n---\n\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildDesktop();
