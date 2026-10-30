// 缩略图失败的离线复现：Jimp 的 WASM 解码器用 file:// 加载 node_modules 里的 .wasm。
// 受管装配把 node_modules 符号链接到运行副本之外，Node 又把 import.meta.url 解析成真实路径，
// 上游 fetch 补丁因此拒绝。补丁只额外放行该符号链接的真实目录，且仍只允许 .wasm。
// 数据根里的文件（包括 .wasm）必须继续拒绝。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applySpecToFile } from '../scripts/lib/patcher.mjs';
import { CORE_PATCH_SPECS, INTEG, ST_DIR } from '../scripts/lib/paths.mjs';

const SPEC_NAME = 'st-fetch-wasm-realpath.json';
const SPEC_PATH = path.join(INTEG, 'patches', SPEC_NAME);
const HERE = fileURLToPath(import.meta.url);
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

function runChild(mode) {
    const result = spawnSync(process.execPath, [HERE], {
        env: { ...process.env, VC_THUMB_FETCH_CHILD: mode },
        encoding: 'utf8',
        timeout: 120000,
    });
    const line = (result.stdout || '').split('\n').filter((row) => row.startsWith('VC_RESULT ')).at(-1);
    let payload = null;
    if (line) {
        payload = JSON.parse(line.slice('VC_RESULT '.length));
    }
    return { status: result.status, stderr: result.stderr || '', payload };
}

if (process.env.VC_THUMB_FETCH_CHILD === 'unpatched' || process.env.VC_THUMB_FETCH_CHILD === 'patched') {
    await runLayout(process.env.VC_THUMB_FETCH_CHILD);
} else {
    test('未打补丁时，node_modules 真实路径上的 wasm 被拒绝，缩略图生成失败', () => {
        const result = runChild('unpatched');
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.payload.wasmAllowed, false);
        assert.equal(result.payload.thumbnailPath, null);
        assert.match(result.payload.errors.join('\n'), /Requested file path is outside of the server directory/);
        assert.equal(result.payload.dataRootWasmAllowed, false);
        assert.equal(result.payload.dataRootPngAllowed, false);
        assert.equal(result.payload.httpStatus, 200);
        assert.equal(result.payload.httpMagic, '89504e47');
    });

    test('补丁只放行 node_modules 真实路径上的 .wasm，并生成 jpeg 缩略图', () => {
        assert.ok(fs.existsSync(SPEC_PATH), `缺少补丁规格 ${SPEC_NAME}`);
        assert.ok(CORE_PATCH_SPECS.some((file) => file.endsWith(SPEC_NAME)), '规格必须登记到 CORE_PATCH_SPECS');
        const result = runChild('patched');
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.payload.wasmAllowed, true);
        assert.equal(result.payload.packageJsonAllowed, false);
        assert.equal(result.payload.dataRootWasmAllowed, false);
        assert.equal(result.payload.dataRootPngAllowed, false);
        assert.equal(result.payload.outsideWasmAllowed, false);
        assert.equal(result.payload.localWasmAllowed, true);
        assert.equal(result.payload.errors.join('\n').includes('Requested file path is outside of the server directory'), false);
        assert.ok(result.payload.thumbnailPath);
        assert.equal(result.payload.thumbnailMagic, 'ffd8');
        assert.notEqual(result.payload.thumbnailMagic, result.payload.originalMagic);
        assert.equal(result.payload.originalMagic, '89504e47');
        assert.equal(result.payload.httpStatus, 200);
        assert.equal(result.payload.httpMagic, 'ffd8');
    });
}

async function runLayout(mode) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-thumb-fetch-'));
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => {
        errors.push(args.map((item) => (item instanceof Error ? item.message : String(item))).join(' '));
        originalError(...args);
    };
    let exitCode = 1;
    try {
        const serverRoot = path.join(tmp, 'st-run');
        const dataRoot = path.join(tmp, 'data');
        fs.cpSync(path.join(ST_DIR, 'src'), path.join(serverRoot, 'src'), { recursive: true });
        if (mode === 'patched') {
            const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
            applySpecToFile(path.join(ST_DIR, 'src', 'fetch-patch.js'), path.join(serverRoot, 'src', 'fetch-patch.js'), spec);
        }
        fs.symlinkSync(path.join(ST_DIR, 'node_modules'), path.join(serverRoot, 'node_modules'), 'dir');
        const configPath = path.join(tmp, 'config.yaml');
        fs.writeFileSync(configPath, '{}\n');
        const characters = path.join(dataRoot, 'characters');
        const thumbs = path.join(dataRoot, 'thumbnails', 'avatar');
        fs.mkdirSync(characters, { recursive: true });
        fs.mkdirSync(thumbs, { recursive: true });
        const avatar = path.join(characters, 'face.png');
        fs.writeFileSync(avatar, PNG);
        const outsideWasm = path.join(tmp, 'outside.wasm');
        fs.writeFileSync(outsideWasm, Buffer.from('outside'));
        const dataWasm = path.join(dataRoot, 'secret.wasm');
        fs.writeFileSync(dataWasm, Buffer.from('secret'));

        const serverDirectoryModule = await import(pathToFileURL(path.join(serverRoot, 'src', 'server-directory.js')).href);
        const serverDirectory = serverDirectoryModule.serverDirectory;
        assert.equal(fs.realpathSync(serverDirectory), fs.realpathSync(serverRoot));
        assert.equal(path.relative(fs.realpathSync(serverRoot), fs.realpathSync(dataRoot)).startsWith('..'), true);
        // serverDirectory 来自 import.meta 的真实路径（macOS 上 /var → /private/var）。
        // 落在程序目录内的探针必须用这个路径，否则词法比较会把别名当成目录外。
        const localWasm = path.join(serverDirectory, 'local.wasm');
        fs.writeFileSync(localWasm, Buffer.from('local'));

        await import(pathToFileURL(path.join(serverRoot, 'src', 'fetch-patch.js')).href);
        const util = await import(pathToFileURL(path.join(serverRoot, 'src', 'util.js')).href);
        util.setConfigFilePath(configPath);
        const { generateThumbnail, publicRouter } = await import(pathToFileURL(path.join(serverRoot, 'src', 'endpoints', 'thumbnails.js')).href);
        const express = (await import(pathToFileURL(path.join(serverRoot, 'node_modules', 'express', 'index.js')).href)).default;

        const wasm = fs.realpathSync(path.join(serverRoot, 'node_modules', '@jsquash', 'png', 'codec', 'pkg', 'squoosh_png_bg.wasm'));
        const packageJson = fs.realpathSync(path.join(serverRoot, 'node_modules', 'mime-types', 'package.json'));
        const probes = {
            wasmAllowed: await allowed(wasm),
            packageJsonAllowed: await allowed(packageJson),
            dataRootWasmAllowed: await allowed(dataWasm),
            dataRootPngAllowed: await allowed(avatar),
            outsideWasmAllowed: await allowed(outsideWasm),
            localWasmAllowed: await allowed(localWasm),
        };
        const generated = await generateThumbnail({
            characters,
            thumbnailsAvatar: thumbs,
        }, 'avatar', 'face.png');
        const thumbBytes = generated.path ? fs.readFileSync(generated.path) : null;
        const directories = {
            characters,
            thumbnailsAvatar: thumbs,
            backgrounds: characters,
            thumbnailsBg: thumbs,
            avatars: characters,
            thumbnailsPersona: thumbs,
        };
        const app = express();
        app.use((req, _res, next) => {
            req.user = { directories };
            next();
        });
        app.use('/thumbnail', publicRouter);
        const server = await new Promise((resolve) => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        let httpStatus = 0;
        let httpMagic = null;
        try {
            const port = server.address().port;
            const response = await fetch(`http://127.0.0.1:${port}/thumbnail?type=avatar&file=face.png`);
            httpStatus = response.status;
            const body = Buffer.from(await response.arrayBuffer());
            httpMagic = body.subarray(0, body[0] === 0x89 ? 4 : 2).toString('hex');
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
        const payload = {
            ...probes,
            thumbnailPath: generated.path,
            thumbnailMagic: thumbBytes ? thumbBytes.subarray(0, 2).toString('hex') : null,
            originalMagic: PNG.subarray(0, 4).toString('hex'),
            httpStatus,
            httpMagic,
            errors,
        };
        process.stdout.write(`VC_RESULT ${JSON.stringify(payload)}\n`);
        exitCode = 0;
    } catch (error) {
        console.error(error && error.stack ? error.stack : error);
        exitCode = 1;
    } finally {
        console.error = originalError;
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    process.exit(exitCode);
}

async function allowed(file) {
    try {
        const response = await fetch(pathToFileURL(file));
        await response.arrayBuffer();
        return response.ok;
    } catch {
        return false;
    }
}
