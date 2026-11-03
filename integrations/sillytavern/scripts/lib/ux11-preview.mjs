// 多个桌面受管场景共用的合成宿主生命周期；退出即关闭，不访问运行实例。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export async function startPreview() {
    const server = spawn('python3', [path.join(ROOT, 'docs/product/v2-redesign/ux11/serve.py'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const url = await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => { server.kill(); reject(new Error('合成样板未启动')); }, 10000);
        server.once('error', error => { clearTimeout(timeout); reject(error); });
        server.once('exit', code => { clearTimeout(timeout); reject(new Error(`合成样板提前退出 ${code}`)); });
        server.stdout.on('data', chunk => {
            output += chunk;
            const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
            if (match) { clearTimeout(timeout); resolve(match[0]); }
        });
    });
    return { url, close: () => new Promise(resolve => { server.once('exit', resolve); server.kill(); }) };
}

export async function settle(page) {
    await page.waitForFunction(() => document.documentElement.dataset.previewReady === 'true');
    await page.evaluate(async () => {
        await document.fonts.ready;
        for (const animation of document.getAnimations()) if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
}
