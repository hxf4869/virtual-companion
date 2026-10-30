import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { absorbStreamAbort } from '../server-plugin/virtual-companion/lib/stream-abort.js';
import { settleArmedResponse, uninstallUsageFetch } from '../server-plugin/virtual-companion/lib/model-usage.js';

function abortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    error.type = 'aborted';
    return error;
}

test('pipe 在没有持久 error 监听时会把 AbortError 重新抛出', () => {
    const body = new PassThrough();
    const dest = new PassThrough();
    body.pipe(dest);
    assert.throws(() => body.emit('error', abortError()), (error) => error?.name === 'AbortError');
    dest.destroy();
});

test('absorbStreamAbort 让客户端中断在 pipe 之后安静结束', () => {
    const body = new PassThrough();
    const dest = new PassThrough();
    absorbStreamAbort(body);
    absorbStreamAbort(body);
    body.pipe(dest);
    assert.doesNotThrow(() => body.emit('error', abortError()));
    dest.destroy();
    body.destroy();
});

test('settleArmedResponse 在没有预留时也接住响应体中断', () => {
    uninstallUsageFetch();
    const body = new PassThrough();
    const dest = new PassThrough();
    settleArmedResponse({ body }, 'http://127.0.0.1/upstream', {});
    body.pipe(dest);
    assert.doesNotThrow(() => body.emit('error', abortError()));
    dest.destroy();
    body.destroy();
});

test('插件入口不再改写 AbortController 或替换 uncaughtException', () => {
    const src = fs.readFileSync(new URL('../server-plugin/virtual-companion/index.js', import.meta.url), 'utf8');
    assert.equal(src.includes('AbortController'), false);
    assert.equal(src.includes('uncaughtException'), false);
    assert.equal(src.includes('guardClientAbort'), false);
});

function streamError(code, message = 'upstream failure') {
    const error = new Error(message);
    error.code = code;
    return error;
}

function captureWarn(run) {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    try {
        run();
    } finally {
        console.warn = orig;
    }
    return warnings;
}

function pipedBody() {
    const body = new PassThrough();
    const dest = new PassThrough();
    dest.on('error', () => {});
    absorbStreamAbort(body);
    body.pipe(dest);
    return { body, dest };
}

test('带 ABORT_ERR 的 AbortError 仍然安静结束，不 destroy 下游', () => {
    const { body, dest } = pipedBody();
    const error = abortError();
    error.code = 'ABORT_ERR';
    const warnings = captureWarn(() => {
        assert.doesNotThrow(() => body.emit('error', error));
    });
    assert.equal(warnings.length, 0);
    assert.equal(dest.destroyed, false);
    dest.destroy();
    body.destroy();
});

test('只有 type===aborted 时也安静结束', () => {
    const { body, dest } = pipedBody();
    const error = new Error('stopped');
    error.type = 'aborted';
    const warnings = captureWarn(() => {
        assert.doesNotThrow(() => body.emit('error', error));
    });
    assert.equal(warnings.length, 0);
    assert.equal(dest.destroyed, false);
    dest.destroy();
    body.destroy();
});

test('ERR_STREAM_PREMATURE_CLOSE 记录 name 与 code，并 destroy 下游', () => {
    const { body, dest } = pipedBody();
    const error = streamError('ERR_STREAM_PREMATURE_CLOSE', 'SECRET-STREAM-BODY');
    const warnings = captureWarn(() => {
        assert.doesNotThrow(() => body.emit('error', error));
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /name=Error/);
    assert.match(warnings[0], /code=ERR_STREAM_PREMATURE_CLOSE/);
    assert.equal(warnings[0].includes('SECRET-STREAM-BODY'), false);
    assert.equal(dest.destroyed, true);
    assert.equal(dest.errored, error);
    body.destroy();
});

test('其他上游错误同样记录 name 与 code 并 destroy 下游', () => {
    const { body, dest } = pipedBody();
    const error = streamError('ECONNRESET', 'SECRET-STREAM-BODY');
    error.name = 'FetchError';
    const warnings = captureWarn(() => {
        assert.doesNotThrow(() => body.emit('error', error));
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /name=FetchError/);
    assert.match(warnings[0], /code=ECONNRESET/);
    assert.equal(warnings[0].includes('SECRET-STREAM-BODY'), false);
    assert.equal(dest.destroyed, true);
    body.destroy();
});

test('后补的响应对象在非中断错误时被 destroy', () => {
    const body = new PassThrough();
    const response = {
        destroyed: false,
        destroy(error) {
            this.destroyed = true;
            this.error = error;
        },
    };
    absorbStreamAbort(body);
    absorbStreamAbort(body, response);
    const error = streamError('ECONNRESET');
    captureWarn(() => {
        assert.doesNotThrow(() => body.emit('error', error));
    });
    assert.equal(response.destroyed, true);
    assert.equal(response.error, error);
    body.destroy();
});

test('util 流补丁只把 AbortError / type===aborted 当客户端停止', () => {
    const spec = JSON.parse(fs.readFileSync(new URL('../patches/st-util-stream-error-log.json', import.meta.url), 'utf8'));
    const stream = spec.replacements.find((item) => item.to.includes('from.body.on'));
    assert.ok(stream, '成功流替换应挂上 error 监听');
    assert.match(stream.to, /error\?\.name === 'AbortError'/);
    assert.match(stream.to, /error\?\.type === 'aborted'/);
    assert.equal(stream.to.includes('ERR_STREAM_PREMATURE_CLOSE'), false);
    assert.equal(stream.to.includes('ABORT_ERR'), false);
    assert.match(stream.to, /name=\$\{error\?\.name \|\| 'Error'\} code=\$\{error\?\.code \|\| ''\}/);
    assert.match(stream.to, /to\.destroy\(error\)/);
    assert.equal(stream.to.includes('error?.message'), false);
    assert.equal(stream.to.includes('${detail}'), false);
});

test('补丁锁仍指向同一份上游 util.js', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'patches', 'st-util-stream-error-log.json'), 'utf8'));
    assert.equal(spec.expected_input_sha256, 'd33d67234af4e188bb7fcfac9c3ca7952c19e8c58791e96b19f9ad748dd168cd');
    assert.match(spec.expected_output_sha256, /^[0-9a-f]{64}$/);
    assert.notEqual(spec.expected_output_sha256, '450e06c4b0289c921953a5e0016f4049ad9812469c088e3dc8482aa8aeb1e2c1');
});
