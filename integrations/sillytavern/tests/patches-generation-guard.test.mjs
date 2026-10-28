// W13-3：未受校验文本生成出口的集中补丁。
// 受管桥存在时，这些路由在联系上游前拒绝（固定错误码，不回显正文）；
// 桥不存在时钩子为空操作；补丁只写派生副本，锁定上游源码保持原字节。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applySpecToText, applySpecToFile, validateSpec } from '../scripts/lib/patcher.mjs';
import { sha256File } from '../scripts/lib/util.mjs';
import { CORE_PATCH_SPECS } from '../scripts/lib/paths.mjs';

const INTEG = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const UPSTREAM = path.join(INTEG, 'upstream', 'SillyTavern');
const PATCH_DIR = path.join(INTEG, 'patches');
const BRIDGE = Symbol.for('virtual-companion.bridge');
const PROMPT = 'VC_GUARD_PROMPT_MARKER';
const CODE = 'VC_UNVALIDATED_GENERATION';

/** 锁定 ST 1.19.0 上实际存在、且会把聊天/剧情提示词送出上游的独立路由。 */
const EXITS = [
    {
        id: 'st-text-completions-vc-guard',
        target: 'src/endpoints/backends/text-completions.js',
        route: '/generate',
        marker: "router.post('/generate', async function (request, response) {",
        emptyCheck: 'if (!request.body) return response.sendStatus(400);',
        call: 'guardUnmanagedGeneration(request, response)',
    },
    {
        id: 'st-kobold-vc-guard',
        target: 'src/endpoints/backends/kobold.js',
        route: '/generate',
        marker: "router.post('/generate', async function (request, response_generate) {",
        emptyCheck: 'if (!request.body) return response_generate.sendStatus(400);',
        call: 'guardUnmanagedGeneration(request, response_generate)',
    },
    {
        id: 'st-novel-vc-guard',
        target: 'src/endpoints/novelai.js',
        route: '/generate',
        marker: "router.post('/generate', async function (req, res) {",
        emptyCheck: 'if (!req.body) return res.sendStatus(400);',
        call: 'guardUnmanagedGeneration(req, res)',
    },
    {
        id: 'st-koboldhorde-vc-guard',
        target: 'src/endpoints/horde.js',
        route: '/generate-text',
        marker: "router.post('/generate-text', async (request, response) => {",
        emptyCheck: null,
        call: 'guardUnmanagedGeneration(request, response)',
    },
];

function specPath(exit) {
    return path.join(PATCH_DIR, `${exit.id}.json`);
}

function upstreamPath(exit) {
    return path.join(UPSTREAM, exit.target);
}

function readSpec(exit) {
    return JSON.parse(fs.readFileSync(specPath(exit), 'utf8'));
}

function handlerRegion(source, marker) {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `找不到路由锚点 ${marker}`);
    const next = source.indexOf('\nrouter.', start + marker.length);
    return source.slice(start, next === -1 ? source.length : next);
}

function insertedLines(from, to) {
    const fromLines = from.split('\n');
    const extra = [];
    let i = 0;
    for (const line of to.split('\n')) {
        if (i < fromLines.length && line === fromLines[i]) i += 1;
        else extra.push(line);
    }
    assert.equal(i, fromLines.length, '替换必须原样保留锚点的每一行');
    return extra;
}

function mockRes() {
    return {
        statusCode: 200,
        headers: {},
        body: '',
        headersSent: false,
        writableEnded: false,
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        send(payload) {
            this.body = typeof payload === 'string' ? payload : JSON.stringify(payload);
            this.headersSent = true;
            this.writableEnded = true;
            return this;
        },
        sendStatus(code) {
            this.statusCode = code;
            this.headersSent = true;
            this.writableEnded = true;
            return this;
        },
        end(payload = '') {
            this.body += payload;
            this.headersSent = true;
            this.writableEnded = true;
        },
    };
}

function mockReq(body) {
    return {
        body,
        headers: {},
        socket: { removeAllListeners() {}, on() {} },
        user: { directories: { root: '/tmp/vc-guard-user' } },
    };
}

const FILLED_BODY = {
    prompt: PROMPT,
    input: PROMPT,
    api_server: 'http://127.0.0.1:9',
    model: 'clio',
    api_type: 'GENERIC_UNMATCHED',
};

function stripLeadingImports(source) {
    const lines = source.split('\n');
    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('*/')) {
            i += 1;
            continue;
        }
        if (trimmed.startsWith('import ') || trimmed.startsWith('import{') || trimmed === 'import') {
            while (i < lines.length) {
                const current = lines[i];
                i += 1;
                if (/from\s+['"][^'"]+['"]\s*;?\s*$/.test(current) || /^\s*import\s+['"][^'"]+['"]\s*;?\s*$/.test(current)) break;
            }
            continue;
        }
        break;
    }
    return lines.slice(i).join('\n');
}

const PRELUDE = `
const __vcFetchCalls = [];
async function fetch(...args) {
    __vcFetchCalls.push(args);
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ ok: true }), text: async () => '', body: { on() {} } };
}
function createRouter() {
    const routes = [];
    const router = {
        post(routePath, ...fns) { routes.push({ path: routePath, handler: fns[fns.length - 1] }); return router; },
        use() { return router; },
        get() { return router; },
        routes,
    };
    return router;
}
const express = { Router: createRouter };
const _ = { pickBy: (obj) => obj };
const Readable = class {};
const TEXTGEN_TYPES = new Proxy({}, { get: (_target, key) => key });
const TOGETHERAI_KEYS = [];
const OLLAMA_KEYS = [];
const INFERMATICAI_KEYS = [];
const OPENROUTER_KEYS = [];
const VLLM_KEYS = [];
const FEATHERLESS_KEYS = [];
const OPENAI_KEYS = [];
function forwardFetchResponse() {}
function trimV1(value) { return String(value ?? '').replace(/\\/v1\\/?$/, ''); }
function getConfigValue() { return -1; }
function setAdditionalHeaders() {}
function getOverrideHeaders() { return {}; }
function setAdditionalHeadersByType() {}
const fs = { readFileSync() { return ''; }, existsSync() { return false; } };
const util = { inspect: (value) => String(value) };
const Buffer = globalThis.Buffer;
function readSecret() { return 'synthetic-token'; }
const SECRET_KEYS = new Proxy({}, { get: (_target, key) => key });
function readAllChunks() {}
function extractFileFromZipBuffer() {}
class AIHorde {}
const ModelGenerationInputStableSamplers = {};
const ModelInterrogationFormTypes = {};
const HordeAsyncRequestStates = {};
async function getVersion() { return { agent: 'test' }; }
function delay() {}
class Cache { constructor() {} }
function createHash() { return { update() { return this; }, digest() { return '00'; } }; }
`;

async function loadPatched(source) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-gen-guard-'));
    const file = path.join(dir, 'route.mjs');
    fs.writeFileSync(file, `${PRELUDE}\n${stripLeadingImports(source)}\nexport { __vcFetchCalls };\n`);
    const mod = await import(pathToFileURL(file).href);
    return { mod, dir };
}

function withBridge(bridge, fn) {
    const previous = globalThis[BRIDGE];
    globalThis[BRIDGE] = bridge;
    const debug = console.debug;
    const info = console.info;
    const warn = console.warn;
    console.debug = () => {};
    console.info = () => {};
    console.warn = () => {};
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            console.debug = debug;
            console.info = info;
            console.warn = warn;
            if (previous === undefined) delete globalThis[BRIDGE];
            else globalThis[BRIDGE] = previous;
        });
}

test('四个独立文本生成出口各有一块可重放补丁，输出 SHA 与规格一致，上游字节不变', () => {
    const listed = new Set(CORE_PATCH_SPECS.map((file) => path.basename(file)));
    for (const exit of EXITS) {
        const spec = readSpec(exit);
        assert.deepEqual(validateSpec(spec), [], exit.id);
        assert.equal(spec.id, exit.id);
        assert.equal(spec.kind, 'deterministic-string-replacement');
        assert.equal(spec.target, exit.target);
        assert.equal(spec.upstream.component, 'sillytavern');
        assert.equal(spec.upstream.commit, '7e8663cd9c184a550b37238218bdd32c6efc68e9');
        assert.equal(spec.upstream.version, '1.19.0');
        assert.ok(spec.reason.includes('W13'));
        assert.ok(spec.removal_condition);
        assert.equal(spec.replacements.length, 1, '每个出口只插一块入口钩子');
        const extra = insertedLines(spec.replacements[0].from, spec.replacements[0].to);
        assert.ok(extra.some((line) => line.includes(exit.call)), `${exit.id} 必须调用 ${exit.call}`);
        assert.ok(extra.length > 0 && extra.length <= 8, `${exit.id} 插入了 ${extra.length} 行`);
        assert.ok(extra.every((line) => {
            const trimmed = line.trim();
            return trimmed === '' || trimmed === 'return;' || trimmed === '}'
                || line.includes('virtual-companion') || line.includes('vcBridge') || line.includes('guardUnmanagedGeneration');
        }), `${exit.id} 插入了锚点以外的逻辑：\n${extra.join('\n')}`);
        assert.equal(spec.replacements[0].count, 1);

        const srcFile = upstreamPath(exit);
        const before = sha256File(srcFile);
        const input = fs.readFileSync(srcFile, 'utf8');
        assert.equal(input.includes('guardUnmanagedGeneration'), false, `${exit.target} 上游不得已含钩子`);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-gen-spec-'));
        try {
            const outFile = path.join(dir, 'patched.js');
            const applied = applySpecToFile(srcFile, outFile, spec);
            assert.equal(applied.inputSha256, spec.expected_input_sha256);
            assert.equal(applied.outputSha256, spec.expected_output_sha256);
            assert.equal(sha256File(srcFile), before, 'apply 不得改写锁定上游');
            assert.notEqual(path.resolve(outFile), path.resolve(srcFile));
            const region = handlerRegion(applied.output, exit.marker);
            const hookAt = region.indexOf('guardUnmanagedGeneration');
            const fetchAt = region.indexOf('fetch(');
            assert.ok(hookAt >= 0 && fetchAt > hookAt, `${exit.id} 钩子必须在联系上游之前`);
            if (exit.emptyCheck) {
                assert.ok(region.indexOf(exit.emptyCheck) < hookAt, `${exit.id} 钩子必须在空 body 判断之后`);
            }
            assert.ok(region.includes("globalThis[Symbol.for('virtual-companion.bridge')]"));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        assert.ok(listed.has(`${exit.id}.json`), `${exit.id} 必须进入 CORE_PATCH_SPECS，供 assemble-managed 重放`);
    }
});

test('受管桥存在时四个路由在联系上游前拒绝且不回显正文；桥不存在时为空操作', async () => {
    const { guardUnmanagedGeneration } = await import('../server-plugin/virtual-companion/lib/unmanaged-generation-guard.js');
    for (const exit of EXITS) {
        const spec = readSpec(exit);
        const patched = applySpecToText(fs.readFileSync(upstreamPath(exit), 'utf8'), spec).output;
        const { mod, dir } = await loadPatched(patched);
        try {
            const hit = mod.router.routes.find((route) => route.path === exit.route);
            assert.ok(hit, `${exit.id} 未注册 ${exit.route}`);

            await withBridge({ guardUnmanagedGeneration }, async () => {
                mod.__vcFetchCalls.length = 0;
                const res = mockRes();
                await hit.handler(mockReq({ ...FILLED_BODY }), res);
                assert.equal(mod.__vcFetchCalls.length, 0, `${exit.id} 拒绝前不得联系上游`);
                assert.equal(res.statusCode, 409, exit.id);
                const error = JSON.parse(res.body).error;
                assert.equal(error.code, CODE);
                assert.equal(typeof error.message, 'string');
                assert.ok(error.message.length > 0);
                assert.equal(res.body.includes(PROMPT), false, `${exit.id} 拒绝响应不得回显正文`);
                assert.equal(JSON.stringify(error).includes(PROMPT), false);

                mod.__vcFetchCalls.length = 0;
                const again = mockRes();
                await hit.handler(mockReq({ ...FILLED_BODY, prompt: PROMPT + '-2' }), again);
                assert.equal(JSON.parse(again.body).error.code, CODE, '错误码必须固定');
                assert.equal(JSON.parse(again.body).error.message, error.message, '错误文案必须固定');
            });

            await withBridge({
                async guardUnmanagedGeneration(_request, response) {
                    response.statusCode = 409;
                    response.end('{"error":{"code":"VC_UNVALIDATED_GENERATION","message":"fixed"}}');
                    return false;
                },
            }, async () => {
                mod.__vcFetchCalls.length = 0;
                const res = mockRes();
                await hit.handler(mockReq({ ...FILLED_BODY }), res);
                assert.equal(mod.__vcFetchCalls.length, 0, `${exit.id} 桥对象存在时一律不得联系上游`);
            });

            await withBridge(undefined, async () => {
                mod.__vcFetchCalls.length = 0;
                const res = mockRes();
                await hit.handler(mockReq({ ...FILLED_BODY }), res);
                assert.ok(mod.__vcFetchCalls.length >= 1, `${exit.id} 桥不存在时必须保持原生出站`);
            });

            if (exit.emptyCheck) {
                await withBridge({ guardUnmanagedGeneration }, async () => {
                    mod.__vcFetchCalls.length = 0;
                    const res = mockRes();
                    await hit.handler(mockReq(undefined), res);
                    assert.equal(res.statusCode, 400, `${exit.id} 空 body 仍走原生 400`);
                    assert.equal(mod.__vcFetchCalls.length, 0);
                    assert.equal(res.body.includes(CODE), false);
                });
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

test('插件把 guardUnmanagedGeneration 挂到桥上，且不改写 generate-bridge 的现有导出', async () => {
    const indexSrc = fs.readFileSync(path.join(INTEG, 'server-plugin', 'virtual-companion', 'index.js'), 'utf8');
    assert.match(indexSrc, /import \{ guardUnmanagedGeneration \} from '\.\/lib\/unmanaged-generation-guard\.js'/);
    assert.match(indexSrc, /globalThis\[BRIDGE_SYMBOL\] = \{[^}]*guardUnmanagedGeneration[^}]*\}/);
    const generateSrc = fs.readFileSync(path.join(INTEG, 'server-plugin', 'virtual-companion', 'lib', 'generate-bridge.js'), 'utf8');
    assert.equal(generateSrc.includes('guardUnmanagedGeneration'), false);
    const { guardUnmanagedGeneration } = await import('../server-plugin/virtual-companion/lib/unmanaged-generation-guard.js');
    const res = mockRes();
    assert.equal(await guardUnmanagedGeneration({ body: { prompt: PROMPT, input: PROMPT } }, res), true);
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).error.code, CODE);
    assert.equal(res.body.includes(PROMPT), false);
});
