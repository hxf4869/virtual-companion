import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RERANK_GGUF, RERANK_IMAGE } from '../../memorycore-service/rerank.mjs';

const SERVER_ARGS = ['-t', '4', '-c', '8192', '-b', '2048', '-ub', '2048', '--reranking', '--pooling', 'rank', '-ngl', '0', '--fit', 'off', '--no-op-offload'];
let warnedOldModelDir = false;

export function resetRerankDirWarning() {
    warnedOldModelDir = false;
}

export function rerankRuntime(env = process.env, warn = console.warn) {
    const port = Number(env.VC_RERANK_PORT || 11439);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid rerank port');
    const container = env.VC_RERANK_CONTAINER || 'vc-rerank';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error('Invalid rerank container name');
    let modelDir = env.VC_RERANK_MODELS_DIR;
    if (!modelDir && env.VC_RERANK_MODEL_DIR) {
        modelDir = env.VC_RERANK_MODEL_DIR;
        if (!warnedOldModelDir) {
            warnedOldModelDir = true;
            warn('VC_RERANK_MODEL_DIR 已改名为 VC_RERANK_MODELS_DIR，旧名仍可用');
        }
    }
    if (!modelDir) modelDir = path.join(os.homedir(), '.local/share/virtual-companion/rerank');
    return { port, container, modelDir, modelPath: path.join(modelDir, RERANK_GGUF.file), endpoint: `http://127.0.0.1:${port}` };
}

function docker(args) {
    const result = spawnSync('docker', args, { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'docker failed').trim());
    return (result.stdout || '').trim();
}

function sha256File(file) {
    const hash = createHash('sha256');
    const stream = fs.openSync(file, 'r');
    try {
        const buffer = Buffer.alloc(1024 * 1024);
        let read = 0;
        while ((read = fs.readSync(stream, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
    } finally {
        fs.closeSync(stream);
    }
    return hash.digest('hex');
}

function assertModel(modelPath) {
    const stat = fs.statSync(modelPath);
    if (!stat.isFile() || stat.size !== RERANK_GGUF.bytes) throw new Error('Rerank model file is missing or the wrong size');
    const stamp = `${modelPath}.sha256`;
    const recorded = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
    if (recorded === RERANK_GGUF.sha256) return;
    const digest = sha256File(modelPath);
    if (digest !== RERANK_GGUF.sha256) throw new Error('Rerank model SHA256 does not match the pinned GGUF');
    fs.writeFileSync(stamp, `${digest}\n`, { mode: 0o600 });
}

async function healthy(endpoint) {
    try {
        const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1000) });
        return response.ok;
    } catch {
        return false;
    }
}

function containerState(name) {
    const result = spawnSync('docker', ['inspect', '-f', '{{.State.Running}} {{json .HostConfig.PortBindings}} {{.Config.Image}}', name], { encoding: 'utf8' });
    if (result.status !== 0) return null;
    const [running, bindings, image] = result.stdout.trim().split(' ');
    return { running: running === 'true', bindings, image };
}

function bindingMatches(bindings, port) {
    try {
        const parsed = JSON.parse(bindings);
        const published = parsed['8080/tcp'];
        return Array.isArray(published) && published.some((item) => item.HostIp === '127.0.0.1' && item.HostPort === String(port));
    } catch {
        return false;
    }
}

async function waitHealthy(endpoint) {
    const started = Date.now();
    while (Date.now() - started < 120000) {
        if (await healthy(endpoint)) return;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('Rerank service did not become healthy');
}

// Starts the pinned llama.cpp reranker, or reuses a healthy container on the same loopback port.
export async function ensureRerankContainer(env = process.env) {
    const runtime = rerankRuntime(env);
    assertModel(runtime.modelPath);
    const state = containerState(runtime.container);
    if (state?.running && bindingMatches(state.bindings, runtime.port) && await healthy(runtime.endpoint)) {
        return { ...runtime, reused: true };
    }
    if (state) docker(['rm', '-f', runtime.container]);
    docker(['run', '-d', '--name', runtime.container, '-p', `127.0.0.1:${runtime.port}:8080`, '-v', `${runtime.modelDir}:/models:ro`, RERANK_IMAGE,
        '-m', `/models/${RERANK_GGUF.file}`, '--host', '0.0.0.0', '--port', '8080', ...SERVER_ARGS]);
    try {
        await waitHealthy(runtime.endpoint);
    } catch (error) {
        const logs = spawnSync('docker', ['logs', '--tail', '40', runtime.container], { encoding: 'utf8' });
        throw new Error(`${error.message}\n${(logs.stderr || logs.stdout || '').slice(-2000)}`);
    }
    return { ...runtime, reused: false };
}
